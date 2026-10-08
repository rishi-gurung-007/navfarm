import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';

export class QueryFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
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

export class FeedRequisitionReceiptDto extends FeedRequisitionShipmentDto {
  @ApiProperty() @IsUUID() shipment_id: string;
}
