import { Module } from '@nestjs/common';
import { BreedingLineSetupController } from './breeding-line-setup.controller';
import { BreedingLineSetupService } from './breeding-line-setup.service';
import { BcsScaleController } from './bcs-scale.controller';
import { BcsScaleService } from './bcs-scale.service';
import { GeneticLevelBandController } from './genetic-level-band.controller';
import { GeneticLevelBandService } from './genetic-level-band.service';
import { SemenDestinationService } from './semen-destination.service';

@Module({
  controllers: [BreedingLineSetupController, GeneticLevelBandController, BcsScaleController],
  providers: [BreedingLineSetupService, GeneticLevelBandService, SemenDestinationService, BcsScaleService],
  exports: [BreedingLineSetupService, GeneticLevelBandService, SemenDestinationService, BcsScaleService],
})
export class BreedingLineModule {}
