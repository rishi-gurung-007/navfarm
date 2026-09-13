import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsUUID, IsNumber, IsDateString } from 'class-validator';

export class CreateBatchDailyDataDto {
  @ApiProperty({ description: 'scheduler_line UUID this entry answers' })
  @IsUUID()
  @IsNotEmpty()
  line_id: string;

  @ApiProperty({ example: '2026-09-08' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({ description: 'Numeric value — quantity for CONSUMPTION/OUTPUT/OVERHEAD/RESOURCE, the measured value for DESCRIPTIVE', required: false })
  @IsOptional()
  @IsNumber()
  entered_value?: number;

  @ApiProperty({ description: 'Free-text value, for a non-numeric DESCRIPTIVE capture', required: false })
  @IsOptional()
  @IsString()
  entered_text?: string;

  @ApiProperty({ description: 'Lot number — required when the line has lot_required', required: false })
  @IsOptional()
  @IsString()
  lot_no?: string;

  @ApiProperty({ description: 'Overrides the line default rate for OVERHEAD/RESOURCE lines (cost per unit)', required: false })
  @IsOptional()
  @IsNumber()
  rate?: number;

  @ApiProperty({ description: 'TRANSFER only — the batch this entry moves animals/stock into', required: false })
  @IsOptional()
  @IsUUID()
  destination_batch_id?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}
