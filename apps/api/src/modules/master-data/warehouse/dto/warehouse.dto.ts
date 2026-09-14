import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateWarehouseDto {
  @ApiProperty({ description: 'Company UUID scope', example: 'company-uuid-here' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Optional Farm UUID mapping', required: false, example: 'farm-uuid-here' })
  @IsUUID()
  @IsOptional()
  farm_id?: string;

  @ApiProperty({ description: 'Unique code representing the warehouse within company', example: 'WH01' })
  @IsString()
  @IsNotEmpty()
  warehouse_code: string;

  @ApiProperty({ description: 'Full name of the warehouse', example: 'Raw Material Feed Silo 1' })
  @IsString()
  @IsNotEmpty()
  warehouse_name: string;

  @ApiProperty({ description: 'Warehouse type classification', example: 'SILO', enum: ['COLD_STORAGE', 'SILO', 'GENERAL', 'INGREDIENTS', 'MEDICINE'] })
  @IsString()
  @IsNotEmpty()
  warehouse_type: string;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON', required: false })
  @IsOptional()
  extension_config?: any;
}

export class UpdateWarehouseDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  farm_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  warehouse_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  warehouse_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  warehouse_type?: string;

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

export class QueryWarehouseDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by farm UUID', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ description: 'Filter by warehouse type', required: false })
  @IsOptional()
  @IsString()
  warehouseType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search warehouse code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
