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

export class GoodsIssueLineInput {
  @ApiProperty({ description: 'Item UUID' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Quantity to issue', example: 20 })
  @IsNumber()
  @IsPositive()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure code', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Lot number being consumed — required when the item is lot-tracked', required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ description: 'Serial number being consumed — required when the item is serial-tracked', required: false })
  @IsString()
  @IsOptional()
  serial_no?: string;

  @ApiProperty({ description: 'Line remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateGoodsIssueDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Issuing warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  warehouse_id: string;

  @ApiProperty({ description: 'Posting date', example: '2026-08-06' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Cost Center UUID this issue is for (optional)', required: false })
  @IsUUID()
  @IsOptional()
  cost_center_id?: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Issue lines', type: [GoodsIssueLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsIssueLineInput)
  lines: GoodsIssueLineInput[];
}

export class UpdateGoodsIssueDto {
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
  cost_center_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Replaces all existing lines when provided', required: false, type: [GoodsIssueLineInput] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsIssueLineInput)
  @IsOptional()
  lines?: GoodsIssueLineInput[];
}

export class QueryGoodsIssueDto {
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

  @ApiProperty({ description: 'Search issue no.', required: false })
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
