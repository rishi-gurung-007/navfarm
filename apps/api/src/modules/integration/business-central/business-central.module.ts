import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import businessCentralConfig, { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig } from './business-central.config';
import { BcConnectionService } from './bc-connection.service';
import { BcODataClient } from './bc-odata.client';
import { BC_FETCH, BcTokenService } from './bc-token.service';
import { BusinessCentralController } from './business-central.controller';
import { BcVendorSyncController } from './vendor-sync/bc-vendor-sync.controller';
import { BcVendorSyncService } from './vendor-sync/bc-vendor-sync.service';
import { BcVendorWriteService } from './vendor-sync/bc-vendor-write.service';

/**
 * Business Central connector: OAuth token cache, OData client, connection diagnostics.
 * Export BcODataClient to the modules that will sync masters and post transactions.
 */
@Module({
  imports: [ConfigModule.forFeature(businessCentralConfig)],
  controllers: [BusinessCentralController, BcVendorSyncController],
  providers: [
    {
      provide: BUSINESS_CENTRAL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): BusinessCentralConfig => config.getOrThrow<BusinessCentralConfig>(BUSINESS_CENTRAL_CONFIG),
    },
    { provide: BC_FETCH, useValue: (...args: Parameters<typeof fetch>) => fetch(...args) },
    BcTokenService,
    BcODataClient,
    BcConnectionService,
    BcVendorSyncService,
    BcVendorWriteService,
  ],
  exports: [BcODataClient, BcConnectionService, BcTokenService, BcVendorSyncService, BcVendorWriteService, BUSINESS_CENTRAL_CONFIG],
})
export class BusinessCentralModule {}
