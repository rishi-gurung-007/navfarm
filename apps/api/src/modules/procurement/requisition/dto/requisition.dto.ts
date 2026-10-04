import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { REQUISITION_PURPOSES } from '../requisition.rules';

/**
 * Requisition DTOs — Phase 9 MVP, extended by Task 8 with the supplied
 * common-requisition header and line fields.
 *
 * Fields named by the BBP feed flow (§7.2): item, farm, quantity, balance
 * context, proposed delivery date (`required_date`), and an approver-adjustable
 * quantity. Fields named by Rishi's 1 Oct specification (decisions.md):
 * requisition date, main location, requester/sender department identities,
 * Store/Purchase purpose, from/to sub-location, direct-transfer flag and
 * remarks. `est_rate`, `description` and the number series are ours (no field
 * spec exists for requisitions) — flagged to Rishi in docs/decisions.md.
 *
 * requester_user_id / requester_name / requester_department_id are server-side
 * snapshots taken from the signed-in user — deliberately not client inputs.
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

  @ApiPropertyOptional({ description: 'Free description when no master record exists — also the Fixed Asset/Service description (Task 8)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
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

  @ApiPropertyOptional({ description: 'Line source sub-location; defaults to the header source' })
  @IsOptional()
  @IsUUID()
  from_location_id?: string;

  @ApiPropertyOptional({ description: 'Line destination sub-location; defaults to the header destination' })
  @IsOptional()
  @IsUUID()
  to_location_id?: string;

  @ApiPropertyOptional({ description: 'Authorized shipment target; defaults to the requested quantity on a Store line' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  qty_to_ship?: number;

  @ApiPropertyOptional({ description: 'Authorized receipt target; defaults to the to-ship quantity on a Store line' })
  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  qty_to_receive?: number;
}

export class CreateRequisitionDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiPropertyOptional({ description: 'The farm the requisition is for — farm scope is enforced on it. Ignored on update (the farm of an existing document never changes).' })
  @IsOptional()
  @IsUUID()
  farm_id?: string;

  // Task 13 fix round 1: only the common kinds. A lowercase or unknown value
  // used to fall through normalizeCommonDocType to ITEM; FEED gets the message
  // that sends it to /feed-requisition (the service guard says the same).
  @ApiPropertyOptional({ enum: ['ITEM', 'FA', 'SERVICE'] })
  @IsOptional()
  @IsIn(['ITEM', 'FA', 'SERVICE'], {
    message: (args) => args.value === 'FEED'
      ? 'A feed requisition cannot be created or edited through /requisition; use /feed-requisition.'
      : 'doc_type must be one of ITEM, FA, SERVICE.',
  })
  doc_type?: string;

  @ApiPropertyOptional({ enum: REQUISITION_PURPOSES, description: 'STORE (Item only) or PURCHASE — required by the service for common requisitions' })
  @IsOptional()
  @IsIn(REQUISITION_PURPOSES as unknown as string[])
  purpose?: string;

  @ApiPropertyOptional({ description: 'The requisition document date; defaults to the draft creation date' })
  @IsOptional()
  @IsDateString()
  requisition_date?: string;

  @ApiPropertyOptional({ description: 'Main (farm) location of the requisition; defaults to farm_id' })
  @IsOptional()
  @IsUUID()
  main_location_id?: string;

  @ApiPropertyOptional({ description: 'Requester department — a Cost Center Master row of type DEPARTMENT; defaults to the signed-in user’s department identity' })
  @IsOptional()
  @IsUUID()
  requester_department_id?: string;

  @ApiPropertyOptional({ description: 'Sender department — a Cost Center Master row of type DEPARTMENT (decisions, 1 Oct)' })
  @IsOptional()
  @IsUUID()
  sender_department_id?: string;

  @ApiPropertyOptional({ description: 'Source sub-location (required for a Store purpose)' })
  @IsOptional()
  @IsUUID()
  from_location_id?: string;

  @ApiPropertyOptional({ description: 'Destination sub-location (required for a Store purpose)' })
  @IsOptional()
  @IsUUID()
  to_location_id?: string;

  @ApiPropertyOptional({ description: 'Post shipment and its matching receipt together at fulfilment (explicit permission required)' })
  @IsOptional()
  @IsBoolean()
  direct_transfer?: boolean;

  @ApiPropertyOptional({ description: 'Free-text remarks on the document' })
  @IsOptional()
  @IsString()
  remarks?: string;

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

/**
 * PUT /requisition/:id — the whole document while it is Open; full replace, not a patch.
 * Lines are replaced, not merged. Omitted remarks, required_date, justification,
 * sender_department_id become null and direct_transfer becomes false; omitted
 * requisition_date, main_location_id, requester_department_id and purpose keep the
 * stored value. farm_id is ignored.
 */
export class UpdateRequisitionDto extends OmitType(CreateRequisitionDto, ['company_id'] as const) {}

/**
 * POST /requisition/:id/shipment and /receipt (Task 7) — the requisition's own
 * line ids, translated to the linked transfer's lines by
 * requisition.rules.ts's mapToTransferLines before reaching StockTransferService.
 */
export class RequisitionEventLineInput {
  @ApiProperty({ description: 'Requisition line UUID' })
  @IsUUID()
  line_id: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;
}

export class RequisitionShipmentDto {
  @ApiProperty()
  @IsDateString()
  posting_date: string;

  @ApiProperty({ type: [RequisitionEventLineInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RequisitionEventLineInput)
  lines: RequisitionEventLineInput[];
}

export class RequisitionReceiptDto extends RequisitionShipmentDto {
  @ApiProperty({ description: 'The shipment this receipt receives against' })
  @IsUUID()
  shipment_id: string;
}
