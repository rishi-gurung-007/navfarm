import { Module } from '@nestjs/common';
import { BatchDailyDataController } from './batch-daily-data.controller';
import { BatchDailyDataService } from './batch-daily-data.service';
import { BatchModule } from '../batch/batch.module';
import { JournalModule } from '../../finance/journal/journal.module';

@Module({
  imports: [BatchModule, JournalModule],
  controllers: [BatchDailyDataController],
  providers: [BatchDailyDataService],
  exports: [BatchDailyDataService],
})
export class BatchDailyDataModule {}
