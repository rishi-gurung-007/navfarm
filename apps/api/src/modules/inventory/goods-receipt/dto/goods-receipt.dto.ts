import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  IsNumber,
  IsPositive,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GoodsReceiptLineInput {
  @ApiProperty({ description: 'Item UUID' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Quantity received', example: 100 })
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure code', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Rate per unit', required: false })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  rate?: number;

  @ApiProperty({ description: 'Lot number (manual entry on receipt)', required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ description: 'Serial number', required: false })
  @IsString()
  @IsOptional()
  serial_no?: string;

  @ApiProperty({ description: 'List of serial numbers for serial-tracked items with quantity > 1', required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  serials?: string[];

  @ApiProperty({ description: 'Expiry date', required: false })
  @IsDateString()
  @IsOptional()
  expiry_date?: string;

  @ApiProperty({ description: 'Line remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateGoodsReceiptDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Receiving warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  warehouse_id: string;

  @ApiProperty({ description: 'Posting date', example: '2026-08-06' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Supplier UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  supplier_id?: string;

  @ApiProperty({ description: 'External reference (e.g. supplier DC/invoice no.)', required: false })
  @IsString()
  @IsOptional()
  external_reference_no?: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Receipt lines', type: [GoodsReceiptLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineInput)
  lines: GoodsReceiptLineInput[];
}

export class UpdateGoodsReceiptDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  posting_date?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  supplier_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  external_reference_no?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Replaces all existing lines when provided', required: false, type: [GoodsReceiptLineInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineInput)
  @IsOptional()
  lines?: GoodsReceiptLineInput[];
}

export class QueryGoodsReceiptDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by status', required: false, enum: ['DRAFT', 'POSTED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: 'Filter by warehouse UUID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'Goods receipts have no is_active flag — findAll already excludes soft-deleted rows unconditionally. Declared so pickers can send the same isActive param every other list endpoint accepts without a 400.', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search receipt no. or external reference', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Results per page', default: 50, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ description: 'Pagination offset', default: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
