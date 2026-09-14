import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsBoolean, IsIn, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

const STAGE_CATEGORIES = ['PRE_PRODUCTIVE', 'PRODUCTIVE', 'OUTPUT', 'DISPOSAL'] as const;
const TRANSITION_TRIGGERS = ['AUTO_BY_DAY', 'MANUAL', 'EVENT_BASED', 'KPI_BASED'] as const;
const DATA_ENTRY_FORMS = ['STANDARD', 'FARROWING', 'WEANING', 'SLAUGHTER'] as const;

export class CreateStageDto {
  @ApiProperty({ description: 'Company UUID scope (omit for a tenant-wide stage)', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope. Omit to derive it from the company\'s operational areas.', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope. Omit to derive it from the company\'s operational areas.', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Unique stage code per LOB. Optional when a number series is configured for stages — the code is generated then.', required: false, example: 'QUARANTINE' })
  @IsString()
  @IsOptional()
  stage_code?: string;

  @ApiProperty({ description: 'Display name', example: 'Quarantine' })
  @IsString()
  @IsNotEmpty()
  stage_name: string;

  @ApiProperty({ description: 'Stage category', enum: STAGE_CATEGORIES })
  @IsString()
  @IsIn(STAGE_CATEGORIES)
  stage_category: string;

  @ApiProperty({ description: 'Display order — must be unique per LOB', example: 1 })
  @IsInt()
  @Min(1)
  stage_sequence: number;

  @ApiProperty({ description: 'Standard number of days this stage lasts', required: false })
  @IsInt()
  @IsOptional()
  @Min(0)
  typical_duration_days?: number;

  @ApiProperty({ description: 'Minimum days in this stage before a transition is allowed', required: false, default: 0 })
  @IsInt()
  @IsOptional()
  @Min(0)
  min_days_before_move?: number;

  @ApiProperty({ description: 'What triggers the move to the next stage', enum: TRANSITION_TRIGGERS })
  @IsString()
  @IsIn(TRANSITION_TRIGGERS)
  transition_trigger: string;

  @ApiProperty({ description: 'Day number (from stage start) to auto-move — required when transition_trigger = AUTO_BY_DAY', required: false })
  @IsInt()
  @IsOptional()
  @Min(1)
  auto_move_on_day?: number;

  @ApiProperty({ description: 'Default next stage UUID — NULL for a terminal stage', required: false })
  @IsUUID()
  @IsOptional()
  next_stage_id?: string;

  @ApiProperty({ description: 'Conditional alternate next stage UUID', required: false })
  @IsUUID()
  @IsOptional()
  alt_next_stage_id?: string;

  @ApiProperty({ description: 'Condition that triggers alt_next_stage_id instead of next_stage_id', required: false, example: 'PREGNANCY_FAILED' })
  @IsString()
  @IsOptional()
  alt_trigger_condition?: string;

  @ApiProperty({ description: 'KPI checks validated before allowing a stage transition', required: false })
  @IsOptional()
  required_kpi_to_pass?: any;

  @ApiProperty({ description: 'Data entry form template shown while a batch is in this stage', enum: DATA_ENTRY_FORMS, default: 'STANDARD', required: false })
  @IsString()
  @IsOptional()
  @IsIn(DATA_ENTRY_FORMS)
  data_entry_form?: string;

  @ApiProperty({ description: 'Auto-create the next scheduler when this stage starts', required: false, default: true })
  @IsBoolean()
  @IsOptional()
  scheduler_auto_create?: boolean;

  @ApiProperty({ description: 'Show this stage as a milestone on the individual animal card', required: false, default: true })
  @IsBoolean()
  @IsOptional()
  show_on_animal_card?: boolean;

  @ApiProperty({ description: 'Icon identifier for UI display', required: false })
  @IsString()
  @IsOptional()
  icon_code?: string;

  @ApiProperty({ description: 'Brief description of what happens in this stage', required: false })
  @IsString()
  @IsOptional()
  stage_description?: string;

  @ApiProperty({ description: 'Display sort order', required: false })
  @IsInt()
  @IsOptional()
  sort_order?: number;
}

export class UpdateStageDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  stage_name?: string;

  @ApiProperty({ required: false, enum: STAGE_CATEGORIES })
  @IsString()
  @IsOptional()
  @IsIn(STAGE_CATEGORIES)
  stage_category?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  @Min(1)
  stage_sequence?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  @Min(0)
  typical_duration_days?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  @Min(0)
  min_days_before_move?: number;

  @ApiProperty({ required: false, enum: TRANSITION_TRIGGERS })
  @IsString()
  @IsOptional()
  @IsIn(TRANSITION_TRIGGERS)
  transition_trigger?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  @Min(1)
  auto_move_on_day?: number;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  next_stage_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  alt_next_stage_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  alt_trigger_condition?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  required_kpi_to_pass?: any;

  @ApiProperty({ required: false, enum: DATA_ENTRY_FORMS })
  @IsString()
  @IsOptional()
  @IsIn(DATA_ENTRY_FORMS)
  data_entry_form?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  scheduler_auto_create?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  show_on_animal_card?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  icon_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  stage_description?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  sort_order?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class QueryStageDto extends MasterListQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by Nature of Business UUID', required: false })
  @IsOptional()
  @IsString()
  nobId?: string;

  @ApiProperty({ description: 'Filter by Line of Business UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ required: false, enum: STAGE_CATEGORIES })
  @IsOptional()
  @IsString()
  stageCategory?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
