import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsBoolean, IsIn, IsInt, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { QC_PARAM_TYPES } from '../qc-parameter.rules';

// The client's QC Parameter Master fields: QC Code, Description, QC Type, Unit of Measurement, Min / Max / Target Value, Mandatory, Active.

export class CreateQcParameterDto {
  @ApiProperty({ description: 'Company UUID scope (omit for a tenant-wide template)', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'QC Code: unique identification of the QC parameter, unique per company', example: 'QC-MOISTURE-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  param_code: string;

  @ApiProperty({ description: 'Description: what needs to be inspected', example: 'Moisture Percentage' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  param_name: string;

  @ApiProperty({ description: 'QC Type: type of inspection', enum: QC_PARAM_TYPES, example: 'NUMERIC' })
  @IsString()
  @IsNotEmpty()
  @IsIn(QC_PARAM_TYPES)
  param_type: string;

  @ApiProperty({ description: 'Unit of Measurement (NUMERIC)', required: false, example: '%' })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  uom?: string;

  @ApiProperty({ description: 'Min Value: minimum acceptable value (NUMERIC)', required: false, example: 10 })
  @IsNumber()
  @IsOptional()
  min_value?: number;

  @ApiProperty({ description: 'Max Value: maximum acceptable value (NUMERIC)', required: false, example: 14 })
  @IsNumber()
  @IsOptional()
  max_value?: number;

  @ApiProperty({ description: 'Target Value: ideal expected value (NUMERIC), between Min and Max', required: false, example: 12 })
  @IsNumber()
  @IsOptional()
  target_value?: number;

  @ApiProperty({ description: 'Mandatory: whether inspection is compulsory (a failed mandatory parameter fails the QC)', required: false, default: true })
  @IsBoolean()
  @IsOptional()
  is_mandatory?: boolean;

  @ApiProperty({ description: 'Active: whether this parameter is active', required: false, default: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

/** QC Code identifies the parameter and is not changed once created; null clears a value. */
export class UpdateQcParameterDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(100)
  param_name?: string;

  @ApiProperty({ required: false, enum: QC_PARAM_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(QC_PARAM_TYPES)
  param_type?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  uom?: string | null;

  @ApiProperty({ required: false, nullable: true })
  @IsNumber()
  @IsOptional()
  min_value?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsNumber()
  @IsOptional()
  max_value?: number | null;

  @ApiProperty({ required: false, nullable: true })
  @IsNumber()
  @IsOptional()
  target_value?: number | null;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_mandatory?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class QueryQcParameterDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false, description: 'Parameters for this line of business, plus those that apply to every line' })
  @IsOptional()
  @IsString()
  lobId?: string;

  // Text, not boolean: implicit conversion turns the text 'false' into true.
  @ApiProperty({ required: false, enum: ['true', 'false'] })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
