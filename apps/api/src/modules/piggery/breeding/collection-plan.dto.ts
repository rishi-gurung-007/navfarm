import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';

export class PlanBoarDto {
  @IsUUID() boar_animal_id!: string;
  /** Who is to collect him, from the Semen Collectors master. */
  @IsOptional() @IsUUID() collector_id?: string;
}

export class CreateCollectionPlanDto {
  /** The breeding line: a breed. Every boar must be of it. */
  @IsUUID() breed_id!: string;
  @IsDateString() collection_date!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PlanBoarDto) boars!: PlanBoarDto[];
  /** Who asked for it (the Multiplier Unit, for Z-Line). */
  @IsOptional() @IsString() @MaxLength(100) requested_by?: string;
  /** The outside reference the line asks for (Breeding Web, for Z-Line). */
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsUUID() destination_farm_id?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class QueryCollectionPlansDto {
  @IsOptional() @IsUUID() breed_id?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(['PLANNED', 'COLLECTED', 'CANCELLED']) status?: string;
}

export class ReasonDto {
  @IsString() @MaxLength(200) reason!: string;
}
