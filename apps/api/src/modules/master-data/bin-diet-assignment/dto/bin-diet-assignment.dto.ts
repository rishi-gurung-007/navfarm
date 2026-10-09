import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../../common/master-list-query';

export class CreateBinDietAssignmentDto {
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @IsUUID()
  bin_location_id: string;

  @IsUUID()
  feed_item_id: string;

  @IsDateString()
  production_date: string;

  @IsUUID()
  production_slot_id: string;

  @IsInt()
  @Min(1)
  diet_priority: number;
}

export class UpdateBinDietAssignmentDto {
  @IsUUID()
  @IsOptional()
  bin_location_id?: string;

  @IsUUID()
  @IsOptional()
  feed_item_id?: string;

  @IsDateString()
  @IsOptional()
  production_date?: string;

  @IsUUID()
  @IsOptional()
  production_slot_id?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  diet_priority?: number;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

export class QueryBinDietAssignmentDto extends MasterListQueryDto {
  @IsUUID()
  @IsOptional()
  companyId?: string;

  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
