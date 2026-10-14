import { Module } from '@nestjs/common';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { SchedulerHeaderController } from './scheduler-header.controller';
import { SchedulerHeaderService } from './scheduler-header.service';
import { SystemSchedulerController } from './system-scheduler.controller';
import { SystemSchedulerService } from './system-scheduler.service';

@Module({
  imports: [NumberSeriesModule],
  controllers: [SchedulerHeaderController, SystemSchedulerController],
  providers: [SchedulerHeaderService, SystemSchedulerService],
  exports: [SchedulerHeaderService],
})
export class SchedulerHeaderModule {}
