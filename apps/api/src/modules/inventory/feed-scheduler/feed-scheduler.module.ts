import { Module } from '@nestjs/common';
import { FeedForecastModule } from '../feed-forecast/feed-forecast.module';
import { FeedSettingsModule } from '../feed-settings/feed-settings.module';
import { FeedAlertModule } from '../feed-alert/feed-alert.module';
import { FeedSchedulerController } from './feed-scheduler.controller';
import { FeedSchedulerService } from './feed-scheduler.service';

/** Brief B: the feed scheduler (in-app notices). ScheduleModule.forRoot() is registered once, in AppModule. */
@Module({
  imports: [FeedForecastModule, FeedSettingsModule, FeedAlertModule],
  controllers: [FeedSchedulerController],
  providers: [FeedSchedulerService],
  exports: [FeedSchedulerService],
})
export class FeedSchedulerModule {}
