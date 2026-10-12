import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Matches, Min, ValidateNested } from 'class-validator';

export class QueryFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
}

export class FeedConsolidationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'REVIEWED', 'CONSOLIDATED', 'CANCELLED'] }) @IsOptional()
  @IsIn(['DRAFT', 'REVIEWED', 'CONSOLIDATED', 'CANCELLED'])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) requisitionIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() fromDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() toDate?: string;
}

export class FeedConsolidationLineDto {
  @ApiProperty() @IsUUID() requisitionLineId!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) millApprovedQtyKg?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) adjustmentReason?: string;
}

export class CreateFeedConsolidationDto extends FeedConsolidationQueryDto {
  @ApiProperty({ type: [FeedConsolidationLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => FeedConsolidationLineDto)
  lines!: FeedConsolidationLineDto[];
}

/** Loading Instruction Sheet rows 70–72: what the mill records at loading. */
export class UpdateFeedLoadingSheetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) compartmentNo?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) kgLoaded?: number;
  /** Row 72: the mill staff name confirming loading (stored in feed_loading_sheet.loaded_by, 36 characters). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(36, { message: 'Loaded By can be at most 36 characters.' }) loadedBy?: string;
}

/** Row 76: dispatch may carry the mill's typed estimated arrival (local date and time, YYYY-MM-DDTHH:mm). */
export class DispatchFeedLoadingSheetDto {
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/, { message: 'Estimated arrival must be a date and time.' }) estimatedArrivalAt?: string;
}

export class AutoDraftFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional({ description: 'Last forecast day the draft covers (default planning date + 7, at most + 45)' })
  @IsOptional() @IsDateString() to?: string;
}

/** Requisition §2: a manual line names its destination silo or store, the item, the kilograms and the delivery date. */
export class ManualFeedLineInput {
  @ApiProperty() @IsUUID() destination_location_id: string;
  @ApiProperty() @IsUUID() item_id: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.001) quantity_kg: number;
  @ApiProperty() @IsDateString() proposed_delivery_date: string;
  @ApiPropertyOptional({ description: 'Requisition row 13: why the line orders an item the lifecycle does not require' })
  @IsOptional() @IsString() @MaxLength(180) exception_reason?: string;
  @ApiPropertyOptional({ description: 'Active company Reason Master identity for the feed-line exception/override' })
  @IsOptional() @IsUUID() reason_id?: string;
}

export class CreateManualFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiProperty({ type: [ManualFeedLineInput] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ManualFeedLineInput)
  lines: ManualFeedLineInput[];
}

export class FeedRequisitionFromRunLineDto {
  @ApiProperty() @IsUUID() destination_location_id: string;
  @ApiProperty() @IsUUID() item_id: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.001) quantity_kg: number;
  @ApiProperty() @IsDateString() proposed_delivery_date: string;
}

export class CreateFeedRequisitionFromRunDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiProperty({ type: [FeedRequisitionFromRunLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => FeedRequisitionFromRunLineDto)
  lines: FeedRequisitionFromRunLineDto[];
}

/**
 * Requisition §2 rows 53 and 56: the farm may change Requested Qty and Proposed
 * Delivery Date; rows 43/55 and 45 (Task 9): the destination silo and the feed
 * item — an item the lifecycle does not require needs an exception reason
 * (Requisition row 13), and a silo holding another feed with stock is refused
 * (checkpoint 4).
 */
export class FeedLineEditInput {
  @ApiProperty() @IsUUID() line_id: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) quantity_kg?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() proposed_delivery_date?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() destination_location_id?: string;
  @ApiPropertyOptional({ description: 'Requisition row 13: why the line orders an item the lifecycle does not require' })
  @IsOptional() @IsString() @MaxLength(180) exception_reason?: string;
  @ApiPropertyOptional({ description: 'Active company Reason Master identity for the feed-line exception/override' })
  @IsOptional() @IsUUID() reason_id?: string;
}

export class UpdateFeedRequisitionDto {
  @ApiPropertyOptional({ description: 'Requisition §1 row 36' }) @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiPropertyOptional({ description: 'Requisition §1 row 34: escalate only', enum: ['CRITICAL_FIRST_PRIORITY', 'CRITICAL', 'WARNING', 'INFO'] })
  @IsOptional() @IsIn(['CRITICAL_FIRST_PRIORITY', 'CRITICAL', 'WARNING', 'INFO']) priority?: 'CRITICAL_FIRST_PRIORITY' | 'CRITICAL' | 'WARNING' | 'INFO';
  @ApiPropertyOptional({ type: [FeedLineEditInput] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FeedLineEditInput)
  lines?: FeedLineEditInput[];
}

export class FeedRequisitionEventLineDto {
  @ApiProperty() @IsUUID() requisition_line_id: string;
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.001) quantity: number;
}

export class FeedRequisitionShipmentDto {
  @ApiProperty() @IsUUID() transfer_id: string;
  @ApiProperty() @IsDateString() posting_date: string;
  @ApiProperty({ type: [FeedRequisitionEventLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => FeedRequisitionEventLineDto)
  lines: FeedRequisitionEventLineDto[];
}

/**
 * W2T: a feed receipt line carries its controls (Requisition rows 144-147, Silo
 * TO Receipt rows 17, 24, 27). Which are required is decided by the posting rule
 * (assertFeedReceiptLine), not here, because it depends on what shipped.
 */
export class FeedRequisitionReceiptLineDto extends FeedRequisitionEventLineDto {
  @ApiPropertyOptional({ description: 'Ignored: a reason is now required on every short receipt' })
  @IsOptional() @IsBoolean() final_receipt?: boolean;
  @ApiPropertyOptional({ description: 'Mandatory on every short receipt (checkpoint 26)' })
  @IsOptional() @IsString() @MaxLength(500) variance_reason?: string;
  @ApiPropertyOptional({ description: 'Bags physically received; required for BAGGED feed (checkpoint 27)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) bag_count?: number;
  @ApiPropertyOptional({ description: 'Mill delivery note no. (optional)' })
  @IsOptional() @IsString() @MaxLength(80) delivery_note_no?: string;
}

export class FeedRequisitionReceiptDto {
  @ApiProperty() @IsUUID() transfer_id: string;
  @ApiProperty() @IsUUID() shipment_id: string;
  @ApiProperty() @IsDateString() posting_date: string;
  @ApiProperty({ type: [FeedRequisitionReceiptLineDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => FeedRequisitionReceiptLineDto)
  lines: FeedRequisitionReceiptLineDto[];
}
