import { Module } from '@nestjs/common';
import { BatchModule } from '../batch/batch.module';
import { JournalModule } from '../../finance/journal/journal.module';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';
import { SlaughterTransferController } from './slaughter-transfer.controller';
import { SlaughterTransferService } from './slaughter-transfer.service';

@Module({
  imports: [BatchModule, JournalModule, NumberSeriesModule],
  controllers: [SlaughterTransferController],
  providers: [SlaughterTransferService],
  exports: [SlaughterTransferService],
})
export class SlaughterTransferModule {}
