import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateFarmDto {
  @ApiProperty({ description: 'Company UUID ownership scope', example: 'company-uuid-here' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Unique code for the farm within the company', example: 'FARM01' })
  @IsString()
  @IsNotEmpty()
  farm_code: string;

  @ApiProperty({ description: 'Descriptive name of the farm', example: 'Green Valley Breeding Farm' })
  @IsString()
  @IsNotEmpty()
  farm_name: string;

  @ApiProperty({ description: 'Farm type classification', example: 'BREEDER', enum: ['BREEDER', 'COMMERCIAL_LAYERS', 'COMMERCIAL_BROILERS', 'HATCHERY', 'REARING', 'DAIRY'] })
  @IsString()
  @IsNotEmpty()
  farm_type: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = shared across all business verticals)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Maximum holding capacity', default: 0, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiProperty({ description: 'Street address line 1', required: false })
  @IsString()
  @IsOptional()
  address_line1?: string;

  @ApiProperty({ description: 'City location', required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ description: 'State location', required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ description: 'Country location', required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ description: 'Postal area pincode', required: false })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiProperty({ description: 'Custom dynamic metadata configurations', required: false })
  @IsOptional()
  extension_config?: any;
}

export class UpdateFarmDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  farm_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  farm_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  farm_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  address_line1?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ required: false, example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  extension_config?: any;
}

export class QueryFarmDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
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

  @ApiProperty({ description: 'Filter by farm type', required: false })
  @IsOptional()
  @IsString()
  farmType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search farm code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
