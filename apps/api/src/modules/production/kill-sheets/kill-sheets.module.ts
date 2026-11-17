import { Module } from '@nestjs/common';
import { KillSheetsController } from './kill-sheets.controller';
import { KillSheetsService } from './kill-sheets.service';
import { KillSheetStorageService } from './kill-sheet-storage.service';
@Module({ controllers: [KillSheetsController], providers: [KillSheetsService, KillSheetStorageService], exports: [KillSheetsService] })
export class KillSheetsModule {}
