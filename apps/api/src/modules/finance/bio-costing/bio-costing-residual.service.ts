import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { isDuplicateEntry } from '../../../common/filters/http-exception.filter';
import { animalScopeConditions, assertCompanyInScope, farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { resolveResidual, settingResidual, validateResidualSetting, type ProfileTerms, type ResidualSetting } from './bio-costing.rules';
import type { CreateResidualSettingDto, SetAnimalResidualDto } from './bio-costing-residual.dto';
import { bioEventCondition, bioEventsCondition } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The company's residual value: the default every animal is written down to, per sex and from a date, which an animal may override with
 * her own. The run, the animal card and the setup screen all read it here, so there is one answer to "what is her residual".
 */
@Injectable()
export class BioCostingResidualService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /** Every setting of the company, newest first within a sex, each with the figure it works out to. */
  async list(tenantId: string, companyId: string) {
    const S = schema.bioCostingResidualSetting;
    const rows = await this.db.select().from(S).where(and(eq(S.tenant_id, tenantId), eq(S.company_id, companyId))).orderBy(asc(S.gender), desc(S.effective_from));
    return rows.map((r) => ({ ...r, residual_value: settingResidual(r as ResidualSetting) }));
  }

  /** The raw settings, for the run to resolve each animal against. */
  async settingsOf(tenantId: string, companyId: string): Promise<ResidualSetting[]> {
    const S = schema.bioCostingResidualSetting;
    return (await this.db.select().from(S).where(and(eq(S.tenant_id, tenantId), eq(S.company_id, companyId)))) as ResidualSetting[];
  }

  async add(dto: CreateResidualSettingDto, tenantId: string, companyId: string, userId?: string) {
    assertCompanyInScope(farmScope(this.cls), companyId);
    const errors = validateResidualSetting(dto as ResidualSetting);
    if (errors.length) throw new BadRequestException(errors);
    const setting_id = randomUUID();
    try {
      await this.db.insert(schema.bioCostingResidualSetting).values({
        setting_id, tenant_id: tenantId, company_id: companyId, gender: dto.gender, residual_rule: dto.residual_rule,
        residual_fixed_amount: dto.residual_rule === 'FIXED' ? String(dto.residual_fixed_amount) : null,
        residual_weight_kg: dto.residual_rule === 'WEIGHT_X_PRICE' ? String(dto.residual_weight_kg) : null,
        residual_price_per_kg: dto.residual_rule === 'WEIGHT_X_PRICE' ? String(dto.residual_price_per_kg) : null,
        effective_from: dto.effective_from, note: dto.note ?? null, created_by: userId ?? null,
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw new ConflictException(`The ${dto.gender === 'F' ? 'female' : 'male'} residual already has a setting from ${dto.effective_from}; give a later date for a change.`);
      throw error;
    }
    await this.audit.log({ tenantId, companyId, userId, action: 'CREATE', entityName: 'bio_costing_residual_setting', entityId: setting_id, newValues: dto });
    return (await this.list(tenantId, companyId)).find((r) => r.setting_id === setting_id);
  }

  private async loadAnimal(animalId: string, tenantId: string) {
    const A = schema.animalRegister;
    const [animal] = await this.db.select().from(A).where(and(eq(A.animal_id, animalId), eq(A.tenant_id, tenantId), ...animalScopeConditions(farmScope(this.cls)))).limit(1);
    if (!animal) throw new NotFoundException(`Animal '${animalId}' not found.`);
    return animal;
  }

  /** The residual an animal is written down to on a date, and where it comes from. */
  async forAnimal(animalId: string, tenantId: string, onDate: string = today()) {
    const animal = await this.loadAnimal(animalId, tenantId);
    const [profile] = animal.costing_profile_id
      ? await this.db.select().from(schema.bioCostingProfile).where(eq(schema.bioCostingProfile.profile_id, animal.costing_profile_id)).limit(1)
      : [];
    const settings = await this.settingsOf(tenantId, animal.company_id);
    const resolved = resolveResidual({ animalOverride: animal.residual_value, settings, profile: (profile ?? { costing_method: 'AMORTIZATION', start_age_weeks: 0 }) as unknown as ProfileTerms, gender: animal.gender, onDate });
    // The latest month's amortisation she has actually been charged (a reversed month nets to nothing and is passed over).
    const L = schema.bioAssetLedger;
    const [latest] = await this.db.select({ date: L.posting_date, total: sql<string>`SUM(${L.cost_amount})` }).from(L)
      .where(and(eq(L.animal_id, animalId), bioEventCondition(L, 'AMORTIZATION')))
      .groupBy(L.posting_date).having(sql`SUM(${L.cost_amount}) < 0`).orderBy(desc(L.posting_date)).limit(1);
    return {
      animal_id: animalId, residual: resolved.value, source: resolved.source, own_residual: animal.residual_value, costing_profile_id: animal.costing_profile_id,
      latest_amortisation: latest ? Math.abs(Number(latest.total)) : null, latest_amortisation_date: latest?.date ?? null,
    };
  }

  /**
   * Gives an animal her own residual, or takes it away so the company setting applies again. The reason goes to the audit log. A month that is
   * already posted is not touched: each run line keeps the residual it used, and this applies from the next run.
   */
  async setForAnimal(animalId: string, dto: SetAnimalResidualDto, tenantId: string, userId?: string) {
    const animal = await this.loadAnimal(animalId, tenantId);
    const next = dto.residual_value === undefined || dto.residual_value === null ? null : String(dto.residual_value);
    await this.db.update(schema.animalRegister).set({ residual_value: next, updated_by: userId ?? null }).where(eq(schema.animalRegister.animal_id, animalId));
    await this.audit.log({
      tenantId, companyId: animal.company_id, userId, action: 'UPDATE', entityName: 'animal_register', entityId: animalId,
      oldValues: { residual_value: animal.residual_value }, newValues: { residual_value: next, reason: dto.reason },
    });
    return this.forAnimal(animalId, tenantId);
  }
}
