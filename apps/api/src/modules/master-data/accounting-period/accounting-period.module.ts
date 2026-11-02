import { Module } from '@nestjs/common';
import { AccountingPeriodController } from './accounting-period.controller';
import { AccountingPeriodService } from './accounting-period.service';

@Module({
  controllers: [AccountingPeriodController],
  providers: [AccountingPeriodService],
  exports: [AccountingPeriodService],
})
export class AccountingPeriodModule {}
