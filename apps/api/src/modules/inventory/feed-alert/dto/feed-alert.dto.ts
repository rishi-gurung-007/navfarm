import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

export class QueryFeedAlertDto {
  // Optional for the same reason as the forecast's: a farm-bound user has one farm (D13).
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'RESOLVED', 'ALL'] }) @IsOptional() @IsIn(['ACTIVE', 'RESOLVED', 'ALL']) status?: 'ACTIVE' | 'RESOLVED' | 'ALL';
}

export class EvaluateFeedAlertDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() farmId?: string;
}
