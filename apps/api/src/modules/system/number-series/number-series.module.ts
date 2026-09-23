import { Module } from '@nestjs/common';
import { NumberSeriesService } from './number-series.service';
import { NumberSeriesController } from './number-series.controller';
import { OperationalAreaModule } from '../../core/operational-area/operational-area.module';
import { NoSeriesController } from '../../master-data/no-series/no-series.controller';

@Module({
  imports: [OperationalAreaModule],
  // NoSeriesController is kept as a thin alias over the same merged no_series
  // table/service — item-template, inventory-setup and the frontend's
  // /no-series/* calls all still work unchanged; see docs/decisions.md,
  // 2026-09-23 (no_series/no_series_master consolidation).
  controllers: [NumberSeriesController, NoSeriesController],
  providers: [NumberSeriesService],
  exports: [NumberSeriesService],
})
export class NumberSeriesModule {}
