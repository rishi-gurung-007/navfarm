import { Module } from '@nestjs/common';
import { BreedingLineModule } from '../../master-data/breeding-line/breeding-line.module';
import { BoarConditionController } from './boar-condition.controller';
import { BoarConditionService } from './boar-condition.service';

@Module({
  imports: [BreedingLineModule],
  controllers: [BoarConditionController],
  providers: [BoarConditionService],
  exports: [BoarConditionService],
})
export class BoarConditionModule {}
