import { Module } from '@nestjs/common';
import { PiggeryAnalyticsController } from './piggery-analytics.controller';
import { PiggeryAnalyticsService } from './piggery-analytics.service';

@Module({
  controllers: [PiggeryAnalyticsController],
  providers: [PiggeryAnalyticsService],
  exports: [PiggeryAnalyticsService],
})
export class PiggeryAnalyticsModule {}
