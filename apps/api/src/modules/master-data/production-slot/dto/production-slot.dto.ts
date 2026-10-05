import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { MasterListQueryDto } from '../../../../common/master-list-query';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

export class CreateProductionSlotDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  company_id?: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  slot_code: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  slot_name: string;

  @ApiProperty({ example: '06:00' })
  @IsString()
  @Matches(TIME_PATTERN)
  start_time: string;

  @ApiProperty({ example: '14:00' })
  @IsString()
  @Matches(TIME_PATTERN)
  end_time: string;
}

export class UpdateProductionSlotDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  slot_name?: string;

  @IsString()
  @IsOptional()
  @Matches(TIME_PATTERN)
  start_time?: string;

  @IsString()
  @IsOptional()
  @Matches(TIME_PATTERN)
  end_time?: string;

  @IsBoolean()
  @IsOptional()
  is_active?: boolean;

  @IsString()
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class QueryProductionSlotDto extends MasterListQueryDto {
  @IsUUID()
  @IsOptional()
  companyId?: string;

  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
