import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, Max, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

// ==========================================
// SPECIES DTOs
// ==========================================

export class CreateSpeciesDto {
  @ApiProperty({ description: 'Unique code representing the species', example: 'CHICKEN' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  species_code?: string;

  @ApiProperty({ description: 'Full name of the species', example: 'Chicken' })
  @IsString()
  @IsNotEmpty()
  species_name: string;

  @ApiProperty({ description: 'Company UUID (null means global tenant-wide)', required: false, example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class UpdateSpeciesDto {
  @ApiProperty({ description: 'Species unique code', required: false, example: 'CHICKEN' })
  @IsString()
  @IsOptional()
  species_code?: string;

  @ApiProperty({ description: 'Species full name', required: false, example: 'Chicken' })
  @IsString()
  @IsOptional()
  species_name?: string;

  @ApiProperty({ description: 'Active status', required: false, example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ description: 'Status description', required: false, example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QuerySpeciesDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search term for code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}

// ==========================================
// BREED DTOs
// ==========================================

export class CreateBreedDto {
  @ApiProperty({ description: 'Active first-level farm where this breed profile applies.' })
  @IsUUID()
  @IsNotEmpty()
  location_id: string;
  @ApiProperty({ description: 'Nature of Business UUID scope. Omit to derive it from the company\'s operational areas.', required: false, example: '50000000-5000-5000-5000-000000000001' })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (optional)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Unique code representing the breed. Optional when a number series is configured for breeds — the code is generated then.', required: false, example: 'COBB500' })
  @IsString()
  @IsOptional()
  breed_code?: string;

  @ApiProperty({ description: 'Full descriptive name of the breed', example: 'Cobb 500 Broiler' })
  @IsString()
  @IsNotEmpty()
  breed_name: string;

  @ApiProperty({ description: 'Species UUID link', example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  @IsNotEmpty()
  species_id: string;

  @ApiProperty({ description: 'Legacy text description of species', required: false, example: 'Chicken' })
  @IsString()
  @IsOptional()
  species?: string;

  @ApiProperty({ description: 'Breed type classification', example: 'BROILER', enum: ['BROILER', 'LAYER', 'BREEDER', 'DUAL_PURPOSE', 'DAIRY', 'BEEF', 'MEAT', 'TREE', 'FISH'] })
  @IsString()
  @IsNotEmpty()
  breed_type: string;

  @ApiProperty({ description: 'Average daily growth rate in grams', required: false, example: 52.4 })
  @IsNumber()
  @IsOptional()
  avg_growth_rate_g_day?: number;

  @ApiProperty({ description: 'Benchmark Feed Conversion Ratio (FCR)', required: false, example: 1.6500 })
  @IsNumber()
  @IsOptional()
  avg_fcr?: number;

  @ApiProperty({ description: 'Expected benchmark mortality %', required: false, example: 3.50 })
  @IsNumber()
  @IsOptional()
  avg_mortality_pct?: number;

  @ApiProperty({ description: 'Laying hens benchmark lay rate %', required: false, example: 85.00 })
  @IsNumber()
  @IsOptional()
  avg_lay_rate_pct?: number;

  @ApiProperty({ description: 'Hatching egg incubation days', required: false, example: 21 })
  @IsInt()
  @Min(0)
  @IsOptional()
  incubation_days?: number;

  @ApiProperty({ description: 'Gestation/pregnancy days for mammals', required: false, example: 114 })
  @IsInt()
  @Min(0)
  @IsOptional()
  gestation_days?: number;

  @ApiProperty({ description: 'Average litter size per birth', required: false, example: 10.50 })
  @IsNumber()
  @IsOptional()
  avg_litter_size?: number;

  @ApiProperty({ description: 'Age at productive maturity in months', required: false, example: 6 })
  @IsInt()
  @Min(0)
  @IsOptional()
  mature_age_months?: number;

  @ApiProperty({ description: 'Productive lifespan in months', required: false, example: 18 })
  @IsInt()
  @Min(0)
  @IsOptional()
  productive_life_months?: number;

  @ApiProperty({ description: 'Trees target years to maturity', required: false, example: 5.00 })
  @IsNumber()
  @IsOptional()
  premature_years?: number;

  @ApiProperty({ description: 'Average yield per unit (eggs/day, L milk/day, etc.)', required: false, example: 1.00 })
  @IsNumber()
  @IsOptional()
  avg_yield_per_unit?: number;

  @ApiProperty({ description: 'Nursing/lactation duration in days', required: false, example: 28 })
  @IsInt()
  @Min(0)
  @IsOptional()
  lactation_days?: number;

  @ApiProperty({ description: 'Salvage value as percent of total opening asset value — amortisation denominator input', required: false, example: 10.0 })
  @IsNumber()
  @IsOptional()
  residual_value_pct?: number;

  @ApiProperty({ description: 'Expected number of parities/cycles in productive life', required: false, example: 7 })
  @IsInt()
  @Min(0)
  @IsOptional()
  productive_life_cycles?: number;

  @ApiProperty({ description: 'Average piglets born live per farrowing', required: false, example: 11.5 })
  @IsNumber()
  @IsOptional()
  avg_litter_size_born?: number;

  @ApiProperty({ description: 'Average piglets weaned per litter', required: false, example: 10.0 })
  @IsNumber()
  @IsOptional()
  avg_litter_size_weaned?: number;

  @ApiProperty({ description: 'Standard piglet weight at weaning, KG', required: false, example: 7.0 })
  @IsNumber()
  @IsOptional()
  avg_weaning_weight_kg?: number;

  @ApiProperty({ description: 'Percent of matings/AI resulting in a successful farrowing', required: false, example: 85.0 })
  @IsNumber()
  @IsOptional()
  farrowing_rate_pct?: number;

  @ApiProperty({ description: 'Boar species only: expected semen doses collected per week', required: false, example: 4.0 })
  @IsNumber()
  @IsOptional()
  boar_doses_per_week?: number;

  @ApiProperty({ description: 'Boar species only: productive life in months for amortisation', required: false, example: 24 })
  @IsInt()
  @Min(0)
  @IsOptional()
  boar_productive_life_months?: number;

  @ApiProperty({ description: 'Standard lifetime vaccination schedule (auto-populates scheduler params on batch create)', required: false })
  @IsOptional()
  vaccination_schedule?: any;

  @ApiProperty({ description: 'Stage labels by week range for UI display on the data entry screen header', required: false })
  @IsOptional()
  age_labels?: any;

  @ApiProperty({ description: 'Additional description details', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Blocked breeds stay visible/historical but cannot be used on new animals', default: false, required: false })
  @IsBoolean()
  @IsOptional()
  is_blocked?: boolean;

  @ApiProperty({ description: 'Company UUID scope (null means global)', required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Flexible custom config config extensions in JSON format', required: false })
  @IsOptional()
  extension_config?: any;
}

export class UpdateBreedDto {
  @ApiProperty({ description: 'Location where this breed is kept. Existing codes are not renumbered.', required: false })
  @IsUUID()
  @IsOptional()
  location_id?: string | null;
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ required: false, example: 'COBB500' })
  @IsString()
  @IsOptional()
  breed_code?: string;

  @ApiProperty({ required: false, example: 'Cobb 500 Broiler' })
  @IsString()
  @IsOptional()
  breed_name?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  species_id?: string;

  @ApiProperty({ required: false, example: 'Chicken' })
  @IsString()
  @IsOptional()
  species?: string;

  @ApiProperty({ required: false, example: 'BROILER' })
  @IsString()
  @IsOptional()
  breed_type?: string;

  @ApiProperty({ required: false, example: 52.4 })
  @IsNumber()
  @IsOptional()
  avg_growth_rate_g_day?: number;

  @ApiProperty({ required: false, example: 1.65 })
  @IsNumber()
  @IsOptional()
  avg_fcr?: number;

  @ApiProperty({ required: false, example: 3.5 })
  @IsNumber()
  @IsOptional()
  avg_mortality_pct?: number;

  @ApiProperty({ required: false, example: 85.0 })
  @IsNumber()
  @IsOptional()
  avg_lay_rate_pct?: number;

  @ApiProperty({ required: false, example: 21 })
  @IsInt()
  @Min(0)
  @IsOptional()
  incubation_days?: number;

  @ApiProperty({ required: false, example: 114 })
  @IsInt()
  @Min(0)
  @IsOptional()
  gestation_days?: number;

  @ApiProperty({ required: false, example: 10.5 })
  @IsNumber()
  @IsOptional()
  avg_litter_size?: number;

  @ApiProperty({ required: false, example: 6 })
  @IsInt()
  @Min(0)
  @IsOptional()
  mature_age_months?: number;

  @ApiProperty({ required: false, example: 18 })
  @IsInt()
  @Min(0)
  @IsOptional()
  productive_life_months?: number;

  @ApiProperty({ required: false, example: 5.0 })
  @IsNumber()
  @IsOptional()
  premature_years?: number;

  @ApiProperty({ required: false, example: 1.0 })
  @IsNumber()
  @IsOptional()
  avg_yield_per_unit?: number;

  @ApiProperty({ required: false, example: 28 })
  @IsInt()
  @Min(0)
  @IsOptional()
  lactation_days?: number;

  @ApiProperty({ required: false, example: 10.0 })
  @IsNumber()
  @IsOptional()
  residual_value_pct?: number;

  @ApiProperty({ required: false, example: 7 })
  @IsInt()
  @Min(0)
  @IsOptional()
  productive_life_cycles?: number;

  @ApiProperty({ required: false, example: 11.5 })
  @IsNumber()
  @IsOptional()
  avg_litter_size_born?: number;

  @ApiProperty({ required: false, example: 10.0 })
  @IsNumber()
  @IsOptional()
  avg_litter_size_weaned?: number;

  @ApiProperty({ required: false, example: 7.0 })
  @IsNumber()
  @IsOptional()
  avg_weaning_weight_kg?: number;

  @ApiProperty({ required: false, example: 85.0 })
  @IsNumber()
  @IsOptional()
  farrowing_rate_pct?: number;

  @ApiProperty({ required: false, example: 4.0 })
  @IsNumber()
  @IsOptional()
  boar_doses_per_week?: number;

  @ApiProperty({ required: false, example: 24 })
  @IsInt()
  @Min(0)
  @IsOptional()
  boar_productive_life_months?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  vaccination_schedule?: any;

  @ApiProperty({ required: false })
  @IsOptional()
  age_labels?: any;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_blocked?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ required: false, example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  extension_config?: any;
}

export class QueryBreedDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ description: 'Filter by farm UUID', required: false })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ description: 'Filter by species UUID', required: false })
  @IsOptional()
  @IsString()
  speciesId?: string;

  @ApiProperty({ description: 'Filter by NOB UUID', required: false })
  @IsOptional()
  @IsString()
  nobId?: string;

  @ApiProperty({ description: 'Filter by LOB UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ description: 'Filter by breed type', required: false, example: 'BROILER' })
  @IsOptional()
  @IsString()
  breedType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search breed code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}

// ==========================================
// BREED LIFECYCLE STAGE DTOs
// ==========================================

const CALC_UNITS = ['DAY', 'WEEK', 'MONTH'] as const;
const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
// Same vocabulary as animal_register.animal_type — a lifecycle standard is
// written for a class of animal, and the two masters have to agree on the words.
const LIFECYCLE_CATEGORIES = ['SOW', 'GILT', 'BOAR', 'PIGLET', 'COMMERCIAL_PIG'] as const;
// TDD row 82 caps the teat count at two digits.
const MAX_TEATS = 99;
const SEASON_TYPES = ['ALL', 'SUMMER', 'WINTER'] as const;

export class CreateBreedLifecycleStageDto {
  @ApiProperty({ description: 'Unique code for this record within the tenant/company scope. Optional: no breed lifecycle stage number series is configured yet, so a code is only stored when one is typed. Once a series is configured the code is generated instead.', required: false, example: 'BLS-001' })
  @IsString()
  @IsOptional()
  lifecycle_code?: string;

  @ApiProperty({ description: 'Breed UUID this standard is for' })
  @IsUUID()
  @IsNotEmpty()
  breed_id: string;

  @ApiProperty({ description: 'Stage UUID this standard applies to' })
  @IsUUID()
  @IsNotEmpty()
  stage_id: string;

  @ApiProperty({ description: 'Animal class this standard is written for — matches animal_register.animal_type', enum: LIFECYCLE_CATEGORIES, required: false })
  @IsString()
  @IsIn(LIFECYCLE_CATEGORIES)
  @IsOptional()
  category?: string;

  @ApiProperty({ description: 'Unit for the from/to period range', enum: CALC_UNITS })
  @IsString()
  @IsIn(CALC_UNITS)
  calc_unit: string;

  @ApiProperty({ description: 'Start of this standard range in calc_unit', example: 1 })
  @IsInt()
  period_from: number;

  @ApiProperty({ description: 'End of this standard range in calc_unit', example: 11 })
  @IsInt()
  period_to: number;
  @ApiProperty({ description: 'Standard teat count for this line at this stage. BBP §6 hard-blocks gilt selection below 15.', required: false, example: 15, maximum: MAX_TEATS })
  @IsInt()
  @Min(0)
  @Max(MAX_TEATS)
  @IsOptional()
  std_teats?: number;


  @ApiProperty({ description: 'Season this standard applies to', enum: SEASON_TYPES, required: false, example: 'ALL' })
  @IsString()
  @IsIn(SEASON_TYPES)
  @IsOptional()
  season_type?: string;

  @ApiProperty({ description: 'Standard feed item UUID for this stage/period range', required: false })
  @IsUUID()
  @IsOptional()
  feed_item_id?: string;

  @ApiProperty({ description: 'Standard feed quantity per animal per day, KG', required: false })
  @IsNumber()
  @IsOptional()
  feed_qty_per_head_per_day_kg?: number;

  @ApiProperty({ description: 'Allowance for feed wastage in forecast calculation, %', required: false })
  @IsNumber()
  @IsOptional()
  feed_wastage_pct?: number;

  @ApiProperty({ description: 'Expected average body weight at end of this range, KG', required: false })
  @IsNumber()
  @IsOptional()
  std_body_weight_kg?: number;

  @ApiProperty({ description: 'Standard Average Daily Gain, grams/day', required: false })
  @IsNumber()
  @IsOptional()
  std_adg_gpd?: number;

  @ApiProperty({ description: 'Standard Feed Conversion Ratio', required: false })
  @IsNumber()
  @IsOptional()
  std_fcr?: number;

  @ApiProperty({ description: 'Acceptable mortality percentage for this stage/range', required: false })
  @IsNumber()
  @IsOptional()
  std_mortality_rate_pct?: number;

  @ApiProperty({ description: 'Expected output item UUID at this stage', required: false })
  @IsUUID()
  @IsOptional()
  output_item_id?: string;

  @ApiProperty({ description: 'UOM code for the output quantity', required: false })
  @IsString()
  @IsOptional()
  output_uom?: string;

  @ApiProperty({ description: 'Expected output per animal/sow at end of this range', required: false })
  @IsNumber()
  @IsOptional()
  std_output_qty?: number;

  @ApiProperty({ description: 'Standard medication schedule for this stage', required: false })
  @IsOptional()
  medication_protocol?: any;

  @ApiProperty({ description: 'Standard vaccination schedule for this stage', required: false })
  @IsOptional()
  vaccination_protocol?: any;

  @ApiProperty({ description: 'Labour standard for this stage, used in resource planning', required: false })
  @IsOptional()
  resource_requirements?: any;

  @ApiProperty({
    description: 'KPI thresholds for this stage, each naming its own metric and carrying its own alert: '
      + '[{ metric, lower_limit, upper_limit, severity }]. Supersedes the single unnamed '
      + 'kpi_lower_limit/kpi_upper_limit/alert_severity trio, which could not say which metric it bounded.',
    required: false,
    example: [{ metric: 'ADG_GPD', lower_limit: 450, upper_limit: null, severity: 'WARNING' }],
  })
  @IsOptional()
  kpi_thresholds?: any;

  @ApiProperty({ description: 'Alert if actual KPI falls below this', required: false })
  @IsNumber()
  @IsOptional()
  kpi_lower_limit?: number;

  @ApiProperty({ description: 'Alert if actual KPI exceeds this', required: false })
  @IsNumber()
  @IsOptional()
  kpi_upper_limit?: number;

  @ApiProperty({ description: 'Severity if the KPI limits are breached', enum: ALERT_SEVERITIES, required: false })
  @IsString()
  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  alert_severity?: string;

  @ApiProperty({ description: 'Instructions for farm staff, shown as a tooltip on the data entry screen', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class UpdateBreedLifecycleStageDto {
  @ApiProperty({ description: 'Unique code within the tenant/company scope. Leave blank to keep the stored code unchanged.', required: false })
  @IsString()
  @IsOptional()
  lifecycle_code?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  stage_id?: string;

  @ApiProperty({ required: false, enum: LIFECYCLE_CATEGORIES })
  @IsString()
  @IsOptional()
  @IsIn(LIFECYCLE_CATEGORIES)
  category?: string;

  @ApiProperty({ required: false, enum: CALC_UNITS })
  @IsString()
  @IsOptional()
  @IsIn(CALC_UNITS)
  calc_unit?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  period_from?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  period_to?: number;
  @ApiProperty({ description: 'Standard teat count for this line at this stage. BBP §6 hard-blocks gilt selection below 15.', required: false, example: 15, maximum: MAX_TEATS })
  @IsInt()
  @Min(0)
  @Max(MAX_TEATS)
  @IsOptional()
  std_teats?: number;


  @ApiProperty({ enum: SEASON_TYPES, required: false })
  @IsString()
  @IsIn(SEASON_TYPES)
  @IsOptional()
  season_type?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  feed_item_id?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  feed_qty_per_head_per_day_kg?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  feed_wastage_pct?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  std_body_weight_kg?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  std_adg_gpd?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  std_fcr?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  std_mortality_rate_pct?: number;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  output_item_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  output_uom?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  std_output_qty?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  medication_protocol?: any;

  @ApiProperty({ required: false })
  @IsOptional()
  vaccination_protocol?: any;

  @ApiProperty({ required: false })
  @IsOptional()
  resource_requirements?: any;

  @ApiProperty({
    description: 'KPI thresholds for this stage, each naming its own metric and carrying its own alert: '
      + '[{ metric, lower_limit, upper_limit, severity }]. Supersedes the single unnamed '
      + 'kpi_lower_limit/kpi_upper_limit/alert_severity trio, which could not say which metric it bounded.',
    required: false,
    example: [{ metric: 'ADG_GPD', lower_limit: 450, upper_limit: null, severity: 'WARNING' }],
  })
  @IsOptional()
  kpi_thresholds?: any;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  kpi_lower_limit?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  kpi_upper_limit?: number;

  @ApiProperty({ required: false, enum: ALERT_SEVERITIES })
  @IsString()
  @IsOptional()
  @IsIn(ALERT_SEVERITIES)
  alert_severity?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QueryBreedLifecycleStageDto extends MasterListQueryDto {
  // breed_lifecycle_stages is tenant-wide — it has no company_id column — but
  // the master-data table appends companyId to every list request, and the
  // global pipe runs forbidNonWhitelisted, so an undeclared param 400s the
  // whole page. Accepted and ignored.
  @ApiProperty({ description: 'Active company scope (accepted for UI consistency; these records are tenant-wide)', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Search term for lifecycle code, stage, or breed', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Filter by breed UUID', required: false })
  @IsOptional()
  @IsUUID()
  breedId?: string;

  @ApiProperty({ description: 'Filter by stage UUID', required: false })
  @IsOptional()
  @IsUUID()
  stageId?: string;
}
