import { Module } from '@nestjs/common';
import { BatchModule } from '../../production/batch/batch.module';
import { LitterCostModule } from '../litter-cost/litter-cost.module';
import { AnimalModule } from '../animal/animal.module';
import { GiltSelectionController } from './gilt-selection.controller';
import { GiltSelectionService } from './gilt-selection.service';

@Module({
  imports: [BatchModule, AnimalModule, LitterCostModule],
  controllers: [GiltSelectionController],
  providers: [GiltSelectionService],
  exports: [GiltSelectionService],
})
export class GiltSelectionModule {}
