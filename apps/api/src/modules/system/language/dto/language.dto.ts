import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResolveTranslationDto {
  @ApiProperty({ 
    description: 'User identifier for user-specific language preferences (optional)', 
    required: false, 
    nullable: true,
    example: null 
  })
  userId?: string | null;

  @ApiProperty({ 
    description: 'Company identifier', 
    example: '00000000-0000-0000-0000-000000000000' 
  })
  companyId: string;

  @ApiProperty({ 
    description: 'System module code', 
    example: 'POULTRY' 
  })
  moduleCode: string;

  @ApiProperty({ 
    description: 'UI translation label key name', 
    example: 'BUTTON_SUBMIT' 
  })
  key: string;
}

// Lengths follow the language_translations columns, so a bad body is a 400
// naming the field instead of a database error.
export class AddTranslationDto {
  // Not @IsUUID: seeded language ids (10000000-1000-1000-1000-...) are not
  // RFC-4122 and the validator would reject real rows.
  @ApiProperty({ 
    description: 'Language identifier', 
    example: '00000000-0000-0000-0000-000000000000' 
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(36)
  langId: string;

  @ApiProperty({ 
    description: 'System module code', 
    example: 'POULTRY' 
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  moduleCode: string;

  @ApiProperty({ 
    description: 'UI translation label key name', 
    example: 'BUTTON_SUBMIT' 
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  key: string;

  @ApiProperty({ 
    description: 'Localized message value', 
    example: 'Submit' 
  })
  @IsString()
  @IsNotEmpty()
  value: string;
}

export class CreateLanguageDto {
  @ApiProperty({ description: 'Short unique standard language code', example: 'en' })
  lang_code: string;

  @ApiProperty({ description: 'English name of the language', example: 'English' })
  lang_name_english: string;

  @ApiProperty({ description: 'Native display name of the language', example: 'English' })
  lang_name_native: string;

  @ApiProperty({ description: 'Script classification type code', example: 'Latin' })
  script: string;

  @ApiProperty({ description: 'Flag indicating if the text layout is Right-to-Left (RTL)', default: false, example: false })
  is_rtl?: boolean;

  @ApiProperty({ description: 'Flag indicating if the language is system default', default: false, example: false })
  is_system_default?: boolean;

  @ApiProperty({ description: 'Date format configuration pattern', default: 'DD/MM/YYYY', example: 'DD/MM/YYYY' })
  date_format?: string;

  @ApiProperty({ description: 'Number format grouping pattern', default: 'IN', example: 'IN' })
  number_format?: string;

  @ApiProperty({ description: 'Decimal separator character symbol', default: '.', example: '.' })
  decimal_separator?: string;

  @ApiProperty({ description: 'Thousands separator character symbol', default: ',', example: ',' })
  thousands_separator?: string;

  @ApiProperty({ description: 'Flag emoji icon', example: '🇺🇸' })
  flag_emoji?: string;
}

export class UpdateLanguageDto {
  @ApiProperty({ description: 'Short unique standard language code', required: false, example: 'en' })
  lang_code?: string;

  @ApiProperty({ description: 'English name of the language', required: false, example: 'English' })
  lang_name_english?: string;

  @ApiProperty({ description: 'Native display name of the language', required: false, example: 'English' })
  lang_name_native?: string;

  @ApiProperty({ description: 'Script classification type code', required: false, example: 'Latin' })
  script?: string;

  @ApiProperty({ description: 'Flag indicating if the text layout is Right-to-Left (RTL)', required: false, example: false })
  is_rtl?: boolean;

  @ApiProperty({ description: 'Flag indicating if the language is system default', required: false, example: false })
  is_system_default?: boolean;

  @ApiProperty({ description: 'Date format configuration pattern', required: false, example: 'DD/MM/YYYY' })
  date_format?: string;

  @ApiProperty({ description: 'Number format grouping pattern', required: false, example: 'IN' })
  number_format?: string;

  @ApiProperty({ description: 'Decimal separator character symbol', required: false, example: '.' })
  decimal_separator?: string;

  @ApiProperty({ description: 'Thousands separator character symbol', required: false, example: ',' })
  thousands_separator?: string;

  @ApiProperty({ description: 'Flag emoji icon', required: false, example: '🇺🇸' })
  flag_emoji?: string;

  @ApiProperty({ description: 'Is Active flag status', required: false, example: true })
  is_active?: boolean;
}
