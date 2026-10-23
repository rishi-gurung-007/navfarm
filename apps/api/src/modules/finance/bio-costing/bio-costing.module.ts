import { Module } from '@nestjs/common';
import { JournalModule } from '../journal/journal.module';
import { AnimalBookValueModule } from '../../inventory/bio-asset-ledger/animal-book-value.module';
import { BioCostingProfileController } from './bio-costing-profile.controller';
import { BioCostingProfileService } from './bio-costing-profile.service';
import { BioCostingResidualService } from './bio-costing-residual.service';
import { BioCostingRunController } from './bio-costing-run.controller';
import { BioCostingRunService } from './bio-costing-run.service';
import { BioCostingExitService } from './bio-costing-exit.service';
import { BioCostingSchedulerService } from './bio-costing-scheduler.service';

@Module({
  imports: [JournalModule, AnimalBookValueModule],
  controllers: [BioCostingProfileController, BioCostingRunController],
  providers: [BioCostingProfileService, BioCostingResidualService, BioCostingRunService, BioCostingExitService, BioCostingSchedulerService],
  exports: [BioCostingProfileService, BioCostingResidualService, BioCostingRunService, BioCostingExitService, BioCostingSchedulerService],
})
export class BioCostingModule {}
