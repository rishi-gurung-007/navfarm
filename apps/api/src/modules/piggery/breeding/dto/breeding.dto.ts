import { IsString, IsOptional, IsEnum, IsNumber, IsInt, IsDateString, IsBoolean, Min, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export enum MatingType {
  AI = 'AI',
  NATURAL_MATING = 'NATURAL_MATING',
}

export enum PregCheckMethod {
  ULTRASOUND = 'ULTRASOUND',
  RECTAL = 'RECTAL',
  VISUAL = 'VISUAL',
  NOT_CHECKED = 'NOT_CHECKED',
}

export enum ConceptionResult {
  CONFIRMED = 'CONFIRMED',
  REPEAT = 'REPEAT',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
}

export enum FarrowingStatus {
  NORMAL = 'NORMAL',
  ASSISTED = 'ASSISTED',
  C_SECTION = 'C_SECTION',
  COMPLICATIONS = 'COMPLICATIONS',
}

export class CreateMatingDto {
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsUUID()
  sow_animal_id: string;

  @IsOptional()
  @IsUUID()
  batch_id?: string;

  @IsEnum(MatingType)
  mating_type: MatingType;

  @IsOptional()
  @IsUUID()
  boar_animal_id?: string;

  @IsOptional()
  @IsString()
  semen_lot_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  semen_dose_qty?: number;

  @IsDateString()
  mating_date: string;

  @IsOptional()
  @IsDateString()
  second_mating_date?: string;

  @IsOptional()
  @IsDateString()
  expected_farrowing_date?: string;

  @IsOptional()
  @IsDateString()
  preg_check_date?: string;

  @IsOptional()
  @IsEnum(PregCheckMethod)
  preg_check_method?: PregCheckMethod;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  parity_number?: number;

  /** The boar's service count at this mating. Defaults to his prior services + 1. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  boar_parity_number?: number;

  /** Usually PENDING at service; may be entered now when the check is already known. */
  @IsOptional()
  @IsEnum(ConceptionResult)
  conception_result?: ConceptionResult;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class MatingDefaultsQueryDto {
  @IsUUID()
  sow_animal_id: string;

  @IsOptional()
  @IsUUID()
  boar_animal_id?: string;

  @IsOptional()
  @IsString()
  semen_lot_id?: string;

  @IsDateString()
  mating_date: string;
}

export class UpdatePregCheckDto {
  @IsOptional()
  @IsDateString()
  preg_check_date?: string;

  @IsOptional()
  @IsEnum(PregCheckMethod)
  preg_check_method?: PregCheckMethod;

  /**
   * Kept for older clients. conception_result is the field of record; when both
   * are sent they must agree (CONFIRMED ⇔ true), and one of the two is required.
   */
  @IsOptional()
  @IsBoolean()
  pregnancy_confirmed?: boolean;

  @IsOptional()
  @IsEnum(ConceptionResult)
  conception_result?: ConceptionResult;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateFarrowingDto {
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsUUID()
  sow_animal_id: string;

  @IsOptional()
  @IsUUID()
  breeding_id?: string;

  @IsOptional()
  @IsUUID()
  batch_id?: string;

  @IsDateString()
  farrowing_date: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  piglets_born_live: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  piglets_stillborn?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  piglets_mummified?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  avg_birth_weight_kg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  total_litter_weight_kg?: number;

  @IsOptional()
  @IsEnum(FarrowingStatus)
  farrowing_status?: FarrowingStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  foster_received?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  fostered_out?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateWeaningDto {
  @IsDateString()
  weaning_date: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  piglets_weaned: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  avg_weaning_weight_kg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cost_per_piglet?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSemenCollectionDto {
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsUUID()
  boar_animal_id: string;

  @IsOptional()
  @IsUUID()
  boar_batch_id?: string;

  @IsDateString()
  collection_date: string;

  @IsOptional()
  @IsDateString()
  period_from?: string;

  @IsOptional()
  @IsDateString()
  period_to?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amortisation_period?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  feed_cost_period?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  drug_cost_period?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overhead_cost_period?: number;

  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  doses_collected: number;

  @IsOptional()
  @IsUUID()
  output_item_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  doses_used_internal?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  doses_sold?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
