import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { CreateBcsScaleDto, QueryBcsScaleDto, UpdateBcsScaleDto } from './bcs-scale.dto';
import { BcsScaleService } from './bcs-scale.service';

// A company master: the body condition scale is not a farm's records.
@ApiTags('Body Condition Scale') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bcs-scale')
export class BcsScaleController {
  constructor(private readonly scale: BcsScaleService) {}

  @Get() @RequirePermission('MASTER_DATA', 'BCS_SCALE', 'view')
  async list(@Query() query: QueryBcsScaleDto, @Req() req: any) {
    const page = await this.scale.findAll(query, req.user.tenantId);
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }

  @Get(':id') @RequirePermission('MASTER_DATA', 'BCS_SCALE', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.scale.findOne(id, req.user.tenantId) }; }

  @Post() @RequirePermission('MASTER_DATA', 'BCS_SCALE', 'create')
  async create(@Body() dto: CreateBcsScaleDto, @Req() req: any) { return { data: await this.scale.create(dto, req.user.tenantId, req.user) }; }

  @Put(':id') @RequirePermission('MASTER_DATA', 'BCS_SCALE', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateBcsScaleDto, @Req() req: any) { return { data: await this.scale.update(id, dto, req.user.tenantId, req.user) }; }

  @Delete(':id') @RequirePermission('MASTER_DATA', 'BCS_SCALE', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.scale.setActive(id, false, req.user.tenantId, req.user) }; }

  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'BCS_SCALE', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.scale.setActive(id, true, req.user.tenantId, req.user) }; }
}
