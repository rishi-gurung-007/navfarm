import { Module } from '@nestjs/common';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryLedgerController } from './inventory-ledger.controller';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';

@Module({
  imports: [NumberSeriesModule],
  controllers: [InventoryLedgerController],
  providers: [InventoryLedgerService],
  exports: [InventoryLedgerService],
})
export class InventoryLedgerModule {}
