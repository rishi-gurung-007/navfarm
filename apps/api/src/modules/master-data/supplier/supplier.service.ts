import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateSupplierDto, UpdateSupplierDto, QuerySupplierDto } from './dto/supplier.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { EncryptionService } from '../../system/encryption/encryption.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class SupplierService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly encryptionService: EncryptionService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** ANIMAL_SUPPLIER needs both docs; BREEDING_FARM needs its registration code. */
  private assertVendorTypeRequirements(vendorType: string, healthCertUrl?: string | null, breedingFarmCode?: string | null) {
    if (vendorType === 'ANIMAL_SUPPLIER' && (!healthCertUrl || !breedingFarmCode)) {
      throw new BadRequestException('ANIMAL_SUPPLIER vendors require both health_cert_url and breeding_farm_code.');
    }
    if (vendorType === 'BREEDING_FARM' && !breedingFarmCode) {
      throw new BadRequestException('BREEDING_FARM vendors require breeding_farm_code.');
    }
  }

  /** Never returns bank_account_no_enc — replaces it with a decrypt-only-to-mask last-4 display value. */
  private maskSupplier(supplier: typeof schema.supplierMaster.$inferSelect) {
    const { bank_account_no_enc, ...rest } = supplier;
    let bank_account_last4: string | null = null;
    if (bank_account_no_enc) {
      try {
        bank_account_last4 = EncryptionService.maskLast4(this.encryptionService.decrypt(bank_account_no_enc));
      } catch {
        bank_account_last4 = null;
      }
    }
    return { ...rest, bank_account_last4 };
  }

  async create(dto: CreateSupplierDto, tenantId: string, userPayload?: any) {
    // 1. Verify company exists
    if (dto.company_id) {
      const [company] = await this.db
        .select()
        .from(schema.companyMaster)
        .where(and(companyCondition(schema.companyMaster.company_id, dto.company_id), isNull(schema.companyMaster.deleted_at)))
        .limit(1);

      if (!company) {
        throw new NotFoundException(`Company with ID '${dto.company_id}' not found.`);
      }
    }

    const vendorType = dto.vendor_type || 'GENERAL';
    this.assertVendorTypeRequirements(vendorType, dto.health_cert_url, dto.breeding_farm_code);

    await this.numberSeriesService.ensureCompanySeries(
      tenantId,
      dto.company_id,
      { seriesCode: 'SUPPLIER', seriesName: 'Supplier Code', documentType: 'SUPPLIER', prefix: 'SUP', seqLength: 3 },
      async () => {
        const rows = await this.db.select({ code: schema.supplierMaster.supplier_code }).from(schema.supplierMaster).where(and(
          eq(schema.supplierMaster.tenant_id, tenantId),
          companyCondition(schema.supplierMaster.company_id, dto.company_id),
        ));
        return rows.map((row) => row.code);
      },
    );
    const supplierCode = dto.supplier_code?.trim()
      ? await this.numberSeriesService.manualCode('SUPPLIER', dto.supplier_code, tenantId, dto.company_id)
      : await this.numberSeriesService.generateNext('SUPPLIER', tenantId, dto.company_id, undefined, dto as unknown as Record<string, unknown>);

    const supplierId = randomUUID();
    const newSupplier = {
      supplier_id: supplierId,
      tenant_id: tenantId,
      nob_id: (dto as any).nob_id ?? null,
      lob_id: (dto as any).lob_id ?? null,
      company_id: dto.company_id || null,
      supplier_code: supplierCode,
      supplier_name: dto.supplier_name,
      email: dto.email || null,
      phone: dto.phone || null,
      tax_number: dto.tax_number || null,
      payment_terms: dto.payment_terms || null,
      address_line1: dto.address_line1 || null,
      city: dto.city || null,
      state: dto.state || null,
      country: dto.country || null,
      pincode: dto.pincode || null,
      vendor_type: vendorType,
      health_cert_url: dto.health_cert_url || null,
      breeding_farm_code: dto.breeding_farm_code || null,
      bank_account_no_enc: dto.bank_account_no ? this.encryptionService.encrypt(dto.bank_account_no) : null,
      bank_ifsc: dto.bank_ifsc || null,
      credit_limit: dto.credit_limit?.toString() || null,
      is_approved: false,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.supplierMaster).values(newSupplier);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'supplier_master',
      entityId: supplierId,
      newValues: { ...newSupplier, bank_account_no_enc: newSupplier.bank_account_no_enc ? '[REDACTED]' : null },
    });

    return this.findOne(supplierId);
  }

  async findOne(id: string) {
    const [supplier] = await this.db
      .select()
      .from(schema.supplierMaster)
      .where(and(eq(schema.supplierMaster.supplier_id, id), isNull(schema.supplierMaster.deleted_at)))
      .limit(1);

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID '${id}' not found.`);
    }

    return this.maskSupplier(supplier);
  }

  async findAll(query: QuerySupplierDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.supplierMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.supplierMaster, query.companyId));
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.supplierMaster.is_active, query.isActive));
    }
    if (query.vendorType) {
      conditions.push(eq(schema.supplierMaster.vendor_type, query.vendorType));
    }
    if (query.isApproved !== undefined) {
      conditions.push(eq(schema.supplierMaster.is_approved, query.isApproved));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.supplierMaster.supplier_code, `%${query.search}%`),
          like(schema.supplierMaster.supplier_name, `%${query.search}%`),
          like(schema.supplierMaster.tax_number, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.supplierMaster, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const rows = await this.db
      .select()
      .from(schema.supplierMaster)
      .where(and(...conditions))
      .orderBy(listOrderBy(schema.supplierMaster, query, schema.supplierMaster.supplier_code))
      .limit(limit)
      .offset(offset);

    return rows.map((row) => this.maskSupplier(row));
  }

  async update(id: string, dto: UpdateSupplierDto, tenantId: string, userPayload?: any) {
    const supplier = await this.findOne(id);

    if (dto.supplier_code && dto.supplier_code.toUpperCase() !== supplier.supplier_code) {
      throw new ConflictException('Supplier Code is generated from the company-wide SUPPLIER sequence and cannot be changed.');
    }

    // Re-validate COND rules against the effective (post-update) values, same "dto value if
    // touched, else existing row's" pattern used across every other phase's update() methods.
    const effectiveVendorType = dto.vendor_type ?? supplier.vendor_type;
    const effectiveHealthCertUrl = dto.health_cert_url !== undefined ? dto.health_cert_url : supplier.health_cert_url;
    const effectiveBreedingFarmCode = dto.breeding_farm_code !== undefined ? dto.breeding_farm_code : supplier.breeding_farm_code;
    this.assertVendorTypeRequirements(effectiveVendorType, effectiveHealthCertUrl, effectiveBreedingFarmCode);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.supplier_name !== undefined) updates.supplier_name = dto.supplier_name;
    if (dto.email !== undefined) updates.email = dto.email;
    if (dto.phone !== undefined) updates.phone = dto.phone;
    if (dto.tax_number !== undefined) updates.tax_number = dto.tax_number;
    if (dto.payment_terms !== undefined) updates.payment_terms = dto.payment_terms;
    if (dto.address_line1 !== undefined) updates.address_line1 = dto.address_line1;
    if (dto.city !== undefined) updates.city = dto.city;
    if (dto.state !== undefined) updates.state = dto.state;
    if (dto.country !== undefined) updates.country = dto.country;
    if (dto.pincode !== undefined) updates.pincode = dto.pincode;
    if (dto.vendor_type !== undefined) updates.vendor_type = dto.vendor_type;
    if (dto.health_cert_url !== undefined) updates.health_cert_url = dto.health_cert_url;
    if (dto.breeding_farm_code !== undefined) updates.breeding_farm_code = dto.breeding_farm_code;
    if (dto.bank_account_no !== undefined) updates.bank_account_no_enc = dto.bank_account_no ? this.encryptionService.encrypt(dto.bank_account_no) : null;
    if (dto.bank_ifsc !== undefined) updates.bank_ifsc = dto.bank_ifsc;
    if (dto.credit_limit !== undefined) updates.credit_limit = dto.credit_limit?.toString() || null;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.supplierMaster)
      .set(updates)
      .where(eq(schema.supplierMaster.supplier_id, id));

    await this.auditService.log({
      tenantId,
      companyId: supplier.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'supplier_master',
      entityId: id,
      oldValues: supplier,
      newValues: { ...updates, bank_account_no_enc: updates.bank_account_no_enc !== undefined ? '[REDACTED]' : undefined },
    });

    return this.findOne(id);
  }

  /**
   * Distinct business action, not folded into update() — a vendor cannot be used in a PO
   * until is_approved=TRUE per spec (this codebase has no PO entity yet to enforce that
   * against, so this just records the approval; enforcement is a documented follow-up).
   */
  async approve(id: string, tenantId: string, userPayload?: any) {
    const supplier = await this.findOne(id);

    if (supplier.is_approved) {
      throw new BadRequestException(`Supplier '${supplier.supplier_name}' is already approved.`);
    }

    await this.db
      .update(schema.supplierMaster)
      .set({
        is_approved: true,
        approved_by: userPayload?.userId || null,
        approved_at: toMysqlTimestamp() as any,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.supplierMaster.supplier_id, id));

    await this.auditService.log({
      tenantId,
      companyId: supplier.company_id || undefined,
      userId: userPayload?.userId,
      action: 'APPROVE',
      entityName: 'supplier_master',
      entityId: id,
      newValues: { is_approved: true, approved_by: userPayload?.userId },
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const supplier = await this.findOne(id);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.supplierMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.supplierMaster.supplier_id, id));

    await this.auditService.log({
      tenantId,
      companyId: supplier.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'supplier_master',
      entityId: id,
      oldValues: supplier,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Supplier '${supplier.supplier_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [supplier] = await this.db
      .select()
      .from(schema.supplierMaster)
      .where(eq(schema.supplierMaster.supplier_id, id))
      .limit(1);

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID '${id}' not found.`);
    }

    if (!supplier.deleted_at) {
      return supplier;
    }

    await this.db
      .update(schema.supplierMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.supplierMaster.supplier_id, id));

    await this.auditService.log({
      tenantId,
      companyId: supplier.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'supplier_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}
