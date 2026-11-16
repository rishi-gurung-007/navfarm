import { Module } from '@nestjs/common';
import { ItemQcSpecController } from './item-qc-spec.controller';
import { ItemQcSpecService } from './item-qc-spec.service';

@Module({
  controllers: [ItemQcSpecController],
  providers: [ItemQcSpecService],
  exports: [ItemQcSpecService],
})
export class ItemQcSpecModule {}
