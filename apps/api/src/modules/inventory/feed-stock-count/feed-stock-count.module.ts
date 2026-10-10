import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { ReasonModule } from '../../master-data/reason/reason.module';
import { CurrencyModule } from '../../system/currency/currency.module';
import { FeedAlertModule } from '../feed-alert/feed-alert.module';
import { FeedForecastModule } from '../feed-forecast/feed-forecast.module';
import { FeedSettingsModule } from '../feed-settings/feed-settings.module';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { StockAdjustmentModule } from '../stock-adjustment/stock-adjustment.module';
import { FeedStockCountController } from './feed-stock-count.controller';
import { FeedStockCountService } from './feed-stock-count.service';

@Module({
  imports: [
    InventoryLedgerModule, FeedSettingsModule, CurrencyModule, ReasonModule,
    ApprovalModule, StockAdjustmentModule, FeedAlertModule, FeedForecastModule,
  ],
  controllers: [FeedStockCountController],
  providers: [FeedStockCountService],
  exports: [FeedStockCountService],
})
export class FeedStockCountModule {}
