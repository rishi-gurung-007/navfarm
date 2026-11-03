import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { rawBoolean } from './raw-boolean';

export class CreateSemenCollectorDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() nob_id?: string;
  @IsOptional() @IsString() lob_id?: string;
  /** The short ID on the AI Station's sheets (CM, AW, TA). */
  @IsString() @IsNotEmpty() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, { message: 'The code is letters, digits, hyphen or underscore.' }) @MaxLength(20) collector_code!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(100) collector_name!: string;
  /** The system user, when the technician has a login. */
  @IsOptional() @IsUUID() user_id?: string | null;
}

export class UpdateSemenCollectorDto extends PartialType(OmitType(CreateSemenCollectorDto, ['company_id'] as const)) {}

export class QuerySemenCollectorDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() @MaxLength(50) search?: string;
  @IsOptional() @Transform(rawBoolean) @IsBoolean() isActive?: boolean;
}
