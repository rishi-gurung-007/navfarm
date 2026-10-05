import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CreateProductionSlotDto, QueryProductionSlotDto, UpdateProductionSlotDto } from './dto/production-slot.dto';
import { ProductionSlotService } from './production-slot.service';

@ApiTags('Production Slot Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('production-slot')
export class ProductionSlotController {
  constructor(private readonly slots: ProductionSlotService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'PRODUCTION_SLOT', 'view')
  async list(@Query() query: QueryProductionSlotDto, @Req() req: any) {
    return { data: await this.slots.findAll(query, req.user.tenantId) };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'PRODUCTION_SLOT', 'view')
  async get(@Param('id') id: string, @Req() req: any) {
    return { data: await this.slots.findOne(id, req.user.tenantId) };
  }

  @Post()
  @RequirePermission('MASTER_DATA', 'PRODUCTION_SLOT', 'create')
  async create(@Body() dto: CreateProductionSlotDto, @Req() req: any) {
    return { data: await this.slots.create(dto, req.user.tenantId, req.user) };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'PRODUCTION_SLOT', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateProductionSlotDto, @Req() req: any) {
    return { data: await this.slots.update(id, dto, req.user.tenantId, req.user) };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'PRODUCTION_SLOT', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    return { data: await this.slots.deactivate(id, req.user.tenantId, req.user) };
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'PRODUCTION_SLOT', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) {
    return { data: await this.slots.restore(id, req.user.tenantId, req.user) };
  }
}
