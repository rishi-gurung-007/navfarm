import { Module } from '@nestjs/common';
import { FeedForecastController } from './feed-forecast.controller';
import { FeedForecastService } from './feed-forecast.service';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';
import { FeedSettingsModule } from '../feed-settings/feed-settings.module';
import { FeedForecastRunService } from './feed-forecast-run.service';

@Module({
  imports: [InventoryLedgerModule, SiloFeedModule, FeedSettingsModule],
  controllers: [FeedForecastController],
  providers: [FeedForecastService, FeedForecastRunService],
  exports: [FeedForecastService, FeedForecastRunService],
})
export class FeedForecastModule {}
