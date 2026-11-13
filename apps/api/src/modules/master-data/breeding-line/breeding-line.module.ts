import { Module } from '@nestjs/common';
import { BreedingLineSetupController } from './breeding-line-setup.controller';
import { BreedingLineSetupService } from './breeding-line-setup.service';
import { BcsScaleController } from './bcs-scale.controller';
import { BcsScaleService } from './bcs-scale.service';
import { GeneticLevelBandController } from './genetic-level-band.controller';
import { GeneticLevelBandService } from './genetic-level-band.service';
import { GiltClassRuleController } from './gilt-class-rule.controller';
import { GiltClassRuleService } from './gilt-class-rule.service';
import { SemenDestinationService } from './semen-destination.service';

@Module({
  controllers: [BreedingLineSetupController, GeneticLevelBandController, BcsScaleController, GiltClassRuleController],
  providers: [BreedingLineSetupService, GeneticLevelBandService, SemenDestinationService, BcsScaleService, GiltClassRuleService],
  exports: [BreedingLineSetupService, GeneticLevelBandService, SemenDestinationService, BcsScaleService, GiltClassRuleService],
})
export class BreedingLineModule {}
