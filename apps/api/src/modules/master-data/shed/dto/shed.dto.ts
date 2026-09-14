import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateShedDto {
  @ApiProperty({ description: 'Company UUID scope', example: 'company-uuid-here' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Farm UUID mapping (belongs to this Farm)', example: 'farm-uuid-here' })
  @IsUUID()
  @IsNotEmpty()
  farm_id: string;

  @ApiProperty({ description: 'Unique code representing the shed within the farm', example: 'SHED01' })
  @IsString()
  @IsNotEmpty()
  shed_code: string;

  @ApiProperty({ description: 'Full name of the shed', example: 'Broiler Grow-out Shed 1' })
  @IsString()
  @IsNotEmpty()
  shed_name: string;

  @ApiProperty({ description: 'Shed type classification', example: 'ENVIRONMENTALLY_CONTROLLED', enum: ['OPEN_SIDED', 'ENVIRONMENTALLY_CONTROLLED', 'SEMI_EC'] })
  @IsString()
  @IsNotEmpty()
  shed_type: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = shared across all business verticals)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Maximum holding capacity (birds/animals)', default: 0, required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  capacity?: number;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON format', required: false })
  @IsOptional()
  extension_config?: any;
}

export class UpdateShedDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  farm_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  shed_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  shed_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  shed_type?: string;

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

export class QueryShedDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by farm UUID', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ description: 'Filter by Nature of Business UUID', required: false })
  @IsOptional()
  @IsString()
  nobId?: string;

  @ApiProperty({ description: 'Filter by Line of Business UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ description: 'Filter by shed type', required: false })
  @IsOptional()
  @IsString()
  shedType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search shed code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
