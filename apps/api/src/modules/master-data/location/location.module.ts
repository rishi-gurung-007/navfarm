import { Module } from '@nestjs/common';
import { LocationService } from './location.service';
import { LocationController } from './location.controller';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { SiloFeedModule } from '../../inventory/silo-feed/silo-feed.module';

@Module({
  imports: [NumberSeriesModule, SiloFeedModule],
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
