import { Module } from '@nestjs/common';
import { NoSeriesService } from './no-series.service';
import { NoSeriesController } from './no-series.controller';

@Module({
  controllers: [NoSeriesController],
  providers: [NoSeriesService],
  exports: [NoSeriesService],
})
export class NoSeriesModule {}
