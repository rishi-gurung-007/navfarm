import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { REJECTION_DISPOSITIONS } from '../qc-inspection.rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class QueryQcInspectionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'PENDING_APPROVAL', 'CLOSED'] }) @IsOptional() @IsIn(['OPEN', 'PENDING_APPROVAL', 'CLOSED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() itemId?: string;
  @ApiPropertyOptional({ description: 'Inspection no., source document no. or PO no.' }) @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}

export class QcLineEntryDto {
  @ApiProperty({ description: 'The inspection line this reading is for' })
  @IsUUID() line_id: string;

  @ApiPropertyOptional({ description: 'Value checks: the reading. The system judges it against Min/Max.' })
  @IsOptional() @IsNumber() actual_value?: number | null;

  @ApiPropertyOptional({ description: 'What was observed (Descriptive checks, or a note on a Value check)' })
  @IsOptional() @IsString() @MaxLength(500) actual_text?: string | null;

  @ApiPropertyOptional({ description: 'Descriptive checks: the inspector\'s verdict. Ignored for Value checks.', enum: ['PASS', 'FAIL'] })
  @IsOptional() @IsIn(['PASS', 'FAIL']) result?: 'PASS' | 'FAIL' | null;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string | null;
}

export class CompleteQcInspectionDto {
  @ApiProperty({ type: [QcLineEntryDto] })
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => QcLineEntryDto)
  lines: QcLineEntryDto[];

  @ApiPropertyOptional({ description: 'Quantity tested' }) @IsOptional() @IsNumber() @Min(0) sample_qty?: number;
  @ApiProperty() @IsNumber() @Min(0) accepted_qty: number;
  @ApiProperty() @IsNumber() @Min(0) rejected_qty: number;

  @ApiPropertyOptional({ description: 'Reason master row. Required when anything is rejected or the inspection fails.' })
  @IsOptional() @IsUUID() reason_id?: string;

  @ApiPropertyOptional({ description: 'Accept a failed lot anyway. Needs a Reason Code and a second person\'s approval before anything is posted.' })
  @IsOptional() @IsBoolean() deviation?: boolean;

  @ApiPropertyOptional({ description: 'Date the inventory entry is posted, YYYY-MM-DD. Defaults to today; not before the receipt.' })
  @IsOptional() @Matches(DATE, { message: 'posting_date must be YYYY-MM-DD.' }) posting_date?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string;

  @ApiPropertyOptional({ description: 'What becomes of the rejected quantity. Required when anything is rejected (a transfer records its return to the sender itself). Recorded only: nothing is posted.', enum: REJECTION_DISPOSITIONS })
  @IsOptional() @IsIn(REJECTION_DISPOSITIONS) rejection_disposition?: string;

  @ApiPropertyOptional({ description: 'The document that carries the disposition out, e.g. a return note or debit note no.' })
  @IsOptional() @IsString() @MaxLength(100) rejection_ref?: string;
}

export class ApproveQcDeviationDto {
  @ApiPropertyOptional({ description: 'Date the inventory entry is posted, YYYY-MM-DD. Defaults to the date entered on completion, else today.' })
  @IsOptional() @Matches(DATE, { message: 'posting_date must be YYYY-MM-DD.' }) posting_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class RefuseQcDeviationDto extends ApproveQcDeviationDto {
  @ApiPropertyOptional({ description: 'Refusing rejects the whole lot: what becomes of it. Defaults to what the inspector recorded for the part rejected on completion.', enum: REJECTION_DISPOSITIONS })
  @IsOptional() @IsIn(REJECTION_DISPOSITIONS) rejection_disposition?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) rejection_ref?: string;
}

export class SettleQcRejectionDto {
  @ApiProperty({ description: 'The final disposition of a rejected quantity that was held for a decision', enum: REJECTION_DISPOSITIONS })
  @IsIn(REJECTION_DISPOSITIONS) rejection_disposition: string;

  @ApiPropertyOptional({ description: 'The document that carries it out, e.g. a return note or debit note no.' })
  @IsOptional() @IsString() @MaxLength(100) rejection_ref?: string;
}

export class ItemQcSpecLineDto {
  @ApiPropertyOptional({ description: 'The QC Parameter Master row to take this check from: its code, description, type, range and Mandatory replace what is sent' })
  @IsOptional() @IsUUID() param_id?: string | null;
  @ApiProperty({ example: 'Ni' }) @IsString() @IsNotEmpty() @MaxLength(50) measurement_code: string;
  @ApiPropertyOptional({ example: 'Nickel' }) @IsOptional() @IsString() @MaxLength(200) measurement_description?: string | null;
  @ApiProperty({ enum: ['VALUE', 'DESCRIPTIVE'] }) @IsString() sampling_type: string;
  @ApiPropertyOptional({ default: 'INCOMING' }) @IsOptional() @IsString() @MaxLength(50) stage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) uom?: string | null;
  @ApiPropertyOptional({ description: 'VALUE only' }) @IsOptional() @IsNumber() min_value?: number | null;
  @ApiPropertyOptional({ description: 'VALUE only' }) @IsOptional() @IsNumber() max_value?: number | null;
  @ApiPropertyOptional({ description: 'VALUE only: the ideal value' }) @IsOptional() @IsNumber() target_value?: number | null;
  @ApiPropertyOptional({ description: 'DESCRIPTIVE only: the rule the inspector checks against' }) @IsOptional() @IsString() @MaxLength(500) acceptance_text?: string | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() is_mandatory?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() is_active?: boolean;
}

export class ReplaceItemQcSpecDto {
  @ApiProperty({ type: [ItemQcSpecLineDto] })
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ItemQcSpecLineDto)
  lines: ItemQcSpecLineDto[];
}
