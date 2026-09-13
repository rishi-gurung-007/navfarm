import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateActivityDto, QueryActivityDto, UpdateActivityDto } from './activity.dto';
import { ActivityService } from './activity.service';

@ApiTags('Activity Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly activities: ActivityService) {}
  @Get() @RequirePermission('MASTER_DATA', 'ACTIVITY', 'view')
  async list(@Query() query: QueryActivityDto, @Req() req: any) { return { data: await this.activities.findAll(query, req.user.tenantId) }; }
  @Get(':id') @RequirePermission('MASTER_DATA', 'ACTIVITY', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.activities.findOne(id, req.user.tenantId) }; }
  @Post() @RequirePermission('MASTER_DATA', 'ACTIVITY', 'create')
  async create(@Body() dto: CreateActivityDto, @Req() req: any) { return { data: await this.activities.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('MASTER_DATA', 'ACTIVITY', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateActivityDto, @Req() req: any) { return { data: await this.activities.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('MASTER_DATA', 'ACTIVITY', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.activities.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'ACTIVITY', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.activities.setActive(id, true, req.user.tenantId, req.user) }; }
}
