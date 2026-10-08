import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsInt, Min, IsDateString, IsBoolean, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryInventoryLedgerDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by item UUID', required: false })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty({ description: 'Filter by Entry No.', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  entryNo?: number;

  @ApiProperty({ description: 'Filter by location UUID', required: false })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ description: 'Filter by location UUID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'Filter by transaction type', required: false })
  @IsOptional()
  @IsString()
  transactionType?: string;

  @ApiProperty({ description: 'Filter by document type', required: false })
  @IsOptional()
  @IsString()
  documentType?: string;

  @ApiProperty({ description: 'Filter by document number / batch number', required: false })
  @IsOptional()
  @IsString()
  documentNo?: string;

  @ApiProperty({ description: 'Filter by entry type (POSITIVE or NEGATIVE)', required: false })
  @IsOptional()
  @IsString()
  entryType?: string;

  @ApiProperty({ description: 'Sort by field: created_at or posting_date', required: false })
  @IsOptional()
  @IsIn(['created_at', 'posting_date'])
  sortBy?: 'created_at' | 'posting_date';

  @ApiProperty({ description: 'Posting date from (inclusive)', required: false })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ description: 'Posting date to (inclusive)', required: false })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

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

/** The list filters plus the file format. Paging is ignored: an export is the whole result. */
export class ExportInventoryLedgerDto extends QueryInventoryLedgerDto {
  @ApiProperty({ description: 'File format: xlsx (default) or csv', required: false, enum: ['xlsx', 'csv'] })
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv';
}

export class QueryStockBalanceDto {
  @ApiProperty({ description: 'Filter by company UUID (required)' })
  @IsUUID()
  companyId: string;

  @ApiProperty({ description: 'Filter by location UUID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'Filter by item UUID', required: false })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty({ description: 'Filter by Nature of Business UUID', required: false })
  @IsOptional()
  @IsString()
  nobId?: string;

  @ApiProperty({ description: 'Filter by Line of Business UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ description: 'Only show items at or below their reorder level', required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  belowReorderOnly?: boolean;
}

export class QueryAvailableLotsDto {
  @ApiProperty({ description: 'Filter by item UUID', required: false })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiProperty({ description: 'Filter by location UUID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  company_id?: string;
}

export class QueryAvailableSerialsDto {
  @ApiProperty({ description: 'Filter by item UUID', required: false })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiProperty({ description: 'Filter by location UUID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @IsOptional()
  @IsUUID()
  warehouse_id?: string;

  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  company_id?: string;
}
