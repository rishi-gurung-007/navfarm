import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class CreateMillOutputDto {
  @ApiPropertyOptional({ description: 'Company UUID — taken from the workspace when it has one' })
  @IsOptional()
  @IsUUID()
  company_id?: string;

  @ApiProperty({ example: '2026-10-20' })
  @IsDateString()
  @IsNotEmpty()
  production_date: string;

  @ApiProperty({ description: "The BIN Diet Assignment produced into — it names the BIN and the feed item for the date" })
  @IsUUID()
  @IsNotEmpty()
  assignment_id: string;

  @ApiProperty({ example: 12000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  quantity_kg: number;

  @ApiPropertyOptional({ description: 'Lot number, for a lot-tracked feed item without a tracking number series' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  lot_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class QueryMillOutputDto {
  @ApiPropertyOptional({ description: 'Company UUID — taken from the workspace when it has one' })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiPropertyOptional({ description: 'Production date (the assignments of that day; outputs of that day)' })
  @IsOptional()
  @IsDateString()
  productionDate?: string;
}
