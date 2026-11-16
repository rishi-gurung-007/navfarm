import { Module } from '@nestjs/common';
import { QcInspectionService } from './qc-inspection.service';
import { QcInspectionController } from './qc-inspection.controller';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, NumberSeriesModule],
  controllers: [QcInspectionController],
  providers: [QcInspectionService],
  exports: [QcInspectionService],
})
export class QcInspectionModule {}
