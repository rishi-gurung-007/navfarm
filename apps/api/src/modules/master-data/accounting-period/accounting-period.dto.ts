import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';

const toBool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class CreateAccountingPeriodDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'The period runs from here to the day before the next period starts' })
  @IsDateString() starting_date: string;
  @ApiProperty({ description: 'e.g. July' }) @IsString() @MinLength(1) @MaxLength(30) name: string;
  @ApiPropertyOptional({ description: 'This period starts a fiscal year' }) @IsOptional() @Transform(toBool) @IsBoolean() new_fiscal_year?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() closed?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() date_locked?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(toBool) @IsBoolean() inventory_period_closed?: boolean;
}

export class UpdateAccountingPeriodDto extends PartialType(CreateAccountingPeriodDto) {}

export class QueryAccountingPeriodDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
}
