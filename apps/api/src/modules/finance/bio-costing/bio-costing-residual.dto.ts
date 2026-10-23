import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { RESIDUAL_RULES } from './bio-costing.rules';

export class CreateResidualSettingDto {
  @ApiProperty({ enum: ['F', 'M'] }) @IsIn(['F', 'M']) gender: string;
  @ApiProperty({ enum: RESIDUAL_RULES }) @IsIn([...RESIDUAL_RULES]) residual_rule: string;
  @ApiPropertyOptional({ description: 'FIXED only: the residual amount per animal' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_fixed_amount?: number;
  @ApiPropertyOptional({ description: 'WEIGHT_X_PRICE only: the expected weight at the end of life, kg' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_weight_kg?: number;
  @ApiPropertyOptional({ description: 'WEIGHT_X_PRICE only: the price per kg' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_price_per_kg?: number;
  @ApiProperty({ description: 'The first day the setting is used; earlier runs keep the figure they used' }) @IsDateString() effective_from: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) note?: string;
}

export class SetAnimalResidualDto {
  @ApiPropertyOptional({ description: 'The animal\'s own residual; null removes it, so the company setting applies again', nullable: true })
  @ValidateIf((o) => o.residual_value !== null && o.residual_value !== undefined) @Type(() => Number) @IsNumber() @Min(0)
  residual_value?: number | null;
  @ApiProperty({ description: 'Why: written to the audit log' }) @IsString() @IsNotEmpty() @MaxLength(300) reason: string;
}
