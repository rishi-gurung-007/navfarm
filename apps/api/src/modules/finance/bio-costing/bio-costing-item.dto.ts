import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

/** A dated fair-value rate of a biological item: the expected (CDM) weight and the price per kg, optionally from an age and for one farm. */
export class CreateItemFairValueRateDto {
  @ApiPropertyOptional({ description: 'A farm; empty = every farm' }) @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional({ description: 'The rate applies from this age in weeks' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) age_week_from?: number;
  @ApiProperty() @IsDateString() effective_from: string;
  @ApiProperty({ description: 'Expected (CDM) weight, kg' }) @Type(() => Number) @IsNumber() @Min(0.001) expected_weight_kg: number;
  @ApiProperty({ description: 'Unit price per kg' }) @Type(() => Number) @IsNumber() @Min(0.000001) price_per_kg: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cdm_based?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costs_to_sell_pct?: number;
}
