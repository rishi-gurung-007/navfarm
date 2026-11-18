import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../../core/database/schema';
import * as masterSchema from '../../../../core/database/master-schema';
import { MASTER_CONNECTION } from '../../../../core/database/database.tokens';
import { ConnectionManagerService } from '../../../../core/database/connection-manager.service';
import { withTenantTransaction } from '../../../../common/tenant-transaction';
import { AuditLogService } from '../../../system/audit-log/audit-log.service';
import { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig } from '../business-central.config';
import { BcApiError } from '../bc-errors';
import { BcODataClient } from '../bc-odata.client';
import { BcTokenService } from '../bc-token.service';
import {
  applyVendorPlan,
  fetchBcVendors,
  finishSyncLog,
  loadExistingSuppliers,
  planVendorSync,
  startSyncLog,
  type SyncTrigger,
  type VendorSyncContext,
  type VendorSyncResult,
  writeBackToBc,
} from './bc-vendor-sync.engine';
import type { VendorAction } from './bc-vendor-sync.planner';

type Db = MySql2Database<typeof schema>;

/** What the preview/sync endpoints return: the plan without the raw BC payloads. */
export function summariseResult(result: VendorSyncResult) {
  const strip = (a: VendorAction) => {
    switch (a.type) {
      case 'CREATE':
        return { type: a.type, vendorNo: a.vendorNo, name: a.supplier.supplier_name, active: a.supplier.is_active };
      case 'UPDATE':
        return { type: a.type, vendorNo: a.vendorNo, name: a.supplier.supplier_name, linkExisting: a.linkExisting, restore: a.restore, changes: a.changes };
      case 'UNCHANGED':
        return { type: a.type, vendorNo: a.vendorNo };
      case 'DEACTIVATE':
        return { type: a.type, vendorNo: a.vendorNo, reason: a.reason };
      case 'FAILED':
        return { type: a.type, vendorNo: a.vendorNo, reason: a.reason };
    }
  };
  return {
    logId: result.logId,
    status: result.status,
    scope: result.scope,
    fetched: result.plan.fetched,
    counts: result.plan.counts,
    blockedReason: result.plan.blockedReason,
    writtenBack: result.writtenBack,
    writeBackErrors: result.writeBackErrors,
    error: result.error,
    actions: result.plan.actions.filter((a) => a.type !== 'UNCHANGED').map(strip),
  };
}

/**
 * Business Central vendors → NAVFarm suppliers.
 *
 * preview(): reads BC and shows what a sync would do. Writes nothing anywhere.
 * sync():    applies the plan in one tenant transaction, logs the run in integration_sync_log, then (when enabled)
 *            writes the outcome back onto each BC vendor. A run that fails part-way leaves no half-applied suppliers.
 * tick():    the same sync every hour when BC_VENDOR_SYNC_SCHEDULE_ENABLED=true.
 */
@Injectable()
export class BcVendorSyncService {
  private readonly logger = new Logger(BcVendorSyncService.name);
  private readonly running = new Set<string>();

  constructor(
    @Inject(BUSINESS_CENTRAL_CONFIG) private readonly config: BusinessCentralConfig,
    private readonly client: BcODataClient,
    private readonly tokens: BcTokenService,
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
    private readonly connections: ConnectionManagerService,
    @Inject(MASTER_CONNECTION) private readonly masterDb: MySql2Database<typeof masterSchema>,
  ) {}

