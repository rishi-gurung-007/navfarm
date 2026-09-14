import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsIn, IsInt, Min, IsNumber, IsDateString, IsArray, ArrayNotEmpty, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

/**
 * Animal types across every livestock line of business, not just Piggery.
 *
 * This list was piggery-only (SOW/BOAR/GILT/PIGLET/COMMERCIAL_PIG), which meant
 * a dairy cow could not be registered at all — the Dairy screens worked around
 * that by inventing their herd in component state. Grouped by LOB so adding a
 * line of business is an entry here, and nothing else: `animal_register
 * .animal_type` is a plain varchar, so no migration follows.
 */
export const ANIMAL_TYPES_BY_LOB = {
  PIGGERY: ['SOW', 'BOAR', 'GILT', 'PIGLET', 'COMMERCIAL_PIG'],
  DAIRY: ['COW', 'HEIFER', 'CALF', 'BULL'],
  SMALL_RUMINANT: ['DOE', 'BUCK', 'KID', 'EWE', 'RAM', 'LAMB'],
  POULTRY: ['LAYER', 'BROILER', 'CHICK', 'BREEDER'],
} as const;

const ANIMAL_TYPES = Object.values(ANIMAL_TYPES_BY_LOB).flat();
const GENDERS = ['F', 'M'] as const;
const ENTRY_TYPES = ['PURCHASED_IMPORTED', 'PURCHASED_LOCAL', 'BORN_ON_FARM', 'TRANSFERRED_IN'] as const;
const STATUSES = ['ACTIVE', 'QUARANTINE', 'SICK', 'PREGNANT', 'LACTATING', 'DRY', 'CULLED', 'DEAD', 'SOLD', 'SLAUGHTERED'] as const;
export const DISPOSAL_TYPES = ['SOLD', 'SLAUGHTERED', 'DIED', 'TRANSFERRED'] as const;

export class CreateAnimalDto {
  @ApiProperty({ description: 'Optional manual code; omit to allocate from the configured animal series', required: false })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  animal_code?: string;

  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Nature of Business UUID scope. Omit to derive it from the company\'s operational areas.', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope. Omit to derive it from the company\'s operational areas.', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Animal type', enum: ANIMAL_TYPES })
  @IsString()
  @IsIn(ANIMAL_TYPES)
  animal_type: string;

  @ApiProperty({ description: 'Breed UUID' })
  @IsUUID()
  @IsNotEmpty()
  breed_id: string;

  @ApiProperty({ description: 'Gender', enum: GENDERS })
  @IsString()
  @IsIn(GENDERS)
  gender: string;

  @ApiProperty({ description: 'Date of birth — omit if born on this farm and unknown or if imported/unknown', required: false })
  @IsDateString()
  @IsOptional()
  dob?: string;

