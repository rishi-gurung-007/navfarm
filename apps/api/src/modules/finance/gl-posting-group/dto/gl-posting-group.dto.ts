import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';
import { GROUP_KINDS } from '../gl-posting-group.rules';

const blankToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

class AccountsDto {
  @IsOptional() @Transform(blankToNull) @IsUUID() asset_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() accum_amort_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() amort_expense_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() fv_gain_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() fv_loss_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() writeoff_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() inventory_gl_id?: string | null;
  @IsOptional() @Transform(blankToNull) @IsUUID() cogs_gl_id?: string | null;
}

export class CreateGlPostingGroupDto extends AccountsDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsString() @IsNotEmpty() @MaxLength(50) group_code!: string;
  @IsString() @IsNotEmpty() @MaxLength(150) group_name!: string;
  @IsIn(GROUP_KINDS as unknown as string[]) kind!: string;
}

export class UpdateGlPostingGroupDto extends AccountsDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(150) group_name?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

export class QueryGlPostingGroupDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  // The item form sends a default kind and the one its biological tick calls for; the last one given wins.
  @IsOptional() @Transform(({ value }) => (Array.isArray(value) ? value[value.length - 1] : value)) @IsIn(GROUP_KINDS as unknown as string[]) kind?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() isActive?: boolean;
}
