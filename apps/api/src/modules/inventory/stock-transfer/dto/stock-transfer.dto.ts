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

  @ApiProperty({ description: 'Planned shipment date (YYYY-MM-DD)', required: false })
  @IsDateString()
  @IsOptional()
  shipment_date?: string;

  @ApiProperty({ description: 'Planned receipt date (YYYY-MM-DD)', required: false })
  @IsDateString()
  @IsOptional()
  receipt_date?: string;

  @ApiProperty({ description: 'Unit cost estimate', required: false })
  @IsNumber()
  @IsOptional()
  unit_cost?: number;

  @ApiProperty({ description: 'Line total amount', required: false })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({ description: 'Line remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Part E: the requisition line this transfer line fulfils (set by Store release)', required: false })
  @IsUUID()
  @IsOptional()
  requisition_line_id?: string;
}

export class CreateStockTransferDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Source location UUID' })
  @IsUUID()
  @IsNotEmpty()
  from_warehouse_id: string;

  @ApiProperty({ description: 'Destination location UUID' })
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

// ---------------------------------------------------------------------------
// Staged execution (Task 10): partial shipment and receipt events.
// ---------------------------------------------------------------------------

export class ShipmentLineInput {
  @ApiProperty({ description: 'Stock transfer line UUID' })
  @IsUUID()
  @IsNotEmpty()
  line_id: string;

  @ApiProperty({ description: 'Quantity being shipped with this event' })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  quantity: number;
}

export class PostShipmentDto {
  @ApiProperty({ description: 'Event posting date', example: '2026-10-02' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Shipped quantities per transfer line (partial allowed; may not exceed the balance to ship)', type: [ShipmentLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineInput)
  lines: ShipmentLineInput[];

  @ApiProperty({ description: 'Event remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ReceiptLineInput {
  @ApiProperty({ description: 'Stock transfer line UUID' })
  @IsUUID()
  @IsNotEmpty()
  line_id: string;

  @ApiProperty({ description: 'Quantity being received with this event' })
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  quantity: number;
}

export class PostReceiptDto {
  @ApiProperty({ description: 'Shipment this receipt receives against — a receipt cannot precede its shipment' })
  @IsUUID()
  @IsNotEmpty()
  shipment_id: string;

  @ApiProperty({ description: 'Event posting date', example: '2026-10-03' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Received quantities per transfer line (partial allowed; may not exceed what has shipped)', type: [ReceiptLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptLineInput)
  lines: ReceiptLineInput[];

  @ApiProperty({ description: 'Event remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class PostDirectTransferDto {
  @ApiProperty({ description: 'Event posting date', example: '2026-10-02' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Quantities to ship and receive in one transaction (each may not exceed the ordered quantity)', type: [ShipmentLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineInput)
  lines: ShipmentLineInput[];

  @ApiProperty({ description: 'Event remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class QueryStockTransferDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by status', required: false, enum: ['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'POSTED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: 'Filter by transfer direction relative to active farm scope', required: false, enum: ['OUTBOUND', 'INBOUND', 'ALL'] })
  @IsOptional()
  @IsString()
  direction?: 'OUTBOUND' | 'INBOUND' | 'ALL';

  @ApiProperty({ description: 'Filter by source location UUID', required: false })
  @IsOptional()
  @IsUUID()
  fromWarehouseId?: string;

  @ApiProperty({ description: 'Filter by destination location UUID', required: false })
  @IsOptional()
  @IsUUID()
  toWarehouseId?: string;

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

export class ReceiveStockTransferLineInput {
  @ApiProperty({ description: 'Transfer Order Line UUID' })
  @IsUUID()
  @IsNotEmpty()
  line_id: string;

  @ApiProperty({ description: 'Received good quantity', example: 20 })
  @IsNumber()
  @Min(0)
  @IsNotEmpty()
  received_quantity: number;

  @ApiProperty({ description: 'DOA (Dead on Arrival) / damaged transit waste quantity', example: 4, required: false })
  @IsNumber()
  @Min(0)
  @IsOptional()
  doa_quantity?: number;

  @ApiProperty({ description: 'DOA reason code or remarks', required: false })
  @IsString()
  @IsOptional()
  doa_remarks?: string;

  @ApiProperty({ description: 'Line inspection / discrepancy remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Actual receipt date (YYYY-MM-DD)', required: false })
  @IsDateString()
  @IsOptional()
  receipt_date?: string;
}

export class ReceiveStockTransferDto {
  @ApiProperty({ description: 'Receipt posting date', example: '2026-08-06', required: false })
  @IsDateString()
  @IsOptional()
  posting_date?: string;

  @ApiProperty({ description: 'Receipt remarks / condition of goods', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Lines with received quantities', type: [ReceiveStockTransferLineInput], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockTransferLineInput)
  @IsOptional()
  lines?: ReceiveStockTransferLineInput[];
}

export class ShipStockTransferLineInput {
  @ApiProperty({ description: 'Transfer Order Line UUID', required: false })
  @IsUUID()
  @IsOptional()
  line_id?: string;

  @ApiProperty({ description: 'Item UUID', required: false })
  @IsString()
  @IsOptional()
  item_id?: string;

  @ApiProperty({ description: 'Quantity to ship', example: 20 })
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure code', required: false })
  @IsString()
  @IsOptional()
  uom?: string;

  @ApiProperty({ description: 'Lot number', required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ description: 'Serial number', required: false })
  @IsString()
  @IsOptional()
  serial_no?: string;

  @ApiProperty({ description: 'Shipment date (YYYY-MM-DD)', required: false })
  @IsDateString()
  @IsOptional()
  shipment_date?: string;

  @ApiProperty({ description: 'Expected receipt date (YYYY-MM-DD)', required: false })
  @IsDateString()
  @IsOptional()
  receipt_date?: string;

  @ApiProperty({ description: 'Line remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class ShipStockTransferDto {
  @ApiProperty({ description: 'Shipment posting date', example: '2026-08-06', required: false })
  @IsDateString()
  @IsOptional()
  posting_date?: string;

  @ApiProperty({ description: 'Vehicle / truck number', required: false })
  @IsString()
  @IsOptional()
  vehicle_no?: string;

  @ApiProperty({ description: 'Driver name', required: false })
  @IsString()
  @IsOptional()
  driver_name?: string;

  @ApiProperty({ description: 'Waybill reference', required: false })
  @IsString()
  @IsOptional()
  waybill_ref?: string;

  @ApiProperty({ description: 'Shipping remarks or notes', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Lines with quantities to ship', type: [ShipStockTransferLineInput], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipStockTransferLineInput)
  @IsOptional()
  lines?: ShipStockTransferLineInput[];
}

