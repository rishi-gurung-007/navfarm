import { Module } from '@nestjs/common';
import { BreedingLineSetupController } from './breeding-line-setup.controller';
import { BreedingLineSetupService } from './breeding-line-setup.service';
import { BcsScaleController } from './bcs-scale.controller';
import { BcsScaleService } from './bcs-scale.service';
import { GeneticLevelBandController } from './genetic-level-band.controller';
import { GeneticLevelBandService } from './genetic-level-band.service';
import { SemenDestinationService } from './semen-destination.service';
import { SemenCollectorController } from './semen-collector.controller';
import { SemenCollectorService } from './semen-collector.service';

@Module({
  controllers: [BreedingLineSetupController, SemenCollectorController, GeneticLevelBandController, BcsScaleController],
  providers: [BreedingLineSetupService, SemenCollectorService, GeneticLevelBandService, SemenDestinationService, BcsScaleService],
  exports: [BreedingLineSetupService, SemenCollectorService, GeneticLevelBandService, SemenDestinationService, BcsScaleService],
})
export class BreedingLineModule {}
