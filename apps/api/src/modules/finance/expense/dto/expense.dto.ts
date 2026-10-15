import { ApiProperty, OmitType } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, NotEquals, IsDateString, IsIn, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export const EXPENSE_DOC_TYPES = ['EXPENSE_VOUCHER', 'EXPENSE'] as const;
export type ExpenseDocType = (typeof EXPENSE_DOC_TYPES)[number];

export class CreateExpenseDocumentDto {
  @ApiProperty({ enum: EXPENSE_DOC_TYPES })
  @IsIn(EXPENSE_DOC_TYPES as unknown as string[])
  doc_type: ExpenseDocType;

  @ApiProperty({ description: 'Company UUID scope' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ example: '2026-10-15' })
  @IsDateString()
  posting_date: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  payee?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Signed: negative for a payment, positive for a receipt.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @NotEquals(0)
  amount: number;

  @ApiProperty({ description: 'Balance Account No. (GL). Required for EXPENSE.', required: false })
  @IsUUID()
  @IsOptional()
  expense_gl_account_id?: string;

  @ApiProperty({ description: 'GL account the money moves through (bank, cash, petty cash). Required for EXPENSE.', required: false })
  @IsUUID()
  @IsOptional()
  payment_gl_account_id?: string;

  @ApiProperty({ description: 'Location = the farm', required: false })
  @IsUUID()
  @IsOptional()
  location_id?: string;

  @ApiProperty({ description: 'Sub-Location = a shed of that farm', required: false })
  @IsUUID()
  @IsOptional()
  sub_location_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  remarks?: string;

  @ApiProperty({ required: false, default: 'GL' })
  @IsIn(['GL'])
  @IsOptional()
  voucher_type?: 'GL';
}

// The route names the document type, so the body does not carry one.
export class CreateExpenseBodyDto extends OmitType(CreateExpenseDocumentDto, ['doc_type'] as const) {}

export class QueryExpenseDocumentDto {
  @IsOptional() @IsIn(EXPENSE_DOC_TYPES as unknown as string[]) doc_type?: ExpenseDocType;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) limit?: number;
  @IsOptional() @Type(() => Number) offset?: number;
}
