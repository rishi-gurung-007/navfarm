import { ApiProperty } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, Max, IsNumber, IsIn, IsArray, ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

export const LINE_TYPES = ['CONSUMPTION', 'OUTPUT', 'DESCRIPTIVE', 'OVERHEAD', 'RESOURCE', 'TRANSFER'] as const;
export const OCCURRENCES = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE', 'CUSTOM'] as const;
export const QTY_BASES = ['PER_HEAD', 'TOTAL_BATCH'] as const;
export const OUTPUT_BASES = ['PER_SOW', 'PER_PEN', 'PER_BATCH'] as const;
export const DATA_ENTRY_LEVELS = ['FARM', 'SHED', 'PEN'] as const;
export const KPI_METRICS = [
  'BODY_WEIGHT', 'FCR', 'ADG', 'BCS_SCORE', 'MORTALITY_COUNT', 'TEMPERATURE',
  'HEAD_COUNT', 'LITTER_SIZE', 'WEANING_WEIGHT', 'PIGLETS_BORN', 'SEMEN_MOTILITY',
  'EGG_COUNT', 'MILK_LITRES', 'CUSTOM',
] as const;
export const CAPTURE_PERS = ['AVERAGE', 'TOTAL', 'PER_HEAD'] as const;

/**
 * What the user answered when a batch's scheduler was about to be created and
 * a system scheduler matched its stage: SYSTEM copies that scheduler's lines,
 * EMPTY leaves the header empty for manual lines. Omitted (no one was asked —
 * a lazy create from data entry, a split, a transfer posting) behaves as
 * SYSTEM. With no matching system scheduler, the lines come from the breed
 * lifecycle exactly as before.
 */
export const SCHEDULER_SOURCES = ['SYSTEM', 'EMPTY'] as const;
export type SchedulerSource = (typeof SCHEDULER_SOURCES)[number];

export class GenerateSchedulerHeaderDto {
  @ApiProperty({ description: 'Batch UUID to generate this stage\'s schedule for' })
  @IsUUID()
  @IsNotEmpty()
  batch_id: string;
}

export class CreateSchedulerHeaderDto {
  @ApiProperty({ description: 'Batch UUID' })
  @IsUUID()
  @IsNotEmpty()
  batch_id: string;

  @ApiProperty({ description: 'Stage UUID' })
  @IsUUID()
  @IsNotEmpty()
  stage_id: string;

  @ApiProperty({ enum: DATA_ENTRY_LEVELS, required: false, default: 'SHED' })
  @IsOptional()
  @IsString()
  @IsIn(DATA_ENTRY_LEVELS)
  data_entry_level?: string;

  @ApiProperty({ required: false, example: '2026-03-08' })
  @IsOptional()
  @IsString()
  effective_from?: string;

  @ApiProperty({ required: false, example: '2026-06-30' })
  @IsOptional()
  @IsString()
  effective_to?: string;

