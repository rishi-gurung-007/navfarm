import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';

export class QuerySemenRequestDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() breed_id?: string;
  @ApiPropertyOptional({ description: 'OPEN (default): approved, not cancelled, not fully received. ALL: every semen request.' })
  @IsOptional() @IsIn(['OPEN', 'ALL']) status?: string;
}

export class AllocateSemenLotDto {
  @ApiProperty({ description: 'The collected lot (semen_batch_id), clear of QC' }) @IsUUID() semen_batch_id: string;
  @ApiPropertyOptional({ description: "The request lines to allocate it to. Default: the requests linked to the lot's collection plan.", type: [String] })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) requisition_line_ids?: string[];
}
