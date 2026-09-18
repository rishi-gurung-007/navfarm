import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min, Max } from 'class-validator';

export class CreateNoSeriesDto {
  @ApiProperty({ description: 'Series Code (unique identifier)', maxLength: 20 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  code: string;

  @ApiPropertyOptional({ description: 'Human readable label', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string;

  @ApiPropertyOptional({ description: 'Master entity type this series codes for (e.g. SUPPLIER, CUSTOMER, ITEM)', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  document_type?: string;

  @ApiPropertyOptional({ description: 'Prefix for generated codes (e.g. FEED-)', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  no_series_code?: string;

  @ApiPropertyOptional({ description: 'Sequence length / number of digits for zero padding (e.g. 3 for -001, 4 for -0001)', default: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  seq_length?: number;

  @ApiPropertyOptional({ description: 'Increment step', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  increment_by?: number;

  @ApiPropertyOptional({ description: 'Is default series for this master type', default: true })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({ description: 'Allow manual override on item card', default: false })
  @IsOptional()
  @IsBoolean()
  manual_nos?: boolean;

  @ApiPropertyOptional({ description: 'Last generated code', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  last_no_used?: string;

  @ApiPropertyOptional({ description: 'Lock series from generating numbers', default: false })
  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  @ApiPropertyOptional({ description: 'Company ID' })
  @IsOptional()
  @IsString()
  company_id?: string;
}

export class UpdateNoSeriesDto {
  @ApiPropertyOptional({ description: 'Human readable label', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  description?: string;

  @ApiPropertyOptional({ description: 'Master entity type this series codes for', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  document_type?: string;

  @ApiPropertyOptional({ description: 'Prefix for generated codes', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  no_series_code?: string;

  @ApiPropertyOptional({ description: 'Sequence length / number of digits' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  seq_length?: number;

  @ApiPropertyOptional({ description: 'Increment step' })
  @IsOptional()
  @IsInt()
  @Min(1)
  increment_by?: number;

  @ApiPropertyOptional({ description: 'Is default series for this master type' })
  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({ description: 'Allow manual override' })
  @IsOptional()
  @IsBoolean()
  manual_nos?: boolean;

  @ApiPropertyOptional({ description: 'Last generated code' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  last_no_used?: string;

  @ApiPropertyOptional({ description: 'Lock series' })
  @IsOptional()
  @IsBoolean()
  blocked?: boolean;
}
