import { ApiProperty } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsNumber, IsIn, IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const LINE_TYPES = ['CONSUMPTION', 'OUTPUT', 'DESCRIPTIVE', 'OVERHEAD', 'RESOURCE', 'TRANSFER'] as const;
export const OCCURRENCES = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE', 'CUSTOM'] as const;
export const QTY_BASES = ['PER_HEAD', 'TOTAL_BATCH', 'PER_PEN', 'FIXED'] as const;
export const OUTPUT_BASES = ['PER_SOW', 'PER_PEN', 'PER_BATCH'] as const;
export const DATA_ENTRY_LEVELS = ['FARM', 'SHED', 'PEN'] as const;
export const KPI_METRICS = [
  'BODY_WEIGHT', 'FCR', 'ADG', 'BCS_SCORE', 'MORTALITY_COUNT', 'TEMPERATURE',
  'HEAD_COUNT', 'LITTER_SIZE', 'WEANING_WEIGHT', 'PIGLETS_BORN', 'SEMEN_MOTILITY',
  'EGG_COUNT', 'MILK_LITRES', 'CUSTOM',
] as const;
export const CAPTURE_PERS = ['AVERAGE', 'TOTAL', 'PER_HEAD'] as const;

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

  @ApiProperty({ description: '1=Monday..7=Sunday — required when occurrence=WEEKLY', required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
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
