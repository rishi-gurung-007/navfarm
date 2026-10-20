import { Module } from '@nestjs/common';
import { BioCostingProfileController } from './bio-costing-profile.controller';
import { BioCostingProfileService } from './bio-costing-profile.service';

@Module({ controllers: [BioCostingProfileController], providers: [BioCostingProfileService], exports: [BioCostingProfileService] })
export class BioCostingModule {}
