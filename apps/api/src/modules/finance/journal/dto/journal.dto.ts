import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  IsNumber,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class JournalLineInput {
  @ApiProperty({ description: 'GL Account UUID' })
  @IsUUID()
  @IsNotEmpty()
  gl_account_id: string;

  @ApiProperty({ description: 'Cost Center UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  cost_center_id?: string;

  @ApiProperty({ description: 'Debit amount (0 if this line is a credit)', default: 0, required: false })
  @IsNumber()
  @IsOptional()
  debit_amount?: number;

  @ApiProperty({ description: 'Credit amount (0 if this line is a debit)', default: 0, required: false })
  @IsNumber()
  @IsOptional()
  credit_amount?: number;

  @ApiProperty({ description: 'Line description', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateJournalDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Posting date', example: '2026-08-06' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Journal description/memo', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Journal lines — must balance (sum debits = sum credits) to post', type: [JournalLineInput] })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => JournalLineInput)
  lines: JournalLineInput[];
}

export class UpdateJournalDto {
  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  posting_date?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Replaces all existing lines when provided', required: false, type: [JournalLineInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineInput)
  @IsOptional()
  lines?: JournalLineInput[];
}

export class QueryJournalDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by status', required: false, enum: ['DRAFT', 'POSTED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: 'Filter by source', required: false, enum: ['MANUAL', 'SYSTEM'] })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiProperty({ description: 'Search journal no.', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
