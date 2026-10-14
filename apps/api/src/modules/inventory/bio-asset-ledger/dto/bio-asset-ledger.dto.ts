import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsInt, Min, IsNumber, IsDateString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

const ENTRY_TYPES = [
  'ACQUISITION', 'CONSUMPTION', 'WRITEOFF', 'OVERHEAD', 'OVERHEAD_COST',
  'GROWTH_ADJMT', 'MORTALITY', 'DEAD_PLANT', 'AMORTIZATION', 'FAIR_VALUE_ADJMT', 'TRANSFORMATION',
] as const;
const COSTING_METHODS = ['COST_ACCUMULATION', 'AMORTIZED_COST', 'FAIR_VALUE'] as const;
const TRACKING_TYPES = ['SERIAL', 'LOT'] as const;

export class CreateBioAssetLedgerDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Biological item UUID (item_master.is_biological_asset = true)' })
  @IsUUID()
  @IsNotEmpty()
  bio_asset_item_id: string;

  @ApiProperty({ description: 'Type of value-change event', enum: ENTRY_TYPES })
  @IsString()
  @IsNotEmpty()
  @IsIn(ENTRY_TYPES)
  entry_type: string;

  @ApiProperty({ description: 'Source document reference', required: false })
  @IsString()
  @IsOptional()
  document_no?: string;

  @ApiProperty({ description: 'Posting date', example: '2026-08-06' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Tracking method for this asset group', required: false, enum: TRACKING_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(TRACKING_TYPES)
  asset_tracking_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lot_no?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  asset_rfid_no?: string;

  @ApiProperty({ description: 'Production batch reference (plain text until Batch Management ships)', required: false })
  @IsString()
  @IsOptional()
  batch_no?: string;

  @ApiProperty({ description: 'Lifecycle stage, e.g. Breeding/WIP/Inuse', required: false })
  @IsString()
  @IsOptional()
  stage?: string;

  @ApiProperty({ description: 'Signed head-count/quantity change', required: false })
  @IsNumber()
  @IsOptional()
  quantity?: number;

  @ApiProperty({ description: 'Cost added or removed at this entry', required: false })
  @IsNumber()
  @IsOptional()
  cost_amount?: number;

  @ApiProperty({ enum: COSTING_METHODS, required: false })
  @IsString()
  @IsOptional()
  @IsIn(COSTING_METHODS)
  costing_method?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QueryBioAssetLedgerDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by biological item UUID', required: false })
  @IsOptional()
  @IsUUID()
  bioAssetItemId?: string;

  @ApiProperty({ description: 'Filter by entry type', required: false, enum: ENTRY_TYPES })
  @IsOptional()
  @IsString()
  entryType?: string;

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

/**
 * The Bio Asset Ledger page (Rishi, 14 Oct): an animal's registration (+1) and its death (-1), filtered the way the
 * Inventory Ledger is.
 */
export class QueryBioAssetLedgerEntriesDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by biological item UUID', required: false })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiProperty({ description: 'Filter by location UUID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'POSITIVE (a registration) or NEGATIVE (a death)', required: false, enum: ['POSITIVE', 'NEGATIVE'] })
  @IsOptional()
  @IsIn(['POSITIVE', 'NEGATIVE'])
  entryType?: 'POSITIVE' | 'NEGATIVE';

  @ApiProperty({ description: 'ANIMAL_REGISTRATION or MORTALITY', required: false, enum: ['ANIMAL_REGISTRATION', 'MORTALITY'] })
  @IsOptional()
  @IsIn(['ANIMAL_REGISTRATION', 'MORTALITY'])
  transactionType?: 'ANIMAL_REGISTRATION' | 'MORTALITY';

  @ApiProperty({ description: 'Search document no., item, animal, batch or source GRN', required: false })
  @IsOptional()
  @IsString()
  documentNo?: string;

  @ApiProperty({ description: 'Posting date from (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiProperty({ description: 'Posting date to (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiProperty({ description: 'created_at (recently posted first) or posting_date', required: false, enum: ['created_at', 'posting_date'] })
  @IsOptional()
  @IsIn(['created_at', 'posting_date'])
  sortBy?: 'created_at' | 'posting_date';

  @ApiProperty({ description: 'Results per page', default: 250, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class ExportBioAssetLedgerDto extends QueryBioAssetLedgerEntriesDto {
  @ApiProperty({ description: 'File format: xlsx (default) or csv', required: false, enum: ['xlsx', 'csv'] })
  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv';
}
