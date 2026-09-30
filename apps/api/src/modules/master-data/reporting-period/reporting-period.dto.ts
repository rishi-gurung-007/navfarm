import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';

/** The master form sends a cleared date as ''. */
const blankToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class CreateReportingPeriodDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'e.g. 2026-09' }) @IsString() @Matches(/^[A-Za-z0-9-]{1,20}$/) period_code: string;
  @ApiProperty() @IsDateString() start_date: string;
  @ApiProperty({ description: 'The month-end Saturday' }) @IsDateString() end_date: string;
  @ApiPropertyOptional({ description: 'Blank = End Date' }) @IsOptional() @Transform(blankToNull) @IsDateString() stock_take_date?: string | null;
}

export class UpdateReportingPeriodDto extends PartialType(CreateReportingPeriodDto) {}

export class QueryReportingPeriodDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() businessYear?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() isActive?: boolean;
}

export class GenerateReportingPeriodsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'The calendar year the July–June business year starts in. Generation creates inactive DRAFT proposals only.' })
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) business_year_start: number;
}
