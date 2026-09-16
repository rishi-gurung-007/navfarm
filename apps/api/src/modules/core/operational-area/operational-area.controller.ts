import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { OperationalAreaService } from './operational-area.service';
import { CreateOperationalAreaDto, UpdateOperationalAreaDto, UpdateAreaSettingsDto, AssignAreaStaffDto } from './dto/operational-area.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@Controller('operational-area')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperationalAreaController {
  constructor(private readonly areaService: OperationalAreaService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'view')
  async findAll(@Query('company_id') companyId?: string) {
    return this.areaService.findAll(companyId);
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'view')
  async findOne(@Param('id') id: string) {
    return this.areaService.findOne(id);
  }

  @Post()
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'create')
  async create(@Body() dto: CreateOperationalAreaDto, @Req() req: any) {
    const userId = req.user?.sub;
    return this.areaService.create(dto, userId);
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateOperationalAreaDto, @Req() req: any) {
    const userId = req.user?.sub;
    return this.areaService.update(id, dto, userId);
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'delete')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.areaService.delete(id, req.user?.sub);
  }

  @Post('preseed-company/:companyId')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'create')
  async preseedCompany(@Param('companyId') companyId: string) {
    return this.areaService.preseedCompanyMasterDataFromTenant(companyId);
  }

  @Get(':id/settings')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'view')
  async getSettings(@Param('id') id: string) {
    return this.areaService.getSettings(id);
  }

  @Put(':id/settings')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'edit')
  async updateSettings(@Param('id') id: string, @Body() dto: UpdateAreaSettingsDto, @Req() req: any) {
    return this.areaService.updateSettings(id, dto, req.user?.sub);
  }

  @Get(':id/staff')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'view')
  async listStaff(@Param('id') id: string) {
    return this.areaService.listStaff(id);
  }

  @Post(':id/staff')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'edit')
  async addStaff(@Param('id') id: string, @Body() dto: AssignAreaStaffDto) {
    return this.areaService.addStaff(id, dto);
  }

  @Delete(':id/staff/:userId')
  @RequirePermission('MASTER_DATA', 'OPERATIONAL_AREA', 'edit')
  async removeStaff(@Param('id') id: string, @Param('userId') userId: string) {
    return this.areaService.removeStaff(id, userId);
  }
}
