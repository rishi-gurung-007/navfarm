import { PartialType, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export const LINE_TYPES = ['CONSUMPTION', 'OUTPUT', 'DESCRIPTIVE', 'OVERHEAD', 'RESOURCE', 'TRANSFER'] as const;
export const OCCURRENCES = ['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE', 'CUSTOM'] as const;
export const QTY_BASES = ['PER_HEAD', 'TOTAL_BATCH', 'PER_PEN', 'FIXED'] as const;
export const OUTPUT_BASES = ['PER_SOW', 'PER_PEN', 'PER_BATCH'] as const;
export const CAPTURE_PERS = ['AVERAGE', 'TOTAL', 'PER_HEAD'] as const;

export class CreateActivityDto {
  // company_id/nob_id/lob_id are NOT accepted here when the caller is in an
  // OPERATIONAL workspace — enforceMasterRequest resolves those from the
  // active area and the service uses that, ignoring anything sent. They're
  // only meaningful (and optional) for a TENANT/COMPANY-scope shared template
  // with no active operational area to infer them from.
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsUUID() nob_id?: string;
  @IsOptional() @IsUUID() lob_id?: string;

  @IsString() @IsNotEmpty() @Matches(/^[A-Z][A-Z0-9_]{0,49}$/, { message: 'activity_code must be uppercase letters/digits/underscore, starting with a letter' })
  @MaxLength(50) activity_code!: string;

  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(200) activity_name!: string;

  @IsIn(LINE_TYPES) line_type!: (typeof LINE_TYPES)[number];

  @IsOptional() @IsString() description?: string;

  @IsOptional() @IsUUID() default_item_id?: string;
  @IsOptional() @IsUUID() default_resource_id?: string;
  @IsOptional() @IsIn(OCCURRENCES) default_occurrence?: (typeof OCCURRENCES)[number];
  @IsOptional() @IsIn(QTY_BASES) default_qty_basis?: (typeof QTY_BASES)[number];
  @IsOptional() @IsIn(OUTPUT_BASES) default_output_basis?: (typeof OUTPUT_BASES)[number];
  @IsOptional() @IsString() @MaxLength(50) default_kpi_metric?: string;
  @IsOptional() @IsIn(CAPTURE_PERS) default_capture_per?: (typeof CAPTURE_PERS)[number];
  @IsOptional() @IsString() @MaxLength(30) default_overhead_category?: string;
  @IsOptional() @IsString() @MaxLength(20) default_gl_account?: string;
  @IsOptional() @IsBoolean() default_is_mandatory?: boolean;
  @IsOptional() @IsBoolean() default_lot_required?: boolean;
}

export class UpdateActivityDto extends PartialType(OmitType(CreateActivityDto, ['activity_code'] as const)) {}

export class QueryActivityDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() nobId?: string;
  @IsOptional() @IsUUID() lobId?: string;
  @IsOptional() @IsIn(LINE_TYPES) lineType?: (typeof LINE_TYPES)[number];
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
}
