import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * A health event that the schedule did not call for.
 *
 * A sick animal at 2am is not going to wait for a schedule to be redesigned,
 * so the worker records it there and then. What waits for approval is the
 * stock movement and the cost, not the observation — the record exists the
 * moment it is raised, as a pending request anyone can see.
 *
 * Only health. A worker cannot invent a feed or overhead line this way: those
 * are the batch's cost and they come from the schedule, which is the whole
 * point of having one.
 */
export class CreateUnscheduledHealthDto {
  @ApiProperty({ description: 'Date the event happened, YYYY-MM-DD' })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({ description: 'What was observed — "Lame gilt, pen 4"' })
  @IsString()
  @IsNotEmpty()
  observation: string;

  @ApiProperty({ required: false, description: 'Stage the animal is in, when known' })
  @IsOptional()
  @IsUUID()
  stage_id?: string;

  @ApiProperty({ required: false, description: 'Suspected or confirmed disease, from Disease Master' })
  @IsOptional()
  @IsUUID()
  disease_id?: string;

  @ApiProperty({ required: false, description: 'Medicine given, from Item Master. Its cost posts on approval.' })
  @IsOptional()
  @IsUUID()
  item_id?: string;

  @ApiProperty({ required: false, description: 'Dose given, in the item\'s stock UOM' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiProperty({ required: false, description: 'Head treated' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  animals_affected?: number;

  @ApiProperty({ required: false, enum: ['HIGH', 'MEDIUM', 'LOW'] })
  @IsOptional()
  @IsIn(['HIGH', 'MEDIUM', 'LOW'])
  urgency?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class RejectUnscheduledHealthDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  rejection_reason?: string;
}
