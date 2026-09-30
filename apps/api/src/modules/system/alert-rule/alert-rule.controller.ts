import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AlertRuleService } from './alert-rule.service';
import { CreateAlertRuleDto, QueryAlertRuleDto, UpdateAlertRuleDto } from './alert-rule.dto';

// A company master (Master Setup §4). A rule's farm_id is a filter on which
// farms it applies to, not an access boundary — exempt from farm scope.
@ApiTags('Alerts and Notifications Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alert-rule')
export class AlertRuleController {
  constructor(private readonly rules: AlertRuleService) {}
  @Get() @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'view')
  async list(@Query() query: QueryAlertRuleDto, @Req() req: any) { return { data: await this.rules.findAll(query, req.user.tenantId) }; }
  @Get(':id') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.findOne(id, req.user.tenantId) }; }
  @Post() @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'create')
  async create(@Body() dto: CreateAlertRuleDto, @Req() req: any) { return { data: await this.rules.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateAlertRuleDto, @Req() req: any) { return { data: await this.rules.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('NOTIFICATION', 'ALERT_RULE', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.rules.setActive(id, true, req.user.tenantId, req.user) }; }
}
