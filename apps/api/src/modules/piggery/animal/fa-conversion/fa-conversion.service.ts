import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, getTableColumns, like } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../../core/database/schema';
import { withTenantTransaction } from '../../../../common/tenant-transaction';
import { isDuplicateEntry } from '../../../../common/filters/http-exception.filter';
import { AuditLogService } from '../../../system/audit-log/audit-log.service';
import { AnimalBookValueService } from '../../../inventory/bio-asset-ledger/animal-book-value.service';
import { InventoryLedgerService } from '../../../inventory/inventory-ledger/inventory-ledger.service';
import { AnimalService } from '../animal.service';
import type { ApproveFaConversionDto, PostFaConversionDto, QueryFaConversionDto, RejectFaConversionDto, RequestFaConversionDto } from './fa-conversion.dto';
import {
  assertApprover, assertConversionDate, assertRequestable, CONVERSION_ITEM_CODE, CONVERSION_ITEM_NAME, conversionGainLoss,
} from './fa-conversion.rules';

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/**
 * TDD row 11, Sale of Fixed Asset (Cull). A culled breeding animal is converted from a fixed asset to inventory in NAVFarm first, and Finance must approve:
 * request (the farm), approve with a market value (Finance, not the requester), post. Posting is one transaction: the animal leaves the herd as CONVERTED_INV
 * through the same exit a disposal makes (batch counts, ledger row, accumulated amortisation cleared, her book value relieved), the market value is booked as
 * inventory against the asset and the difference as gain or loss, and she is received into inventory (one lot, her animal code) at the market value.
 * The two BC entry numbers stay empty until there is a Business Central link. Transfer order, kill sheet and sales invoice are a later phase.
 */
