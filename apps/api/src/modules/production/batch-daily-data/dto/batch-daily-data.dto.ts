import { ApiProperty, OmitType } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateBatchDailyDataDto {
  @ApiProperty({ description: 'scheduler_line UUID this entry answers' })
  @IsUUID()
  @IsNotEmpty()
  line_id: string;

  @ApiProperty({ example: '2026-09-08' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({ description: 'Numeric value — quantity for CONSUMPTION/OUTPUT/OVERHEAD/RESOURCE, the measured value for DESCRIPTIVE', required: false })
  @IsOptional()
  @IsNumber()
  entered_value?: number;

  @ApiProperty({ description: 'Free-text value, for a non-numeric DESCRIPTIVE capture', required: false })
  @IsOptional()
  @IsString()
  entered_text?: string;

  @ApiProperty({ description: 'Lot number — required when the line has lot_required', required: false })
  @IsOptional()
  @IsString()
  lot_no?: string;

  @ApiProperty({ description: 'Overrides the line default rate for OVERHEAD/RESOURCE lines (cost per unit)', required: false })
  @IsOptional()
  @IsNumber()
  rate?: number;

  @ApiProperty({ description: 'TRANSFER only — the batch this entry moves animals/stock into', required: false })
  @IsOptional()
  @IsUUID()
  destination_batch_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

export const TARGET_SCOPES = ['BATCH', 'STAGE_ANIMALS', 'SELECTED_ANIMALS'] as const;

/**
 * PUT /batch/:batchId/daily-data/draft — a sub-card's values saved without
 * posting anything. The same fields a post takes, plus who the entry is about
 * and the version the client last read, so two people on one line cannot
 * silently overwrite each other's draft.
 */
export class SaveDailyDraftDto extends CreateBatchDailyDataDto {
  @ApiProperty({ enum: TARGET_SCOPES, required: false, description: 'Defaults to BATCH on a Count Only batch and STAGE_ANIMALS on a Registered one' })
  @IsOptional()
  @IsIn(TARGET_SCOPES as unknown as string[])
  target_scope?: (typeof TARGET_SCOPES)[number];

  @ApiProperty({ type: [String], required: false, description: 'SELECTED_ANIMALS only — animal_register ids standing in the line\'s stage' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  animal_ids?: string[];

  @ApiProperty({ required: false, description: 'The draft version last read — required when a draft already exists' })
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

/** POST /batch/:batchId/daily-data/post — one or more drafts of one date, all or nothing. */
export class PostDailyDraftsDto {
  @ApiProperty({ example: '2026-09-15' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({ type: [String], description: 'scheduler_line ids whose drafts to post' })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  line_ids: string[];
}

/** POST /batch/:batchId/daily-data/correct — replaces a posted entry; the version is not optional here. */
export class CorrectDailyEntryDto extends OmitType(SaveDailyDraftDto, ['version'] as const) {
  @ApiProperty({ description: 'The posted entry\'s version as last read' })
  @IsInt()
  @Min(1)
  version: number;
}
