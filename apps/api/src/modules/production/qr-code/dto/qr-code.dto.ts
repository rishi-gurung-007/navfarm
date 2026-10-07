import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateQrCodeDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Source Batch UUID' })
  @IsUUID()
  @IsNotEmpty()
  batch_id: string;

  @ApiProperty({ description: 'Batch Output Line UUID this pack was drawn from', required: false })
  @IsUUID()
  @IsOptional()
  output_line_id?: string;

  @ApiProperty({ description: 'Linked QC inspection UUID (optional — QR generation works with or without QC)', required: false })
  @IsUUID()
  @IsOptional()
  qc_id?: string;

  @ApiProperty({ description: 'Item UUID being packed — must have is_qr_enabled = true' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Lot/serial number', required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ description: 'Production date', example: '2026-08-07' })
  @IsString()
  @IsNotEmpty()
  production_date: string;

  @ApiProperty({ description: 'Net product weight', example: 1.85 })
  @IsNumber()
  @IsNotEmpty()
  net_weight: number;

  @ApiProperty({ description: 'Gross pack weight', required: false })
  @IsNumber()
  @IsOptional()
  gross_weight?: number;

  @ApiProperty({ description: 'Pack unit of measure', example: 'KG' })
  @IsString()
  @IsNotEmpty()
  pack_uom: string;

  @ApiProperty({ description: 'Destination/facility location UUID', required: false })
  @IsUUID()
  @IsOptional()
  warehouse_id?: string;
}

export class QueryQrCodeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  outputLineId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
