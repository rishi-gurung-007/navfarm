import { Module } from '@nestjs/common';
import { GoodsReceiptService } from './goods-receipt.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';
import { FeedAlertModule } from '../feed-alert/feed-alert.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { QcInspectionModule } from '../qc-inspection/qc-inspection.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, SiloFeedModule, FeedAlertModule, NumberSeriesModule, QcInspectionModule],
  controllers: [GoodsReceiptController],
  providers: [GoodsReceiptService],
  exports: [GoodsReceiptService],
})
export class GoodsReceiptModule {}
