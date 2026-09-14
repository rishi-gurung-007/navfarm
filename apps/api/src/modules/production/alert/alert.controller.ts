import { Controller, Get, Post, Param, Query, Body, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { QueryAlertDto, MarkAlertReadDto } from './dto/alert.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

// Alert visibility rides on the existing PRODUCTION/BATCH permission —
// alerts are just a KPI-monitoring view over batch daily entries, not a
// separately-grantable resource.
@ApiTags('KPI Alert Center')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('alert')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'List KPI deviation alerts matching filters' })
  async findAll(@Query() query: QueryAlertDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.alertService.findAll(query, tenantId);
    return { success: true, message: 'Alerts retrieved successfully.', data: result };
  }

  @Post(':id/read')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'Mark an alert as read/acknowledged' })
  @ApiParam({ name: 'id', description: 'Alert UUID' })
  async markRead(@Param('id') id: string, @Body() dto: MarkAlertReadDto, @Req() req: any) {
    const result = await this.alertService.markRead(id, dto.companyId, req.user);
    return { success: true, message: 'Alert marked as read.', data: result };
  }
}
