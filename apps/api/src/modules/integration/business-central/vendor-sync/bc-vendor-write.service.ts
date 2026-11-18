import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../../core/database/schema';
import { withTenantTransaction } from '../../../../common/tenant-transaction';
import { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig, missingBusinessCentralSettings } from '../business-central.config';
import { BcApiError } from '../bc-errors';
import { BcODataClient, odataString } from '../bc-odata.client';
import { BC_VENDOR_SELECT, type BcVendorCard } from './bc-vendor.mapper';
import { applyVendorPlan, loadExistingSuppliers } from './bc-vendor-sync.engine';
import { planVendorSync } from './bc-vendor-sync.planner';
import { BcVendorSyncService } from './bc-vendor-sync.service';
import { BcVendorInputError, looksLikeVendorNo, toBcVendorFields } from './bc-vendor.writer';

type Db = MySql2Database<typeof schema>;

export interface BcVendorListRow {
  no: string;
  name: string;
  city: string | null;
  country: string | null;
  currency: string | null;
  paymentTerms: string | null;
  vendorPostingGroup: string | null;
  blocked: string | null;
  navfarmSync: boolean;
  syncError: string | null;
  supplierId: string | null;
  supplierActive: boolean | null;
}

const LIST_SELECT = ['No', 'Name', 'City', 'Country_Region_Code', 'Currency_Code', 'Payment_Terms_Code', 'Vendor_Posting_Group', 'Blocked', 'NavFarm_Sync', 'Navfarm_Sync_Error', 'Navfarm_Error_Message'];
const blank = (v?: string | null) => (v && v.trim() ? v.trim() : null);

/**
 * Business Central as the vendor master, used from NAVFarm's Supplier screen:
 *   list   — live BC vendors (search, paging) with their NAVFarm link
 *   create — POST to BC (BC assigns the Vendor No. and validates the codes), then the supplier is stored from BC's reply
 *   update — PATCH only the changed BC fields, guarded by the ETag, then the supplier is refreshed from BC
 *   link / unlink — tick / untick "NavFarm Sync" on the BC vendor and bring the supplier in / deactivate it
 * Every write goes to BC first; NAVFarm's copy is always what BC returned, never what was typed.
 */
@Injectable()
export class BcVendorWriteService {
  private readonly logger = new Logger(BcVendorWriteService.name);

  constructor(
    @Inject(BUSINESS_CENTRAL_CONFIG) private readonly config: BusinessCentralConfig,
    private readonly client: BcODataClient,
    private readonly cls: ClsService,
    private readonly sync: BcVendorSyncService,
  ) {}

