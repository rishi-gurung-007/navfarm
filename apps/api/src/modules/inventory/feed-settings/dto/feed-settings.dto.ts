import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class QueryFeedSettingsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString()
  companyId?: string;

  @ApiProperty({ required: false }) @IsOptional() @IsString()
  farmId?: string;
}

export class UpdateCompanyFeedSettingsDto {
  @ApiProperty({ required: false }) @IsOptional() @IsString()
  companyId?: string;

  @ApiProperty({ required: false, default: 7 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(45)
  defaultForecastDays?: number;

  @ApiProperty({ required: false, default: 45 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(45)
  maxForecastDays?: number;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6)
  productionWeekday?: number | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @IsString()
  productionShift?: string | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6)
  submissionWeekday?: number | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  submissionTime?: string | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6)
  reminderWeekday?: number | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  reminderTime?: string | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(6)
  physicalCountWeekday?: number | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  physicalCountTime?: string | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01)
  truckTargetKg?: number | null;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0.01)
  bulkMultipleKg?: number | null;

  @ApiProperty({ required: false, default: 90 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100)
  capacityWarningPct?: number;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  bagTolerancePct?: number | null;

  @ApiProperty({ required: false, default: 5 }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  financeVariancePct?: number;

  @ApiProperty({ required: false, nullable: true }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0)
  financeVarianceAmount?: number | null;
}
