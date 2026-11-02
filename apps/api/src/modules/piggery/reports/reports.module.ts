import { Module } from '@nestjs/common';
import { FarrowingReportController } from './farrowing-report.controller';
import { FarrowingReportService } from './farrowing-report.service';
import { MonthlyOpsController } from './monthly-ops.controller';
import { MonthlyOpsService } from './monthly-ops.service';
import { AccountingPeriodModule } from '../../master-data/accounting-period/accounting-period.module';

/** Operational reports (Triple-C_reports COMMENTS.xlsx). Each report adds its controller and service here. */
@Module({
  imports: [AccountingPeriodModule],
  controllers: [FarrowingReportController, MonthlyOpsController],
  providers: [FarrowingReportService, MonthlyOpsService],
  exports: [MonthlyOpsService],
})
export class ReportsModule {}