  @ApiProperty({ required: false, example: 25 })
  @IsOptional()
  @IsNumber()
  animal_count?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ enum: ['DRAFT', 'ACTIVE'], required: false, default: 'DRAFT' })
  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'ACTIVE'])
  scheduler_status?: string;

  @ApiProperty({ type: () => [CreateSchedulerLineDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSchedulerLineDto)
  lines?: CreateSchedulerLineDto[];

  @ApiProperty({ description: 'The system scheduler the sent lines were copied from — recorded as their origin', required: false })
  @IsOptional()
  @IsUUID()
  system_scheduler_id?: string;
}

export class UpdateSchedulerHeaderDto {
  @ApiProperty({ enum: DATA_ENTRY_LEVELS, required: false })
  @IsOptional()
  @IsString()
  @IsIn(DATA_ENTRY_LEVELS)
  data_entry_level?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  effective_from?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  effective_to?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  animal_count?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

/** Where an empty scheduler's activities are copied from: a system scheduler, or another batch's scheduler. */
export const COPY_SOURCE_TYPES = ['SYSTEM', 'BATCH'] as const;

export class CopySchedulerLinesDto {
  @ApiProperty({ enum: COPY_SOURCE_TYPES, description: 'SYSTEM = a system scheduler; BATCH = a batch\'s scheduler' })
  @IsString()
  @IsIn(COPY_SOURCE_TYPES)
  source_type: (typeof COPY_SOURCE_TYPES)[number];

  @ApiProperty({ description: 'The system_scheduler_id or scheduler_id to copy from' })
  @IsUUID()
  source_id: string;
}

export const SCHEDULER_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'SUSPENDED'] as const;

export class QuerySchedulerHeaderDto {
  @ApiProperty({ description: 'Filter by batch UUID — returns that batch\'s full schedule history (one row per stage)', required: false })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiProperty({ description: 'Filter by company UUID — used for the company-wide Scheduler list when batchId is omitted', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ enum: SCHEDULER_STATUSES, required: false })
  @IsOptional()
  @IsString()
  @IsIn(SCHEDULER_STATUSES)
  status?: string;

  @ApiProperty({ description: 'Filter by LOB UUID', required: false })
  @IsOptional()
  @IsUUID()
  lobId?: string;

  @ApiProperty({ description: 'Search batch no.', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Max rows to return', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ description: 'Row offset for pagination', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class UpdateSchedulerHeaderStatusDto {
  @ApiProperty({ enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'SUSPENDED'] })
  @IsString()
  @IsIn(['DRAFT', 'ACTIVE', 'COMPLETED', 'SUSPENDED'])
  scheduler_status: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSchedulerLineDto {
  @ApiProperty({ enum: LINE_TYPES })
  @IsString()
  @IsIn(LINE_TYPES)
  line_type: string;

  @ApiProperty({ example: 'Evening Feed' })
  @IsString()
  @IsNotEmpty()
  activity_name: string;

  @ApiProperty({ enum: OCCURRENCES, default: 'DAILY' })
  @IsOptional()
  @IsString()
  @IsIn(OCCURRENCES)
  occurrence?: string;

  @ApiProperty({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  start_day?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  end_day?: number;

  @ApiProperty({ description: '1=Monday..7=Sunday for WEEKLY; 1..28 for MONTHLY', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  day_of_week?: number;

  @ApiProperty({ description: 'Day numbers (from stage start) — required when occurrence=CUSTOM', required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  custom_days?: number[];

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiProperty({ description: 'Item UUID — CONSUMPTION / OUTPUT', required: false })
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiProperty({ description: 'Free-editable description — pre-filled from item_master.item_name on item_id selection but not locked to it', required: false })
  @IsOptional()
  @IsString()
  item_description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  standard_qty?: number;

  @ApiProperty({ enum: QTY_BASES, description: 'CONSUMPTION only', required: false })
  @IsOptional()
  @IsString()
  @IsIn(QTY_BASES)
  qty_basis?: string;

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  allow_qty_edit?: boolean;

  @ApiProperty({ description: 'CONSUMPTION only — FIFO traceability and medicine withdrawal-period tracking', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  lot_required?: boolean;

  @ApiProperty({ description: 'OUTPUT only', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  creates_inventory?: boolean;

  @ApiProperty({ description: 'OUTPUT only', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  output_lot_auto?: boolean;

  @ApiProperty({ enum: OUTPUT_BASES, description: 'OUTPUT only', required: false })
  @IsOptional()
  @IsString()
  @IsIn(OUTPUT_BASES)
  output_basis?: string;

  @ApiProperty({ description: 'DESCRIPTIVE only', required: false })
  @IsOptional()
  @IsString()
  kpi_metric?: string;

  @ApiProperty({ description: 'DESCRIPTIVE only', required: false })
  @IsOptional()
  @IsString()
  kpi_uom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  std_value?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  lower_alert_limit?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  upper_alert_limit?: number;

  @ApiProperty({ enum: ['INFO', 'WARNING', 'CRITICAL'], required: false, default: 'WARNING' })
  @IsOptional()
  @IsString()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  alert_severity?: string;

  @ApiProperty({ description: 'DESCRIPTIVE only — AVERAGE / TOTAL / PER_HEAD', required: false })
  @IsOptional()
  @IsString()
  capture_per?: string;

  @ApiProperty({ description: 'OVERHEAD only', required: false })
  @IsOptional()
  @IsString()
  overhead_category?: string;

  @ApiProperty({ description: 'OVERHEAD / RESOURCE — gl_account_master.account_code', required: false })
  @IsOptional()
  @IsString()
  gl_account?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  estimated_cost?: number;

  @ApiProperty({ description: 'RESOURCE only', required: false })
  @IsOptional()
  @IsUUID()
  resource_id?: string;

  @ApiProperty({ description: 'TRANSFER only — auto-create the destination batch\'s scheduler_header for its current stage when this line is posted', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  auto_triggers_stage?: boolean;

  @ApiProperty({ required: false, description: 'What the line carries that has no column (a medication line\'s treatment card, a resource line\'s notes).' })
  @IsOptional()
  @IsObject()
  extension_config?: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'The breed_lifecycle_stages row this line was filled in from — sent back by the Create Scheduler form so a line keeps the same origin whichever path created the scheduler.' })
  @IsOptional()
  @IsUUID()
  lifecycle_ref_id?: string;
}

export class UpdateSchedulerLineDto {
  @ApiProperty({ enum: LINE_TYPES, required: false })
  @IsOptional()
  @IsString()
  @IsIn(LINE_TYPES)
  line_type?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  activity_name?: string;

  @ApiProperty({ enum: OCCURRENCES, required: false })
  @IsOptional()
  @IsString()
  @IsIn(OCCURRENCES)
  occurrence?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  start_day?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  end_day?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  day_of_week?: number;

  @ApiProperty({ required: false, type: [Number] })
  @IsOptional()
  @IsArray()
  custom_days?: number[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_mandatory?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  item_description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  standard_qty?: number;

  @ApiProperty({ enum: QTY_BASES, required: false })
  @IsOptional()
  @IsString()
  @IsIn(QTY_BASES)
  qty_basis?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  allow_qty_edit?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  lot_required?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  creates_inventory?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  output_lot_auto?: boolean;

  @ApiProperty({ enum: OUTPUT_BASES, required: false })
  @IsOptional()
  @IsString()
  @IsIn(OUTPUT_BASES)
  output_basis?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  kpi_metric?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  kpi_uom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  std_value?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  lower_alert_limit?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  upper_alert_limit?: number;

  @ApiProperty({ enum: ['INFO', 'WARNING', 'CRITICAL'], required: false })
  @IsOptional()
  @IsString()
  @IsIn(['INFO', 'WARNING', 'CRITICAL'])
  alert_severity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  capture_per?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  overhead_category?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  gl_account?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  estimated_cost?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  resource_id?: string;

  @ApiProperty({ description: 'TRANSFER only', required: false })
  @IsOptional()
  @IsBoolean()
  auto_triggers_stage?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

/**
 * One feed line as the scheduler's own Feed Consumption editor posts it (Rishi, 14 Oct).
 *
 * Deliberately the same shape as a breed lifecycle stage's feed line, so the two screens
 * read alike. `period_from`/`period_to` are stage days, the same unit the lifecycle uses;
 * the quantity is per head per day in `feed_qty_uom` and the service converts it to the kg
 * that scheduler_line.standard_qty holds.
 */
export class SchedulerFeedLineInput {
  @ApiProperty({ description: 'The feed item' })
  @IsUUID()
  feed_item_id: string;

  @ApiProperty({ description: 'First stage day this feed applies to (day 1 = the day the batch entered the stage)' })
  @IsInt()
  @Min(0)
  period_from: number;

  @ApiProperty({ description: 'Last stage day this feed applies to' })
  @IsInt()
  @Min(0)
  period_to: number;

  @ApiProperty({ description: 'Daily feed per head, in feed_qty_uom' })
  @IsNumber()
  @Min(0)
  feed_qty_per_head_per_day_kg: number;

  @ApiProperty({ required: false, description: 'A weight UOM code for the quantity above; blank = KG' })
  @IsOptional()
  @IsString()
  feed_qty_uom?: string;
}

export class UpdateSchedulerFeedLinesDto {
  @ApiProperty({ type: [SchedulerFeedLineInput], description: 'The scheduler\'s whole feed line set. Several feeds may share days; a feed is on a day once, and no day between the first and last line is without feed.' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SchedulerFeedLineInput)
  lines: SchedulerFeedLineInput[];
}
