import { Module } from '@nestjs/common';
import { JournalService } from './journal.service';
import { JournalController } from './journal.controller';
import { GlPostingService } from './gl-posting.service';
import { NumberSeriesModule } from '../../system/number-series/number-series.module';

@Module({
  imports: [NumberSeriesModule],
  controllers: [JournalController],
  providers: [JournalService, GlPostingService],
  exports: [JournalService, GlPostingService],
})
export class JournalModule {}
