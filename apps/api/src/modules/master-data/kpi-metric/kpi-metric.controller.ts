import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateKpiMetricDto, QueryKpiMetricDto, UpdateKpiMetricDto } from './kpi-metric.dto';
import { KpiMetricService } from './kpi-metric.service';

@ApiTags('KPI Metric Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('kpi-metric')
export class KpiMetricController {
  constructor(private readonly kpiMetrics: KpiMetricService) {}
  @Get() @RequirePermission('MASTER_DATA', 'KPI_METRIC', 'view')
  async list(@Query() query: QueryKpiMetricDto, @Req() req: any) { return { data: await this.kpiMetrics.findAll(query, req.user.tenantId) }; }
  @Get(':id') @RequirePermission('MASTER_DATA', 'KPI_METRIC', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.kpiMetrics.findOne(id, req.user.tenantId) }; }
  @Post() @RequirePermission('MASTER_DATA', 'KPI_METRIC', 'create')
  async create(@Body() dto: CreateKpiMetricDto, @Req() req: any) { return { data: await this.kpiMetrics.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('MASTER_DATA', 'KPI_METRIC', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateKpiMetricDto, @Req() req: any) { return { data: await this.kpiMetrics.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('MASTER_DATA', 'KPI_METRIC', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.kpiMetrics.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'KPI_METRIC', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.kpiMetrics.setActive(id, true, req.user.tenantId, req.user) }; }
}
