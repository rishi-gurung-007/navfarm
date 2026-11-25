import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

// A plain day: the list window appends its own times, so a datetime here would build an invalid SQL value.
const DAY = /^\d{4}-\d{2}-\d{2}$/;

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
  @IsOptional() @IsDateString() @Matches(DAY, { message: 'date_from must be a date as YYYY-MM-DD.' }) date_from?: string;
  @IsOptional() @IsDateString() @Matches(DAY, { message: 'date_to must be a date as YYYY-MM-DD.' }) date_to?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() limit?: string;
}
