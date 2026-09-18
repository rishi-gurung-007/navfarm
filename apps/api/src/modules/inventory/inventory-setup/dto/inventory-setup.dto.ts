import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class NumberingFieldConfigDto {
  @ApiProperty({ description: 'Whether number series is applied / active for this master entity', example: true })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({ description: 'ID of the default No. Series for this master entity', example: 'uuid', nullable: true })
  @IsOptional()
  @IsString()
  default_series_id?: string | null;
}

export class UpdateInventorySetupDto {
  @ApiProperty({ description: 'Target company ID', example: 'uuid' })
  @IsString()
  @IsNotEmpty()
  company_id: string;

  @ApiProperty({
    description: 'Map of master entity code to numbering configuration',
    example: {
      ITEM: { enabled: true, default_series_id: 'series-uuid-1' },
      SUPPLIER: { enabled: true, default_series_id: 'series-uuid-2' },
      LOCATION: { enabled: false, default_series_id: null },
    },
  })
  @IsOptional()
  @IsObject()
  numbering_config?: Record<string, NumberingFieldConfigDto>;

  @ApiProperty({
    description: 'General inventory control and posting policies',
    required: false,
  })
  @IsOptional()
  @IsObject()
  general_config?: Record<string, any>;
}
