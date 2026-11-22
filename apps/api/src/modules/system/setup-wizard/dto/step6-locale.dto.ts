import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Step 6 body: the timezone id has slashes (Asia/Kolkata), so it travels in the body, not the URL path. */
export class Step6LocaleDto {
  @ApiProperty({ example: 'Africa/Harare', description: 'IANA timezone identifier' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  timezone_id: string;

  @ApiProperty({ example: 'ZWE', description: 'Operating country code' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country_id: string;
}
