import { Module } from '@nestjs/common';
import { BreedingService } from './breeding.service';
import { BreedingController } from './breeding.controller';
import { BatchModule } from '../../production/batch/batch.module';
import { SemenLotService } from './semen-lot.service';
import { InventoryLedgerModule } from '../../inventory/inventory-ledger/inventory-ledger.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { QrCodeModule } from '../../production/qr-code/qr-code.module';
import { AnimalModule } from '../animal/animal.module';
import { LitterCostModule } from '../litter-cost/litter-cost.module';
import { GiltSelectionModule } from '../gilt-selection/gilt-selection.module';
import { AnimalBookValueModule } from '../../inventory/bio-asset-ledger/animal-book-value.module';

@Module({
  imports: [BatchModule, InventoryLedgerModule, JournalModule, NumberSeriesModule, QrCodeModule, AnimalModule, AnimalBookValueModule, GiltSelectionModule, LitterCostModule],
  controllers: [BreedingController],
  providers: [BreedingService, SemenLotService],
  exports: [BreedingService],
})
export class BreedingModule {}
