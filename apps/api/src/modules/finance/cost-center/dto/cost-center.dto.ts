import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateCostCenterDto {
  @ApiProperty({ description: 'Company UUID scope ownership', example: 'company-uuid-here' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Unique dimension code. Optional when a number series is configured for cost centers — the code is generated then.', required: false, example: 'DEPT-ADMIN' })
  @IsString()
  @IsOptional()
  cost_center_code?: string;

  @ApiProperty({ description: 'Common name of the cost center', example: 'Administrative Department' })
  @IsString()
  @IsNotEmpty()
  cost_center_name: string;

  @ApiProperty({ description: 'Cost Center Dimension Type', example: 'DEPARTMENT', enum: ['DEPARTMENT', 'FARM', 'WAREHOUSE', 'PROJECT', 'OTHER'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['DEPARTMENT', 'FARM', 'WAREHOUSE', 'PROJECT', 'OTHER'])
  cost_center_type: string;

  @ApiProperty({ description: 'Parent Cost Center UUID for hierarchical dimensions breakdown structure', required: false })
  @IsUUID()
  @IsOptional()
  parent_cost_center_id?: string;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON format', required: false })
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

export class UpdateCostCenterDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  cost_center_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  cost_center_name?: string;

  @ApiProperty({ required: false, enum: ['DEPARTMENT', 'FARM', 'WAREHOUSE', 'PROJECT', 'OTHER'] })
  @IsString()
  @IsOptional()
  @IsIn(['DEPARTMENT', 'FARM', 'WAREHOUSE', 'PROJECT', 'OTHER'])
  cost_center_type?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  parent_cost_center_id?: string;

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

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QueryCostCenterDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by cost center type', required: false, enum: ['DEPARTMENT', 'FARM', 'WAREHOUSE', 'PROJECT', 'OTHER'] })
  @IsOptional()
  @IsString()
  costCenterType?: string;

  @ApiProperty({ description: 'Filter by parent cost center UUID', required: false })
  @IsOptional()
  @IsUUID()
  parentCostCenterId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search cost center code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
