import { Module } from '@nestjs/common';
import { ItemTemplateService } from './item-template.service';
import { ItemTemplateController } from './item-template.controller';

@Module({
  controllers: [ItemTemplateController],
  providers: [ItemTemplateService],
  exports: [ItemTemplateService],
})
export class ItemTemplateModule {}