  private get db(): Db {
    const db = this.cls.get<Db>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  /** The NAVFarm company the BC company maps to (BC_NAVFARM_COMPANY_CODE). */
  async resolveCompanyId(db: Db = this.db): Promise<string> {
    const code = this.config.navfarmCompanyCode;
    if (!code) throw new BcApiError('NOT_CONFIGURED', 'BC_NAVFARM_COMPANY_CODE is not set: which NAVFarm company receives the BC vendors?');
    const [company] = await db
      .select({ id: schema.companyMaster.company_id })
      .from(schema.companyMaster)
      .where(and(eq(schema.companyMaster.company_code, code), isNull(schema.companyMaster.deleted_at)))
      .limit(1);
    if (!company) throw new BcApiError('NOT_CONFIGURED', `NAVFarm company with code ${code} (BC_NAVFARM_COMPANY_CODE) does not exist in this tenant.`);
    return company.id;
  }

  async preview(tenantId: string) {
    this.tokens.assertConfigured();
    const companyId = await this.resolveCompanyId();
    const vendors = await fetchBcVendors(this.client, this.config);
    const plan = planVendorSync(vendors, await loadExistingSuppliers(this.db, tenantId, companyId), this.config.vendor);
    return summariseResult({ logId: null, status: 'PREVIEW', scope: this.config.vendor.scope, plan, writtenBack: 0, writeBackErrors: [], error: null });
  }

  async sync(tenantId: string, trigger: SyncTrigger, userId?: string | null) {
    this.tokens.assertConfigured();
    if (this.running.has(tenantId)) throw new ConflictException('A vendor sync is already running for this tenant.');
    this.running.add(tenantId);
    try {
      const companyId = await this.resolveCompanyId();
      const ctx: VendorSyncContext = { tenantId, companyId, userId, trigger };
      const logId = await startSyncLog(this.db, ctx);
      const result: VendorSyncResult = {
        logId,
        status: 'FAILED',
        scope: this.config.vendor.scope,
        plan: { fetched: 0, actions: [], counts: { create: 0, update: 0, unchanged: 0, deactivate: 0, failed: 0 }, blockedReason: null },
        writtenBack: 0,
        writeBackErrors: [],
        error: null,
      };
      try {
        const vendors = await fetchBcVendors(this.client, this.config);
        result.plan = planVendorSync(vendors, await loadExistingSuppliers(this.db, tenantId, companyId), this.config.vendor);
        if (result.plan.blockedReason) {
          result.error = result.plan.blockedReason;
        } else {
          await withTenantTransaction(this.cls, () => applyVendorPlan(this.db, result.plan, ctx));
          result.status = result.plan.counts.failed ? 'PARTIAL' : 'SUCCESS';
          if (this.config.vendor.writeBack) {
            const wb = await writeBackToBc(this.db, this.client, this.config, result.plan, vendors, ctx);
            result.writtenBack = wb.written;
            result.writeBackErrors = wb.errors;
            if (wb.errors.length && result.status === 'SUCCESS') result.status = 'PARTIAL';
          }
        }
      } catch (error) {
        result.status = 'FAILED';
        result.error = error instanceof BcApiError ? `${error.message} ${error.hint}` : (error as Error).message;
        this.logger.warn(`Vendor sync failed for tenant ${tenantId}: ${result.error}`);
      }
      await finishSyncLog(this.db, logId, result);
      await this.audit.log({
        tenantId,
        companyId,
        userId: userId ?? undefined,
        action: 'BC_VENDOR_SYNC',
        entityName: 'integration_sync_log',
        entityId: logId,
        newValues: { trigger, status: result.status, scope: result.scope, counts: result.plan.counts, error: result.error },
      });
      return summariseResult(result);
    } finally {
      this.running.delete(tenantId);
    }
  }

  /** After "NavFarm Sync" was unticked from NAVFarm: deactivate (never delete) the linked supplier now, not at the next run. */
  async deactivateUnlinked(tenantId: string, vendorNo: string, userId?: string | null) {
    const companyId = await this.resolveCompanyId();
    const s = schema.supplierMaster;
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const [row] = await this.db
      .select({ id: s.supplier_id })
      .from(s)
      .where(and(eq(s.tenant_id, tenantId), eq(s.company_id, companyId), eq(s.bc_vendor_no, vendorNo)))
      .limit(1);
    if (!row) return { supplierId: null, deactivated: false };
    await this.db
      .update(s)
      .set({ is_active: false, status: 'INACTIVE', bc_sync_error: 'NavFarm Sync unticked from NAVFarm.', updated_by: userId ?? null, updated_at: stamp })
      .where(eq(s.supplier_id, row.id));
    await this.audit.log({
      tenantId,
      companyId,
      userId: userId ?? undefined,
      action: 'BC_VENDOR_UNLINK',
      entityName: 'supplier_master',
      entityId: row.id,
      newValues: { bc_vendor_no: vendorNo, is_active: false },
    });
    return { supplierId: row.id, deactivated: true };
  }

  /**
   * Sync only when the supplier list may be out of date: no successful run in the last `maxAgeMinutes`. Called when
   * the Suppliers screen opens, so the list shows BC's vendors without anyone pressing "Sync". Age is computed by
   * MySQL (finished_at is stamped with now()), so server/database time zones cannot skew it.
   */
  async refreshIfStale(tenantId: string, maxAgeMinutes = 15, userId?: string | null) {
    this.tokens.assertConfigured();
    const l = schema.integrationSyncLog;
    const [last] = await this.db
      .select({ finishedAt: l.finished_at, ageMinutes: sql<number>`timestampdiff(minute, ${l.finished_at}, now())` })
      .from(l)
      .where(and(eq(l.tenant_id, tenantId), eq(l.entity, 'VENDOR'), inArray(l.status, ['SUCCESS', 'PARTIAL'])))
      .orderBy(desc(l.finished_at))
      .limit(1);
    if (last && Number(last.ageMinutes) < maxAgeMinutes) {
      return { refreshed: false, lastSyncedAt: last.finishedAt, ageMinutes: Number(last.ageMinutes) };
    }
    if (this.running.has(tenantId)) return { refreshed: false, lastSyncedAt: last?.finishedAt ?? null, running: true };
    const result = await this.sync(tenantId, 'AUTO', userId ?? null);
    return { refreshed: true, result };
  }

  async recentRuns(tenantId: string, limit = 20) {
    const l = schema.integrationSyncLog;
    return this.db
      .select()
      .from(l)
      .where(and(eq(l.tenant_id, tenantId), eq(l.entity, 'VENDOR')))
      .orderBy(desc(l.started_at))
      .limit(Math.min(100, Math.max(1, limit)));
  }

  /**
   * Hourly scheduled sync, off unless BC_VENDOR_SYNC_SCHEDULE_ENABLED=true. The flag is read at call time (as the
   * feed scheduler does): a decorator option would be read before ConfigModule has loaded .env.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'bc-vendor-sync' })
  async tick(): Promise<void> {
    if (!this.config.enabled || !this.config.vendor.scheduleEnabled) return;
    const code = this.config.navfarmTenantCode;
    if (!code) {
      this.logger.warn('Scheduled vendor sync skipped: BC_NAVFARM_TENANT_CODE is not set.');
      return;
    }
    try {
      const [tenant] = await this.masterDb
        .select()
        .from(masterSchema.tenantMaster)
        .where(and(eq(masterSchema.tenantMaster.tenant_code, code), eq(masterSchema.tenantMaster.is_active, true)))
        .limit(1);
      if (!tenant) throw new BadRequestException(`Tenant ${code} (BC_NAVFARM_TENANT_CODE) not found or inactive.`);
      const tenantDb = await this.connections.getTenantConnection(tenant as any);
      await this.cls.run(async () => {
        this.cls.set('tenantId', tenant.tenant_id);
        this.cls.set('tenantDb', tenantDb);
        const result = await this.sync(tenant.tenant_id, 'SCHEDULED', null);
        this.logger.log(`Scheduled vendor sync: ${result.status} — ${JSON.stringify(result.counts)}`);
      });
    } catch (error) {
      this.logger.warn(`Scheduled vendor sync failed: ${(error as Error).message}`);
    }
  }
}
