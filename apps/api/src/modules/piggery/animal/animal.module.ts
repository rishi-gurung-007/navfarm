import { Module } from '@nestjs/common';
import { AnimalService } from './animal.service';
import { AnimalController } from './animal.controller';
import { AnimalActivityService } from './animal-activity.service';
import { AnimalMedicationLogService } from './animal-medication-log.service';
import { AnimalMedicationLogController } from './animal-medication-log.controller';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { BatchModule } from '../../production/batch/batch.module';
import { OperationalAreaModule } from '../../core/operational-area/operational-area.module';
import { AnimalBookValueModule } from '../../inventory/bio-asset-ledger/animal-book-value.module';
import { BioCostingModule } from '../../finance/bio-costing/bio-costing.module';

@Module({
  imports: [NumberSeriesModule, OperationalAreaModule, BatchModule, AnimalBookValueModule, BioCostingModule],
  controllers: [AnimalController, AnimalMedicationLogController],
  providers: [AnimalService, AnimalMedicationLogService, AnimalActivityService],
  exports: [AnimalService, AnimalMedicationLogService],
})
export class AnimalModule {}
