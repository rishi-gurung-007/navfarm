import { ApiProperty } from '@nestjs/swagger';
import {
  IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsIn, IsArray, ValidateNested, MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CreateSchedulerLineDto, DATA_ENTRY_LEVELS } from './scheduler-header.dto';

export class CreateSystemSchedulerDto {
  @ApiProperty({ description: 'Company UUID' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Stage UUID — the system scheduler applies to batches entering this stage' })
  @IsUUID()
  @IsNotEmpty()
  stage_id: string;

  @ApiProperty({ description: 'Breed UUID — omit for a system scheduler that covers every breed', required: false })
  @IsOptional()
  @IsUUID()
  breed_id?: string;

  @ApiProperty({ example: 'Weaner standard' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  scheduler_name: string;

  @ApiProperty({ enum: DATA_ENTRY_LEVELS, required: false, default: 'SHED' })
  @IsOptional()
  @IsString()
  @IsIn(DATA_ENTRY_LEVELS)
  data_entry_level?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ type: () => [CreateSchedulerLineDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSchedulerLineDto)
  lines?: CreateSchedulerLineDto[];
}

/** Stage and breed are what a system scheduler is matched on, so they are fixed once created. */
export class UpdateSystemSchedulerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  scheduler_name?: string;

  @ApiProperty({ enum: DATA_ENTRY_LEVELS, required: false })
  @IsOptional()
  @IsString()
  @IsIn(DATA_ENTRY_LEVELS)
  data_entry_level?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class QuerySystemSchedulerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  lobId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  breedId?: string;

  @ApiProperty({ required: false, description: 'Search the scheduler name' })
  @IsOptional()
  @IsString()
  search?: string;
}

export class MatchSystemSchedulerDto {
  @ApiProperty({ description: 'Company UUID' })
  @IsUUID()
  companyId: string;

  @ApiProperty({ description: 'Comma-separated stage UUIDs the batch is about to get a scheduler for', required: false })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value ?? '').split(',')).map((s: string) => s.trim()).filter(Boolean))
  @IsArray()
  @IsUUID('all', { each: true })
  stageIds?: string[];

  @ApiProperty({ description: 'Comma-separated stage codes, with lobId — what a stage transfer names its destination by', required: false })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : String(value ?? '').split(',')).map((s: string) => s.trim().toUpperCase()).filter(Boolean))
  @IsArray()
  @IsString({ each: true })
  stageCodes?: string[];

  @ApiProperty({ description: 'LOB UUID — required with stageCodes', required: false })
  @IsOptional()
  @IsUUID()
  lobId?: string;

  @ApiProperty({ required: false, description: "The batch's breed UUID" })
  @IsOptional()
  @IsUUID()
  breedId?: string;
}
