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
}

export class CreateManualFeedRequisitionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiProperty({ type: [ManualFeedLineInput] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ManualFeedLineInput)
  lines: ManualFeedLineInput[];
}

/** Requisition §2 rows 53 and 56: the farm may change Requested Qty and Proposed Delivery Date. */
export class FeedLineEditInput {
  @ApiProperty() @IsUUID() line_id: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0.001) quantity_kg?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() proposed_delivery_date?: string;
}

export class UpdateFeedRequisitionDto {
  @ApiPropertyOptional({ description: 'Requisition §1 row 36' }) @IsOptional() @IsString() @MaxLength(2000) remarks?: string;
  @ApiPropertyOptional({ type: [FeedLineEditInput] })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => FeedLineEditInput)
  lines?: FeedLineEditInput[];
}

