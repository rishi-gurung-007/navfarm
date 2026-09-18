import { Module } from '@nestjs/common';
import { InventorySetupController } from './inventory-setup.controller';
import { InventorySetupService } from './inventory-setup.service';

@Module({
  controllers: [InventorySetupController],
  providers: [InventorySetupService],
  exports: [InventorySetupService],
})
export class InventorySetupModule {}
