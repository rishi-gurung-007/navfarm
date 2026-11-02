import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class MonthlyOpsQueryDto {
  @ApiPropertyOptional({
    description: 'Company UUID — taken from the workspace when it has one',
  })
  @IsOptional()
  @IsUUID()
  companyId?: string;
  @ApiProperty({ description: 'The farm the report is for' })
  @IsUUID()
  farmId: string;
  @ApiProperty({
    description: 'Fiscal year from the Accounting Period Master, e.g. 2026-27',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  year: string;
}

export class MonthlyOpsYearsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
}
