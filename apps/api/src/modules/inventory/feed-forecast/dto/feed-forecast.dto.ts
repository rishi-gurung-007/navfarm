import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { FORECAST_VIEWS } from '../feed-forecast.view';
import type { ForecastView } from '../feed-forecast.view';

// Dates are IsDateString here and checked again as calendar days by the
// service: IsDateString admits a timestamp or a rolled-over day (2026-02-31),
// and a malformed date is answered 400 whichever view is asked for.
export class QueryFeedForecastDto {
  // Optional because a farm-bound user already has exactly one farm (spec
  // D13); tenant and company admins must name the farm they want to see.
  @ApiProperty({ description: 'Farm (top-level Location Master row) to forecast', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ description: 'As-of date (YYYY-MM-DD); defaults to today in the farm time zone (D16), within 45 days of it', required: false })
  @IsOptional()
  @IsDateString()
  planningDate?: string;

  @ApiProperty({ description: 'DAILY (one date), WEEKLY (7 days grouped), PERIOD (a reporting period grouped) or CUSTOM (per date); default CUSTOM', required: false, enum: FORECAST_VIEWS })
  @IsOptional()
  @IsIn(FORECAST_VIEWS as unknown as string[])
  view?: ForecastView;

  @ApiProperty({ description: 'DAILY: the date; WEEKLY: the week start; CUSTOM: the first day. Defaults to the planning date. Ignored for PERIOD, but still validated.', required: false })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ description: 'CUSTOM only: the last day; defaults to from + 6 (7 days inclusive), at most from + 45 and planning date + 45', required: false })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ description: 'PERIOD only: the reporting period; defaults to the one covering the planning date. Refused for any other view.', required: false })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class QuerySiloStatusDto extends QueryFeedForecastDto {
  @ApiProperty({ description: 'Selected Shed. Omit to bootstrap the Farm Shed options without calculating facts.', required: false })
  @IsOptional()
  @IsUUID()
  shedId?: string;

  @ApiProperty({ description: 'Selected Silo linked to the selected Shed. Omit to bootstrap Silo options without calculating facts.', required: false })
  @IsOptional()
  @IsUUID()
  siloId?: string;
}

export class QueryFeedPeriodsDto {
  @ApiProperty({ description: 'Farm whose company periods are listed', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;
}

export class QueryFeedForecastRunsDto extends QueryFeedPeriodsDto {}

// Mill Planning (spec 2026-11-03): one week from weekOf. farmIds and itemIds
// are comma-separated, absent meaning every farm in scope / every feed.
const UUID_LIST = /^[0-9a-f-]{36}(,[0-9a-f-]{36})*$/i;
export class QueryMillPlanDto {
  @ApiProperty({ description: 'First day of the week (YYYY-MM-DD)' })
  @IsDateString()
  weekOf!: string;

  @ApiProperty({ required: false, description: 'Comma-separated farm ids; absent = every farm in scope' })
  @IsOptional()
  @IsString()
  @Matches(UUID_LIST, { message: 'farmIds must be comma-separated ids.' })
  farmIds?: string;

  @ApiProperty({ required: false, description: 'Comma-separated feed item ids; absent = every feed' })
  @IsOptional()
  @IsString()
  @Matches(UUID_LIST, { message: 'itemIds must be comma-separated ids.' })
  itemIds?: string;

  @ApiProperty({ required: false, description: 'MILL location; absent = the first mill of the farms\' companies' })
  @IsOptional()
  @IsUUID()
  millId?: string;
}

/** Compare Report filters: one MILL (default: the first), a production date, and DAY or its ISO WEEK. */
export class QueryMillCompareDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  millId?: string;

  @ApiProperty({ description: 'Production date (YYYY-MM-DD); with period WEEK, any date in the ISO week' })
  @IsDateString()
  date!: string;

  @ApiProperty({ required: false, enum: ['DAY', 'WEEK'] })
  @IsOptional()
  @IsIn(['DAY', 'WEEK'])
  period?: 'DAY' | 'WEEK';
}
