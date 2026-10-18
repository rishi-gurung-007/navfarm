import { Module } from '@nestjs/common';
import { FarrowingReportController } from './farrowing-report.controller';
import { FarrowingReportService } from './farrowing-report.service';

/** Operational reports (Triple-C_reports COMMENTS.xlsx). Each report adds its controller and service here. */
@Module({
  controllers: [FarrowingReportController],
  providers: [FarrowingReportService],
})
export class ReportsModule {}
