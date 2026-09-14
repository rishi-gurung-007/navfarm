import { Module } from '@nestjs/common';
import { OperationalAreaModule } from '../../core/operational-area/operational-area.module';
import { ActivityController } from './activity.controller';
import { ActivityService } from './activity.service';

@Module({
  imports: [OperationalAreaModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
