import { Module } from '@nestjs/common';
import { MillOutputController } from './mill-output.controller';
import { MillOutputService } from './mill-output.service';
import { InventoryLedgerModule } from '../inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';

@Module({
  imports: [InventoryLedgerModule, JournalModule, NumberSeriesModule],
  controllers: [MillOutputController],
  providers: [MillOutputService],
})
export class MillOutputModule {}