@Injectable()
export class FaConversionService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
    private readonly animals: AnimalService,
    private readonly animalBookValue: AnimalBookValueService,
    private readonly inventory: InventoryLedgerService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async nextNo(tenantId: string, companyId: string): Promise<string> {
    const year = today().slice(0, 4);
    const T = schema.faInventoryConversion;
    const [row] = await this.db.select({ no: T.conversion_no }).from(T)
      .where(and(eq(T.tenant_id, tenantId), eq(T.company_id, companyId), like(T.conversion_no, `FAC-${year}-%`))).orderBy(desc(T.conversion_no)).limit(1);
    const last = row ? Number(row.no.split('-')[2]) || 0 : 0;
    return `FAC-${year}-${String(last + 1).padStart(5, '0')}`;
  }

  private async load(id: string, tenantId: string) {
    const T = schema.faInventoryConversion;
    const [row] = await this.db.select().from(T).where(and(eq(T.conversion_id, id), eq(T.tenant_id, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Conversion request not found.');
    return row;
  }

  async findOne(id: string, tenantId: string) {
    const row = await this.load(id, tenantId);
    const [animal] = await this.db.select({ code: schema.animalRegister.animal_code, rfid: schema.animalRegister.rfid_tag }).from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, row.animal_id)).limit(1);
    return { ...row, animal_code: animal?.code ?? null, rfid_tag: animal?.rfid ?? null };
  }

  async findAll(query: QueryFaConversionDto, tenantId: string, companyId?: string) {
    const T = schema.faInventoryConversion;
    return this.db.select({ ...getTableColumns(T), animal_code: schema.animalRegister.animal_code, rfid_tag: schema.animalRegister.rfid_tag }).from(T)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, T.animal_id)).where(and(
        eq(T.tenant_id, tenantId), ...(companyId ? [eq(T.company_id, companyId)] : []),
        ...(query.status ? [eq(T.status, query.status)] : []), ...(query.animal_id ? [eq(T.animal_id, query.animal_id)] : []),
      )).orderBy(desc(T.created_at));
  }

  /** The farm raises the request, from an animal already taken out of production. One open request per animal. */
  async request(dto: RequestFaConversionDto, tenantId: string, userId?: string) {
    const A = schema.animalRegister;
    const [animal] = await this.db.select().from(A).where(and(eq(A.animal_id, dto.animal_id), eq(A.tenant_id, tenantId))).limit(1);
    if (!animal) throw new NotFoundException('Animal not found.');
    assertRequestable({
      animal_code: animal.animal_code, is_active: !!animal.is_active,
      costing_start_date: animal.costing_start_date ? String(animal.costing_start_date).slice(0, 10) : null,
      out_of_production_date: animal.out_of_production_date ? String(animal.out_of_production_date).slice(0, 10) : null,
    });
    const T = schema.faInventoryConversion;
    const id = randomUUID();
    const no = await this.nextNo(tenantId, animal.company_id);
    try {
      await this.db.insert(T).values({
        conversion_id: id, tenant_id: tenantId, company_id: animal.company_id, conversion_no: no, animal_id: animal.animal_id, item_id: animal.item_id,
        status: 'REQUESTED', active_key: animal.animal_id, out_of_production_date: String(animal.out_of_production_date).slice(0, 10),
        exit_weight_kg: dto.exit_weight_kg != null ? String(dto.exit_weight_kg) : null, remarks: dto.remarks ?? null, requested_by: userId ?? null,
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw new ConflictException(`${animal.animal_code} already has an open conversion request; approve, reject or cancel it first.`);
      throw error;
    }
    await this.audit.log({ tenantId, companyId: animal.company_id, userId, action: 'CREATE', entityName: 'fa_inventory_conversion', entityId: id, newValues: { conversion_no: no, animal: animal.animal_code } });
    return this.findOne(id, tenantId);
  }

  /** Finance puts the market value on it and approves. Not by the person who raised it. */
  async approve(id: string, dto: ApproveFaConversionDto, tenantId: string, userId?: string) {
    const row = await this.load(id, tenantId);
    if (row.status !== 'REQUESTED') throw new BadRequestException(`${row.conversion_no} is ${row.status}; only a requested conversion can be approved.`);
    assertApprover(row.requested_by, userId);
    const T = schema.faInventoryConversion;
    await this.db.update(T).set({ status: 'APPROVED', market_value: String(dto.market_value), approved_by: userId ?? null, approved_at: now() }).where(eq(T.conversion_id, id));
    await this.audit.log({ tenantId, companyId: row.company_id, userId, action: 'APPROVE', entityName: 'fa_inventory_conversion', entityId: id, newValues: { market_value: dto.market_value } });
    return this.findOne(id, tenantId);
  }

  async reject(id: string, dto: RejectFaConversionDto, tenantId: string, userId?: string) {
    const row = await this.load(id, tenantId);
    if (row.status !== 'REQUESTED' && row.status !== 'APPROVED') throw new BadRequestException(`${row.conversion_no} is ${row.status}; only an open conversion can be rejected.`);
    const T = schema.faInventoryConversion;
    await this.db.update(T).set({ status: 'REJECTED', active_key: null, rejected_by: userId ?? null, rejected_at: now(), reject_reason: dto.reason }).where(eq(T.conversion_id, id));
    await this.audit.log({ tenantId, companyId: row.company_id, userId, action: 'REJECT', entityName: 'fa_inventory_conversion', entityId: id, newValues: { reason: dto.reason } });
    return this.findOne(id, tenantId);
  }

  /** The farm withdraws its own request before it posts. */
  async cancel(id: string, tenantId: string, userId?: string) {
    const row = await this.load(id, tenantId);
    if (row.status !== 'REQUESTED' && row.status !== 'APPROVED') throw new BadRequestException(`${row.conversion_no} is ${row.status}; only an open conversion can be cancelled.`);
    const T = schema.faInventoryConversion;
    await this.db.update(T).set({ status: 'CANCELLED', active_key: null }).where(eq(T.conversion_id, id));
    await this.audit.log({ tenantId, companyId: row.company_id, userId, action: 'CANCEL', entityName: 'fa_inventory_conversion', entityId: id, newValues: {} });
    return this.findOne(id, tenantId);
  }

  /** The one inventory item every converted animal is received as; created for the company the first time. */
  private async conversionItem(companyId: string, tenantId: string, like: { nob_id: string | null; lob_id: string | null }) {
    const I = schema.itemMaster;
    const [found] = await this.db.select().from(I).where(and(eq(I.company_id, companyId), eq(I.item_code, CONVERSION_ITEM_CODE))).limit(1);
    if (found) return found;
    const id = randomUUID();
    await this.db.insert(I).values({
      item_id: id, tenant_id: tenantId, company_id: companyId, item_code: CONVERSION_ITEM_CODE, item_name: CONVERSION_ITEM_NAME, item_type: 'FINISHED_GOODS',
      uom_primary: 'HEAD', is_lot_tracked: true, is_serial_tracked: false, is_inventoriable: true, is_biological_asset: false, status: 'ACTIVE', is_active: true,
      nob_id: like.nob_id, lob_id: like.lob_id,
    } as any);
    const [made] = await this.db.select().from(I).where(eq(I.item_id, id)).limit(1);
    return made;
  }

  /** Posts an approved conversion, in one transaction. */
  async post(id: string, dto: PostFaConversionDto, tenantId: string, userId?: string) {
    const row = await this.load(id, tenantId);
    if (row.status !== 'APPROVED' || row.market_value == null) {
      throw new BadRequestException(`${row.conversion_no} is ${row.status}; Finance must approve it, with a market value, before it posts.`);
    }
    assertConversionDate(dto.conversion_date, String(row.out_of_production_date).slice(0, 10), today());
    const marketValue = Number(row.market_value);

    await withTenantTransaction(this.cls, async () => {
      const [animal] = await this.db.select().from(schema.animalRegister).where(eq(schema.animalRegister.animal_id, row.animal_id)).limit(1);
      if (!animal || !animal.is_active) throw new BadRequestException('The animal has already left the herd.');
      const item = await this.conversionItem(row.company_id, tenantId, { nob_id: animal.nob_id, lob_id: animal.lob_id });
      // What she is carried at before she leaves: the figure the gain or loss is against.
      const derived = await this.animalBookValue.valueOf(animal.animal_id);
      const nbv = derived.hasRows ? derived.bookValue : Number(animal.book_value ?? 0);

      await this.animals.dispose(animal.animal_id, {
        disposal_type: 'CONVERTED', disposal_date: dto.conversion_date, disposal_value: marketValue, exit_weight_kg: row.exit_weight_kg != null ? Number(row.exit_weight_kg) : undefined,
        disposal_destination: `Inventory: ${CONVERSION_ITEM_NAME}`, notes: row.conversion_no,
      } as any, tenantId, { userId }, { conversion: true });

      const farmId = animal.current_location_id
        ? (await this.db.select({ farm: schema.locationMaster.farm_id }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, animal.current_location_id)).limit(1))[0]?.farm ?? animal.current_location_id
        : null;
      const received = await this.inventory.writePositiveEntry({
        tenantId, companyId: row.company_id, itemId: item.item_id, documentType: 'FA_CONVERSION', documentNo: row.conversion_no, postingDate: dto.conversion_date,
        transactionType: 'VARIANCE_POSITIVE', glMappingType: 'BIO_FA_CONVERSION', quantity: 1, uom: 'HEAD', rate: marketValue, amount: marketValue, lotNo: animal.animal_code,
        warehouseId: farmId ?? undefined, userId,
      });

      const T = schema.faInventoryConversion;
      await this.db.update(T).set({
        status: 'POSTED', active_key: null, conversion_date: dto.conversion_date, nbv_at_conversion: String(nbv), gain_loss: String(conversionGainLoss(marketValue, nbv)),
        inventory_ledger_id: (received as { ledger_id: string }).ledger_id, lot_no: animal.animal_code, posted_by: userId ?? null, posted_at: now(),
      }).where(eq(T.conversion_id, id));
      await this.audit.log({ tenantId, companyId: row.company_id, userId, action: 'POST', entityName: 'fa_inventory_conversion', entityId: id, newValues: { nbv, market_value: marketValue } });
    });
    return this.findOne(id, tenantId);
  }
}
