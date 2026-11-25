import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every filter is optional; together they narrow both the requests and the lots. */
export class AiStationDashboardQueryDto {
  @ApiPropertyOptional({ description: 'From (needed-by date of a request, collection date of a lot)' }) @IsOptional() @Matches(DATE) from_date?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to_date?: string;
  @ApiPropertyOptional({ description: "The AI Station's farm: where the semen is collected and sent from" }) @IsOptional() @IsUUID() collection_farm_id?: string;
  @ApiPropertyOptional({ description: 'The farm that asked for it' }) @IsOptional() @IsUUID() farm_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() breed_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() boar_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) lot_no?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() item_id?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'IN_PROGRESS', 'RECEIVED', 'CANCELLED'] }) @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RECEIVED', 'CANCELLED']) request_status?: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'PASSED', 'FAILED', 'NONE'], description: "The lot's collection QC" }) @IsOptional() @IsIn(['PENDING', 'PASSED', 'FAILED', 'NONE']) qc_state?: string;
}
