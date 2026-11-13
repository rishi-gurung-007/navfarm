import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class AssessBoarConditionDto {
  @IsUUID() boar_animal_id!: string;
  /** A score on the boar's line's scale. */
  @Type(() => Number) @IsInt() @Min(0) @Max(100) score!: number;
  /** Default today; not in the future. */
  @IsOptional() @IsDateString() assessed_on?: string;
  /** A feed level other than the scale's, where the line allows it. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(999) feed_kg_per_day?: number;
  @IsOptional() @IsString() @MaxLength(200) override_reason?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class BoarConditionListQueryDto {
  @IsOptional() @IsUUID() breed_id?: string;
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsIn(['NEVER', 'NOT_SCHEDULED', 'OK', 'DUE_SOON', 'DUE', 'OVERDUE']) status?: string;
}
