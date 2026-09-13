import { Module } from '@nestjs/common';
import { BatchService } from './batch.service';
import { BatchController } from './batch.controller';
import { BatchTransferService } from './batch-transfer.service';
import { BatchTransferController } from './batch-transfer.controller';
import { InventoryLedgerModule } from '../../inventory/inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { SchedulerHeaderModule } from '../scheduler-header/scheduler-header.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, NumberSeriesModule, SchedulerHeaderModule],
  controllers: [BatchController, BatchTransferController],
  providers: [BatchService, BatchTransferService],
  exports: [BatchService, BatchTransferService],
})
export class BatchModule {}
