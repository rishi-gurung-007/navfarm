import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsEnum, IsISO8601, IsIn, IsNumber, IsOptional, IsString,
  IsUUID, Matches, Min, ValidateNested,
} from 'class-validator';

export const FEED_STOCK_COUNT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'REJECTED'] as const;
export type FeedStockCountStatus = typeof FEED_STOCK_COUNT_STATUSES[number];
export const FEED_STOCK_COUNT_SOURCES = ['SCHEDULED', 'ON_DEMAND'] as const;
export type FeedStockCountScheduleSource = typeof FEED_STOCK_COUNT_SOURCES[number];

export class CreateFeedStockCountLineDto {
  @ApiProperty()
  @IsUUID()
  siloId!: string;

  @ApiProperty()
  @IsUUID()
  itemId!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  countedQtyKg!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string;
}

export class CreateFeedStockCountDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsUUID()
  farmId!: string;

  @ApiProperty({ description: 'ISO timestamp when the physical quantity was observed' })
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: 'countedAt must include Z or an explicit UTC offset' })
  countedAt!: string;

  @ApiProperty({ enum: FEED_STOCK_COUNT_SOURCES })
  @IsEnum(FEED_STOCK_COUNT_SOURCES)
  scheduleSource!: FeedStockCountScheduleSource;

  @ApiProperty({ type: [CreateFeedStockCountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateFeedStockCountLineDto)
  lines!: CreateFeedStockCountLineDto[];
}

export class UpdateFeedStockCountLineDto {
  @ApiProperty()
  @IsUUID()
  countLineId!: string;

  @ApiProperty({ minimum: 0 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  countedQtyKg!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reasonId?: string;
}

export class UpdateFeedStockCountDto {
  @ApiProperty({ type: [UpdateFeedStockCountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateFeedStockCountLineDto)
  lines!: UpdateFeedStockCountLineDto[];
}

export class QueryFeedStockCountDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsUUID()
  farmId!: string;

  @ApiPropertyOptional({ enum: FEED_STOCK_COUNT_STATUSES })
  @IsOptional()
  @IsString()
  @IsIn(FEED_STOCK_COUNT_STATUSES)
  status?: FeedStockCountStatus;
}

export class QueryFeedStockCountEvidenceDto {
  @ApiProperty()
  @IsUUID()
  companyId!: string;

  @ApiProperty()
  @IsUUID()
  farmId!: string;

  @ApiPropertyOptional({ description: 'ISO observation instant; defaults to now for an on-demand count' })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/i, { message: 'countedAt must include Z or an explicit UTC offset' })
  countedAt?: string;
}
