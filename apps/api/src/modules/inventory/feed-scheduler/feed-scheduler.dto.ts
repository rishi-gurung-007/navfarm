import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class RunFeedJobDto {
  @ApiPropertyOptional({ description: 'Only this company\'s farms' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ description: 'Only this farm' }) @IsOptional() @IsUUID() farmId?: string;
}

export class QueryFeedRunsDto {
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}
