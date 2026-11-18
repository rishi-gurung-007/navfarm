import { Module } from '@nestjs/common';
import { UomModule } from '../master-data/uom/uom.module';
import { LOGISTICS_CONTROLLERS } from './logistics-master.controller';
import { LogisticsMasterService } from './logistics-master.service';
import { LogisticsTripController } from './logistics-trip.controller';
import { LogisticsTripService } from './logistics-trip.service';
import { RoadDistanceController } from './road-distance.controller';
import { RoadDistanceService } from './road-distance.service';

/** Logistics (NAVFarm TDD: Logistics Module). Phase 1: the masters a trip is planned from. Phase 2: trips. */
@Module({
  imports: [UomModule],
  controllers: [...LOGISTICS_CONTROLLERS, RoadDistanceController, LogisticsTripController],
  providers: [LogisticsMasterService, RoadDistanceService, LogisticsTripService],
  exports: [LogisticsMasterService, LogisticsTripService],
})
export class LogisticsModule {}
