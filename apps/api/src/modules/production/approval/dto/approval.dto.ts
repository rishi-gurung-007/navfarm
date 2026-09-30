import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const URGENCIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

export class CreateApprovalRequestDto {
  @ApiProperty()
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  operational_area_id?: string;

  @ApiProperty({ description: 'FEED_RATION, GRN_RECEIPT, STOCK_TRANSFER, STAGE_CLOSE, VET_DISPOSAL, or an LOB-specific type' })
  @IsString()
  @IsNotEmpty()
  doc_type: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  location_label?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  batch_id?: string;

  @ApiProperty({ enum: URGENCIES, required: false })
  @IsOptional()
  @IsIn(URGENCIES as unknown as string[])
  urgency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  item_or_stage?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  requested_qty?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  uom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  cost_impact?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  justification?: string;
}

export class DecideApprovalDto {
  @ApiProperty({ required: false, description: 'Required when rejecting.' })
  @IsOptional()
  @IsString()
  rejection_reason?: string;
}

/** D25: an approver's remarks on approval — a feed requisition needs them when it is late or more than 20 % off. */
export class ApproveApprovalDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class QueryApprovalDto {
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

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  operational_area_id?: string;

  @ApiProperty({ required: false, enum: APPROVAL_STATUSES })
  @IsOptional()
  @IsIn(APPROVAL_STATUSES as unknown as string[])
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  doc_type?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  search?: string;

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
