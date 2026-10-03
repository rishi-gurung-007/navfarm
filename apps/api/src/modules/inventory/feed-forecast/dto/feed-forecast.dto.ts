import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';
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

export class QueryFeedForecastRunsDto extends QueryFeedPeriodsDto {}

/**
 * D32, narrowed by D38 to five and by Task 4 (3 Oct ruling) to four: the
 * refill buffer left this screen for the silo's own Silo Reorder Days, and
 * feed_lead_time_days left it for FeedSettingsService's safety stock (Task
 * 2). The per-farm settings, edited on Settings → Inventory Setup →
 * Feed Planning. Same bounds the Location form used before they moved. Every
 * one is optional and every one accepts null, which clears it back to the
 * client default (@IsOptional skips validation for null as well as for a
 * missing key, so a clear is not bounds-checked); a key left out is not
 * touched. feed-forecast.service.ts checks the same bounds again, so the rule
 * holds whether or not a caller came through the validation pipe.
 */
export class UpdateFeedFarmSettingsDto {
  @ApiProperty({ description: 'Bulk feed orders round up to this many kilograms (default 3000). 1 or more, null clears.', required: false, nullable: true })
  @IsOptional() @IsInt() @Min(1)
  feed_bulk_multiple_kg?: number | null;

  @ApiProperty({ description: 'Bagged feed rounds to whole bags of this many kilograms (default 50). 1 or more, null clears.', required: false, nullable: true })
  @IsOptional() @IsInt() @Min(1)
  feed_bag_size_kg?: number | null;

  @ApiProperty({ description: 'Normal bulk truck load in KG — a planning target, not a cap (default 30000). 1 or more, null clears.', required: false, nullable: true })
  @IsOptional() @IsInt() @Min(1)
  feed_truck_target_kg?: number | null;

  @ApiProperty({ description: 'Weekday the mill produces this farm\'s feed, 0 = Sunday to 6 = Saturday (default 0). null clears.', required: false, nullable: true })
  @IsOptional() @IsInt() @Min(0) @Max(6)
  feed_production_weekday?: number | null;
}

/**
 * D41, narrowed by Task 4 (3 Oct ruling): a silo's own feed levels, edited
 * from Settings → Inventory Setup → Feed Planning. Only these two now — the
 * forecast does not read silo_reorder_days (engine.ts, Task 3); the column
 * stays on location_master, and Location Master's own generic form still
 * edits it (spec R6). The same bounds the Location form uses, and
 * feed-forecast.service.ts re-checks the level pair against the silo's
 * capacity with the silo form's own rule.
 */
export class UpdateSiloPlanningDto {
  @ApiProperty({ description: 'Low feed level in KG — the level a low-feed alert fires at.', required: false, nullable: true })
  @IsOptional() @IsNumber() @Min(0)
  low_level_kg?: number | null;

  @ApiProperty({ description: 'High feed level in KG — the over-stock notice level.', required: false, nullable: true })
  @IsOptional() @IsNumber() @Min(0)
  high_level_kg?: number | null;

  @ApiProperty({ description: 'Feed Type — BULK or BAGGED. Drives rounding and truck type (Requisition and Loading Sheet row 15); stored as feed_in_bags.', required: false, enum: ['BULK', 'BAGGED'] })
  @IsOptional() @IsIn(['BULK', 'BAGGED'], { message: 'Feed Type must be BULK or BAGGED.' })
  feedType?: 'BULK' | 'BAGGED';
}
