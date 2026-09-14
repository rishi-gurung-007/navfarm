import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsIn, IsInt, Min, MaxLength, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

const RESET_FREQUENCIES = ['YEARLY', 'MONTHLY', 'NEVER'] as const;

export class CreateNumberSeriesDto {
  @ApiProperty({ description: 'Company UUID scope (omit for a tenant-wide series)', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (omit for shared)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (omit for all LOBs under the NOB)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Unique series code, referenced by callers of generateNext()', example: 'BATCH' })
  @IsString()
  @IsNotEmpty()
  series_code: string;

  @ApiProperty({ description: 'Display name', example: 'Batch Number' })
  @IsString()
  @IsNotEmpty()
  series_name: string;

  @ApiProperty({ description: 'What kind of document this series numbers', example: 'BATCH' })
  @IsString()
  @IsNotEmpty()
  document_type: string;

  @ApiProperty({ description: 'Fixed prefix, e.g. "BATCH" or "PIG-ITM"', required: false })
  @IsString()
  @IsOptional()
  prefix?: string;

  @ApiProperty({ description: 'Segment separator', required: false, default: '-' })
  @IsString()
  @IsOptional()
  @MaxLength(1)
  separator?: string;

  @ApiProperty({ description: 'Zero-padded sequence digit count', example: 6 })
  @IsInt()
  @Min(1)
  seq_length: number;

  @ApiProperty({ description: 'When the sequence resets', enum: RESET_FREQUENCIES, default: 'NEVER', required: false })
  @IsString()
  @IsOptional()
  @IsIn(RESET_FREQUENCIES)
  reset_frequency?: string;

  @ApiProperty({ description: 'Allow a user to type their own code instead of generating one', required: false, default: false })
  @IsBoolean()
  @IsOptional()
  allow_manual?: boolean;

  @ApiProperty({
    description: 'Ordered field names of the master this series codes, in order, before the sequence. '
      + 'Each entry is a field of that master, or the token __PREFIX__ for this series\' own prefix. '
      + 'Example for LOCATION: ["parent_location_id", "location_type"].',
    required: false,
    type: [String],
    example: ['item_type', 'category_id', 'sub_category'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  code_segments?: string[];

  @ApiProperty({ description: "Where the prefix sits: START for BRD-LARGEWHITE-001, END for FEED-STARTER-ITM-001.", required: false, enum: ['START', 'END'] })
  @IsString()
  @IsIn(['START', 'END'])
  @IsOptional()
  prefix_position?: string;

  @ApiProperty({ description: "Separator before the number when it differs from the one joining segments — Location is FARM-001/SHED-001/PEN-001. Blank uses the main separator.", required: false, enum: ['-', '/', '|'] })
  @IsString()
  @IsIn(['-', '/', '|'])
  @IsOptional()
  seq_separator?: string;
}

export class UpdateNumberSeriesDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  series_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  document_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  prefix?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(1)
  separator?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  @Min(1)
  seq_length?: number;

  @ApiProperty({ required: false, enum: RESET_FREQUENCIES })
  @IsString()
  @IsOptional()
  @IsIn(RESET_FREQUENCIES)
  reset_frequency?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  allow_manual?: boolean;

  @ApiProperty({
    description: 'Ordered field names of the master this series codes, in order, before the sequence. '
      + 'Each entry is a field of that master, or the token __PREFIX__ for this series\' own prefix. '
      + 'Example for LOCATION: ["parent_location_id", "location_type"].',
    required: false,
    type: [String],
    example: ['item_type', 'category_id', 'sub_category'],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  code_segments?: string[];

  @ApiProperty({ description: "Where the prefix sits: START for BRD-LARGEWHITE-001, END for FEED-STARTER-ITM-001.", required: false, enum: ['START', 'END'] })
  @IsString()
  @IsIn(['START', 'END'])
  @IsOptional()
  prefix_position?: string;

  @ApiProperty({ description: "Separator before the number when it differs from the one joining segments — Location is FARM-001/SHED-001/PEN-001. Blank uses the main separator.", required: false, enum: ['-', '/', '|'] })
  @IsString()
  @IsIn(['-', '/', '|'])
  @IsOptional()
  seq_separator?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class QueryNumberSeriesDto extends MasterListQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  documentType?: string;

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
