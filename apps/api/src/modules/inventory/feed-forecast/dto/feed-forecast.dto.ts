import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
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

  @ApiProperty({ description: 'CUSTOM only: the last day; defaults to from + 7, at most from + 45 and planning date + 45', required: false })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ description: 'PERIOD only: the reporting period; defaults to the one covering the planning date. Refused for any other view.', required: false })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class QueryFeedPeriodsDto {
  @ApiProperty({ description: 'Farm whose company periods are listed', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;
}
