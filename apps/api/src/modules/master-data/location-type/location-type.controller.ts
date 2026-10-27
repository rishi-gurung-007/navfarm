import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CreateLocationTypeDto, QueryLocationTypeDto, UpdateLocationTypeDto } from './dto/location-type.dto';
import { LocationTypeService } from './location-type.service';

@ApiTags('Location Type Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('location-type')
export class LocationTypeController {
  constructor(private readonly service: LocationTypeService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'LOCATION', 'create')
  async create(@Body() dto: CreateLocationTypeDto, @Req() req: any) {
    return { success: true, data: await this.service.create(dto, req.user?.tenantId || req.tenantId, req.user) };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'LOCATION', 'view')
  async findAll(@Query() query: QueryLocationTypeDto, @Req() req: any) {
    const page = await this.service.findAll(query, req.user?.tenantId || req.tenantId);
    return { success: true, data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'view')
  async findOne(@Param('id') id: string, @Req() req: any) {
    return { success: true, data: await this.service.findOne(id, req.user?.tenantId || req.tenantId) };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateLocationTypeDto, @Req() req: any) {
    return { success: true, data: await this.service.update(id, dto, req.user?.tenantId || req.tenantId, req.user) };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'delete')
  async remove(@Param('id') id: string, @Req() req: any) { return this.service.remove(id, req.user?.tenantId || req.tenantId, req.user); }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) {
    return { success: true, data: await this.service.restore(id, req.user?.tenantId || req.tenantId, req.user) };
  }
}
