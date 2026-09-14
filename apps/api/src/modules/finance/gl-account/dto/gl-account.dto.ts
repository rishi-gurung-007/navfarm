import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateGlAccountDto {
  @ApiProperty({ description: 'Company UUID scope ownership', example: 'company-uuid-here' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Unique account code. Optional when a number series is configured for GL accounts — the code is generated then.', required: false, example: '101000' })
  @IsString()
  @IsOptional()
  account_code?: string;

  @ApiProperty({ description: 'Account descriptor name', example: 'Cash at Bank' })
  @IsString()
  @IsNotEmpty()
  account_name: string;

  @ApiProperty({ description: 'Account Category', example: 'ASSET', enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'])
  account_type: string;

  @ApiProperty({ description: 'Parent Account UUID link for Chart of Accounts nesting hierarchy', required: false })
  @IsUUID()
  @IsOptional()
  parent_account_id?: string;

  @ApiProperty({ description: 'Indicates whether this is a sub-account descriptor', required: false, default: false })
  @IsBoolean()
  @IsOptional()
  is_sub_account?: boolean;

  @ApiProperty({ description: 'Indicates whether this is a bank/tax reconciliation account', required: false, default: false })
  @IsBoolean()
  @IsOptional()
  is_reconciliation?: boolean;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON format', required: false })
  @IsOptional()
  extension_config?: any;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class UpdateGlAccountDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  account_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  account_name?: string;

  @ApiProperty({ required: false, enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] })
  @IsString()
  @IsOptional()
  @IsIn(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'])
  account_type?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  parent_account_id?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_sub_account?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_reconciliation?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({ required: false, example: 'ACTIVE', enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'] })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  extension_config?: any;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QueryGlAccountDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by account type', required: false, enum: ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] })
  @IsOptional()
  @IsString()
  accountType?: string;

  @ApiProperty({ description: 'Filter by parent account UUID', required: false })
  @IsOptional()
  @IsUUID()
  parentAccountId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search account code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
