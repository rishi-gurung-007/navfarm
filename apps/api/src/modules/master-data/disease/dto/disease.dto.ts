import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsBoolean, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateDiseaseDto {
  @ApiProperty({ description: 'Company UUID scope ownership', example: 'company-uuid-here' })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ description: 'Unique code representing the disease definition. Optional when a number series is configured for diseases — the code is generated then.', required: false, example: 'DIS-ND' })
  @IsString()
  @IsOptional()
  disease_code?: string;

  @ApiProperty({ description: 'Common name of the disease', example: 'Newcastle Disease' })
  @IsString()
  @IsNotEmpty()
  disease_name: string;

  @ApiProperty({ description: 'Scientific taxonomic name', required: false, example: 'Avian paramyxovirus 1' })
  @IsString()
  @IsOptional()
  scientific_name?: string;

  @ApiProperty({ description: 'Common clinical symptoms', required: false })
  @IsString()
  @IsOptional()
  symptoms?: string;

  @ApiProperty({ description: 'Treatment protocol and guidelines', required: false })
  @IsString()
  @IsOptional()
  treatment_guideline?: string;

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

export class UpdateDiseaseDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  disease_code?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  disease_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  scientific_name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  symptoms?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  treatment_guideline?: string;

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

export class QueryDiseaseDto extends MasterListQueryDto {
  @ApiProperty({ description: 'Filter by company UUID', required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isActive?: boolean;

  @ApiProperty({ description: 'Search disease code, name or symptoms', required: false })
  @IsOptional()
  @IsString()
  search?: string;
}
