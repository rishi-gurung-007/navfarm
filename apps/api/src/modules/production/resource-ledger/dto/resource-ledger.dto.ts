import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsInt, Min, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

/** Mirrors QueryInventoryLedgerDto — the two ledger screens filter the same way. */
export class QueryResourceLedgerDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by farm (top-level Location) UUID', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ description: 'Filter by resource UUID', required: false })
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @ApiProperty({ description: 'Filter by batch UUID', required: false })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiProperty({ description: 'Filter by transaction type (RESOURCE_USAGE, OVERHEAD, REVERSAL)', required: false })
  @IsOptional()
  @IsString()
  transactionType?: string;

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
