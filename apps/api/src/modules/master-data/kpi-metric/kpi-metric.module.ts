import { Module } from '@nestjs/common';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { KpiMetricController } from './kpi-metric.controller';
import { KpiMetricService } from './kpi-metric.service';

@Module({ imports: [NumberSeriesModule], controllers: [KpiMetricController], providers: [KpiMetricService], exports: [KpiMetricService] })
export class KpiMetricModule {}
