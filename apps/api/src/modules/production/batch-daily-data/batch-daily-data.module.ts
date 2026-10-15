import { Module, forwardRef } from '@nestjs/common';
import { BatchDailyDataController } from './batch-daily-data.controller';
import { BatchDailyDataService } from './batch-daily-data.service';
import { BatchModule } from '../batch/batch.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { SiloFeedModule } from '../../inventory/silo-feed/silo-feed.module';
import { FeedAlertModule } from '../../inventory/feed-alert/feed-alert.module';

@Module({
  // forwardRef: BatchModule now also imports this module back (BatchService.
  // postBatchDay() dispatches draft entries via BatchDailyDataService, using
  // the 'BATCH_DAILY_DATA_POSTER' token below rather than the class directly
  // — see the `import type` comment in batch.service.ts for why).
  imports: [forwardRef(() => BatchModule), JournalModule, SiloFeedModule, FeedAlertModule],
  controllers: [BatchDailyDataController],
  providers: [
    BatchDailyDataService,
    { provide: 'BATCH_DAILY_DATA_POSTER', useExisting: BatchDailyDataService },
  ],
  exports: [BatchDailyDataService, 'BATCH_DAILY_DATA_POSTER'],
})
export class BatchDailyDataModule {}
