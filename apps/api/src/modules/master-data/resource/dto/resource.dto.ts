import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateResourceDto {
  @ApiProperty({ description: 'Company UUID scope ownership' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ description: 'Legacy input only; the API generates RES-001, RES-002, etc. per company', example: 'RES-001', required: false })
  @IsString()
  @IsOptional()
  resource_code?: string;

  @ApiProperty({ description: 'Full name/description of the resource', example: 'Senior Laborer' })
  @IsString()
  @IsNotEmpty()
  resource_name: string;

  @ApiProperty({ description: 'Resource category; LABOR remains a legacy alias', example: 'MANPOWER', enum: ['MANPOWER', 'EQUIPMENT', 'VEHICLE', 'UTILITY', 'OTHER', 'LABOR'] })
  @IsString()
  @IsNotEmpty()
  resource_type: string;

  @ApiProperty({ description: 'Sub-classification: PERMANENT/CONTRACT/DAILY for labor, OWNED/LEASED/RENTED for equipment', required: false })
  @IsString()
  @IsOptional()
  resource_sub_type?: string;

  @ApiProperty({ description: 'HR employee ID (labor/manpower resources only)', required: false })
  @IsString()
  @IsOptional()
  employee_id?: string;

  @ApiProperty({ description: 'Job title/designation (labor/manpower resources only)', required: false })
  @IsString()
  @IsOptional()
  designation?: string;

  @ApiProperty({ description: 'Operating capacity count/limit', required: false })
  @IsNumber()
  @IsOptional()
  capacity?: number;

  @ApiProperty({ description: 'UOM for the capacity value (e.g. KG_PER_HOUR)', required: false })
  @IsString()
  @IsOptional()
  capacity_uom?: string;

  @ApiProperty({ description: 'Operational units', required: false, example: 'HOURS' })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiProperty({ description: 'Standard billing cost rate per unit', required: false })
  @IsNumber()
  @IsOptional()
  cost_rate?: number;

  @ApiProperty({ description: 'Fixed asset register code (equipment/vehicle only)', required: false })
  @IsString()
  @IsOptional()
  asset_code?: string;

  @ApiProperty({ description: 'Make/brand of the equipment', required: false })
  @IsString()
  @IsOptional()
  asset_make?: string;

  @ApiProperty({ description: 'Model number of the equipment', required: false })
  @IsString()
  @IsOptional()
  asset_model?: string;

  @ApiProperty({ description: 'Serial number of the equipment', required: false })
  @IsString()
  @IsOptional()
  asset_serial_no?: string;

  @ApiProperty({ description: 'Equipment purchase date', required: false })
  @IsDateString()
  @IsOptional()
  purchase_date?: string;

  @ApiProperty({ description: 'Warranty expiry date', required: false })
  @IsDateString()
  @IsOptional()
  warranty_expiry_date?: string;

  @ApiProperty({ description: 'Days between scheduled maintenance services (equipment/vehicle)', required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  maintenance_frequency_days?: number;

  @ApiProperty({ description: 'Expected cost per maintenance service', required: false })
  @IsNumber()
  @IsOptional()
  maintenance_cost_per_service?: number;

  @ApiProperty({ description: 'Preferred maintenance vendor/engineer', required: false })
  @IsString()
  @IsOptional()
  maintenance_vendor?: string;

  @ApiProperty({ description: 'GL account this resource posts cost to', required: false })
  @IsUUID()
  @IsOptional()
  gl_cost_account?: string;

  @ApiProperty({ description: 'Department this resource belongs to', required: false })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiProperty({ description: 'Cost element/classification for costing reports', required: false })
  @IsString()
  @IsOptional()
  cost_element?: string;

  @ApiProperty({ description: 'License/certification expiry date (labor resources only)', required: false })
  @IsDateString()
  @IsOptional()
  license_expiry?: string;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON format', required: false })
  @IsOptional()
  extension_config?: any;
}

export class UpdateResourceDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  resource_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  resource_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  resource_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  resource_sub_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  employee_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  designation?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  capacity?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  capacity_uom?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  cost_rate?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  asset_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  asset_make?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  asset_model?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  asset_serial_no?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  purchase_date?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  warranty_expiry_date?: string;

  @ApiProperty({ required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  maintenance_frequency_days?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  maintenance_cost_per_service?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  maintenance_vendor?: string;

  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  gl_cost_account?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  cost_element?: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  license_expiry?: string;

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
}

export class QueryResourceDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by resource type category', required: false })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiProperty({ description: 'Filter by NOB UUID', required: false })
  @IsOptional()
  @IsString()
  nobId?: string;

  @ApiProperty({ description: 'Filter by LOB UUID', required: false })
  @IsOptional()
  @IsString()
  lobId?: string;

  @ApiProperty({ description: 'Filter resources whose next maintenance is due within N days', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  maintenanceDueWithinDays?: number;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search resource code or name', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}

export class CreateMaintenanceLogDto {
  @ApiProperty({ description: 'Maintenance service date', example: '2026-07-27' })
  @IsDateString()
  @IsNotEmpty()
  maintenance_date: string;

  @ApiProperty({ description: 'Type of maintenance', example: 'PREVENTIVE', enum: ['PREVENTIVE', 'BREAKDOWN', 'CALIBRATION'] })
  @IsString()
  @IsNotEmpty()
  maintenance_type: string;

  @ApiProperty({ description: 'Service remarks/notes', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Cost incurred', required: false })
  @IsNumber()
  @IsOptional()
  cost?: number;

  @ApiProperty({ description: 'Technician/vendor name performing service', required: false })
  @IsString()
  @IsOptional()
  performed_by?: string;

  @ApiProperty({ description: 'Service status', default: 'COMPLETED', required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ description: 'Flexible custom config configurations in JSON format', required: false })
  @IsOptional()
  extension_config?: any;
}

export class UpdateMaintenanceLogDto {
  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  maintenance_date?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  maintenance_type?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  cost?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  performed_by?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  extension_config?: any;
}
