import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsInt,
  Min,
  IsNumber,
  NotEquals,
  IsDateString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockAdjustmentLineInput {
  @ApiProperty({ description: 'Item UUID' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Signed quantity — positive for found/excess stock, negative for missing/damaged stock', example: -5 })
  @IsNumber()
  @NotEquals(0, { message: 'quantity cannot be zero — a zero-quantity adjustment line has no effect and silently bypasses FIFO validation' })
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure code', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Rate per unit — required when quantity is positive (no existing layer to draw cost from)', required: false })
  @ValidateIf((line) => line.quantity > 0)
  @IsNumber()
  @IsNotEmpty({ message: 'rate is required when quantity is positive' })
  rate?: number;

  @ApiProperty({ description: 'Lot number — required when item is lot-tracked', required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ description: 'Serial number — required when item is serial-tracked', required: false })
  @IsString()
  @IsOptional()
  serial_no?: string;

  @ApiProperty({ description: 'Line remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateStockAdjustmentDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  warehouse_id: string;

  @ApiProperty({ description: 'Posting date', example: '2026-08-06' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Reason for the adjustment', required: false, example: 'Physical count variance' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Adjustment lines', type: [StockAdjustmentLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineInput)
  lines: StockAdjustmentLineInput[];
}

export class UpdateStockAdjustmentDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  posting_date?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Replaces all existing lines when provided', required: false, type: [StockAdjustmentLineInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockAdjustmentLineInput)
  @IsOptional()
  lines?: StockAdjustmentLineInput[];
}

export class QueryStockAdjustmentDto {
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

  @ApiProperty({ description: 'Search adjustment no.', required: false })
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
