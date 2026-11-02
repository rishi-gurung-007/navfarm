import { Module } from '@nestjs/common';
import { PiggeryAnalyticsController } from './piggery-analytics.controller';
import { PiggeryAnalyticsService } from './piggery-analytics.service';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [PiggeryAnalyticsController],
  providers: [PiggeryAnalyticsService],
  exports: [PiggeryAnalyticsService],
})
export class PiggeryAnalyticsModule {}
