import { MasterListQueryDto } from '../../../../common/master-list-query';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCountryDto {
  @ApiProperty({ description: 'ISO 3166-1 alpha-2 code', example: 'IN' })
  iso2: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-3 code', example: 'IND' })
  iso3: string;

  @ApiProperty({ description: 'Full country name', example: 'India' })
  country_name: string;

  @ApiProperty({ description: 'International dialing code', required: false, example: '+91' })
  phone_code?: string;

  @ApiProperty({ description: 'Default timezone UUID', required: false })
  default_tz_id?: string;

  @ApiProperty({ description: 'Default currency UUID', required: false })
  default_currency_id?: string;

  @ApiProperty({ description: 'Flag emoji', required: false, example: '🇮🇳' })
  flag_emoji?: string;
}

export class UpdateCountryDto {
  @ApiProperty({ required: false })
  iso2?: string;

  @ApiProperty({ required: false })
  iso3?: string;

  @ApiProperty({ required: false })
  country_name?: string;

  @ApiProperty({ required: false })
  phone_code?: string;

  @ApiProperty({ required: false })
  default_tz_id?: string;

  @ApiProperty({ required: false })
  default_currency_id?: string;

  @ApiProperty({ required: false })
  flag_emoji?: string;

  @ApiProperty({ required: false })
  is_active?: boolean;
}

export class CreateStateDto {
  @ApiProperty({ description: 'Short state code, unique per country', example: 'MH' })
  state_code: string;

  @ApiProperty({ description: 'Full state name', example: 'Maharashtra' })
  state_name: string;
}

export class UpdateStateDto {
  @ApiProperty({ required: false })
  state_code?: string;

  @ApiProperty({ required: false })
  state_name?: string;

  @ApiProperty({ required: false })
  is_active?: boolean;
}


export class QueryCountryDto extends MasterListQueryDto {
  /**
   * Accepted, not applied. Every master list sends the active company, and the
   * whitelisting ValidationPipe rejects a property that is not declared — which
   * is why the Countries list answered "property companyId should not exist"
   * and rendered as empty. `country_master` has no company_id: countries are
   * tenant-wide reference data, the same list for every company under it.
   */
  @ApiProperty({ description: 'Ignored — countries are tenant-wide, not company-scoped.', required: false })
  @IsOptional()
  @IsString()
  companyId?: string;

  @ApiProperty({ description: 'Search ISO code or country name', required: false })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({ description: 'Filter by active status', required: false })
  @IsOptional()
  @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  isActive?: boolean;
}
