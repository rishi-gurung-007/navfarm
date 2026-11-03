import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateSemenCollectorDto, QuerySemenCollectorDto, UpdateSemenCollectorDto } from './semen-collector.dto';
import { SemenCollectorService } from './semen-collector.service';

// A company master: the AI Station's collectors are not a farm's records.
@ApiTags('Semen Collector') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('semen-collector')
export class SemenCollectorController {
  constructor(private readonly collectors: SemenCollectorService) {}

  @Get() @RequirePermission('MASTER_DATA', 'SEMEN_COLLECTOR', 'view')
  async list(@Query() query: QuerySemenCollectorDto, @Req() req: any) {
    const page = await this.collectors.findAll(query, req.user.tenantId);
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }

  @Get(':id') @RequirePermission('MASTER_DATA', 'SEMEN_COLLECTOR', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.collectors.findOne(id, req.user.tenantId) }; }

  @Post() @RequirePermission('MASTER_DATA', 'SEMEN_COLLECTOR', 'create')
  async create(@Body() dto: CreateSemenCollectorDto, @Req() req: any) { return { data: await this.collectors.create(dto, req.user.tenantId, req.user) }; }

  @Put(':id') @RequirePermission('MASTER_DATA', 'SEMEN_COLLECTOR', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateSemenCollectorDto, @Req() req: any) { return { data: await this.collectors.update(id, dto, req.user.tenantId, req.user) }; }

  @Delete(':id') @RequirePermission('MASTER_DATA', 'SEMEN_COLLECTOR', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.collectors.setActive(id, false, req.user.tenantId, req.user) }; }

  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'SEMEN_COLLECTOR', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.collectors.setActive(id, true, req.user.tenantId, req.user) }; }
}
