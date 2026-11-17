import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class PreviewKillSheetDto {
  @IsUUID() farm_id!: string;
  @IsUUID() batch_id!: string;
}

export class ConfirmKillSheetDto {
  @IsOptional() @IsString() @MaxLength(500) override_reason?: string;
}

export class QueryKillSheetsDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() company_id?: string;
  @IsOptional() @IsString() farm_id?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}
