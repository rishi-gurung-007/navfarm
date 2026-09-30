import { Module } from '@nestjs/common';
import { ReasonModule } from '../../master-data/reason/reason.module';
import { CurrencyModule } from '../../system/currency/currency.module';
import { FeedSettingsModule } from '../feed-settings/feed-settings.module';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { FeedStockCountController } from './feed-stock-count.controller';
import { FeedStockCountService } from './feed-stock-count.service';

@Module({
  imports: [InventoryLedgerModule, FeedSettingsModule, CurrencyModule, ReasonModule],
  controllers: [FeedStockCountController],
  providers: [FeedStockCountService],
  exports: [FeedStockCountService],
})
export class FeedStockCountModule {}
