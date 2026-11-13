import { Module } from '@nestjs/common';
import { StockTransferService } from './stock-transfer.service';
import { StockTransferController } from './stock-transfer.controller';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { UomModule } from '../../master-data/uom/uom.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';
import { FeedAlertModule } from '../feed-alert/feed-alert.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { BreedingLineModule } from '../../master-data/breeding-line/breeding-line.module';
import { QcInspectionModule } from '../qc-inspection/qc-inspection.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, UomModule, SiloFeedModule, FeedAlertModule, NumberSeriesModule, BreedingLineModule, QcInspectionModule],
  controllers: [StockTransferController],
  providers: [StockTransferService],
  exports: [StockTransferService],
})
export class StockTransferModule {}
