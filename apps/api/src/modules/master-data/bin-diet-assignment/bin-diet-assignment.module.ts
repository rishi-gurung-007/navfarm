import { Module } from '@nestjs/common';
import { InventoryLedgerModule } from '../../inventory/inventory-ledger/inventory-ledger.module';
import { BinDietAssignmentController } from './bin-diet-assignment.controller';
import { BinDietAssignmentService } from './bin-diet-assignment.service';

@Module({
  imports: [InventoryLedgerModule],
  controllers: [BinDietAssignmentController],
  providers: [BinDietAssignmentService],
  exports: [BinDietAssignmentService],
})
export class BinDietAssignmentModule {}
