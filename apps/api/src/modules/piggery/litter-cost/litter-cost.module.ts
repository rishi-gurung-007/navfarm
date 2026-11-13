import { Module } from '@nestjs/common';
import { JournalModule } from '../../finance/journal/journal.module';
import { AnimalBookValueModule } from '../../inventory/bio-asset-ledger/animal-book-value.module';
import { LitterCostService } from './litter-cost.service';

/** The sow-to-litter cost move, shared by the weaning (Breeding) and by gilt selection before it. */
@Module({ imports: [AnimalBookValueModule, JournalModule], providers: [LitterCostService], exports: [LitterCostService] })
export class LitterCostModule {}
