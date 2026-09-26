import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { FeedForecastModule } from '../../inventory/feed-forecast/feed-forecast.module';
import { FeedAlertModule } from '../../inventory/feed-alert/feed-alert.module';
import { FeedRequisitionController } from './feed-requisition.controller';
import { FeedRequisitionService } from './feed-requisition.service';

// Ruling C2: RequisitionModule is deliberately not imported — Nest would mount
// its generic /requisition controller along with it, and that route stays off.
@Module({
  imports: [ApprovalModule, FeedForecastModule, FeedAlertModule],
  controllers: [FeedRequisitionController],
  providers: [FeedRequisitionService],
})
export class FeedRequisitionModule {}
