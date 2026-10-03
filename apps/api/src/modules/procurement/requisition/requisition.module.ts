import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { StockTransferModule } from '../../inventory/stock-transfer/stock-transfer.module';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';

@Module({
  imports: [ApprovalModule, StockTransferModule],
  controllers: [RequisitionController],
  providers: [RequisitionService],
  exports: [RequisitionService],
})
export class RequisitionModule {}
