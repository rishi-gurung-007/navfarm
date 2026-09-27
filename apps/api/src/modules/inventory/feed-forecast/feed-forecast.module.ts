import { Module } from '@nestjs/common';
import { FeedForecastController } from './feed-forecast.controller';
import { FeedForecastService } from './feed-forecast.service';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';

@Module({
  imports: [InventoryLedgerModule],
  controllers: [FeedForecastController],
  providers: [FeedForecastService],
  exports: [FeedForecastService],
})
export class FeedForecastModule {}
