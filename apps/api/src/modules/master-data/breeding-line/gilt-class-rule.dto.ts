import { OmitType, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';
import { rawBoolean } from './raw-boolean';

export class CreateGiltClassRuleDto {
  @IsOptional() @IsUUID() company_id?: string;
  @IsOptional() @IsString() nob_id?: string;
  @IsOptional() @IsString() lob_id?: string;
  /** The dam's line (a breed). */
  @IsUUID() dam_breed_id!: string;
  /** The sire's line (a breed). */
  @IsUUID() sire_breed_id!: string;
  /** The item a gilt of this parentage is registered as: it carries her class's accounts and costing terms. */
  @IsUUID() gilt_item_id!: string;
}

/** A rule's parents are its identity; only the item it gives can change. */
export class UpdateGiltClassRuleDto extends PartialType(OmitType(CreateGiltClassRuleDto, ['company_id', 'dam_breed_id', 'sire_breed_id'] as const)) {
  @IsOptional() @IsUUID() dam_breed_id?: string;
  @IsOptional() @IsUUID() sire_breed_id?: string;
}

export class QueryGiltClassRuleDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @Transform(rawBoolean) @IsBoolean() isActive?: boolean;
}
