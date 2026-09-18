import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const ITEM_TYPES = ['FEED', 'MEDICINE', 'VACCINE', 'SEMEN_DOSE', 'SUPPLY', 'OTHER'] as const;
export const VALUATION_METHODS = ['STANDARD', 'FIFO', 'BIO_ASSET', 'AVG'] as const;
export const ITEM_TRACKINGS = ['NONE', 'LOT', 'SERIAL'] as const;
export const INVENTORY_TYPES = ['INVENTORY', 'NON_INVENTORY'] as const;

export class CreateItemTemplateDto {
  @ApiProperty({ description: 'Template Code (unique identifier)', maxLength: 20 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  template_code: string;

  @ApiPropertyOptional({ description: 'Template Description', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  template_description?: string;

  @ApiProperty({ description: 'Linked No. Series ID (mandatory)' })
  @IsNotEmpty({ message: 'No. Series is mandatory on Item Template.' })
  @IsString()
  no_series_id: string;

  @ApiPropertyOptional({ description: 'Item Type', enum: ITEM_TYPES })
  @IsOptional()
  @IsString()
  item_type?: string;

  @ApiPropertyOptional({ description: 'Category', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ description: 'Sub Category', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sub_category?: string;

  @ApiPropertyOptional({ description: 'Valuation Method', enum: VALUATION_METHODS })
  @IsOptional()
  @IsString()
  valuation_method?: string;

  @ApiPropertyOptional({ description: 'Item Tracking', enum: ITEM_TRACKINGS, default: 'NONE' })
  @IsOptional()
  @IsString()
  item_tracking?: string;

  @ApiPropertyOptional({ description: 'Item Tracking No. Series ID (required if item_tracking is LOT or SERIAL)' })
  @IsOptional()
  @IsString()
  item_tracking_no_series_id?: string;

  @ApiPropertyOptional({ description: 'Inventory Type', enum: INVENTORY_TYPES, default: 'INVENTORY' })
  @IsOptional()
  @IsString()
  inventory_type?: string;

  @ApiPropertyOptional({ description: 'QR Code Enabled', default: false })
  @IsOptional()
  @IsBoolean()
  qr_code_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Inventory GL Account', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  inventory_gl_account?: string;

  @ApiPropertyOptional({ description: 'COGS GL Account', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cogs_gl_account?: string;

  @ApiPropertyOptional({ description: 'Is Active', default: true })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ description: 'Company ID' })
  @IsOptional()
  @IsString()
  company_id?: string;
}

export class UpdateItemTemplateDto {
  @ApiPropertyOptional({ description: 'Template Description', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  template_description?: string;

  @ApiPropertyOptional({ description: 'Linked No. Series ID' })
  @IsOptional()
  @IsString()
  no_series_id?: string;

  @ApiPropertyOptional({ description: 'Item Type', enum: ITEM_TYPES })
  @IsOptional()
  @IsString()
  item_type?: string;

  @ApiPropertyOptional({ description: 'Category', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ description: 'Sub Category', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sub_category?: string;

  @ApiPropertyOptional({ description: 'Valuation Method', enum: VALUATION_METHODS })
  @IsOptional()
  @IsString()
  valuation_method?: string;

  @ApiPropertyOptional({ description: 'Item Tracking', enum: ITEM_TRACKINGS })
  @IsOptional()
  @IsString()
  item_tracking?: string;

  @ApiPropertyOptional({ description: 'Item Tracking No. Series ID' })
  @IsOptional()
  @IsString()
  item_tracking_no_series_id?: string;

  @ApiPropertyOptional({ description: 'Inventory Type', enum: INVENTORY_TYPES })
  @IsOptional()
  @IsString()
  inventory_type?: string;

  @ApiPropertyOptional({ description: 'QR Code Enabled' })
  @IsOptional()
  @IsBoolean()
  qr_code_enabled?: boolean;

  @ApiPropertyOptional({ description: 'Inventory GL Account', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  inventory_gl_account?: string;

  @ApiPropertyOptional({ description: 'COGS GL Account', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  cogs_gl_account?: string;

  @ApiPropertyOptional({ description: 'Is Active' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
