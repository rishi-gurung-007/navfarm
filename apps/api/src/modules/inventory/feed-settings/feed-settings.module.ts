import { Module } from '@nestjs/common';
import { FeedSettingsController } from './feed-settings.controller';
import { FeedSettingsService } from './feed-settings.service';

@Module({ controllers: [FeedSettingsController], providers: [FeedSettingsService], exports: [FeedSettingsService] })
export class FeedSettingsModule {}
