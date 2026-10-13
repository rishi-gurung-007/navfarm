import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsNumber,
  IsDateString,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsInt,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One death on a MORTALITY_COUNT entry. A batch with registered animals names the animal; a count-only batch
 * leaves animal_id out and gives only the dead weight and reason.
 */
export class MortalityAnimalDto {
  @ApiProperty({ description: 'animal_register UUID - must be alive in this batch, at this line\'s stage. Omitted on a count-only batch.', required: false })
  @IsOptional()
  @IsUUID()
  animal_id?: string;

  @ApiProperty({ description: 'Dead body weight in kg (> 0)' })
  @IsNumber()
  dead_weight_kg: number;

  @ApiProperty({ description: 'Reason Master row of category MORTALITY. Give this or reason_text, not both.', required: false })
  @IsOptional()
  @IsUUID()
  reason_id?: string;

  @ApiProperty({ description: 'Free-text reason, when the Reason Master has none that fits. Give this or reason_id, not both.', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason_text?: string;
}

export class CreateBatchDailyDataDto {
  @ApiProperty({ description: 'scheduler_line UUID this entry answers' })
  @IsUUID()
  @IsNotEmpty()
  line_id: string;

  @ApiProperty({
    description:
      "ANIMAL_WISE batches only — the specific animal in the batch this entry is for. Required when the line's scheduler_header belongs to an ANIMAL_WISE batch (data entry is per-animal, grouped by stage); omit entirely for BATCH_WISE, where entries stay whole-batch.",
    required: false,
  })
  @IsOptional()
  @IsUUID()
  animal_id?: string;

  @ApiProperty({ example: '2026-09-08' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({
    description:
      'Numeric value — quantity for CONSUMPTION/OUTPUT/OVERHEAD/RESOURCE, the measured value for DESCRIPTIVE',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  entered_value?: number;

  @ApiProperty({
    description: 'Free-text value, for a non-numeric DESCRIPTIVE capture',
    required: false,
  })
  @IsOptional()
  @IsString()
  entered_text?: string;

  @ApiProperty({
    description: "Lot number — required when the line has lot_required and the item is lot-tracked. A consumption may name several lots, comma separated: they are used in turn until the quantity is covered.",
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'Too many lots for one entry — the lot list must fit in 80 characters.' })
  lot_no?: string;

  @ApiProperty({
    description: "Serial number — required when the line has lot_required and the item is serial-tracked",
    required: false,
  })
  @IsOptional()
  @IsString()
  serial_no?: string;

  @ApiProperty({
    description:
      'Overrides the line default rate for OVERHEAD/RESOURCE lines (cost per unit)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  rate?: number;

  @ApiProperty({
    description:
      'TRANSFER — the batch this entry moves animals/stock into. On an OUTPUT that posts as a weaning, the batch the weaned piglets move to (left out, they stay in their lot).',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  destination_batch_id?: string;

  @ApiProperty({
    description:
      "OUTPUT of a boar only — the other boars this semen collection is pooled with: one lot is mixed from all of them. The boar the entry is made against is the first; he is not repeated here.",
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  pool_animal_ids?: string[];

  @ApiProperty({
    description:
      'MORTALITY lines only — the Reason Master reason (category MORTALITY) for the death. Recorded on the animal and the batch transaction when the entry posts.',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  reason_id?: string;

  @ApiProperty({
    description:
      "OUTPUT only — the item this entry takes out of the batch (piglets of a sow, semen of a boar, any item of a batch-wise batch). Defaults to the line's own item; required when the line has none.",
    required: false,
  })
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiProperty({
    description:
      'Bagged feed CONSUMPTION only — the empty bags counted for this entry. Reconciled on POST Day against the quantity posted (bags x configured bag size, within the bag tolerance); a mismatch is flagged, not refused (workbook checkpoint 28).',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  empty_bags?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;

  @ApiProperty({
    description:
      'Save-only — records the value on batch_daily_data (posted: false) without touching inventory/GL/animal-count/transfer. The value only takes real effect (ledger entry, alert, etc.) once re-submitted with draft omitted/false — see BatchService.postBatchDay(), which does this for every draft row when the day is posted.',
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  @ApiProperty({
    description:
      'MORTALITY_COUNT line of a batch with registered animals - the animals that died, with dead weight and reason. Exactly as many as the deaths this entry adds (entered count less what was already posted for the line and date, capped at the registered animals alive), so a correction upward names only the extra animals. Omit on a draft save to choose later; required to post. Batches with no registered animals keep the count alone.',
    required: false,
    type: [MortalityAnimalDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MortalityAnimalDto)
  mortality_animals?: MortalityAnimalDto[];
}
