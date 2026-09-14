import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateItemCategoryDto {
  @ApiProperty({ description: 'Company UUID scope (null means tenant-wide global template)', required: false, example: 'company-uuid-here' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Unique category code. Optional when a number series is configured for item categories — the code is generated then.', required: false, example: 'FEED' })
  @IsString()
  @IsOptional()
  category_code?: string;

  @ApiProperty({ description: 'Descriptive name of the category', example: 'Animal Feed Products' })
  @IsString()
  @IsNotEmpty()
  category_name: string;

  @ApiProperty({ description: 'Parent Category UUID (for hierarchy mapping)', required: false })
  @IsUUID()
  @IsOptional()
  parent_category_id?: string;

  @ApiProperty({ description: 'Item Type this category belongs to (e.g. CONSUMABLE, RAW_MATERIAL)', required: false })
  @IsString()
  @IsOptional()
  item_type?: string;

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

export class UpdateItemCategoryDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  category_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  category_name?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  parent_category_id?: string;

  @ApiProperty({ description: 'Item Type this category belongs to (e.g. CONSUMABLE, RAW_MATERIAL)', required: false })
  @IsString()
  @IsOptional()
  item_type?: string;

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

export class QueryItemCategoryDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by parent category UUID', required: false })
  @IsOptional()
  @IsUUID()
  parentCategoryId?: string;

  @ApiProperty({ description: 'Filter by item type (e.g. CONSUMABLE, RAW_MATERIAL)', required: false })
  @IsOptional()
  @IsString()
  itemType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({
    description: 'Only top-level categories (no parent). Used by the Item form so the Category picker offers categories, not sub-categories.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  rootOnly?: boolean;

  @ApiProperty({ description: 'Search category code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
