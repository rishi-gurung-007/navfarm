import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class RequestFaConversionDto {
  @ApiProperty() @IsUUID() animal_id: string;
  @ApiPropertyOptional({ description: 'Her weight when she leaves production, kg' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) exit_weight_kg?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) remarks?: string;
}

export class ApproveFaConversionDto {
  @ApiProperty({ description: 'The market value Finance puts on the animal, her cost when she is received into inventory' }) @Type(() => Number) @IsNumber() @Min(0) market_value: number;
}

export class RejectFaConversionDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(300) reason: string;
}

export class PostFaConversionDto {
  @ApiProperty({ description: 'The conversion date: on or after the out-of-production date, not in the future' }) @IsDateString() conversion_date: string;
}

export class QueryFaConversionDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() animal_id?: string;
}
