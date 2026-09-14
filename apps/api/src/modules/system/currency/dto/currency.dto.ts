import { ApiProperty } from '@nestjs/swagger';
import {
  IsNumber, IsPositive, IsString, IsOptional, IsDateString,
  IsNotEmpty, IsInt, IsBoolean, IsArray, IsIn, Length, Min, Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { MasterListQueryDto } from '../../../../common/master-list-query';

/**
 * Every property here carried only @ApiProperty, which is Swagger metadata and
 * not a validator. With the global pipe's whitelist + forbidNonWhitelisted, an
 * undecorated property is non-whitelisted, so POST /currency/rate rejected the
 * exact four fields its own controller reads — "property fromCurrencyId should
 * not exist". The endpoint could never be called successfully, which is why
 * nothing in the frontend used it.
 */
export class UpdateExchangeRateDto {
  @ApiProperty({ 
    description: 'From currency UUID', 
    example: '00000000-0000-0000-0000-000000000000' 
  })
  // @IsString, not @IsUUID: the platform currency ids are hand-assigned
  // sentinels (20000000-2000-...), which are not v4 UUIDs and fail @IsUUID.
  // company.dto.ts's base_currency_id already settled this the same way.
  @IsString()
  fromCurrencyId: string;

  @ApiProperty({ 
    description: 'To currency UUID', 
    example: '00000000-0000-0000-0000-000000000000' 
  })
  @IsString()
  toCurrencyId: string;

  @ApiProperty({ 
    description: 'Currency conversion conversion rate factor multiplier', 
    example: 83.45 
  })
  @IsNumber()
  @IsPositive()
  rate: number;

  @ApiProperty({ 
    description: 'Source rate description tag', 
    required: false, 
    default: 'MANUAL', 
    example: 'MANUAL' 
  })
  @IsString()
  @IsOptional()
  source?: string;

  @ApiProperty({ description: 'Date the rate applies from. Defaults to today. BBP-1 §1.1 has Finance entering the USD/ZWL rate manually, and a dated table is what lets a past period be restated.', required: false, example: '2026-09-06' })
  @IsDateString()
  @IsOptional()
  rateDate?: string;
}

/**
 * Every property below carried only @ApiProperty, exactly as UpdateExchangeRateDto
 * did before the comment above was written. @ApiProperty is Swagger metadata, not
 * a validator, and with the global pipe's whitelist + forbidNonWhitelisted an
 * undecorated property is non-whitelisted — so POST and PUT /currency rejected
 * every field their own controller reads. Nothing had noticed because no screen
 * called them; the currency master is the first thing that does.
 */
export class CreateCurrencyDto {
  @ApiProperty({ description: 'Three character standard ISO 4217 currency code', example: 'USD' })
  @IsString()
  @Length(3, 3)
  iso_code: string;

  @ApiProperty({ description: 'Official currency code name display label', example: 'US Dollar' })
  @IsString()
  @IsNotEmpty()
  currency_name: string;

  @ApiProperty({ description: 'Standard currency display symbol prefix/suffix text', example: '$' })
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @ApiProperty({ description: 'Formatting symbol alignment layout orientation', default: 'PREFIX', example: 'PREFIX' })
  @IsString()
  @IsIn(['PREFIX', 'SUFFIX'])
  @IsOptional()
  symbol_position?: string;

  @ApiProperty({ description: 'Minor-unit digits. 0 for JPY and VND, which have none.', default: 2, example: 2 })
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  decimal_places?: number;

  @ApiProperty({
    description: 'ISO alpha-2 codes of the countries where this currency is legal tender. An array because EUR spans the eurozone and USD is tender in Zimbabwe as well as the United States.',
    required: false,
    type: [String],
    example: ['US', 'ZW'],
  })
  @IsArray()
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  @IsOptional()
  country_codes?: string[];

  @ApiProperty({ description: 'Flag marking currency as system default', default: false, example: false })
  @IsBoolean()
  @IsOptional()
  is_system_default?: boolean;
}

export class UpdateCurrencyDto {
  @ApiProperty({ description: 'Three character standard ISO 4217 currency code', required: false, example: 'USD' })
  @IsString()
  @Length(3, 3)
  @IsOptional()
  iso_code?: string;

  @ApiProperty({ description: 'Official currency code name display label', required: false, example: 'US Dollar' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  currency_name?: string;

  @ApiProperty({ description: 'Standard currency display symbol prefix/suffix text', required: false, example: '$' })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  symbol?: string;

  @ApiProperty({ description: 'Formatting symbol alignment layout orientation', required: false, example: 'PREFIX' })
  @IsString()
  @IsIn(['PREFIX', 'SUFFIX'])
  @IsOptional()
  symbol_position?: string;

  @ApiProperty({ description: 'Minor-unit digits. 0 for JPY and VND, which have none.', required: false, example: 2 })
  @IsInt()
  @Min(0)
  @Max(6)
  @IsOptional()
  decimal_places?: number;

  @ApiProperty({ description: 'ISO alpha-2 codes of the countries where this currency is legal tender', required: false, type: [String], example: ['DE', 'FR', 'NL'] })
  @IsArray()
  @IsString({ each: true })
  @Length(2, 2, { each: true })
  @IsOptional()
  country_codes?: string[];

  @ApiProperty({ description: 'Flag marking currency as system default', required: false, example: false })
  @IsBoolean()
  @IsOptional()
  is_system_default?: boolean;

  @ApiProperty({ description: 'Is Active flag status', required: false, example: true })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}

/** List filters. MasterDataTable sends limit, search and companyId on every load. */
export class QueryCurrencyDto extends MasterListQueryDto {
  @ApiProperty({ required: false, description: 'Matches ISO code or currency name' })
  @IsString()
  @IsOptional()
  search?: string;

  /**
   * Parsed with @Transform, not @Type(() => Boolean): Boolean('false') is true,
   * so the @Type form other query DTOs use cannot express isActive=false at all.
   */
  @ApiProperty({ required: false, description: 'Include deactivated currencies when false is passed explicitly' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() === 'true' : Boolean(value)))
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  /**
   * Accepted and ignored. currency_master is platform-wide reference data with
   * no company_id column, but MasterDataTable sends companyId with every list
   * request; without it declared here the global whitelist would reject the
   * screen's own call.
   */
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  companyId?: string;
}

/**
 * A rate row as the Exchange Rates tab creates it. from_currency_id is optional
 * and defaults to USD in the service: the client anchors every rate to the US
 * dollar and enters it as "1 USD = X" (Rishi, 2026-09-11), so the tab asks only
 * for the other side.
 */
export class CreateExchangeRateDto {
  @ApiProperty({ description: 'Currency being quoted. The rate reads 1 USD = <rate> of this.', example: '20000000-2000-2000-2000-200000000003' })
  @IsString()
  @IsNotEmpty()
  to_currency_id: string;

  @ApiProperty({ description: 'Base currency. Defaults to USD when omitted.', required: false })
  @IsString()
  @IsOptional()
  from_currency_id?: string;

  @ApiProperty({ description: 'How many units of the quoted currency one unit of the base buys', example: 36.25 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  rate: number;

  @ApiProperty({ description: 'Date the rate applies from. Defaults to today.', required: false, example: '2026-09-11' })
  @IsDateString()
  @IsOptional()
  rate_date?: string;

  @ApiProperty({ description: 'Source tag', required: false, default: 'MANUAL', example: 'MANUAL' })
  @IsString()
  @IsOptional()
  rate_source?: string;
}

export class UpdateExchangeRateRowDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  to_currency_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  from_currency_id?: string;

  @ApiProperty({ required: false, example: 36.25 })
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @IsOptional()
  rate?: number;

  @ApiProperty({ required: false, example: '2026-09-11' })
  @IsDateString()
  @IsOptional()
  rate_date?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  rate_source?: string;
}
