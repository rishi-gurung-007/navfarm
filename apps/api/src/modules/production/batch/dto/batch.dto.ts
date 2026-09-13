import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const COSTING_METHODS = ['STANDARD', 'FIFO', 'BIO_ASSET'] as const;
const DISPOSAL_TYPES = ['HARVEST', 'SOLD'] as const;
const TRANSACTION_TYPES = ['CONSUMPTION', 'MORTALITY', 'OUTPUT', 'OVERHEAD', 'OBSERVATION'] as const;
const OUTPUT_TYPES = ['MAIN', 'BY_PRODUCT', 'WASTE'] as const;

export class BatchInputLineInput {
  @ApiProperty({ description: 'Item UUID being placed into the batch' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Source batch UUID, when this input is another batch\'s output (traceability)', required: false })
  @IsUUID()
  @IsOptional()
  source_batch_id?: string;

  @ApiProperty({ description: 'Quantity placed', example: 5000 })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure code' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Rate per unit', required: false })
  @IsNumber()
  @IsOptional()
  rate?: number;
}

export class BatchStandardConsumptionLineInput {
  @ApiProperty({ description: 'Item UUID this consumption standard applies to' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Standard expected quantity per opening unit per day', example: 0.12 })
  @IsNumber()
  @IsNotEmpty()
  std_qty_per_unit_per_day: number;

  @ApiProperty({ description: 'Standard rate per UOM (defaults to the item\'s master standard cost if omitted)', required: false })
  @IsNumber()
  @IsOptional()
  std_rate?: number;
}

export class BatchStandardInput {
  @ApiProperty({ description: 'Standard expected output quantity (defaults to opening_quantity adjusted by the breed\'s avg_mortality_pct, if a breed is set)', required: false })
  @IsNumber()
  @IsOptional()
  std_output_quantity?: number;

  @ApiProperty({ description: 'Standard cost per output unit, used for Output Variance', required: false })
  @IsNumber()
  @IsOptional()
  std_output_cost_per_unit?: number;

  @ApiProperty({ description: 'Standard overhead rate per output unit, used for Overhead Variance', required: false })
  @IsNumber()
  @IsOptional()
  std_overhead_rate_per_unit?: number;

  @ApiProperty({ description: 'Per-item consumption standards, used for Price/Usage Variance', type: [BatchStandardConsumptionLineInput], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchStandardConsumptionLineInput)
  @IsOptional()
  consumption_lines?: BatchStandardConsumptionLineInput[];
}

export class CreateBatchDto {
  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Line of Business UUID — determines allowed costing methods' })
  @IsString()
  @IsNotEmpty()
  lob_id: string;

  @ApiProperty({ description: 'Costing method for this batch', enum: COSTING_METHODS })
  @IsString()
  @IsNotEmpty()
  @IsIn(COSTING_METHODS)
  costing_method: string;

  @ApiProperty({ description: 'Breed UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  breed_id?: string;

  @ApiProperty({ description: 'Initial Stage UUID from Stage Master (filtered by LOB)', required: false })
  @IsUUID()
  @IsOptional()
  stage_id?: string;

  @ApiProperty({ description: 'Whether to auto-generate standard scheduler for the initial stage (defaults to true)', required: false })
  @IsBoolean()
  @IsOptional()
  auto_generate_scheduler?: boolean;

  @ApiProperty({ description: 'Shed UUID (optional — set exactly one of shed_id/location_id, or neither)', required: false })
  @IsUUID()
  @IsOptional()
  shed_id?: string;

  @ApiProperty({ description: 'Location UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  location_id?: string;

  @ApiProperty({ description: 'Batch start date', example: '2026-08-07' })
  @IsDateString()
  @IsNotEmpty()
  start_date: string;

  @ApiProperty({ description: 'Expected end date', required: false })
  @IsDateString()
  @IsOptional()
  expected_end_date?: string;

  @ApiProperty({ description: 'Opening quantity', example: 5000 })
  @IsNumber()
  @IsNotEmpty()
  opening_quantity: number;

  @ApiProperty({ description: 'Unit of measure for the opening quantity' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Input lines — what the batch opens with', type: [BatchInputLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchInputLineInput)
  input_lines: BatchInputLineInput[];

  @ApiProperty({ description: 'Standard-cost assumptions for variance calculation — only meaningful when costing_method = STANDARD', type: BatchStandardInput, required: false })
  @ValidateNested()
  @Type(() => BatchStandardInput)
  @IsOptional()
  standard?: BatchStandardInput;
}

export class RenewBatchDto {
  @ApiProperty({ description: 'New cycle start date', example: '2027-06-01' })
  @IsDateString()
  @IsNotEmpty()
  start_date: string;

  @ApiProperty({ description: 'Expected end date for the new cycle', required: false })
  @IsDateString()
  @IsOptional()
  expected_end_date?: string;

  @ApiProperty({ description: 'Opening quantity for the new cycle', example: 100 })
  @IsNumber()
  @IsNotEmpty()
  opening_quantity: number;

  @ApiProperty({ description: 'Unit of measure for the opening quantity' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Input lines for the new cycle — everything else (breed, shed, costing method, standard assumptions) is carried forward from the source batch', type: [BatchInputLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchInputLineInput)
  input_lines: BatchInputLineInput[];
}

export class TransferStageDto {
  @ApiProperty({ description: 'The stage/sub-location code the batch is moving into (LOB-defined, free text — e.g. HATCHER_ROOM)', example: 'HATCHER_ROOM' })
  @IsString()
  @IsNotEmpty()
  to_stage_code: string;

  @ApiProperty({ description: 'Destination location UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  to_location_id?: string;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;
}

const TREATMENT_ROUTES = ['IM', 'IV', 'SUBCUTANEOUS', 'ORAL', 'ORAL_IN_FEED', 'ORAL_IN_WATER', 'TOPICAL', 'INTRAMAMMARY', 'INTRAUTERINE'] as const;

/**
 * The clinical narrative behind a MORTALITY row. Kept as its own object rather
 * than more columns on the transaction: it only applies to one transaction
 * type, and it is written to batch_mortality_detail, not batch_transaction.
 */
export class MortalityDetailDto {
  @ApiProperty({ description: 'Pen / location UUID where the death occurred — defaults to the batch location when omitted', required: false })
  @IsUUID()
  @IsOptional()
  location_id?: string;

  @ApiProperty({ description: 'Cause of death', example: 'Acute mortality', required: false })
  @IsString()
  @IsOptional()
  cause_of_death?: string;

  @ApiProperty({ description: 'Post-mortem / necropsy findings', required: false })
  @IsString()
  @IsOptional()
  post_mortem_notes?: string;

  @ApiProperty({ description: 'How the carcass was disposed of', example: 'Incineration (biosecure)', required: false })
  @IsString()
  @IsOptional()
  disposal_method?: string;
}

/**
 * The prescription behind a CONSUMPTION row that is a medicine or vaccine.
 * withdrawal_days is the one that carries weight: it drives the slaughter
 * withdrawal check and the active-case count.
 */
export class TreatmentDetailDto {
  @ApiProperty({ description: 'Diagnosis or reason for the treatment', required: false })
  @IsString()
  @IsOptional()
  diagnosis?: string;

  @ApiProperty({ description: 'Route of administration', enum: TREATMENT_ROUTES, required: false })
  @IsString()
  @IsOptional()
  @IsIn(TREATMENT_ROUTES)
  route?: string;

  @ApiProperty({ description: 'Withdrawal period in days — the animal may not enter the food chain until it elapses', required: false, example: 28 })
  @IsInt()
  @Min(0)
  @Max(365)
  @IsOptional()
  withdrawal_days?: number;

  @ApiProperty({ description: 'Attending veterinarian', required: false })
  @IsString()
  @IsOptional()
  veterinarian?: string;
}

export class AddBatchTransactionDto {
  @ApiProperty({ description: 'Transaction date', example: '2026-08-07' })
  @IsDateString()
  @IsNotEmpty()
  transaction_date: string;

  @ApiProperty({ description: 'Transaction type', enum: TRANSACTION_TYPES })
  @IsString()
  @IsNotEmpty()
  @IsIn(TRANSACTION_TYPES)
  transaction_type: string;

  @ApiProperty({ description: 'Item UUID (required for CONSUMPTION/MORTALITY/OUTPUT, omit for pure OVERHEAD/OBSERVATION)', required: false })
  @IsUUID()
  @IsOptional()
  item_id?: string;

  @ApiProperty({ description: 'Resource UUID (labor/equipment consumed, for OVERHEAD)', required: false })
  @IsUUID()
  @IsOptional()
  resource_id?: string;

  @ApiProperty({ description: 'Quantity (unsigned — sign is derived from transaction_type)', required: false })
  @IsNumber()
  @IsOptional()
  quantity?: number;

  @ApiProperty({ description: 'Unit of measure', required: false })
  @IsString()
  @IsOptional()
  uom?: string;

  @ApiProperty({ description: 'Rate per unit', required: false })
  @IsNumber()
  @IsOptional()
  rate?: number;

  @ApiProperty({ description: 'Remarks', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Output classification (OUTPUT type only) — set to BY_PRODUCT/WASTE with nrv_rate to remove a by-product mid-batch at Net Realisable Value, distinct from the main product', enum: OUTPUT_TYPES, required: false })
  @IsString()
  @IsOptional()
  @IsIn(OUTPUT_TYPES)
  output_type?: string;

  @ApiProperty({ description: 'Net Realisable Value per unit (OUTPUT type, output_type=BY_PRODUCT/WASTE only) — the value this quantity actually enters inventory at; the difference vs. its at-cost value posts as an impairment loss', required: false })
  @IsNumber()
  @IsOptional()
  nrv_rate?: number;

  @ApiProperty({ description: 'Number of persons (OVERHEAD/labour rows only)', required: false })
  @IsInt()
  @IsOptional()
  persons?: number;

  @ApiProperty({ description: 'Hours worked per person (OVERHEAD/labour rows only)', required: false })
  @IsNumber()
  @IsOptional()
  hours?: number;

  @ApiProperty({ description: 'Average daily gain in kg/day (OBSERVATION/weight-sample rows only)', required: false })
  @IsNumber()
  @IsOptional()
  adg?: number;

  @ApiProperty({ description: 'Body condition score, 1-5 (OBSERVATION/weight-sample rows only)', required: false })
  @IsNumber()
  @IsOptional()
  bcs_score?: number;

  @ApiProperty({ description: 'Attribute this transaction to a single animal in the batch instead of the whole batch — omit for a whole-batch entry', required: false })
  @IsUUID()
  @IsOptional()
  animal_id?: string;

  @ApiProperty({ description: 'Clinical detail for a MORTALITY row — cause, post-mortem findings, disposal, pen', required: false, type: MortalityDetailDto })
  @ValidateNested()
  @Type(() => MortalityDetailDto)
  @IsOptional()
  mortality_detail?: MortalityDetailDto;

  @ApiProperty({ description: 'Prescription detail for a medicine/vaccine CONSUMPTION row — diagnosis, route, withdrawal period, vet', required: false, type: TreatmentDetailDto })
  @ValidateNested()
  @Type(() => TreatmentDetailDto)
  @IsOptional()
  treatment_detail?: TreatmentDetailDto;
}

export class BatchOutputLineInput {
  @ApiProperty({ description: 'Output item UUID' })
  @IsUUID()
  @IsNotEmpty()
  item_id: string;

  @ApiProperty({ description: 'Output classification', enum: OUTPUT_TYPES, default: 'MAIN' })
  @IsString()
  @IsOptional()
  @IsIn(OUTPUT_TYPES)
  output_type?: string;

  @ApiProperty({ description: 'Share of total batch cost allocated to this output line (all lines must sum to 100)', example: 100 })
  @IsNumber()
  @Min(0.01)
  @Max(100)
  @IsNotEmpty()
  cost_split_pct: number;

  @ApiProperty({ description: 'Output quantity' })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Unit of measure' })
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiProperty({ description: 'Destination warehouse UUID' })
  @IsUUID()
  @IsNotEmpty()
  warehouse_id: string;
}

export class CloseBatchDto {
  @ApiProperty({ description: 'Actual end date', required: false, example: '2026-09-18' })
  @IsDateString()
  @IsOptional()
  actual_end_date?: string;

  @ApiProperty({ description: 'Surviving/closing quantity', required: false })
  @IsNumber()
  @IsOptional()
  closing_quantity?: number;

  @ApiProperty({ description: 'Output lines — cost_split_pct must sum to 100 across all lines', type: [BatchOutputLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BatchOutputLineInput)
  output_lines: BatchOutputLineInput[];
}

export class QueryBatchDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by status', required: false, enum: ['DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: 'Filter by LOB UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ description: 'Batches have no is_active flag — findAll already excludes soft-deleted rows unconditionally. Declared so pickers can send the same isActive param every other list endpoint accepts without a 400.', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search batch no.', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Results per page', default: 50, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ description: 'Pagination offset', default: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class MatureBioAssetDto {
  @ApiProperty({ description: 'Residual (salvage) value per unit, used in the amortization formula', example: 5000 })
  @IsNumber()
  @IsNotEmpty()
  residual_value_per_unit: number;

  @ApiProperty({ description: 'Productive life in months (defaults to the batch breed\'s productive_life_months if omitted)', required: false })
  @IsInt()
  @IsOptional()
  productive_life_months?: number;
}

export class AmortizeBioAssetDto {
  @ApiProperty({ description: 'Posting date for this amortization run — one run per calendar month is allowed', example: '2026-09-30' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;
}

export class RecordFairValueDto {
  @ApiProperty({ description: 'Posting date', example: '2026-09-30' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'New fair value per unit', example: 28000 })
  @IsNumber()
  @IsNotEmpty()
  fair_value_per_unit: number;
}

export class DisposeBioAssetDto {
  @ApiProperty({ description: 'Disposal type', enum: DISPOSAL_TYPES })
  @IsString()
  @IsNotEmpty()
  @IsIn(DISPOSAL_TYPES)
  disposal_type: string;

  @ApiProperty({ description: 'Number of animals disposed', example: 1 })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Posting date', example: '2026-10-15' })
  @IsDateString()
  @IsNotEmpty()
  posting_date: string;

  @ApiProperty({ description: 'Output item UUID the disposed animals convert into (required for HARVEST)', required: false })
  @IsUUID()
  @IsOptional()
  output_item_id?: string;

  @ApiProperty({ description: 'UOM for the harvested output quantity (required for HARVEST)', required: false })
  @IsString()
  @IsOptional()
  output_uom?: string;

  @ApiProperty({ description: 'Harvested output quantity (required for HARVEST — may differ from animal count, e.g. carcass weight)', required: false })
  @IsNumber()
  @IsOptional()
  output_quantity?: number;

  @ApiProperty({ description: 'Destination warehouse UUID (required for HARVEST)', required: false })
  @IsUUID()
  @IsOptional()
  warehouse_id?: string;

  @ApiProperty({ description: 'Sale proceeds (required for SOLD)', required: false })
  @IsNumber()
  @IsOptional()
  sale_proceeds?: number;
}

export class BulkDailyEntryRowDto {
  @ApiProperty({ description: 'Batch UUID' })
  @IsUUID()
  @IsNotEmpty()
  batch_id: string;

  @ApiProperty({ description: 'Feed item UUID (optional)', required: false })
  @IsUUID()
  @IsOptional()
  feed_item_id?: string;

  @ApiProperty({ description: 'Feed consumed quantity (kg)', required: false })
  @IsNumber()
  @IsOptional()
  feed_qty?: number;

  @ApiProperty({ description: 'Mortality headcount (number of dead)', required: false })
  @IsNumber()
  @IsOptional()
  mortality_count?: number;

  @ApiProperty({ description: 'Water intake quantity (litres)', required: false })
  @IsNumber()
  @IsOptional()
  water_qty?: number;

  @ApiProperty({ description: 'Shed temperature observation (°C)', required: false })
  @IsNumber()
  @IsOptional()
  temperature?: number;

  @ApiProperty({ description: 'Remarks / Health notes', required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ description: 'Scope this row to only these animals in the batch (mutually exclusive with exclude_animal_ids) — feed/water quantities split evenly across them, mortality count becomes the number of animals selected, temperature is recorded per animal unchanged. Omit both arrays for the historical whole-batch behaviour.', required: false, type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  animal_ids?: string[];

  @ApiProperty({ description: 'Scope this row to every animal currently in the batch EXCEPT these ones (mutually exclusive with animal_ids)', required: false, type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  @IsOptional()
  exclude_animal_ids?: string[];
}

export class BulkDailyEntryDto {
  @ApiProperty({ description: 'Company UUID' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Daily log date', example: '2026-08-19' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({ description: 'List of batch daily entries', type: [BulkDailyEntryRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkDailyEntryRowDto)
  entries: BulkDailyEntryRowDto[];
}


const TRANSFER_TYPES = ['FULL_BATCH', 'PARTIAL'] as const;

export class CreateBatchTransferDto {
  @ApiProperty({ description: 'Company UUID' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Destination batch UUID' })
  @IsUUID()
  @IsNotEmpty()
  to_batch_id: string;

  @ApiProperty({ description: 'Date the animals physically moved', example: '2026-08-24' })
  @IsDateString()
  @IsNotEmpty()
  transfer_date: string;

  @ApiProperty({ enum: TRANSFER_TYPES, default: 'PARTIAL', required: false })
  @IsOptional()
  @IsIn(TRANSFER_TYPES as unknown as string[])
  transfer_type?: (typeof TRANSFER_TYPES)[number];

  @ApiProperty({
    description:
      'Animals to move. Required for PARTIAL. For FULL_BATCH leave empty and every remaining animal is moved.',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  animal_ids?: string[];

  @ApiProperty({ description: 'Destination pen/location UUID', required: false })
  @IsOptional()
  @IsUUID()
  to_location_id?: string;

  @ApiProperty({ description: 'Why the animals moved', required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiProperty({
    description: 'Post immediately instead of leaving the transfer in DRAFT',
    required: false,
    default: true,
  })
  @IsOptional()
  post_immediately?: boolean;

  @ApiProperty({
    description: 'Internal — set by BatchDailyDataService when the TRANSFER scheduler_line that generated this transfer has auto_triggers_stage = true. Not intended for direct/manual use.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  auto_triggers_stage?: boolean;
}

export class SplitBatchDto {
  @ApiProperty({ description: 'Animals to hold back — the ones not ready to move on with the rest of the cohort', type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  animal_ids: string[];

  @ApiProperty({ description: 'Date the group was split out', example: '2026-09-01' })
  @IsDateString()
  @IsNotEmpty()
  transfer_date: string;

  @ApiProperty({ required: false, description: 'Stage the split group holds at. Defaults to the stage the parent is leaving; set it to send them back a stage (a failed pregnancy scan returns a sow to service).' })
  @IsOptional()
  @IsString()
  hold_stage_code?: string;

  @ApiProperty({ required: false, description: 'Pen the group moves to' })
  @IsOptional()
  @IsUUID()
  to_location_id?: string;

  @ApiProperty({ required: false, description: 'Batch number for the child. Derived from the parent when omitted.' })
  @IsOptional()
  @IsString()
  child_batch_no?: string;

  @ApiProperty({ required: false, example: 'PREGNANCY_FAILED' })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class MergeBatchDto {
  @ApiProperty({ description: 'Date the group rejoined the cohort', example: '2026-10-01' })
  @IsDateString()
  @IsNotEmpty()
  transfer_date: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class QueryBatchTransferDto {
  // The console appends the active company as `companyId`; the global pipe runs
  // forbidNonWhitelisted, so an undeclared param 400s the whole list request and
  // the page renders an empty state over data that exists. Accepted as an alias
  // of company_id below.
  @ApiProperty({ required: false, description: 'Active company scope (camelCase alias of company_id)' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @ApiProperty({ required: false, description: 'Transfers into OR out of this batch' })
  @IsOptional()
  @IsUUID()
  batch_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  operational_area_id?: string;

  @ApiProperty({ required: false, enum: ['DRAFT', 'POSTED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['DRAFT', 'POSTED', 'CANCELLED'])
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  from_date?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  to_date?: string;

  // Every other list endpoint paginates; these three did not declare it, so a
  // screen adding pagination would 400 the whole request.
  @ApiProperty({ description: 'Results per page', default: 50, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ description: 'Pagination offset', default: 0, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
