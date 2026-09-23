import { PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { MasterListQueryDto } from '../../../common/master-list-query';

export class CreateKpiMetricDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() nob_id?: string;
  @IsOptional() @IsString() lob_id?: string;
  // No number series exists for this master — every code is manually typed
  // (manualCode still uppercases and checks width/uniqueness on the way in).
  @IsString() @IsNotEmpty() @MaxLength(50) metric_code!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(150) metric_name!: string;
  @IsOptional() @IsString() @MaxLength(20) default_uom?: string;
}

export class UpdateKpiMetricDto extends PartialType(OmitType(CreateKpiMetricDto, ['metric_code'] as const)) {}

export class QueryKpiMetricDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() @MaxLength(150) search?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() isActive?: boolean;
}
