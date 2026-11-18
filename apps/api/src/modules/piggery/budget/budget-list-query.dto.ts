import { IsOptional, IsString, IsUUID } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';

/**
 * Everything the master table sends (MasterDataTable.tsx load()): companyId when a company is active, search,
 * sort/dir, filter[col], limit and offset from MasterListQueryDto, isActive from pickers. The global pipe refuses an
 * undeclared parameter, so a missing one here 400s the whole list.
 */
export class BudgetListQueryDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() periodId?: string;
  @IsOptional() @IsString() farmId?: string;
  @IsOptional() @IsString() metricCode?: string;
  @IsOptional() @IsString() isActive?: string;
}
