import { IsString, IsNotEmpty, IsOptional, IsEnum, IsBoolean, IsNumber, IsObject, IsEmail } from 'class-validator';

export enum PreseedSource {
  TENANT = 'TENANT',
  COMPANY = 'COMPANY',
  NONE = 'NONE',
}

export class CreateOperationalAreaDto {
  @IsString()
  @IsNotEmpty()
  company_id!: string;

  @IsString()
  @IsOptional()
  farm_id?: string;

  @IsString()
  @IsNotEmpty()
  nob_id!: string;

  @IsString()
  @IsNotEmpty()
  lob_id!: string;

  @IsString()
  @IsNotEmpty()
  area_code!: string;

  @IsString()
  @IsNotEmpty()
  area_name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PreseedSource)
  @IsOptional()
  preseed_source?: PreseedSource; // accepted for old clients, ignored

  @IsBoolean()
  @IsOptional()
  is_active?: boolean = true;
}

export class UpdateOperationalAreaDto {
  @IsString()
  @IsOptional()
  area_name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  farm_id?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}


/**
 * Area operating settings. Identity fields (name, code, farm, NOB/LOB) are
 * deliberately absent — those belong to the area master and are edited there,
 * not duplicated on the settings screen.
 */
export class UpdateAreaSettingsDto {
  @IsString()
  @IsOptional()
  costing_method?: string;

  @IsString()
  @IsOptional()
  default_feed_uom?: string;

  @IsNumber()
  @IsOptional()
  mortality_threshold_pct?: number;

  @IsNumber()
  @IsOptional()
  temp_threshold_min?: number;

  @IsNumber()
  @IsOptional()
  temp_threshold_max?: number;

  @IsNumber()
  @IsOptional()
  auto_approve_ration_under_qty?: number;

  /**
   * LOB-specific capacity and configuration (sow places and farrowing crates
   * for Piggery, milking points for Dairy, and so on). Free-form on purpose so
   * a new line of business needs no migration.
   */
  @IsObject()
  @IsOptional()
  lob_config?: Record<string, unknown>;
}

export class AssignAreaStaffDto {
  @IsString()
  @IsOptional()
  user_id?: string;

  /** Alternative to user_id — resolve an existing user by their login email. */
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;
}
