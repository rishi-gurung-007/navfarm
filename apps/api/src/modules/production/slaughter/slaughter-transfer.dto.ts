import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { SLAUGHTER_CATEGORIES, SLAUGHTER_STATUSES } from './slaughter-transfer.rules';

export class SlaughterLineDto {
  @ApiProperty({ description: 'The batch (a weaner, grower or finisher lot) the pigs come from' }) @IsUUID() batch_id!: string;
  @ApiProperty({ required: false, description: 'The source house (shed or pen)' }) @IsOptional() @IsUUID() source_location_id?: string;
  @ApiProperty({ required: false, enum: SLAUGHTER_CATEGORIES }) @IsOptional() @IsIn(SLAUGHTER_CATEGORIES as unknown as string[]) category?: string;
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) head_count!: number;
  @ApiProperty({ required: false }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) avg_live_weight_kg?: number;
  @ApiProperty({ required: false, description: "Defaults to the batch's lot" }) @IsOptional() @IsString() @MaxLength(50) lot_no?: string;
}

export class CreateSlaughterTransferDto {
  @ApiProperty() @IsDateString() to_date!: string;
  @ApiProperty({ description: 'The supplying farm: one Transfer Order per farm' }) @IsUUID() farm_id!: string;
  @ApiProperty({ description: 'HO approval reference (mandatory, BBP S.10.1)' }) @IsString() @IsNotEmpty() @MaxLength(60) ho_approval_ref!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(150) destination?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsUUID() customer_id?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(30) vehicle_no?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) driver_name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() remarks?: string;
  @ApiProperty({ type: [SlaughterLineDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SlaughterLineDto) lines!: SlaughterLineDto[];
}

export class SlaughterPodLineDto {
  @ApiProperty() @IsUUID() line_id!: string;
  @ApiProperty({ description: 'Dead on arrival (0 if none)' }) @Type(() => Number) @IsInt() @Min(0) doa_head!: number;
}

export class SlaughterPodDto {
  @ApiProperty() @IsDateString() pod_date!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() @MaxLength(100) received_by?: string;
  @ApiProperty({ type: [SlaughterPodLineDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SlaughterPodLineDto) lines!: SlaughterPodLineDto[];
}

export class SlaughterKillSheetLineDto {
  @ApiProperty() @IsUUID() line_id!: string;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) avg_carcass_weight_kg!: number;
  @ApiProperty() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) price_per_kg!: number;
}

export class SlaughterKillSheetDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(60) kill_sheet_ref!: string;
  @ApiProperty() @IsDateString() kill_sheet_date!: string;
  @ApiProperty({ required: false, description: 'The invoice number, typed while Business Central is not connected' }) @IsOptional() @IsString() @MaxLength(30) invoice_no?: string;
  @ApiProperty({ type: [SlaughterKillSheetLineDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => SlaughterKillSheetLineDto) lines!: SlaughterKillSheetLineDto[];
}

export class QuerySlaughterTransferDto {
  @IsOptional() @IsIn(SLAUGHTER_STATUSES as unknown as string[]) status?: string;
}
