import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { FARM_SCOPED_KEY } from './farm-scope';
import { RolesGuard } from './guards/roles.guard';
import { BatchController } from '../modules/production/batch/batch.controller';
import { BatchDailyDataController } from '../modules/production/batch-daily-data/batch-daily-data.controller';
import { BatchTransferController } from '../modules/production/batch/batch-transfer.controller';
import { SchedulerHeaderController } from '../modules/production/scheduler-header/scheduler-header.controller';
import { ApprovalController } from '../modules/production/approval/approval.controller';
import { AnimalController } from '../modules/piggery/animal/animal.controller';
import { AnimalMedicationLogController } from '../modules/piggery/animal/animal-medication-log.controller';
import { BreedingController } from '../modules/piggery/breeding/breeding.controller';
import { GoodsReceiptController } from '../modules/inventory/goods-receipt/goods-receipt.controller';
import { GoodsIssueController } from '../modules/inventory/goods-issue/goods-issue.controller';
import { StockAdjustmentController } from '../modules/inventory/stock-adjustment/stock-adjustment.controller';
import { StockTransferController } from '../modules/inventory/stock-transfer/stock-transfer.controller';
import { InventoryLedgerController } from '../modules/inventory/inventory-ledger/inventory-ledger.controller';
import { AlertController } from '../modules/production/alert/alert.controller';
import { MilkController } from '../modules/production/milk/milk.controller';
import { QcController } from '../modules/production/qc/qc.controller';
import { QrCodeController } from '../modules/production/qr-code/qr-code.controller';
import { BioAssetLedgerController } from '../modules/inventory/bio-asset-ledger/bio-asset-ledger.controller';
import { FinancialReportsController } from '../modules/finance/financial-reports/financial-reports.controller';
import { BreedController } from '../modules/master-data/breed/breed.controller';

/**
 * Farm scope is opt-in per controller, and a controller that forgets it reads
 * every farm's records — the failure the 14 September audit found in all of
 * these. Every controller under apps/api/src/modules must be either marked
 * or named here as exempt with the reason, so a new one cannot slip in
 * unscoped.
 *
 * C3 (2026-09-15): the walk used to cover only production/piggery/inventory,
 * so finance/*, system/*, core/* and most of master-data/* were never
 * classified — that is how /financial-reports/herd-analytics shipped
 * unscoped and undetected. The walk now covers every controller under
 * modules/.
 *
 * M9 (2026-09-15): a controller could carry @FarmScoped() metadata without
 * actually mounting RolesGuard (e.g. a copy-pasted decorator with the guard
 * accidentally dropped), and the old spec only checked the metadata flag.
 * Every SCOPED controller is now also asserted to have RolesGuard in its
 * @UseGuards list via Nest's own GUARDS_METADATA.
 */
const SCOPED = {
  BatchController, BatchDailyDataController, BatchTransferController, SchedulerHeaderController,
  ApprovalController, AnimalController, AnimalMedicationLogController, BreedingController,
  GoodsReceiptController, GoodsIssueController, StockAdjustmentController, StockTransferController,
  InventoryLedgerController,
  AlertController, MilkController, QcController, QrCodeController,
  BioAssetLedgerController,
  FinancialReportsController,
  BreedController,
};

