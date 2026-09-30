import { Module } from '@nestjs/common';
import { ReportingPeriodController } from './reporting-period.controller';
import { ReportingPeriodService } from './reporting-period.service';

@Module({ controllers: [ReportingPeriodController], providers: [ReportingPeriodService], exports: [ReportingPeriodService] })
export class ReportingPeriodModule {}
