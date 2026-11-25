import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { DISPOSAL_REASONS } from '../semen-disposal.rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateSemenDisposalDto {
  @ApiProperty({ description: 'Doses destroyed', example: 5 }) @Type(() => Number) @IsNumber() @Min(0.01) doses: number;
  @ApiProperty({ description: 'YYYY-MM-DD' }) @Matches(DATE, { message: 'disposal_date must be YYYY-MM-DD.' }) disposal_date: string;
  @ApiProperty({ enum: DISPOSAL_REASONS }) @IsIn(DISPOSAL_REASONS) reason_type: string;
  @ApiPropertyOptional({ description: 'The store the doses were destroyed at. Needed only when several stores hold the lot.' })
  @IsOptional() @IsUUID() warehouse_id?: string;
  @ApiPropertyOptional({ description: 'Reason master row, for a finer reason' }) @IsOptional() @IsUUID() reason_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class QuerySemenDisposalDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() semen_batch_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from_date?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to_date?: string;
}
