import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsIn, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

// TDD row 130 lists LIST as a fifth type, with row 131's List Values behind it.
// Both are out: nothing on the item enforces a fixed set of values — the item's
// Attribute Value is a free text input whatever the attribute's type — so LIST
// defined options that no screen could apply. TEXT replaces the old STRING, the
// same type under the client's own word. Rishi's call, 2026-09-08.
const DATA_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN'] as const;

export class CreateItemAttributeDto {
  @ApiProperty({ description: 'Company UUID scope (null means tenant-wide, usable by all companies)', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (null means applies to all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (null means applies to all LOBs under the NOB)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Unique short code for this attribute', example: 'PROTEIN_PCT' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  attribute_code?: string;

  @ApiProperty({ description: 'Display name shown on the item form', example: 'Protein %' })
  @IsString()
  @IsNotEmpty()
  attribute_name: string;

  @ApiProperty({ description: 'Value type for this attribute', example: 'NUMBER', enum: DATA_TYPES })
  @IsString()
  @IsNotEmpty()
  @IsIn(DATA_TYPES)
  data_type: string;

  @ApiProperty({ description: 'Selectable options, required when data_type=LIST', required: false, example: ['Grade A', 'Grade B'] })
  @IsArray()
  @IsOptional()
  list_values?: string[];

  @ApiProperty({ description: 'Unit label for the value (e.g. PCT, KG)', required: false, example: 'PCT' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiProperty({ description: 'Must every item in scope provide this attribute?', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_mandatory?: boolean;

  @ApiProperty({ description: 'Does this attribute feed into cost calculations?', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  affects_costing?: boolean;

  @ApiProperty({ description: 'Does this attribute distinguish item variants (e.g. colour, size)?', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_variant?: boolean;
}

export class UpdateItemAttributeDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  attribute_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  attribute_name?: string;

  @ApiProperty({ required: false, enum: DATA_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(DATA_TYPES)
  data_type?: string;

  @ApiProperty({ required: false })
  @IsArray()
  @IsOptional()
  list_values?: string[];

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_mandatory?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  affects_costing?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_variant?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ required: false, example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'] })
  @IsString()
  @IsOptional()
  status?: string;
}

export class QueryItemAttributeDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by NOB UUID', required: false })
  @IsOptional()
  @IsString()
  nobId?: string;

  @ApiProperty({ description: 'Filter by LOB UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search attribute code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
