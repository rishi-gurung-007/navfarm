import { Module } from '@nestjs/common';
import { ItemService } from './item.service';
import { ItemController } from './item.controller';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { OperationalAreaModule } from '../../core/operational-area/operational-area.module';
import { NoSeriesModule } from '../no-series/no-series.module';
import { ItemTemplateModule } from '../item-template/item-template.module';

@Module({
  imports: [NumberSeriesModule, OperationalAreaModule, NoSeriesModule, ItemTemplateModule],
  controllers: [ItemController],
  providers: [ItemService],
  exports: [ItemService],
})
export class ItemModule {}

