import { Module } from '@nestjs/common';
import { GlPostingGroupController } from './gl-posting-group.controller';
import { GlPostingGroupService } from './gl-posting-group.service';

@Module({ controllers: [GlPostingGroupController], providers: [GlPostingGroupService], exports: [GlPostingGroupService] })
export class GlPostingGroupModule {}
