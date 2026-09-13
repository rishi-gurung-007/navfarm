import { Module } from '@nestjs/common';
import { SchedulerHeaderController } from './scheduler-header.controller';
import { SchedulerHeaderService } from './scheduler-header.service';

@Module({
  controllers: [SchedulerHeaderController],
  providers: [SchedulerHeaderService],
  exports: [SchedulerHeaderService],
})
export class SchedulerHeaderModule {}
