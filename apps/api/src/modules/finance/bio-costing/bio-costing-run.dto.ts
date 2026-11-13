import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CalculateBioCostingRunDto {
  @ApiProperty({ description: 'The biological item to run (TDD "Main Fixed Asset No."): every animal of the item is costed by the terms on its Bio Asset Costing tab' }) @IsUUID() item_id: string;
  @ApiPropertyOptional({ description: 'Any date inside the period to run; the item\'s frequency decides the period' }) @IsOptional() @IsDateString() period_date?: string;
  @ApiPropertyOptional({ description: 'Or the period itself: 2026-10, 2026-W43, 2026-Q4 or 2026' }) @IsOptional() @IsString() @MaxLength(12) period_key?: string;
  @ApiPropertyOptional({ description: 'Cost only the animals standing in this batch; left out, every animal of the item' }) @IsOptional() @IsUUID() batch_id?: string;
  @ApiPropertyOptional({ description: 'Enforce this number of days for the run (the BBP\'s "No. of Days Enforced")' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) days_enforced?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
}

export class CalculateBatchBioCostingRunDto {
  @ApiPropertyOptional({ description: 'The batch to cost: one run is made for each item its animals belong to. Left out, one whole-herd run per item.' }) @IsOptional() @IsUUID() batch_id?: string;
  @ApiPropertyOptional({ description: 'Cost only this item (TDD row 8: the Main Fixed Asset filter). Left out, every item that has animals.' }) @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional({ description: 'Any date inside the period to run' }) @IsOptional() @IsDateString() period_date?: string;
  @ApiPropertyOptional({ description: 'Or the period itself: 2026-10, 2026-W43, 2026-Q4 or 2026' }) @IsOptional() @IsString() @MaxLength(12) period_key?: string;
  @ApiPropertyOptional({ description: 'Enforce this number of days for every run' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) days_enforced?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) description?: string;
}

export class ReverseBioCostingRunDto {
  @ApiProperty({ description: 'Why the run is being taken back' }) @IsString() @IsNotEmpty() @MaxLength(300) reason: string;
}

export class QueryBioCostingRunDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() item_id?: string;
  @IsOptional() @IsUUID() batch_id?: string;
  @IsOptional() @IsIn(['CALCULATED', 'POSTED', 'REVERSED']) status?: string;
}
