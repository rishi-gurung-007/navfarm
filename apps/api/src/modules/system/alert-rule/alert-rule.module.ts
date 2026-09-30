import { Module } from '@nestjs/common';
import { AlertRuleController } from './alert-rule.controller';
import { AlertRuleService } from './alert-rule.service';

@Module({ controllers: [AlertRuleController], providers: [AlertRuleService], exports: [AlertRuleService] })
export class AlertRuleModule {}
