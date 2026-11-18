import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import businessCentralConfig, { BUSINESS_CENTRAL_CONFIG, type BusinessCentralConfig } from './business-central.config';
import { BcConnectionService } from './bc-connection.service';
import { BcODataClient } from './bc-odata.client';
import { BC_FETCH, BcTokenService } from './bc-token.service';
import { BusinessCentralController } from './business-central.controller';

/**
 * Business Central connector: OAuth token cache, OData client, connection diagnostics.
 * Export BcODataClient to the modules that will sync masters and post transactions.
 */
@Module({
  imports: [ConfigModule.forFeature(businessCentralConfig)],
  controllers: [BusinessCentralController],
  providers: [
    {
      provide: BUSINESS_CENTRAL_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): BusinessCentralConfig => config.getOrThrow<BusinessCentralConfig>(BUSINESS_CENTRAL_CONFIG),
    },
    { provide: BC_FETCH, useValue: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init) },
    BcTokenService,
    BcODataClient,
    BcConnectionService,
  ],
  exports: [BcODataClient, BcConnectionService, BcTokenService],
})
export class BusinessCentralModule {}