const EXEMPT: Record<string, string> = {
  // production
  'production/parameter/parameter.controller.ts': 'Master data, not farm-specific.',
  'production/qc-parameter/qc-parameter.controller.ts': 'Master data, not farm-specific.',
  'production/stage/stage.controller.ts': 'Master data, not farm-specific.',

  // piggery / master-data breed family
  'master-data/breed/breed-lifecycle-stage.controller.ts': 'Master data, not farm-specific.',
  'master-data/breed/species.controller.ts': 'Master data, not farm-specific.',

  // master-data — not farm-scoped by decision (records are shared across a company's farms)
  'master-data/activity/activity.controller.ts': 'Master data, not farm-specific.',
  'master-data/customer/customer.controller.ts': 'Master data, not farm-specific.',
  'master-data/disease/disease.controller.ts': 'Master data, not farm-specific.',
  'master-data/farm/farm.controller.ts': 'Master data defining the farms themselves, not farm-specific operational records.',
  'master-data/feed-formula/feed-formula.controller.ts': 'Master data, not farm-specific.',
  'master-data/item-attribute/item-attribute.controller.ts': 'Master data, not farm-specific.',
  'master-data/item-category/item-category.controller.ts': 'Master data, not farm-specific.',
  'master-data/item-type/item-type.controller.ts': 'Master data, not farm-specific.',
  'master-data/item/item.controller.ts': 'Master data, not farm-specific.',
  'master-data/location-type/location-type.controller.ts': 'Master data, not farm-specific.',
  'master-data/location/location.controller.ts': 'Master data; locations reference a farm but the master list itself is not farm-scoped for access — write paths that place a record on a location go through assertLocationOnActiveFarm instead.',
  'master-data/reason/reason.controller.ts': 'Master data, not farm-specific.',
  'master-data/resource/resource.controller.ts': 'Master data, not farm-specific.',
  'master-data/shed/shed.controller.ts': 'Master data, not farm-specific.',
  'master-data/supplier/supplier.controller.ts': 'Master data, not farm-specific.',
  'master-data/uom/uom.controller.ts': 'Master data, not farm-specific.',
  'master-data/warehouse/warehouse.controller.ts': 'Master data, not farm-specific.',

  // core — identity and tenant administration
  'core/auth/auth.controller.ts': 'Authentication flows (login, tokens), not farm records.',
  'core/company/company.controller.ts': 'Tenant/company administration, not farm records.',
  'core/operational-area/operational-area.controller.ts': 'Operational area master — a line of business across all of a company\'s farms, never a farm (operational_area_master.farm_id is never read for access).',
  'core/role/role.controller.ts': 'Identity and tenant administration, not farm records.',
  'core/tenant/tenant.controller.ts': 'Tenant administration, system-admin only, not farm records.',
  'core/user-company/user-company.controller.ts': 'Identity and tenant administration (user-company assignment), not farm records.',
  'core/user/user.controller.ts': 'Identity and tenant administration, not farm records.',

  // finance — company-level by decision (2026-09-14): finance is not farm-scoped.
  // financial-reports is the one exception, because it aggregates farm-specific
  // animal/batch data alongside company-level ledgers — it is SCOPED above.
  'finance/cost-center/cost-center.controller.ts': 'Company-level finance master; finance is not farm-scoped (decided 2026-09-14).',
  'finance/gl-account/gl-account.controller.ts': 'Company-level finance master; finance is not farm-scoped (decided 2026-09-14).',
  'finance/gl-mapping/gl-mapping.controller.ts': 'Company-level finance master; finance is not farm-scoped (decided 2026-09-14).',
  'finance/journal/journal.controller.ts': 'Company-level finance ledger; finance is not farm-scoped (decided 2026-09-14).',

  // system — tenant/system administration and reference data
  'system/audit-log/audit-log.controller.ts': 'Tenant-wide audit trail across every module, not a farm record.',
  'system/costing-method/costing-method.controller.ts': 'System-admin-only reference master data, not farm records.',
  'system/country/country.controller.ts': 'System-admin-only reference master data, not farm records.',
  'system/currency/currency.controller.ts': 'System reference master data, not farm records.',
  'system/language/language.controller.ts': 'System-admin-only reference master data, not farm records.',
  'system/notification/notification.controller.ts': 'Per-user notifications, not farm records.',
  'system/number-series/number-series.controller.ts': 'Tenant-level document numbering configuration, not farm records.',
  'system/plan/plan.controller.ts': 'System-admin-only subscription plan master data, not farm records.',
  'system/setup-wizard/setup-wizard.controller.ts': 'Tenant setup/onboarding flow, not farm records.',
  'system/timezone/timezone.controller.ts': 'System-admin-only reference master data, not farm records.',
};

const MODULES = join(__dirname, '../modules');

function controllerFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.controller.ts')) found.push(relative(MODULES, full));
    }
  };
  walk(MODULES);
  return found.sort();
}

describe('Farm scope coverage', () => {
  it.each(Object.entries(SCOPED))('%s is farm-scoped', (_name, controller) => {
    expect(Reflect.getMetadata(FARM_SCOPED_KEY, controller)).toBe(true);
  });

  // M9: metadata alone proves nothing if the guard that enforces the scope
  // isn't mounted. A @FarmScoped() controller without RolesGuard would still
  // pass the metadata check while reading every farm's records.
  it.each(Object.entries(SCOPED))('%s mounts RolesGuard', (_name, controller) => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) || [];
    expect(guards).toContain(RolesGuard);
  });

  it('classifies every controller under modules/ as scoped or exempt', () => {
    const scopedClassNames = new Set(Object.keys(SCOPED));
    const unclassified = controllerFiles().filter((file) => {
      if (EXEMPT[file]) return false;
      const source = readFileSync(join(MODULES, file), 'utf8');
      const className = /export class (\w+)/.exec(source)?.[1];
      return !className || !scopedClassNames.has(className);
    });
    expect(unclassified).toEqual([]);
  });
});
