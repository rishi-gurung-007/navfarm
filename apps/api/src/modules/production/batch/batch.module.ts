import { Module, forwardRef } from '@nestjs/common';
import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';
import { BatchTransferService } from './batch-transfer.service';
import { BatchTransferController } from './batch-transfer.controller';
import { BatchDayReversalService } from './batch-day-reversal.service';
import { PigletLotService } from './piglet-lot.service';
import { BatchMortalityReversalService } from './batch-mortality-reversal.service';
import { InventoryLedgerModule } from '../../inventory/inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { SchedulerHeaderModule } from '../scheduler-header/scheduler-header.module';
import { BatchDailyDataModule } from '../batch-daily-data/batch-daily-data.module';

@Module({
  // forwardRef: BatchDailyDataModule already imports this module (for
  // addTransaction); BatchService.postBatchDay() needs the reverse edge too.
  imports: [
    InventoryLedgerModule,
    JournalModule,
    NumberSeriesModule,
    SchedulerHeaderModule,
    forwardRef(() => BatchDailyDataModule),
  ],
  controllers: [BatchController, BatchTransferController],
  providers: [BatchService, BatchTransferService, BatchDayReversalService, PigletLotService, BatchMortalityReversalService],
  exports: [BatchService, BatchTransferService, PigletLotService],
})
export class BatchModule {}
