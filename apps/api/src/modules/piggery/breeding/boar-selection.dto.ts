import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class BoarSelectionQueryDto {
  /** The breeding line: a breed. */
  @IsUUID() breed_id!: string;
  /** The date the figures are read as of (a boar's TSI then, his last collection on or before it). Default today. */
  @IsOptional() @IsDateString() as_of?: string;
  @IsOptional() @IsUUID() company_id?: string;
}

export class RecordBoarTsiDto {
  @IsUUID() boar_animal_id!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99999999) tsi!: number;
  /** Default today; not in the future. */
  @IsOptional() @IsDateString() effective_date?: string;
  /** The herd-wide genetic rank published with this TSI, when one was given. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) published_rank?: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class BoarTsiRowDto {
  /** The boar's animal code, as on the sheet he came from. */
  @IsString() @MaxLength(255) animal_code!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99999999) tsi!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) published_rank?: number;
}

export class ImportBoarTsiDto {
  @IsOptional() @IsDateString() effective_date?: string;
  @IsOptional() @IsUUID() company_id?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => BoarTsiRowDto) rows!: BoarTsiRowDto[];
}
