import { Module } from '@nestjs/common';
import { StockAdjustmentService } from './stock-adjustment.service';
import { StockAdjustmentController } from './stock-adjustment.controller';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, NumberSeriesModule],
  controllers: [StockAdjustmentController],
  providers: [StockAdjustmentService],
  exports: [StockAdjustmentService],
})
export class StockAdjustmentModule {}

