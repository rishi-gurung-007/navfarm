import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsEmail, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsIn, IsInt, Min, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { USER_TYPES } from '../../../../common/user-type-hierarchy';

export class CreateUserDto {
  @ApiProperty({ description: 'Company UUID', example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({ description: 'Tenant UUID', example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  @IsNotEmpty()
  tenant_id: string;

  @ApiProperty({ description: 'User full name', example: 'Rajesh Kumar Sharma' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  full_name: string;

  @ApiProperty({ description: 'Login email address', example: 'rajesh@farm.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Plaintext password (min 8 chars)', example: 'SecurePass123!' })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  password: string;

  @ApiProperty({ description: 'Contact phone number', required: false, example: '+919999999999' })
  @IsString()
  @IsOptional()
  phone?: string;

  // Closed list: any other string was persisted verbatim. Whether the caller
  // may assign the value is decided in UserService against the hierarchy.
  @ApiProperty({ description: 'User type classification', enum: USER_TYPES, default: 'STANDARD_USER', example: 'STANDARD_USER' })
  @IsIn(USER_TYPES)
  @IsOptional()
  user_type?: string;

  @ApiProperty({ description: 'Employee / Payroll ID', required: false, example: 'EMP-001' })
  @IsString()
  @IsOptional()
  employee_id?: string;

  @ApiProperty({ description: 'Department name', required: false, example: 'Farm Operations' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiProperty({ description: 'Job designation', required: false, example: 'Senior Farm Manager' })
  @IsString()
  @IsOptional()
  designation?: string;

  @ApiProperty({ description: 'Timezone preference', required: false, example: 'Asia/Kolkata' })
  @IsString()
  @IsOptional()
  timezone_pref_id?: string;
}

export class UpdateUserDto {
  @ApiProperty({ description: 'User full name', required: false, example: 'Rajesh Kumar Sharma' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  full_name?: string;

  @ApiProperty({ description: 'Contact phone number', required: false, example: '+919999999999' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ description: 'User type classification', enum: USER_TYPES, required: false, example: 'STANDARD_USER' })
  @IsIn(USER_TYPES)
  @IsOptional()
  user_type?: string;

  @ApiProperty({ description: 'Employee / Payroll ID', required: false, example: 'EMP-001' })
  @IsString()
  @IsOptional()
  employee_id?: string;

  @ApiProperty({ description: 'Department name', required: false, example: 'Farm Operations' })
  @IsString()
  @IsOptional()
  department?: string;

  @ApiProperty({ description: 'Job designation', required: false, example: 'Senior Farm Manager' })
  @IsString()
  @IsOptional()
  designation?: string;

  @ApiProperty({ description: 'Timezone preference', required: false, example: 'Asia/Kolkata' })
  @IsString()
  @IsOptional()
  timezone_pref_id?: string;

  @ApiProperty({ description: 'Activate or deactivate user account', required: false, example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class QueryUserDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ description: 'Filter by user type', required: false, example: 'STAFF' })
  @IsOptional()
  @IsString()
  userType?: string;

  @ApiProperty({ description: 'Filter by active status', required: false, example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: 'Search by name or email', required: false, example: 'Rajesh' })
  @IsOptional()
  @IsString()
  search?: string;

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

export class UserResponseDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000000' })
  user_id: string;

  @ApiProperty({ example: 'Rajesh Kumar Sharma' })
  full_name: string;

  @ApiProperty({ example: 'rajesh@farm.com' })
  email: string;

  @ApiProperty({ example: '+919999999999' })
  phone?: string;

  @ApiProperty({ example: 'STAFF' })
  user_type: string;

  @ApiProperty({ example: true })
  is_active: boolean;

  @ApiProperty({ example: 'COMPANY_ADMIN' })
  userType?: string;

  roles?: { role_id: string; role_code: string; role_name: string }[];
}
