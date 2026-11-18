import { Module } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { SupplierController } from './supplier.controller';
import { EncryptionModule } from '../../system/encryption/encryption.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { BusinessCentralModule } from '../../integration/business-central/business-central.module';

@Module({
  // BusinessCentralModule: supplier create/update write through to the BC vendor when BC is the vendor master.
  imports: [EncryptionModule, NumberSeriesModule, BusinessCentralModule],
  controllers: [SupplierController],
  providers: [SupplierService],
  exports: [SupplierService],
})
export class SupplierModule {}
