import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class GiltPigletsQueryDto {
  @IsUUID()
  batch_id: string;

  /** The day the selection is for: the litter's age and the cost per pig are worked out to it (today when left out). */
  @IsOptional()
  @IsDateString()
  as_of?: string;
}

export class GiltSelectionLineDto {
  /** The litter the gilts come from (its farrowing record). */
  @IsUUID()
  farrow_id: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  gilts_selected: number;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  colour_code?: string;
}

export class CreateGiltSelectionDto {
  /** The batch the piglets are in now: the litter's own lot, or the batch the weaned piglets were moved to. */
  @IsUUID()
  batch_id: string;

  @IsDateString()
  selection_date: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  production_week?: number;

  @IsOptional()
  @IsUUID()
  location_id?: string;

  @IsOptional()
  @IsUUID()
  sub_location_id?: string;

  /** The fixed-asset (Bio Asset) item the gilts are registered under; the piglet item when left out. */
  @IsOptional()
  @IsUUID()
  gilt_item_id?: string;

  /** An Animal Wise batch the gilts join, when one is named. */
  @IsOptional()
  @IsUUID()
  animal_batch_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GiltSelectionLineDto)
  lines: GiltSelectionLineDto[];
}

/** One row of the "Create Gilts" buffer: what the operator types for each gilt (RFID, teats), the rest has a default. */
export class GiltBufferRowDto {
  @IsUUID()
  line_id: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  rfid_tag: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  no_of_teats: number;

  /** Defaults to the litter's farrowing date. */
  @IsOptional()
  @IsDateString()
  dob?: string;

  /** Defaults to the selection's production week. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  batch_week?: number;
}

export class CreateGiltsDto {
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => GiltBufferRowDto)
  gilts: GiltBufferRowDto[];
}
