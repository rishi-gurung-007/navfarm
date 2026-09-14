import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, desc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { RecordMedicationDto } from './dto/animal-medication-log.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { animalScopeConditions, farmScope } from '../../../common/farm-scope';

@Injectable()
export class AnimalMedicationLogService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(animalId: string, dto: RecordMedicationDto, tenantId: string, userPayload?: any) {
    const [animal] = await this.db
      .select()
      .from(schema.animalRegister)
      .where(and(
        eq(schema.animalRegister.animal_id, animalId),
        eq(schema.animalRegister.tenant_id, tenantId),
        ...animalScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    if (!animal) {
      throw new NotFoundException(`Animal with ID '${animalId}' not found.`);
    }

    const [item] = await this.db
      .select()
      .from(schema.itemMaster)
      .where(and(
        eq(schema.itemMaster.item_id, dto.item_id),
        eq(schema.itemMaster.tenant_id, tenantId),
        eq(schema.itemMaster.company_id, animal.company_id),
      ))
      .limit(1);
    if (!item) {
      throw new NotFoundException(`Item with ID '${dto.item_id}' not found.`);
    }

    const logId = randomUUID();
    await this.db.insert(schema.animalMedicationLog).values({
      log_id: logId,
      tenant_id: tenantId,
      company_id: animal.company_id,
      animal_id: animalId,
      item_id: dto.item_id,
      administered_date: dto.administered_date,
      dose_qty: dto.dose_qty?.toString() ?? null,
      uom: dto.uom || null,
      administered_by: dto.administered_by || null,
      notes: dto.notes || null,
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: animal.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'animal_medication_log',
      entityId: logId,
      newValues: dto,
    });

    const [log] = await this.db
      .select()
      .from(schema.animalMedicationLog)
      .where(eq(schema.animalMedicationLog.log_id, logId))
      .limit(1);
    return log;
  }

  async findByAnimal(animalId: string) {
    const [animal] = await this.db.select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(and(eq(schema.animalRegister.animal_id, animalId), ...animalScopeConditions(farmScope(this.cls))))
      .limit(1);
    if (!animal) throw new NotFoundException(`Animal with ID '${animalId}' not found.`);
    return this.db
      .select()
      .from(schema.animalMedicationLog)
      .where(eq(schema.animalMedicationLog.animal_id, animalId))
      .orderBy(desc(schema.animalMedicationLog.administered_date));
  }
}
