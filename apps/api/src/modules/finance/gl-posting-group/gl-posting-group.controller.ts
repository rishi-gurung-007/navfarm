import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GlPostingGroupService } from './gl-posting-group.service';
import { CreateGlPostingGroupDto, QueryGlPostingGroupDto, UpdateGlPostingGroupDto } from './dto/gl-posting-group.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

// Permissions are those of GL Mapping: whoever sets up the GL sets up the groups.
@ApiTags('G/L Posting Group')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gl-posting-group')
export class GlPostingGroupController {
  constructor(private readonly service: GlPostingGroupService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'create')
  @ApiOperation({ summary: 'Create a posting group' })
  async create(@Body() dto: CreateGlPostingGroupDto, @Req() req: any) {
    const data = await this.service.create(dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Posting group created.', data };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  @ApiOperation({ summary: 'List posting groups with the items that use each' })
  async findAll(@Query() query: QueryGlPostingGroupDto, @Req() req: any) {
    const r = await this.service.findAll(query, req.user?.tenantId || req['tenantId']);
    return { success: true, message: 'Posting groups retrieved.', data: r.data, total: r.total, limit: r.limit, offset: r.offset };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  @ApiOperation({ summary: 'One posting group, its accounts and its items' })
  async findOne(@Param('id') id: string) {
    return { success: true, message: 'Posting group retrieved.', data: await this.service.findOneDetailed(id) };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Change a posting group; its items take the new accounts' })
  async update(@Param('id') id: string, @Body() dto: UpdateGlPostingGroupDto, @Req() req: any) {
    const data = await this.service.update(id, dto, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Posting group updated.', data };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'delete')
  @ApiOperation({ summary: 'Retire a posting group no item uses' })
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.service.remove(id, req.user?.tenantId || req['tenantId'], req.user);
    return { success: true, message: 'Posting group retired.' };
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Bring a retired posting group back' })
  async restore(@Param('id') id: string, @Req() req: any) {
    return { success: true, message: 'Posting group restored.', data: await this.service.restore(id, req.user?.tenantId || req['tenantId'], req.user) };
  }
}
