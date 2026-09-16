import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';

@Module({
  imports: [ApprovalModule],
  controllers: [RequisitionController],
  providers: [RequisitionService],
  exports: [RequisitionService],
})
export class RequisitionModule {}
