import { withTenantTransaction } from '../../../common/tenant-transaction';
import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateSupplierDto, UpdateSupplierDto, QuerySupplierDto } from './dto/supplier.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { EncryptionService } from '../../system/encryption/encryption.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { listFilterConditions, listOrderBy, runMasterList } from '../../../common/master-list-query';
import { assertCodeUnchanged } from '../../../common/master-code';
import { readBusinessCentralConfig } from '../../integration/business-central/business-central.config';
import { BC_LOCKED_DTO_FIELDS } from '../../integration/business-central/vendor-sync/bc-vendor.mapper';
import { BC_WRITABLE_SUPPLIER_FIELDS, changedBcFields } from '../../integration/business-central/vendor-sync/bc-vendor.writer';
import { BcVendorWriteService } from '../../integration/business-central/vendor-sync/bc-vendor-write.service';

/** BC vendor fields a NAVFarm-created supplier may also hold (0257). */
const BC_REFERENCE_FIELDS = ['registration_number', 'currency_code', 'gen_bus_posting_group', 'vendor_posting_group', 'purchaser_code', 'bc_name_2'] as const;
const KEEP_CASE = new Set<string>(['registration_number', 'bc_name_2']);

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

const BC_OWNED_MESSAGE =
  'This vendor is maintained in Business Central. Change it on the BC Vendor Card; the vendor sync brings the change here.';

/** Same value for the lock check: '' / null / undefined are all "empty", strings compare trimmed. */
const sameValue = (a: unknown, b: unknown) => {
  const norm = (v: unknown) => (v === undefined || v === null || v === '' ? null : typeof v === 'string' ? v.trim() : v);
  return norm(a) === norm(b);
};

