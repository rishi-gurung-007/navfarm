import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Requisition DTOs — Phase 9 MVP.
 *
 * Fields named by the BBP feed flow (§7.2): item, farm, quantity, balance
 * context, proposed delivery date (`required_date`), and an approver-adjustable
 * quantity. `est_rate`, `description` and the number series are ours (no field
 * spec exists for requisitions) — flagged to Rishi in docs/decisions.md.
 */
export class RequisitionLineInput {
  @ApiPropertyOptional({ description: 'Item — for ITEM requisitions' })
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiPropertyOptional({ description: 'Resource — for SERVICE/FA requisitions' })
  @IsOptional()
  @IsUUID()
  resource_id?: string;

  @ApiPropertyOptional({ description: 'Free description when no master record exists' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  uom: string;

  @ApiPropertyOptional({ description: 'Our field: estimated unit rate for cost visibility' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  est_rate?: number;
}

export class CreateRequisitionDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiPropertyOptional({ description: 'The farm the requisition is for — farm scope is enforced on it' })
  @IsOptional()
  @IsUUID()
  farm_id?: string;

  @ApiPropertyOptional({ enum: ['ITEM', 'FA', 'SERVICE'] })
  @IsOptional()
  @IsString()
  doc_type?: string;

  @ApiPropertyOptional({ description: 'Proposed delivery date (BBP §7.2 step 5)' })
  @IsOptional()
  @IsDateString()
  required_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  justification?: string;

  @ApiProperty({ type: [RequisitionLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequisitionLineInput)
  lines: RequisitionLineInput[];
}

export class SubmitRequisitionDto {
  @ApiPropertyOptional({ description: 'Optional note recorded on the approval request' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class DecideRequisitionDto {
  @ApiPropertyOptional({ description: 'Required when rejecting' })
  @IsOptional()
  @IsString()
  rejection_reason?: string;

  @ApiPropertyOptional({ description: 'D365BC PO number, stored on the requisition when approved' })
  @IsOptional()
  @IsString()
  linked_po_no?: string;
}

export class LinkPoDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  linked_po_no: string;
}
