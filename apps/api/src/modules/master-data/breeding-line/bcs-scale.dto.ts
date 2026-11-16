import { OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { rawBoolean } from './raw-boolean';
import { Transform } from 'class-transformer';

export class CreateBcsScaleDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() nob_id?: string;
  @IsOptional() @IsString() lob_id?: string;
  /** The line (a breed). Left out, the row is the company default scale, read for a line with none of its own. */
  @IsOptional() @IsUUID() breed_id?: string | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) score!: number;
  @IsOptional() @IsString() @MaxLength(50) score_name?: string | null;
  @IsOptional() @IsString() @MaxLength(300) indicators?: string | null;
  @IsOptional() @IsString() @MaxLength(300) required_action?: string | null;
  /** The feed level this score sets, kg a day. Left out, the score does not change the feed. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999) feed_kg_per_day?: number | null;
  @IsOptional() @IsBoolean() health_assessment_required?: boolean;
  @IsOptional() @IsBoolean() medication_review?: boolean;
}

/** A row's line and score are its identity: they are not edited, another score or line is a new row. */
export class UpdateBcsScaleDto extends PartialType(OmitType(CreateBcsScaleDto, ['company_id', 'breed_id', 'score'] as const)) {
  @IsOptional() @IsUUID() breed_id?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() score?: number;
}

export class QueryBcsScaleDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsUUID() breedId?: string;
  @IsOptional() @Transform(rawBoolean) @IsBoolean() isActive?: boolean;
}
