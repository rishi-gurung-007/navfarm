import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsString, IsInt, Min, IsBoolean, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class MarkAlertReadDto {
  @ApiProperty({ description: 'Company UUID the alert belongs to' })
  @IsUUID()
  @IsNotEmpty()
  companyId: string;
}

export class QueryAlertDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  // D24: the Alerts page filters by farm; a batch alert reaches a farm through its batch.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ required: false, enum: ['WARNING', 'CRITICAL'] })
  @IsOptional()
  @IsString()
  severity?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isRead?: boolean;

  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
