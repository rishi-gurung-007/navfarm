import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class AssignBioCostingDto {
  @ApiPropertyOptional({ description: 'Defaults to every live animal of the company that has no costing start date yet' })
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) animal_ids?: string[];
  @ApiPropertyOptional({ description: 'Report what would be dated and write nothing' }) @IsOptional() @IsBoolean() dry_run?: boolean;
}
