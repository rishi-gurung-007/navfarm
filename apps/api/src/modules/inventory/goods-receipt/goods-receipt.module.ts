import { Module } from '@nestjs/common';
import { GoodsReceiptService } from './goods-receipt.service';
import { GoodsReceiptController } from './goods-receipt.controller';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, NumberSeriesModule],
  controllers: [GoodsReceiptController],
  providers: [GoodsReceiptService],
  exports: [GoodsReceiptService],
})
export class GoodsReceiptModule {}
