import { Module } from '@nestjs/common';
import { AnimalService } from './animal.service';
import { AnimalController } from './animal.controller';
import { AnimalMedicationLogService } from './animal-medication-log.service';
import { AnimalMedicationLogController } from './animal-medication-log.controller';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { OperationalAreaModule } from '../../core/operational-area/operational-area.module';
import { SchedulerHeaderModule } from '../../production/scheduler-header/scheduler-header.module';
import { BatchModule } from '../../production/batch/batch.module';

@Module({
  imports: [
    NumberSeriesModule,
    OperationalAreaModule,
    SchedulerHeaderModule,
    BatchModule,
  ],
  controllers: [AnimalController, AnimalMedicationLogController],
  providers: [AnimalService, AnimalMedicationLogService],
  exports: [AnimalService, AnimalMedicationLogService],
})
export class AnimalModule {}
