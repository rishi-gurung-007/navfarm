import { Module } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { BatchModule } from '../batch/batch.module';

/**
 * ApprovalModule imports BatchModule, which exports both BatchService and
 * BatchTransferService. The transfer side is what a BATCH_TRANSFER decision
 * acts on: approve posts the gated movement, reject cancels its draft.
 */
@Module({
  imports: [BatchModule],
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
