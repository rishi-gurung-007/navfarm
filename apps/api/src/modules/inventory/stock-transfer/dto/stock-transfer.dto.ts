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
} from 'class-validator';
import { Type } from 'class-transformer';

export class StockTransferLineInput {
  @ApiProperty({ description: 'Item UUID' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Quantity to transfer', example: 20 })
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure code', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Lot number being transferred — required when the item is lot-tracked', required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ description: 'Serial number being transferred — required when the item is serial-tracked', required: false })
  @IsString()
  @IsOptional()
  serial_no?: string;

  @ApiProperty({ description: 'Line remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateStockTransferDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Source warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  from_warehouse_id: string;

  @ApiProperty({ description: 'Destination warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  to_warehouse_id: string;

  @ApiProperty({ description: 'Posting date', example: '2026-08-06' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Transfer lines', type: [StockTransferLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineInput)
  lines: StockTransferLineInput[];
}

export class UpdateStockTransferDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  from_warehouse_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  to_warehouse_id?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  posting_date?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Replaces all existing lines when provided', required: false, type: [StockTransferLineInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockTransferLineInput)
  @IsOptional()
  lines?: StockTransferLineInput[];
}

export class QueryStockTransferDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by status', required: false, enum: ['DRAFT', 'POSTED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: 'Search transfer no.', required: false })
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