  private get db(): Db {
    const db = this.cls.get<Db>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private get odata() {
    return { endpoint: { kind: 'odataV4' as const }, companyName: this.config.companyName };
  }

  private key(no: string) {
    return `${this.config.vendor.service}(${encodeURIComponent(odataString(no))})`;
  }

  /** BC is the vendor master and the connection is configured: supplier create/update go to BC. */
  get writeThrough(): boolean {
    return (
      this.config.enabled &&
      this.config.vendor.masterSource === 'BC' &&
      !missingBusinessCentralSettings(this.config).length &&
      !!this.config.companyName
    );
  }

  settings() {
    return {
      enabled: this.config.enabled,
      environment: this.config.environment,
      companyName: this.config.companyName,
      masterSource: this.config.vendor.masterSource,
      writeThrough: this.writeThrough,
      scope: this.config.vendor.scope,
      scheduleEnabled: this.config.vendor.scheduleEnabled,
      writeBack: this.config.vendor.writeBack,
      service: this.config.vendor.service,
    };
  }

  // ---------- read ----------

  async getVendor(no: string): Promise<BcVendorCard> {
    try {
      return await this.client.get<BcVendorCard>(this.key(no), { ...this.odata, query: { select: [...BC_VENDOR_SELECT] } });
    } catch (error) {
      throw this.toHttp(error, `Vendor ${no}`);
    }
  }

  /** Live BC vendors. BC's ODataV4 refuses OR across fields, so one search field is chosen from the term. */
  async listLive(
    tenantId: string,
    q: { search?: string; linked?: 'all' | 'linked' | 'unlinked'; top?: number; skip?: number },
  ): Promise<{ count: number; rows: BcVendorListRow[] }> {
    const filters: string[] = [];
    const term = (q.search ?? '').trim();
    if (term) {
      const upper = term.toUpperCase();
      // Search_Name is BC's upper-case copy of Name, which makes the (case-sensitive) contains() case-insensitive.
      filters.push(looksLikeVendorNo(upper) ? `startswith(No,${odataString(upper)})` : `contains(Search_Name,${odataString(upper)})`);
    }
    if (q.linked === 'linked') filters.push('NavFarm_Sync eq true');
    if (q.linked === 'unlinked') filters.push('NavFarm_Sync eq false');
    const top = Math.min(200, Math.max(1, q.top ?? 50));
    const skip = Math.max(0, q.skip ?? 0);

    let page: { value: BcVendorCard[]; '@odata.count'?: number };
    try {
      page = await this.client.get(this.config.vendor.service, {
        ...this.odata,
        query: { select: LIST_SELECT, filter: filters.join(' and ') || undefined, orderBy: 'No', top, skip, count: true },
      });
    } catch (error) {
      throw this.toHttp(error, 'Vendor list');
    }
    const count = Number(page['@odata.count'] ?? page.value.length);
    const companyId = await this.sync.resolveCompanyId(this.db);
    const nos = page.value.map((v) => v.No);
    const linked = nos.length
      ? await this.db
          .select({ id: schema.supplierMaster.supplier_id, no: schema.supplierMaster.bc_vendor_no, active: schema.supplierMaster.is_active })
          .from(schema.supplierMaster)
          .where(and(eq(schema.supplierMaster.tenant_id, tenantId), eq(schema.supplierMaster.company_id, companyId), inArray(schema.supplierMaster.bc_vendor_no, nos)))
      : [];
    const byNo = new Map(linked.map((r) => [String(r.no).toUpperCase(), r]));
    return {
      count,
      rows: page.value.map((v) => {
        const s = byNo.get(v.No.toUpperCase());
        return {
          no: v.No,
          name: (v.Name ?? '').trim(),
          city: blank(v.City),
          country: blank(v.Country_Region_Code),
          currency: blank(v.Currency_Code),
          paymentTerms: blank(v.Payment_Terms_Code),
          vendorPostingGroup: blank(v.Vendor_Posting_Group),
          blocked: blank(v.Blocked),
          navfarmSync: !!v.NavFarm_Sync,
          syncError: v.Navfarm_Sync_Error ? blank(v.Navfarm_Error_Message) : null,
          supplierId: s?.id ?? null,
          supplierActive: s ? !!s.active : null,
        };
      }),
    };
  }

  // ---------- write ----------

  /** Creates the vendor in BC (NavFarm Sync ticked) and stores the supplier from BC's reply. Returns the supplier id. */
  async createVendor(values: Record<string, unknown>, tenantId: string, userId?: string | null): Promise<string> {
    let payload: Record<string, unknown>;
    try {
      payload = { ...toBcVendorFields(values), NavFarm_Sync: true };
    } catch (error) {
      throw this.toHttp(error, 'Vendor');
    }
    if (!payload.Name) throw new BadRequestException('Name is required.');
    let created: BcVendorCard;
    try {
      created = await this.client.post<BcVendorCard>(this.config.vendor.service, payload, this.odata);
    } catch (error) {
      throw this.toHttp(error, 'New vendor');
    }
    this.logger.log(`Created BC vendor ${created.No} from NAVFarm`);
    return this.upsertOne(await this.getVendor(created.No), tenantId, userId);
  }

  /** PATCHes the changed BC fields (If-Match) and refreshes the supplier from BC. */
  async updateVendor(supplier: { bc_vendor_no: string | null; bc_etag: string | null }, changed: Record<string, unknown>, tenantId: string, userId?: string | null) {
    if (!supplier.bc_vendor_no) throw new BadRequestException('This vendor is not linked to a Business Central vendor record.');
    let payload: Record<string, unknown>;
    try {
      payload = toBcVendorFields(changed);
    } catch (error) {
      throw this.toHttp(error, 'Vendor');
    }
    if (!Object.keys(payload).length) return;
    const etag = supplier.bc_etag ?? (await this.getVendor(supplier.bc_vendor_no))['@odata.etag'];
    try {
      await this.client.patch(this.key(supplier.bc_vendor_no), payload, etag ?? '*', this.odata);
    } catch (error) {
      throw this.toHttp(error, `Vendor ${supplier.bc_vendor_no}`);
    }
    await this.upsertOne(await this.getVendor(supplier.bc_vendor_no), tenantId, userId);
  }

  /** Ticks or unticks NavFarm Sync on the BC vendor; ticking also brings the supplier in. Returns the supplier id when linked. */
  async setNavfarmSync(no: string, flag: boolean, tenantId: string, userId?: string | null): Promise<string | null> {
    if (!flag && this.config.vendor.scope === 'ALL') {
      // Every BC vendor is listed (scope ALL): unticking NavFarm Sync would not remove it — the next sync brings it back.
      throw new BadRequestException(
        `All Business Central vendors are listed in NAVFarm. To stop using vendor ${no}, set Blocked = All on its BC Vendor Card; the sync then makes it inactive in NAVFarm.`,
      );
    }
    const vendor = await this.getVendor(no);
    if (!!vendor.NavFarm_Sync !== flag) {
      try {
        await this.client.patch(this.key(no), { NavFarm_Sync: flag }, vendor['@odata.etag'] ?? '*', this.odata);
      } catch (error) {
        throw this.toHttp(error, `Vendor ${no}`);
      }
    }
    if (!flag) return null;
    return this.upsertOne(await this.getVendor(no), tenantId, userId);
  }

  /** Applies one vendor with the same planner/engine as the full sync, without touching any other supplier. */
  async upsertOne(vendor: BcVendorCard, tenantId: string, userId?: string | null): Promise<string> {
    const companyId = await this.sync.resolveCompanyId(this.db);
    const no = vendor.No.toUpperCase();
    const existing = (await loadExistingSuppliers(this.db, tenantId, companyId)).filter(
      (r) => r.bc_vendor_no?.toUpperCase() === no || r.supplier_code.toUpperCase() === no,
    );
    const plan = planVendorSync([vendor], existing, this.config.vendor);
    const failed = plan.actions.find((a) => a.type === 'FAILED');
    if (failed) throw new BadRequestException(`Vendor ${vendor.No} cannot be used in NAVFarm: ${failed.reason}`);
    await withTenantTransaction(this.cls, () => applyVendorPlan(this.db, plan, { tenantId, companyId, userId, trigger: 'MANUAL' }));
    const [row] = await this.db
      .select({ id: schema.supplierMaster.supplier_id })
      .from(schema.supplierMaster)
      .where(and(eq(schema.supplierMaster.tenant_id, tenantId), eq(schema.supplierMaster.company_id, companyId), eq(schema.supplierMaster.bc_vendor_no, vendor.No)))
      .limit(1);
    if (!row) throw new NotFoundException(`Vendor ${vendor.No} was not stored in NAVFarm.`);
    return row.id;
  }

  /** BC and input errors → HTTP errors the Supplier screen can show as they are. */
  toHttp(error: unknown, what: string): HttpException {
    if (error instanceof HttpException) return error;
    if (error instanceof BcVendorInputError) return new BadRequestException(error.message);
    if (error instanceof BcApiError) {
      // "Business Central PATCH /ODataV4/Company('Triple C Pigs')/… failed (400 code): <BC's message>" → BC's message.
      const bcMessage = error.message.replace(/^Business Central [\s\S]*? failed \([^)]*\): /, '').replace(/\s*CorrelationId:.*$/i, '').trim();
      switch (error.kind) {
        case 'VALIDATION':
          return new BadRequestException(`Business Central rejected it: ${bcMessage}`);
        case 'CONFLICT':
          return new ConflictException(`${what} was changed in Business Central since NAVFarm last read it. Reload and try again.`);
        case 'NOT_FOUND':
          return new NotFoundException(`${what} was not found in Business Central.`);
        case 'NOT_CONFIGURED':
          return new BadRequestException(`${error.message} ${error.hint}`);
        default:
          return new ServiceUnavailableException(`Business Central is not available: ${bcMessage} ${error.hint}`.trim());
      }
    }
    return new ServiceUnavailableException((error as Error)?.message ?? String(error));
  }
}
