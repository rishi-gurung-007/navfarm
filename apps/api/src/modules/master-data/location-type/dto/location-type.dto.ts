import { Transform, Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../../common/master-list-query';

const splitParentTypes = ({ value }: { value: unknown }) => {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim().toUpperCase()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((v) => v.trim().toUpperCase()).filter(Boolean);
  return value;
};

export class CreateLocationTypeDto {
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ example: 'FARM' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z][A-Za-z0-9_-]*$/)
  type_code?: string;

  @ApiProperty({ example: 'Farm' })
  @IsString()
  @IsNotEmpty()
  type_name: string;

  @ApiProperty({ example: 'FARM', description: 'Prefix used for generated location codes' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z][A-Za-z0-9]*$/)
  code_prefix: string;

  @ApiProperty({ example: 'FARM,SHED', description: 'Comma-separated or JSON array of allowed parent type codes' })
  @Transform(splitParentTypes)
  @IsArray()
  @IsOptional()
  allowed_parent_types?: string[];

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class UpdateLocationTypeDto {
  @IsString()
  @IsOptional()
  type_name?: string;

  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9]*$/)
  code_prefix?: string;

  @Transform(splitParentTypes)
  @IsArray()
  @IsOptional()
  allowed_parent_types?: string[];

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ description: 'Nature of Business UUID scope (blank = available across all NOBs)', required: false })
  @IsString()
  @IsOptional()
  nob_id?: string;

  @ApiProperty({ description: 'Line of Business UUID scope (blank = not LOB-restricted)', required: false })
  @IsString()
  @IsOptional()
  lob_id?: string;
}

export class QueryLocationTypeDto extends MasterListQueryDto {
  @IsUUID()
  @IsOptional()
  companyId?: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;

  @IsString()
  @IsOptional()
  search?: string;
}
