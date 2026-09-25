import { Module } from '@nestjs/common';
import { StockTransferService } from './stock-transfer.service';
import { StockTransferController } from './stock-transfer.controller';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { UomModule } from '../../master-data/uom/uom.module';
import { SiloFeedModule } from '../silo-feed/silo-feed.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, UomModule, SiloFeedModule],
  controllers: [StockTransferController],
  providers: [StockTransferService],
  exports: [StockTransferService],
})
export class StockTransferModule {}
