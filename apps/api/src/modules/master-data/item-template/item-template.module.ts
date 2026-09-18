import { Module } from '@nestjs/common';
import { ItemTemplateService } from './item-template.service';
import { ItemTemplateController } from './item-template.controller';
import { NoSeriesModule } from '../no-series/no-series.module';

@Module({
  imports: [NoSeriesModule],
  controllers: [ItemTemplateController],
  providers: [ItemTemplateService],
  exports: [ItemTemplateService],
})
export class ItemTemplateModule {}
