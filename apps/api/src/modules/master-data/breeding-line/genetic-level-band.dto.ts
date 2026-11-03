import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { rawBoolean } from './raw-boolean';

export class CreateGeneticLevelBandDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() nob_id?: string;
  @IsOptional() @IsString() lob_id?: string;
  /** The line (a breed). Left out, the band is the company default for any line with none of its own. */
  @IsOptional() @IsUUID() breed_id?: string | null;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(50) level_name!: string;
  /** Inclusive. Left out, the band has no lower end. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) tsi_from?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) tsi_to?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
}

/** A band's line is its identity: it is not edited, a band for another line is a new band. */
export class UpdateGeneticLevelBandDto extends PartialType(OmitType(CreateGeneticLevelBandDto, ['company_id', 'breed_id'] as const)) {
  @IsOptional() @IsUUID() breed_id?: string | null;
}

export class QueryGeneticLevelBandDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() breedId?: string;
  @IsOptional() @Transform(rawBoolean) @IsBoolean() isActive?: boolean;
}
