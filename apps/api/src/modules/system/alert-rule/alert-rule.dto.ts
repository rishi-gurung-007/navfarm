import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { DELIVERY_CHANNELS, FREQUENCIES, PRIORITY_LEVELS, THRESHOLD_REFERENCES, TRIGGER_ENTITIES } from './alert-rule.rules';

/** Master Setup §4, one field per row 43–56. Event type is free text here and checked by alertRuleProblems, which names what is supported. */
export class CreateAlertRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'Row 43, e.g. FEED-BELOW-L1' }) @IsString() @Matches(/^[A-Za-z0-9-]{1,20}$/) notification_code: string;
  @ApiProperty({ description: 'Row 44' }) @IsString() @MaxLength(100) notification_name: string;
  @ApiProperty({ description: 'Row 45' }) @IsString() @MaxLength(40) event_type: string;
  @ApiProperty({ enum: TRIGGER_ENTITIES }) @IsIn(TRIGGER_ENTITIES as unknown as string[]) trigger_entity: string;
  @ApiProperty({ enum: THRESHOLD_REFERENCES }) @IsIn(THRESHOLD_REFERENCES as unknown as string[]) threshold_reference: string;
  @ApiPropertyOptional({ description: 'Row 47: KG for FIXED_VALUE silo rules, days for DIET_CHANGE and REQ_DEADLINE' })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) threshold_value?: number | null;
  @ApiProperty({ enum: PRIORITY_LEVELS }) @IsIn(PRIORITY_LEVELS as unknown as string[]) priority_level: string;
  @ApiProperty({ type: [String], description: 'Row 50: role_master.role_code values' })
  @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v: unknown) => String(v).trim().toUpperCase()).filter(Boolean) : value))
  recipient_roles: string[];
  @ApiProperty({ enum: DELIVERY_CHANNELS }) @IsIn(DELIVERY_CHANNELS as unknown as string[]) delivery_channel: string;
  @ApiProperty({ enum: FREQUENCIES }) @IsIn(FREQUENCIES as unknown as string[]) frequency: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) escalation_after_hours?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || null : value))
  escalation_role?: string | null;
  @ApiPropertyOptional({ description: 'Row 56: a farm, or blank for ALL' }) @IsOptional() @IsUUID() farm_id?: string | null;
}

export class UpdateAlertRuleDto extends PartialType(CreateAlertRuleDto) {}

export class QueryAlertRuleDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() eventType?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() isActive?: boolean;
}
