import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateFormulaIngredientDto {
  @ApiProperty({ description: 'Raw material Item UUID', example: 'maize-item-uuid' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Ingredient quantity in the batch', example: 650.0 })
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  unit: string;

  @ApiProperty({ description: 'Percentage of inclusion in total formula', required: false, example: 65.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  inclusion_pct?: number;

  @ApiProperty({ description: 'Process loss percentage', required: false, example: 0.5 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  loss_pct?: number;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class CreateFeedFormulaDto {
  @ApiProperty({ description: 'Company UUID scope ownership', example: 'company-uuid-here' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Unique code representing the formula recipe/BOM. Optional when a number series is configured for feed formulas — the code is generated then.', required: false, example: 'FORM-BR-STARTER' })
  @IsString()
  @IsOptional()
  formula_code?: string;

  @ApiProperty({ description: 'Common name of the formula', example: 'Broiler Starter Feed Formula' })
  @IsString()
  @IsNotEmpty()
  formula_name: string;

  @ApiProperty({ description: 'Produced Item UUID link', example: 'produced-feed-item-uuid' })
  @IsUUID()
  @IsNotEmpty()
  target_item_id: string;

  @ApiProperty({ description: 'Total recipe batch production size', example: 1000.0 })
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  batch_size: number;

  @ApiProperty({ description: 'Batch unit of measure', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  batch_unit: string;

  @ApiProperty({ description: 'Description or notes for the feed recipe', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ type: [CreateFormulaIngredientDto], description: 'List of ingredients in this formula' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFormulaIngredientDto)
  ingredients: CreateFormulaIngredientDto[];

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

export class UpdateFeedFormulaDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  formula_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  formula_name?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  target_item_id?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  batch_size?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  batch_unit?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

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

export class QueryFeedFormulaDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by produced target item UUID', required: false })
  @IsOptional()
  @IsUUID()
  targetItemId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search formula code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
