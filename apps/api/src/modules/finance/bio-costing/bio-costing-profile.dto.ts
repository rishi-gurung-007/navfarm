import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { COSTING_METHODS, DAY_BASES, ORIGINS, RESIDUAL_RULES, RUN_FREQUENCIES, TRACKINGS } from './bio-costing.rules';

export class CreateBioCostingProfileDto {
  @ApiPropertyOptional({ description: 'Defaults to the active company' }) @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ example: 'IMP-F' }) @IsString() @Matches(/^[A-Za-z0-9._-]{1,40}$/) profile_code: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(150) name: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() breed_id?: string;
  @ApiPropertyOptional({ enum: ['F', 'M'] }) @IsOptional() @IsIn(['F', 'M']) gender?: string;
  @ApiPropertyOptional({ enum: ORIGINS }) @IsOptional() @IsIn([...ORIGINS]) origin?: string;

  @ApiProperty({ enum: COSTING_METHODS }) @IsIn([...COSTING_METHODS]) costing_method: string;
  @ApiProperty({ description: 'Age in weeks at which costing begins' }) @Type(() => Number) @IsInt() @Min(0) start_age_weeks: number;
  @ApiPropertyOptional({ description: 'Amortisation only' }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) useful_life_months?: number;

  @ApiPropertyOptional({ enum: RESIDUAL_RULES }) @IsOptional() @IsIn([...RESIDUAL_RULES]) residual_rule?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_fixed_amount?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_weight_kg?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_price_per_kg?: number;
  @ApiPropertyOptional({ enum: ['F', 'M'] }) @IsOptional() @IsIn(['F', 'M']) residual_applies_gender?: string;

  @ApiPropertyOptional({ enum: RUN_FREQUENCIES }) @IsOptional() @IsIn([...RUN_FREQUENCIES]) run_frequency?: string;
  @ApiPropertyOptional({ enum: DAY_BASES }) @IsOptional() @IsIn([...DAY_BASES]) day_basis?: string;
  @ApiPropertyOptional({ enum: TRACKINGS }) @IsOptional() @IsIn([...TRACKINGS]) tracking?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() auto_post?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID() acquisition_gl_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accum_amort_gl_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() amort_expense_gl_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fv_gain_loss_gl_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() writeoff_gl_id?: string;

  @ApiProperty({ example: '2026-10-20' }) @IsDateString() effective_from: string;
}

export class UpdateBioCostingProfileDto extends PartialType(CreateBioCostingProfileDto) {}

export class NewBioCostingProfileVersionDto extends PartialType(CreateBioCostingProfileDto) {
  @ApiProperty({ description: 'The date the new terms take effect' }) @IsDateString() effective_from: string;
}

export class CreateBioCostingRateDto {
  @ApiPropertyOptional({ description: 'A farm; empty = every farm' }) @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional({ description: 'The rate applies from this age in weeks' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) age_week_from?: number;
  @ApiProperty() @IsDateString() effective_from: string;
  @ApiProperty({ description: 'Expected (CDM) weight, kg' }) @Type(() => Number) @IsNumber() @Min(0.001) expected_weight_kg: number;
  @ApiProperty({ description: 'Unit price per kg' }) @Type(() => Number) @IsNumber() @Min(0.000001) price_per_kg: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cdm_based?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) costs_to_sell_pct?: number;
}

export class QueryBioCostingProfileDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsIn(['DRAFT', 'ACTIVE', 'INACTIVE', 'SUPERSEDED']) status?: string;
}

export class ResolveBioCostingProfileDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() item_id?: string;
  @IsOptional() @IsUUID() breed_id?: string;
  @IsOptional() @IsIn(['F', 'M']) gender?: string;
  @ApiPropertyOptional({ description: 'The animal\'s entry type, e.g. PURCHASED_IMPORTED' }) @IsOptional() @IsString() entry_type?: string;
  @IsOptional() @IsDateString() on_date?: string;
}

export class AssignBioCostingDto {
  @ApiPropertyOptional({ description: 'Defaults to every active animal of the company that has no profile yet' })
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) animal_ids?: string[];
  @ApiPropertyOptional({ description: 'Report what would be assigned and write nothing' }) @IsOptional() @IsBoolean() dry_run?: boolean;
}
