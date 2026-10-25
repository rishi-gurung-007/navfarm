import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

/** The R07 Farrowing Report's filters (Triple-C_reports COMMENTS.xlsx, row 2; Rishi 18 Oct: dates only, no week). */
export class FarrowingReportQueryDto {
  @ApiPropertyOptional({
    description: 'Company UUID — taken from the workspace when it has one',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Farm (top-level location) UUID' })
  @IsUUID()
  @IsNotEmpty()
  farmId: string;

  @ApiProperty({ example: '2026-01-01' })
  @IsDateString()
  @IsNotEmpty()
  dateFrom: string;

  @ApiProperty({ example: '2026-03-31' })
  @IsDateString()
  @IsNotEmpty()
  dateTo: string;

  @ApiPropertyOptional({ description: 'Sow batch UUID' })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiPropertyOptional({
    description: 'Parity at farrowing — the litter number',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parity?: number;

  @ApiPropertyOptional({ description: 'One sow (animal UUID)' })
  @IsOptional()
  @IsUUID()
  sowId?: string;
}

export class FarrowingReportFiltersQueryDto {
  @ApiPropertyOptional({
    description: 'Company UUID — taken from the workspace when it has one',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Farm (top-level location) UUID' })
  @IsUUID()
  @IsNotEmpty()
  farmId: string;
}
