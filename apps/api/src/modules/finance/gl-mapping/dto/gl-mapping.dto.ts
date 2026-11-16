import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsInt,
  IsIn,
  ValidateIf,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';
import { INVENTORY_ENTRY_TYPES, INVENTORY_TRANSACTION_TYPES } from '../../../inventory/inventory-ledger/inventory-ledger.types';

export class CreateGlMappingDto {
  @ApiProperty({
    description: 'Company UUID scope ownership',
    example: 'company-uuid-here',
  })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({
    description:
      'Unique code for this record within the tenant/company scope. Optional: no GL mapping number series is configured yet, so a code is only stored when one is typed. Once a series is configured the code is generated instead.',
    required: false,
    example: 'MAP-001',
  })
  @IsString()
  @IsOptional()
  mapping_code?: string;

  @ApiProperty({
    description:
      'Optional Item Category UUID link for scoped category mapping rules',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  item_category_id?: string;

  @ApiProperty({
    description:
      'Optional Nature of Business UUID — narrows this mapping to one NOB, omit for all NOBs',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({
    description:
      'Optional Line of Business UUID — narrows this mapping to one LOB, omit for all LOBs',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({
    description:
      'Optional Stage UUID (stage_master) — narrows this mapping to one production stage. Omit (NULL) to match all stages (wildcard). A mapping with a stage set wins over a NULL-stage mapping in the most-specific-wins resolver.',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  stage_id?: string;

  @ApiProperty({
    description:
      'Optional costing method code (costing_method_config.method_code) — narrows this mapping to one valuation method, omit for all',
    required: false,
  })
  @IsString()
  @IsOptional()
  valuation_method?: string;

  @ApiProperty({
    description:
      'Optional Inventory Ledger entry type (POSITIVE, NEGATIVE, TRANSFER, OVERHEAD, DESCRIPTIVE) — narrows this mapping to ledger rows written with it, omit for any entry type',
    required: false,
    enum: INVENTORY_ENTRY_TYPES,
  })
  @ValidateIf((_o, value) => value !== '' && value != null)
  @IsIn(INVENTORY_ENTRY_TYPES as unknown as string[])
  entry_type?: string;

  @ApiProperty({
    description:
      'The Inventory Ledger transaction type this mapping resolves GL accounts for. A new mapping must use one of these; GlPostingService looks the mapping up by this exact value. A mapping created earlier for another type (BIO_*, MORTALITY ...) keeps its type and can still be edited.',
    example: 'PURCHASE',
    enum: INVENTORY_TRANSACTION_TYPES,
  })
  @IsString()
  @IsNotEmpty()
  transaction_type: string;

  @ApiProperty({ description: 'G/L account to debit', required: false })
  @IsUUID()
  @IsOptional()
  debit_gl_account_id?: string;

  @ApiProperty({ description: 'G/L account to credit', required: false })
  @IsUUID()
  @IsOptional()
  credit_gl_account_id?: string;

  @ApiProperty({
    description: 'Flexible custom config configurations in JSON format',
    required: false,
  })
  @IsOptional()
  extension_config?: any;
}

export class UpdateGlMappingDto {
  @ApiProperty({
    description:
      'Unique code within the tenant/company scope. Leave blank to keep the stored code unchanged.',
    required: false,
  })
  @IsString()
  @IsOptional()
  mapping_code?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  item_category_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({
    description:
      'Set/clear the production-stage dimension. Pass null to remove (wildcard).',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  stage_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  valuation_method?: string;

  @ApiProperty({
    description: 'Set/clear the entry-type dimension. Pass an empty value to remove (any entry type).',
    required: false,
    enum: INVENTORY_ENTRY_TYPES,
  })
  @ValidateIf((_o, value) => value !== '' && value != null)
  @IsIn(INVENTORY_ENTRY_TYPES as unknown as string[])
  entry_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  transaction_type?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  debit_gl_account_id?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  credit_gl_account_id?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @ApiProperty({
    required: false,
    example: 'ACTIVE',
    enum: ['ACTIVE', 'INACTIVE', 'ARCHIVE'],
  })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  extension_config?: any;
}

export class QueryGlMappingDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by item category UUID', required: false })
  @IsOptional()
  @IsUUID()
  itemCategoryId?: string;

  @ApiProperty({
    description: 'Filter by Nature of Business UUID',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  nobId?: string;

  @ApiProperty({
    description: 'Filter by Line of Business UUID',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  lobId?: string;

  @ApiProperty({
    description: 'Filter by production stage UUID',
    required: false,
  })
  @IsOptional()
  @IsUUID()
  stageId?: string;

  @ApiProperty({
    description: 'Filter by costing method code',
    required: false,
  })
  @IsOptional()
  @IsString()
  valuationMethod?: string;

  @ApiProperty({ description: 'Filter by Inventory Ledger entry type', required: false })
  @IsOptional()
  @IsString()
  entryType?: string;

  @ApiProperty({
    description: 'Filter by inventory transaction type',
    required: false,
  })
  @IsOptional()
  @IsString()
  transactionType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;
}