  @ApiProperty({
    description:
      "Age in whole weeks when the animal entered the farm. Computed from dob and entry_date whenever dob is given — a value sent alongside a dob is ignored, not merged. Supply it only for an imported animal whose date of birth is unknown.",
    required: false,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  age_at_entry_weeks?: number;

  @ApiProperty({ description: 'How this animal entered the register', enum: ENTRY_TYPES })
  @IsString()
  @IsIn(ENTRY_TYPES)
  entry_type: string;

  @ApiProperty({ description: 'Date animal arrived or was born on this farm' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({ description: 'Goods Receipt UUID this animal arrived on — required if entry_type is PURCHASED_IMPORTED/PURCHASED_LOCAL', required: false })
  @IsUUID()
  @IsOptional()
  source_receipt_id?: string;

  @ApiProperty({ description: 'Batch UUID that produced this animal — required if entry_type is BORN_ON_FARM', required: false })
  @IsUUID()
  @IsOptional()
  source_batch_id?: string;

  @ApiProperty({ description: 'Item UUID (LIVING_ASSET catalogue entry) for this animal type' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'RFID ear tag number for scanning — unique if set', required: false })
  @IsString()
  @IsOptional()
  rfid_tag?: string;

  @ApiProperty({ description: 'Visual ear tag number', required: false })
  @IsString()
  @IsOptional()
  ear_tag?: string;

  @ApiProperty({ description: 'URL to a photo of the ear tag — file upload will move to Cloudflare R2 later', required: false })
  @IsString()
  @IsOptional()
  ear_tag_image_url?: string;

  @ApiProperty({ description: 'Father boar UUID — self-referential', required: false })
  @IsUUID()
  @IsOptional()
  sire_animal_id?: string;

  @ApiProperty({ description: 'Mother sow UUID — self-referential', required: false })
  @IsUUID()
  @IsOptional()
  dam_animal_id?: string;

  @ApiProperty({
    description:
      "Purchase price per animal. Omit for a purchased entry — the API reads it off the source goods receipt line and discards anything sent. Required for every other entry type, which has no document to read it from; the service enforces that rather than this DTO, because the form legitimately omits the field for purchases.",
    required: false,
  })
  @IsNumber()
  @IsOptional()
  acquisition_cost?: number;

  @ApiProperty({ description: 'Transport/import duty/quarantine charges per head for imported animals', required: false })
  @IsNumber()
  @IsOptional()
  landing_cost?: number;

  @ApiProperty({ description: 'Current production stage UUID', required: false })
  @IsUUID()
  @IsOptional()
  current_stage_id?: string;

  @ApiProperty({ description: 'Batch UUID this animal is currently in', required: false })
  @IsUUID()
  @IsOptional()
  current_batch_id?: string;

  @ApiProperty({ description: 'Current shed/pen location UUID', required: false })
  @IsUUID()
  @IsOptional()
  current_location_id?: string;

  @ApiProperty({ description: 'Date animal entered productive stage — first farrowing or PRODUCTIVE_SOW status', required: false })
  @IsDateString()
  @IsOptional()
  productive_life_start?: string;

  @ApiProperty({ description: 'Status', enum: STATUSES, required: false, default: 'ACTIVE' })
  @IsString()
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiProperty({ description: 'Teat count — BBP: below 15 is a hard block on gilt selection regardless of TSI score', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  no_of_teats?: number;

  @ApiProperty({ description: 'Total Sow Index score', required: false })
  @IsNumber()
  @IsOptional()
  tsi?: number;

  @ApiProperty({ description: 'Conformation/quality grading', required: false })
  @IsString()
  @IsOptional()
  grading?: string;

  @ApiProperty({ description: 'Serial number (asset tag), distinct from RFID/ear tag', required: false })
  @IsString()
  @IsOptional()
  serial_number?: string;

  @ApiProperty({ description: 'Notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateAnimalDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  breed_id?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  dob?: string;

  @ApiProperty({
    description:
      'Age in whole weeks at entry. Only honoured while the animal has no date of birth; once a dob is on the record the dob governs and this is recomputed from it.',
    required: false,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  age_at_entry_weeks?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  rfid_tag?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ear_tag?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  ear_tag_image_url?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  sire_animal_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  dam_animal_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  current_stage_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  current_batch_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  current_location_id?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  parity_count?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  total_piglets_born_live?: number;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  total_piglets_weaned?: number;

  @ApiProperty({ description: 'Not ledger-derived yet — settable directly until per-animal bio-asset ledger integration exists', required: false })
  @IsNumber()
  @IsOptional()
  current_bio_asset_value?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  total_amortised?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  book_value?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  residual_value?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  amortisation_monthly?: number;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  productive_life_start?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  expected_cull_date?: string;

  @ApiProperty({ required: false, enum: STATUSES })
  @IsString()
  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @ApiProperty({ description: 'Teat count — BBP: below 15 is a hard block on gilt selection regardless of TSI score', required: false })
  @IsInt()
  @Min(0)
  @IsOptional()
  no_of_teats?: number;

  @ApiProperty({ description: 'Total Sow Index score', required: false })
  @IsNumber()
  @IsOptional()
  tsi?: number;

  @ApiProperty({ description: 'Conformation/quality grading', required: false })
  @IsString()
  @IsOptional()
  grading?: string;

  @ApiProperty({ description: 'Serial number (asset tag), distinct from RFID/ear tag', required: false })
  @IsString()
  @IsOptional()
  serial_number?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class DisposeAnimalDto {
  @ApiProperty({ description: 'How this animal left the register', enum: DISPOSAL_TYPES })
  @IsString()
  @IsIn(DISPOSAL_TYPES)
  disposal_type: string;

  @ApiProperty({ description: 'Date of sale/slaughter/death' })
  @IsDateString()
  @IsNotEmpty()
  disposal_date: string;

  @ApiProperty({ description: 'Sale/salvage value realised, if any', required: false })
  @IsNumber()
  @IsOptional()
  disposal_value?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class QueryAnimalDto extends MasterListQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  breedId?: string;

  @ApiProperty({ required: false, enum: ANIMAL_TYPES })
  @IsOptional()
  @IsString()
  animalType?: string;

  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  currentBatchId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  currentLocationId?: string;

  @ApiProperty({ description: 'Search animal_code, rfid_tag, or ear_tag', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Include disposed (is_active=false) animals', required: false, default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeDisposed?: boolean;

  @ApiProperty({ description: 'Filter by active status (findAll already excludes disposed animals unless includeDisposed is set; declared so pickers can send the same isActive param every other list endpoint accepts without a 400)', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}

export class TransitionAnimalStageDto {
  @ApiProperty({ description: 'Destination Stage UUID' })
  @IsUUID()
  @IsNotEmpty()
  to_stage_id: string;

  @ApiProperty({ description: 'Destination Location / Pen UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  to_location_id?: string;

  @ApiProperty({ description: 'Destination Batch UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  to_batch_id?: string;

  @ApiProperty({ description: 'Date of stage movement', example: '2026-08-19' })
  @IsDateString()
  @IsNotEmpty()
  transition_date: string;

  @ApiProperty({ description: 'Reason for transition / Trigger condition (e.g. PREGNANCY_CONFIRMED, WEANED, MANUAL)', required: false })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiProperty({ description: 'Additional notes', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

export class BulkTransitionAnimalStageDto extends TransitionAnimalStageDto {
  @ApiProperty({ description: 'Animals to move together — typically the tail-enders that a batch-level stage move deliberately left behind', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  animal_ids: string[];
}