@Injectable()
export class SupplierService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly encryptionService: EncryptionService,
    private readonly numberSeriesService: NumberSeriesService,
    // Optional so the supplier master still works (and its tests still build) without the BC module.
    @Optional() private readonly bcVendors?: BcVendorWriteService,
  ) {}

  /** BC is the vendor master and reachable: create/update/delete/restore of BC suppliers go to BC first. */
  private get bcWriteThrough(): boolean {
    return !!this.bcVendors?.writeThrough;
  }

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
      throw new BadRequestException('An animal vendor needs both a Health Certificate URL and a Breeding Farm Registration No.');
    }
    if (vendorType === 'BREEDING_FARM' && !breedingFarmCode) {
      throw new BadRequestException('A breeding farm vendor needs a Breeding Farm Registration No.');
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
    // bc_managed: the row is a BC vendor. bc_readonly drives the web form's field lock (lockWhenRowFlag): BC fields are
    // read-only only when NAVFarm cannot write them to BC (write-through off); with write-through they are edited here.
    const bcManaged = rest.source_system === 'BC';
    return { ...rest, bank_account_last4, bc_managed: bcManaged, bc_readonly: bcManaged && !this.bcWriteThrough };
  }

  /** A BC-sourced supplier: only NAVFarm's own fields (vendor type, compliance, bank, credit, NOB/LOB) may change here. */
  private assertBcOwnedUnchanged(supplier: Record<string, any>, dto: Record<string, any>) {
    if (supplier.source_system !== 'BC') return;
    const changed = BC_LOCKED_DTO_FIELDS.filter((field) => dto[field] !== undefined && !sameValue(dto[field], supplier[field]));
    if (changed.length) {
      throw new BadRequestException(`${BC_OWNED_MESSAGE} Fields maintained in BC: ${changed.join(', ')}.`);
    }
  }

  /**
   * Write-through for a BC supplier: changed BC fields are PATCHed to the BC vendor first (ETag-guarded) and the
   * supplier refreshed from BC; deactivating unticks "NavFarm Sync", reactivating ticks it. Returns the dto without
   * the BC fields, so the local update that follows only touches NAVFarm's own fields.
   */
  private async writeBcChanges(supplier: Record<string, any>, dto: UpdateSupplierDto, tenantId: string, userPayload?: any): Promise<UpdateSupplierDto> {
    assertCodeUnchanged('Vendor', supplier.supplier_code, dto.supplier_code);
    const rest: Record<string, any> = { ...dto };
    const vendorNo: string = supplier.bc_vendor_no;

    if (dto.is_active === true && !supplier.is_active) {
      await this.bcVendors!.setNavfarmSync(vendorNo, true, tenantId, userPayload?.userId);
      delete rest.is_active;
      delete rest.status; // BC's Blocked decides whether it is really active
    } else if (dto.is_active === false && supplier.is_active) {
      await this.bcVendors!.setNavfarmSync(vendorNo, false, tenantId, userPayload?.userId);
      rest.status = 'INACTIVE';
    } else {
      delete rest.is_active;
      delete rest.status;
    }

    const changed = changedBcFields(supplier, dto as Record<string, unknown>);
    if (Object.keys(changed).length) {
      await this.bcVendors!.updateVendor({ bc_vendor_no: vendorNo, bc_etag: supplier.bc_etag }, changed, tenantId, userPayload?.userId);
    }
    for (const field of [...BC_WRITABLE_SUPPLIER_FIELDS, 'supplier_code']) delete rest[field];
    return rest as UpdateSupplierDto;
  }

  async create(dto: CreateSupplierDto, tenantId: string, userPayload?: any) {
    if (readBusinessCentralConfig().vendor.masterSource === 'BC') {
      if (this.bcWriteThrough) return this.createInBc(dto, tenantId, userPayload);
      throw new BadRequestException(
        'Vendors are created in Business Central. Create the vendor there and tick "NavFarm Sync" on the Vendor Card; the vendor sync adds it here.',
      );
    }
    // The number is drawn from the series inside this transaction, so a save that fails after it (a duplicate,
    // a bad reference) rolls the counter back instead of burning the number.
    return withTenantTransaction(this.cls, () => this.createRecord(dto, tenantId, userPayload));
  }

  /**
   * BC is the vendor master: the vendor is created in BC first (BC assigns the Vendor No. from its number series and
   * validates the codes), the supplier is stored from BC's reply, and only then are NAVFarm's own fields added.
   * If BC refuses, nothing is stored in NAVFarm.
   */
  private async createInBc(dto: CreateSupplierDto, tenantId: string, userPayload?: any) {
    const vendorType = dto.vendor_type || 'GENERAL';
    this.assertVendorTypeRequirements(vendorType, dto.health_cert_url, dto.breeding_farm_code);
    const bcValues: Record<string, unknown> = {};
    for (const field of BC_WRITABLE_SUPPLIER_FIELDS) {
      const value = (dto as unknown as Record<string, unknown>)[field];
      if (value !== undefined && value !== null && value !== '') bcValues[field] = value;
    }
    const supplierId = await this.bcVendors!.createVendor(bcValues, tenantId, userPayload?.userId);
    await this.db
      .update(schema.supplierMaster)
      .set({
        ...this.navfarmOwnedValues(dto),
        vendor_type: vendorType,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.supplierMaster.supplier_id, supplierId));
    const created = await this.findOne(supplierId);
    await this.auditService.log({
      tenantId,
      companyId: created.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'supplier_master',
      entityId: supplierId,
      newValues: { source_system: 'BC', bc_vendor_no: created.bc_vendor_no, supplier_name: created.supplier_name, vendor_type: vendorType },
    });
    return created;
  }

  /** The fields NAVFarm owns on any supplier (never sent to BC). */
  private navfarmOwnedValues(dto: Partial<CreateSupplierDto & UpdateSupplierDto>) {
    const v: Record<string, unknown> = {};
    if (dto.vendor_type !== undefined) v.vendor_type = dto.vendor_type;
    if (dto.health_cert_url !== undefined) v.health_cert_url = dto.health_cert_url || null;
    if (dto.breeding_farm_code !== undefined) v.breeding_farm_code = dto.breeding_farm_code || null;
    if (dto.bank_account_no !== undefined) v.bank_account_no_enc = dto.bank_account_no ? this.encryptionService.encrypt(dto.bank_account_no) : null;
    if (dto.bank_ifsc !== undefined) v.bank_ifsc = dto.bank_ifsc || null;
    if (dto.credit_limit !== undefined) v.credit_limit = dto.credit_limit?.toString() || null;
    if ((dto as any).nob_id !== undefined) v.nob_id = (dto as any).nob_id || null;
    if ((dto as any).lob_id !== undefined) v.lob_id = (dto as any).lob_id || null;
    if (dto.extension_config !== undefined) v.extension_config = JSON.stringify(dto.extension_config);
    return v;
  }

  private async createRecord(dto: CreateSupplierDto, tenantId: string, userPayload?: any) {
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
      registration_number: dto.registration_number || null,
      currency_code: dto.currency_code ? dto.currency_code.toUpperCase() : null,
      gen_bus_posting_group: dto.gen_bus_posting_group ? dto.gen_bus_posting_group.toUpperCase() : null,
      vendor_posting_group: dto.vendor_posting_group ? dto.vendor_posting_group.toUpperCase() : null,
      purchaser_code: dto.purchaser_code ? dto.purchaser_code.toUpperCase() : null,
      bc_name_2: dto.bc_name_2 || null,
      is_approved: false,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.supplierMaster).values(newSupplier);

    try {
      const [modernSupplierSeries] = await this.db
        .select({ id: schema.noSeries.id })
        .from(schema.noSeries)
        .where(and(
          eq(schema.noSeries.document_type, 'SUPPLIER'),
          eq(schema.noSeries.blocked, false),
        ))
        .limit(1);

      if (modernSupplierSeries && typeof this.db?.update === 'function') {
        const updateBuilder = this.db.update(schema.noSeries);
        if (updateBuilder?.set) {
          await updateBuilder
            .set({
              last_no_used: supplierCode,
              updated_at: toMysqlTimestamp() as any,
            })
            .where(eq(schema.noSeries.id, modernSupplierSeries.id));
        }
      }
    } catch {
      // Non-fatal if no_series is not present in mock test db
    }

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
      .where(eq(schema.supplierMaster.supplier_id, id))
      .limit(1);

    if (!supplier) {
      throw new NotFoundException(`Vendor with ID '${id}' not found.`);
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

    const page = await runMasterList(this.db, schema.supplierMaster, conditions, query, schema.supplierMaster.supplier_code);

    // Masking is applied to the page, not to the count: the total is how many
    // suppliers match, which is the same whether or not a field is hidden.
    return { ...page, data: page.data.map((row) => this.maskSupplier(row as never)) };
  }

  async update(id: string, dto: UpdateSupplierDto, tenantId: string, userPayload?: any) {
    let supplier = await this.findOne(id);
    if (supplier.source_system === 'BC' && this.bcWriteThrough) {
      dto = await this.writeBcChanges(supplier, dto, tenantId, userPayload);
      supplier = await this.findOne(id);
    } else {
      this.assertBcOwnedUnchanged(supplier, dto as Record<string, any>);
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    assertCodeUnchanged('Vendor', supplier.supplier_code, dto.supplier_code);
    if (dto.supplier_code && dto.supplier_code.trim()) {
      const trimmed = dto.supplier_code.trim().toUpperCase();
      if (trimmed !== supplier.supplier_code) {
        const edited = await this.numberSeriesService.editedCode(
          'SUPPLIER',
          trimmed,
          supplier.supplier_code,
          tenantId,
          supplier.company_id,
        );
        if (edited) {
          updates.supplier_code = edited;
        }
      }
    }

    // Re-validate COND rules against the effective (post-update) values, same "dto value if
    // touched, else existing row's" pattern used across every other phase's update() methods.
    const effectiveVendorType = dto.vendor_type ?? supplier.vendor_type;
    const effectiveHealthCertUrl = dto.health_cert_url !== undefined ? dto.health_cert_url : supplier.health_cert_url;
    const effectiveBreedingFarmCode = dto.breeding_farm_code !== undefined ? dto.breeding_farm_code : supplier.breeding_farm_code;
    this.assertVendorTypeRequirements(effectiveVendorType, effectiveHealthCertUrl, effectiveBreedingFarmCode);

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
    if (supplier.source_system !== 'BC') {
      for (const field of BC_REFERENCE_FIELDS) {
        const value = dto[field];
        if (value !== undefined) updates[field] = value ? (KEEP_CASE.has(field) ? value : value.toUpperCase()) : null;
      }
    }
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
      throw new BadRequestException(`Vendor '${supplier.supplier_name}' is already approved.`);
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
    if (supplier.source_system === 'BC') {
      if (!this.bcWriteThrough) {
        throw new BadRequestException(
          `${BC_OWNED_MESSAGE} To stop using it, set Blocked = All or untick "NavFarm Sync" in BC; the sync deactivates it here.`,
        );
      }
      // The BC vendor is never deleted from NAVFarm: it only stops being synced ("NavFarm Sync" unticked).
      await this.bcVendors!.setNavfarmSync(supplier.bc_vendor_no!, false, tenantId, userPayload?.userId);
    }
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

    return { success: true, message: `Vendor '${supplier.supplier_name}' has been deactivated.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [supplier] = await this.db
      .select()
      .from(schema.supplierMaster)
      .where(eq(schema.supplierMaster.supplier_id, id))
      .limit(1);

    if (!supplier) {
      throw new NotFoundException(`Vendor with ID '${id}' not found.`);
    }

    if (!supplier.deleted_at) {
      return supplier;
    }
    if (supplier.source_system === 'BC') {
      if (!this.bcWriteThrough) {
        throw new BadRequestException(`${BC_OWNED_MESSAGE} Tick "NavFarm Sync" (and clear Blocked) in BC to bring it back.`);
      }
      // Ticking "NavFarm Sync" brings the vendor back through the sync planner, which restores the soft-deleted row.
      await this.bcVendors!.setNavfarmSync(supplier.bc_vendor_no!, true, tenantId, userPayload?.userId);
      return this.findOne(id);
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
      oldValues: supplier,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }
}
