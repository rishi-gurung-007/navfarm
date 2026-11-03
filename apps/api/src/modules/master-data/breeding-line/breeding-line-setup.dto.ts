import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { rawBoolean } from './raw-boolean';
import {
  TIE_BREAKS,
  SELECTION_COLUMN_KEYS,
  COLLECTION_MODES,
  DESTINATION_RULES,
  ENFORCEMENTS,
  RESTRICTIONS,
  WEEKDAYS,
  WEEK_BASES,
} from './breeding-line.rules';

export class SelectionColumnDto {
  @IsIn(SELECTION_COLUMN_KEYS) key!: string;
  @IsString() @MaxLength(50) label!: string;
  // The form's row editor sends a Shown/Hidden dropdown as 'true' / 'false'.
  @Transform(rawBoolean)
  @IsBoolean() visible!: boolean;
}

export class CreateBreedingLineSetupDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() nob_id?: string;
  @IsOptional() @IsString() lob_id?: string;

  /** The line (a breed). Left out, the row is the company default read for a boar whose line has no row of its own. */
  @IsOptional() @IsUUID() breed_id?: string | null;

  @IsOptional() @IsIn(COLLECTION_MODES) collection_mode?: string;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(7) @IsIn(WEEKDAYS, { each: true }) collection_weekdays?: string[] | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) boars_per_collection_day?: number | null;

  @IsOptional() @IsBoolean() pooling_allowed?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) min_boars_per_lot?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_boars_per_lot?: number | null;

  @IsOptional() @IsString() @MaxLength(50) colorant_name?: string | null;
  @IsOptional() @IsUUID() colorant_item_id?: string | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) colorant_qty_per_lot?: number | null;

  @IsOptional() @IsString() @MaxLength(100) label_template?: string | null;
  @IsOptional() @IsIn(WEEK_BASES) week_basis?: string;
  @IsOptional() @IsBoolean() include_year?: boolean;

  @IsOptional() @IsIn(DESTINATION_RULES) destination_rule?: string;
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) destination_farm_ids?: string[] | null;
  @IsOptional() @IsBoolean() reference_required?: boolean;
  @IsOptional() @IsString() @MaxLength(50) reference_label?: string | null;
  @IsOptional() @IsIn(RESTRICTIONS) restrict_to_destination?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) min_rest_days?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) min_motility_pct?: number | null;
  @IsOptional() @IsIn(ENFORCEMENTS) rule_enforcement?: string;

  // The boar selection table: the relative weights of the ranks in the overall grading, how ties rank, and the columns shown.
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) grading_genetic_weight?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) grading_dose_weight?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(1000) grading_morphology_weight?: number | null;
  @IsOptional() @IsIn(TIE_BREAKS) rank_tie_break?: string;

  // Boar body condition (SOP 21): how often a boar is scored, the days of grace and of notice, and whether the scale's feed may be overridden.
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) bcs_frequency_days?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) bcs_grace_days?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) bcs_reminder_days?: number | null;
  @IsOptional() @IsBoolean() bcs_allow_feed_override?: boolean;
  @IsOptional() @IsBoolean() bcs_override_reason_required?: boolean;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SelectionColumnDto) selection_columns?: SelectionColumnDto[] | null;
}

/** A row's line is its identity (like a master's code): it is not edited, a different line is a new row. */
export class UpdateBreedingLineSetupDto extends PartialType(OmitType(CreateBreedingLineSetupDto, ['company_id', 'breed_id'] as const)) {
  @IsOptional() @IsUUID() breed_id?: string | null;

  // Declared again here on purpose. The nested column type is lost through PartialType(OmitType(...)) in the bundled API (it
  // passed in unit tests and failed live: every column property was refused as "not a field this form accepts"), so the
  // decorators must sit on this class itself.
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => SelectionColumnDto) selection_columns?: SelectionColumnDto[] | null;
}

export class QueryBreedingLineSetupDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() breedId?: string;
  @IsOptional() @Transform(rawBoolean) @IsBoolean() isActive?: boolean;
}

export class EffectiveBreedingLineSetupQueryDto {
  /** The boar's breed. Left out, only the company default is read. */
  @IsOptional() @IsUUID() breed_id?: string;
  @IsOptional() @IsUUID() companyId?: string;
}
