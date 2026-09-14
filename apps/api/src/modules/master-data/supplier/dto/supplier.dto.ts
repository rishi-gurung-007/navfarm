import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsEmail, IsIn, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

const VENDOR_TYPES = ['ANIMAL_SUPPLIER', 'BREEDING_FARM', 'SEMEN_SUPPLIER', 'FEED_SUPPLIER', 'MEDICINE_SUPPLIER', 'EQUIPMENT_SUPPLIER', 'SERVICES', 'GENERAL'] as const;

export class CreateSupplierDto {
  @ApiProperty({ description: 'Company UUID scope ownership', example: 'company-uuid-here' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Legacy input only; the API generates SUP-001, SUP-002, etc. per company', example: 'SUP-001', required: false })
  @IsString()
  @IsOptional()
  supplier_code?: string;

  @ApiProperty({ description: 'Full legal name of the supplier', example: 'Feed Ingredients Corp Ltd' })
  @IsString()
  @IsNotEmpty()
  supplier_name: string;

  @ApiProperty({ description: 'Contact email address', required: false, example: 'orders@feedingredients.com' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: 'Contact phone number', required: false, example: '+919999988888' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: 'Government Tax Registration Number (e.g. VAT, GSTIN, EIN)', required: false, example: 'GSTIN123456789A' })
  @IsString()
  @IsOptional()
  tax_number?: string;

  @ApiProperty({ description: 'Standard billing terms', required: false, example: 'NET30' })
  @IsString()
  @IsOptional()
  payment_terms?: string;

  @ApiProperty({ description: 'Supplier street address line 1', required: false })
  @IsString()
  @IsOptional()
  address_line1?: string;

  @ApiProperty({ description: 'City', required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ description: 'State', required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ description: 'Country', required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ description: 'Postal area pincode', required: false })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiProperty({ description: 'Vendor classification', enum: VENDOR_TYPES, default: 'GENERAL', required: false })
  @IsString()
  @IsOptional()
  @IsIn(VENDOR_TYPES)
  vendor_type?: string;

  @ApiProperty({ description: 'Health certificate URL — required for ANIMAL_SUPPLIER, checked at Goods Receipt posting', required: false })
  @IsString()
  @IsOptional()
  health_cert_url?: string;

  @ApiProperty({ description: 'Official breeding-farm government registration number — required for ANIMAL_SUPPLIER / BREEDING_FARM', required: false })
  @IsString()
  @IsOptional()
  breeding_farm_code?: string;

  @ApiProperty({ description: 'Bank account number — stored encrypted, never returned in plaintext', required: false })
  @IsString()
  @IsOptional()
  bank_account_no?: string;

  @ApiProperty({ description: 'Bank IFSC / routing code', required: false })
  @IsString()
  @IsOptional()
  bank_ifsc?: string;

  @ApiProperty({ description: 'Maximum outstanding payable before a new PO is blocked', required: false })
  @IsNumber()
  @IsOptional()
  credit_limit?: number;

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

export class UpdateSupplierDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  supplier_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  supplier_name?: string;

  @ApiProperty({ required: false })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  tax_number?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  payment_terms?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  address_line1?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  pincode?: string;

  @ApiProperty({ required: false, enum: VENDOR_TYPES })
  @IsString()
  @IsOptional()
  @IsIn(VENDOR_TYPES)
  vendor_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  health_cert_url?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  breeding_farm_code?: string;

  @ApiProperty({ description: 'Replaces the stored (encrypted) bank account number', required: false })
  @IsString()
  @IsOptional()
  bank_account_no?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  bank_ifsc?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  credit_limit?: number;

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

export class QuerySupplierDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Filter by vendor type', enum: VENDOR_TYPES, required: false })
  @IsOptional()
  @IsString()
  vendorType?: string;

  @ApiProperty({ description: 'Filter by approval status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isApproved?: boolean;

  @ApiProperty({ description: 'Search supplier code, name, or tax code', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
