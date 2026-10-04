import { Module } from '@nestjs/common';
import { ApprovalModule } from '../../production/approval/approval.module';
import { StockTransferModule } from '../../inventory/stock-transfer/stock-transfer.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { RequisitionController } from './requisition.controller';
import { RequisitionService } from './requisition.service';

@Module({
  imports: [ApprovalModule, StockTransferModule, NumberSeriesModule],
  controllers: [RequisitionController],
  providers: [RequisitionService],
  exports: [RequisitionService],
})
export class RequisitionModule {}
