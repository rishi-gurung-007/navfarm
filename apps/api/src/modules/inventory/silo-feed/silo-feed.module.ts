import { Module } from '@nestjs/common';
import { SiloFeedService } from './silo-feed.service';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';

@Module({
  imports: [InventoryLedgerModule],
  providers: [SiloFeedService],
  exports: [SiloFeedService],
})
export class SiloFeedModule {}
