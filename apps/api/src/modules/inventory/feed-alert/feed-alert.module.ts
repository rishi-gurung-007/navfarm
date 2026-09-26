import { Module } from '@nestjs/common';
import { FeedForecastModule } from '../feed-forecast/feed-forecast.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';
import { AlertRuleModule } from '../../system/alert-rule/alert-rule.module';
import { FeedAlertController } from './feed-alert.controller';
import { FeedAlertService } from './feed-alert.service';

@Module({
  imports: [FeedForecastModule, SiloFeedModule, AlertRuleModule],
  controllers: [FeedAlertController],
  providers: [FeedAlertService],
  exports: [FeedAlertService],
})
export class FeedAlertModule {}
