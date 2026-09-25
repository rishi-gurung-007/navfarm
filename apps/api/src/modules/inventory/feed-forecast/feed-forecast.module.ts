import { Module } from '@nestjs/common';
import { FeedForecastController } from './feed-forecast.controller';
import { FeedForecastService } from './feed-forecast.service';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';

@Module({
  imports: [InventoryLedgerModule, SiloFeedModule],
  controllers: [FeedForecastController],
  providers: [FeedForecastService],
  exports: [FeedForecastService],
})
export class FeedForecastModule {}
