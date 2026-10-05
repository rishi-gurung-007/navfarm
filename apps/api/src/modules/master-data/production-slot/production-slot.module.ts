import { Module } from '@nestjs/common';
import { ProductionSlotService } from './production-slot.service';
import { ProductionSlotController } from './production-slot.controller';

@Module({
  controllers: [ProductionSlotController],
  providers: [ProductionSlotService],
  exports: [ProductionSlotService],
})
export class ProductionSlotModule {}
