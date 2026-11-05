import { Module } from '@nestjs/common';
import { LOGISTICS_CONTROLLERS } from './logistics-master.controller';
import { LogisticsMasterService } from './logistics-master.service';
import { RoadDistanceController } from './road-distance.controller';
import { RoadDistanceService } from './road-distance.service';

/** Logistics (NAVFarm TDD: Logistics Module). Phase 1: the masters a trip is planned from. */
@Module({
  controllers: [...LOGISTICS_CONTROLLERS, RoadDistanceController],
  providers: [LogisticsMasterService, RoadDistanceService],
  exports: [LogisticsMasterService],
})
export class LogisticsModule {}
