import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { FARM_SCOPED_KEY } from './farm-scope';
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

/**
 * Farm scope is opt-in per controller, and a controller that forgets it reads
 * every farm's records — the failure the 14 September audit found in all of
 * these. Every controller under the operational modules must be either marked
 * or named here as exempt with the reason, so a new one cannot slip in unscoped.
 */
const SCOPED = {
  BatchController, BatchDailyDataController, BatchTransferController, SchedulerHeaderController,
  ApprovalController, AnimalController, AnimalMedicationLogController, BreedingController,
  GoodsReceiptController, GoodsIssueController, StockAdjustmentController, StockTransferController,
  InventoryLedgerController,
};

const EXEMPT: Record<string, string> = {
  'inventory/bio-asset-ledger/bio-asset-ledger.controller.ts': 'Finance reconciliation, company-level by decision.',
  'production/alert/alert.controller.ts': 'Alerts carry no batch or location to reach a farm through.',
  'production/milk/milk.controller.ts': 'Dairy — dormant, out of scope.',
  'production/parameter/parameter.controller.ts': 'Master data, not farm-specific.',
  'production/qc-parameter/qc-parameter.controller.ts': 'Master data, not farm-specific.',
  'production/qc/qc.controller.ts': 'Not in the MVP scope; classify when QC is built.',
  'production/qr-code/qr-code.controller.ts': 'Not in the MVP scope; classify when QR packs are built.',
  'production/stage/stage.controller.ts': 'Master data, not farm-specific.',
};

const MODULES = join(__dirname, '../modules');
const OPERATIONAL_DIRS = ['production', 'piggery', 'inventory'];

function controllerFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.controller.ts')) found.push(relative(MODULES, full));
    }
  };
  for (const dir of OPERATIONAL_DIRS) walk(join(MODULES, dir));
  return found.sort();
}

describe('Farm scope coverage', () => {
  it.each(Object.entries(SCOPED))('%s is farm-scoped', (_name, controller) => {
    expect(Reflect.getMetadata(FARM_SCOPED_KEY, controller)).toBe(true);
  });

  it('classifies every operational controller as scoped or exempt', () => {
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
