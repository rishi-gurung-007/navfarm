import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, Max, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateUomDto {
  @ApiProperty({ description: 'Short code for the UOM. Optional when a number series is configured for UOMs — the code is generated then.', required: false, example: 'KG' })
  @IsString()
  @IsOptional()
  uom_code?: string;

  @ApiProperty({ description: 'Full descriptive name', example: 'Kilogram' })
  @IsString()
  @IsNotEmpty()
  uom_name: string;

  @ApiProperty({ description: 'UOM Type classification', example: 'WEIGHT', enum: ['WEIGHT', 'VOLUME', 'COUNT', 'AREA', 'TIME', 'OTHER'] })
  @IsString()
  @IsNotEmpty()
  uom_type: string;

  @ApiProperty({ description: 'Allowed decimal places for transaction quantities', example: 3, default: 0 })
  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  decimal_places?: number;

  @ApiProperty({ description: 'Is this the base unit for conversions of this type?', example: false, default: false })
  @IsBoolean()
  @IsOptional()
  is_base_uom?: boolean;

  @ApiProperty({ description: 'Company UUID (null means global tenant-wide UOM)', required: false, example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Flexible custom config extensions in JSON format', required: false, example: '{"symbol":"kg"}' })
  @IsOptional()
  extension_config?: any;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class UpdateUomDto {
  @ApiProperty({ description: 'Short code for the UOM', required: false, example: 'KG' })
  @IsString()
  @IsOptional()
  uom_code?: string;

  @ApiProperty({ description: 'Full descriptive name', required: false, example: 'Kilogram' })
  @IsString()
  @IsOptional()
  uom_name?: string;

  @ApiProperty({ description: 'UOM Type classification', required: false, example: 'WEIGHT' })
  @IsString()
  @IsOptional()
  uom_type?: string;

  @ApiProperty({ description: 'Allowed decimal places', required: false, example: 3 })
  @IsInt()
  @Min(0)
  @Max(10)
  @IsOptional()
  decimal_places?: number;

  @ApiProperty({ description: 'Is this the base unit?', required: false, example: false })
  @IsBoolean()
  @IsOptional()
  is_base_uom?: boolean;

  @ApiProperty({ description: 'Active status indicator', required: false, example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ description: 'Status description', required: false, example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ description: 'Flexible custom config', required: false })
  @IsOptional()
  extension_config?: any;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QueryUomDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ description: 'Filter by UOM type', required: false, example: 'WEIGHT' })
  @IsOptional()
  @IsString()
  uomType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search term for code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateUomConversionDto {
  @ApiProperty({ description: 'Unique code for this record within the tenant/company scope. Optional: no UOM conversion number series is configured yet, so a code is only stored when one is typed. Once a series is configured the code is generated instead.', required: false, example: 'CONV-001' })
  @IsString()
  @IsOptional()
  conversion_code?: string;

  @ApiProperty({ description: 'Item UUID (null means a generic conversion factor)', required: false })
  @IsUUID()
  @IsOptional()
  item_id?: string;

  @ApiProperty({ description: 'From UOM code', example: 'TONNE' })
  @IsString()
  @IsNotEmpty()
  from_uom: string;

  @ApiProperty({ description: 'To UOM code', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  to_uom: string;

  @ApiProperty({ description: 'Multiplier conversion factor: From * Factor = To', example: 1000.00000000 })
  @IsNumber()
  @IsNotEmpty()
  conversion_factor: number;

  @ApiProperty({ description: 'Effective start date', example: '2026-01-01' })
  @IsString()
  @IsNotEmpty()
  effective_from: string;

  @ApiProperty({ description: 'Effective end date', required: false, example: '2027-12-31' })
  @IsString()
  @IsOptional()
  effective_to?: string;

  @ApiProperty({ description: 'Company UUID for the conversion scope', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class UpdateUomConversionDto {
  @ApiProperty({ description: 'Unique code within the tenant/company scope. Leave blank to keep the stored code unchanged.', required: false })
  @IsString()
  @IsOptional()
  conversion_code?: string;

  @ApiProperty({ description: 'Conversion factor multiplier', required: false })
  @IsNumber()
  @IsOptional()
  conversion_factor?: number;

  @ApiProperty({ description: 'Effective start date', required: false })
  @IsString()
  @IsOptional()
  effective_from?: string;

  @ApiProperty({ description: 'Effective end date', required: false })
  @IsString()
  @IsOptional()
  effective_to?: string;

  @ApiProperty({ description: 'Is active status', required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ description: 'Status description', required: false, example: 'ACTIVE' })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}
