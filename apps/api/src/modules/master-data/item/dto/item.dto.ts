import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, Max, MaxLength, IsNumber, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

// TDD row 21 specifies the withdrawal period as two digits.
const MAX_WITHDRAWAL_DAYS = 99;

export class ItemAttributeValueInput {
  @ApiProperty({ description: 'Attribute UUID definition link' })
  @IsUUID()
  @IsNotEmpty()
  attribute_id: string;

  @ApiProperty({ description: 'Value representing the attribute', example: 'Red' })
  @IsString()
  @IsNotEmpty()
  attribute_value: string;
}

export class CreateItemDto {
  @ApiProperty({ required: false, description: 'Manual code when the number series permits it; otherwise generated.' })
  @IsString()
  @IsOptional()
  item_code?: string;

  @ApiProperty({ description: 'Company UUID scope', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Full descriptive name of the item', example: 'Cobb Broiler Chicks' })
  @IsString()
  @IsNotEmpty()
  item_name: string;

  @ApiProperty({ description: 'Item type classification — code from item_type_master (GET /item-type)', example: 'RAW_MATERIAL' })
  @IsString()
  @IsNotEmpty()
  item_type: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = usable across all NOBs)', required: false, example: 'nob-uuid-here' })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Item Category UUID link', required: false })
  @IsUUID()
  @IsOptional()
  category_id?: string;

  @ApiProperty({ description: 'Legacy text subcategory', required: false })
  @IsString()
  @IsOptional()
  sub_category?: string;

  @ApiProperty({ description: 'Primary Unit of Measure code', example: 'PCS' })
  @IsString()
  @IsNotEmpty()
  uom_primary: string;

  @ApiProperty({ description: 'Secondary Unit of Measure code', required: false })
  @IsString()
  @IsOptional()
  uom_secondary?: string;

  @ApiProperty({ description: 'UOM conversion multiplier from primary to secondary', required: false })
  @IsNumber()
  @IsOptional()
  uom_conversion_factor?: number;

  @ApiProperty({ description: 'Valuation method model — code from costing_method_config (GET /costing-method)', required: false, example: 'FIFO', enum: ['STANDARD', 'FIFO', 'BIO_ASSET', 'AVG'] })
  @IsString()
  @IsOptional()
  valuation_method?: string;

  @ApiProperty({ description: 'GL posting classification — defaults from item_type if omitted', required: false })
  @IsString()
  @IsOptional()
  posting_group?: string;

  @ApiProperty({ description: 'Standard unit cost valuation', required: false })
  @IsNumber()
  @IsOptional()
  standard_cost?: number;

  @ApiProperty({ description: 'Is item tracked by lot numbers', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_lot_tracked?: boolean;

  @ApiProperty({ description: 'Is item tracked by serial numbers', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_serial_tracked?: boolean;

  @ApiProperty({ description: 'no_series_master row the lot/serial numbers for this item are drawn from. The numbers themselves are recorded per transaction, on goods_receipt_line and inventory_ledger.', required: false })
  @IsUUID()
  @IsOptional()
  tracking_series_id?: string;

  @ApiProperty({ description: 'Is item classified as a biological asset', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_biological_asset?: boolean;

  @ApiProperty({ description: 'Costing method model for biological assets', required: false })
  @IsString()
  @IsOptional()
  is_biological_costing_method?: string;

  @ApiProperty({ description: 'Is item trackable in inventory counts', default: true, required: false })
  @IsBoolean()
  @IsOptional()
  is_inventoriable?: boolean;

  @ApiProperty({ description: 'Minimum stock count limit', required: false })
  @IsNumber()
  @IsOptional()
  min_stock_level?: number;

  @ApiProperty({ description: 'Maximum stock count limit', required: false })
  @IsNumber()
  @IsOptional()
  max_stock_level?: number;

  @ApiProperty({ description: 'Reorder alert stock count limit', required: false })
  @IsNumber()
  @IsOptional()
  reorder_level?: number;

  @ApiProperty({ description: 'Procurement lead time in days, for feed/stock forecast planning', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  lead_time_days?: number;

  @ApiProperty({ description: 'Expected shelf life in days', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  shelf_life_days?: number;

  @ApiProperty({ description: 'Minimum storage temperature allowed', required: false })
  @IsNumber()
  @IsOptional()
  storage_temp_min?: number;

  @ApiProperty({ description: 'Maximum storage temperature allowed', required: false })
  @IsNumber()
  @IsOptional()
  storage_temp_max?: number;

  @ApiProperty({ description: 'Days after last administration before an animal treated with this item may be slaughtered. Mandatory for MEDICINE/VACCINE items.', required: false, maximum: MAX_WITHDRAWAL_DAYS })
  @IsInt()
  @Min(0)
  @Max(MAX_WITHDRAWAL_DAYS)
  @IsOptional()
  withdrawal_days?: number;

  @ApiProperty({ description: 'Is QR code tracking enabled', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_qr_enabled?: boolean;

  @ApiProperty({ description: 'Event trigger mapping for QR codes', required: false })
  @IsString()
  @IsOptional()
  qr_trigger_event?: string;

  @ApiProperty({ description: 'Item image URL', required: false })
  @IsString()
  @IsOptional()
  item_image_url?: string;

  @ApiProperty({ description: 'GL account this item posts inventory value to', required: false })
  @IsUUID()
  @IsOptional()
  inventory_gl_account?: string;

  @ApiProperty({ description: 'GL account this item posts cost of goods sold to', required: false })
  @IsUUID()
  @IsOptional()
  cogs_gl_account?: string;

  @ApiProperty({ description: 'Blocked items stay visible/historical but cannot be transacted', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_blocked?: boolean;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON format', required: false })
  @IsOptional()
  extension_config?: any;

  @ApiProperty({ description: 'Item attribute values map', type: [ItemAttributeValueInput], required: false })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemAttributeValueInput)
  attributes?: ItemAttributeValueInput[];
}

export class UpdateItemDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  item_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  item_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  item_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  category_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  sub_category?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  uom_primary?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  uom_secondary?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  uom_conversion_factor?: number;

  @ApiProperty({ required: false, enum: ['STANDARD', 'FIFO', 'BIO_ASSET', 'AVG'] })
  @IsString()
  @IsOptional()
  valuation_method?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  posting_group?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  standard_cost?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_lot_tracked?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_serial_tracked?: boolean;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  tracking_series_id?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_biological_asset?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  is_biological_costing_method?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_inventoriable?: boolean;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  min_stock_level?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  max_stock_level?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  reorder_level?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  lead_time_days?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  shelf_life_days?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  storage_temp_min?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  storage_temp_max?: number;

  @ApiProperty({ required: false, maximum: MAX_WITHDRAWAL_DAYS })
  @IsInt()
  @Min(0)
  @Max(MAX_WITHDRAWAL_DAYS)
  @IsOptional()
  withdrawal_days?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_qr_enabled?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  qr_trigger_event?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  item_image_url?: string;

  @ApiProperty({ description: 'GL account this item posts inventory value to', required: false })
  @IsUUID()
  @IsOptional()
  inventory_gl_account?: string;

  @ApiProperty({ description: 'GL account this item posts cost of goods sold to', required: false })
  @IsUUID()
  @IsOptional()
  cogs_gl_account?: string;

  @ApiProperty({ description: 'Blocked items stay visible/historical but cannot be transacted', required: false })
  @IsBoolean()
  @IsOptional()
  is_blocked?: boolean;

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

  @ApiProperty({ description: 'Item attribute values map', type: [ItemAttributeValueInput], required: false })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ItemAttributeValueInput)
  attributes?: ItemAttributeValueInput[];
}

export class QueryItemDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by category UUID', required: false })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiProperty({ description: 'Filter by item type classification', required: false })
  @IsOptional()
  @IsString()
  itemType?: string;

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

  @ApiProperty({ description: 'Search item code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
