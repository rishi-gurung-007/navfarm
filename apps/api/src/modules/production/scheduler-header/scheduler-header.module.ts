import { Module } from '@nestjs/common';
import { SchedulerHeaderController } from './scheduler-header.controller';
import { SchedulerHeaderService } from './scheduler-header.service';
import { SystemSchedulerController } from './system-scheduler.controller';
import { SystemSchedulerService } from './system-scheduler.service';

@Module({
  controllers: [SchedulerHeaderController, SystemSchedulerController],
  providers: [SchedulerHeaderService, SystemSchedulerService],
  exports: [SchedulerHeaderService],
})
export class SchedulerHeaderModule {}
