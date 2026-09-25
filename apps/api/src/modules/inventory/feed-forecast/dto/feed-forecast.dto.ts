import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class QueryFeedForecastDto {
  // Optional because a farm-bound user already has exactly one farm (spec
  // D13); tenant and company admins must name the farm they want to see.
  @ApiProperty({ description: 'Farm (top-level Location Master row) to forecast', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ description: 'First day shown (YYYY-MM-DD); defaults to today', required: false })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ description: 'Last day shown (YYYY-MM-DD); defaults to from + 7, at most from + 45', required: false })
  @IsOptional()
  @IsDateString()
  to?: string;
}
