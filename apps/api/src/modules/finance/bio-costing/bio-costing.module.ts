import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { AnimalBookValueModule } from '../../inventory/bio-asset-ledger/animal-book-value.module';
import { BioCostingAnimalController } from './bio-costing-animal.controller';
import { BioCostingItemController } from './bio-costing-item.controller';
import { BioCostingItemService } from './bio-costing-item.service';
import { BioCostingResidualService } from './bio-costing-residual.service';
import { BioCostingRunController } from './bio-costing-run.controller';
import { BioCostingRunService } from './bio-costing-run.service';
import { BioCostingExitService } from './bio-costing-exit.service';
import { BioCostingSchedulerService } from './bio-costing-scheduler.service';
import { BioCostingStartService } from './bio-costing-start.service';
import { BioCostingSubjectService } from './bio-costing-subject.service';

@Module({
  imports: [JournalModule, AnimalBookValueModule],
  controllers: [BioCostingAnimalController, BioCostingRunController, BioCostingItemController],
  providers: [BioCostingResidualService, BioCostingRunService, BioCostingExitService, BioCostingSchedulerService, BioCostingSubjectService, BioCostingItemService, BioCostingStartService],
  exports: [BioCostingResidualService, BioCostingRunService, BioCostingExitService, BioCostingSchedulerService, BioCostingSubjectService, BioCostingItemService, BioCostingStartService],
})
export class BioCostingModule {}
