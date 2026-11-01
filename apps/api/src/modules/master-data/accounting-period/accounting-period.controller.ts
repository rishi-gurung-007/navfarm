import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { AccountingPeriodService } from './accounting-period.service';
import { CreateAccountingPeriodDto, QueryAccountingPeriodDto, UpdateAccountingPeriodDto } from './accounting-period.dto';

// A company master, like the Reporting Period Master: periods are company-wide, not a farm's.
@ApiTags('Accounting Period Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting-period')
export class AccountingPeriodController {
  constructor(private readonly periods: AccountingPeriodService) {}
  @Get() @RequirePermission('MASTER_DATA', 'ACCOUNTING_PERIOD', 'view')
  async list(@Query() query: QueryAccountingPeriodDto, @Req() req: any) {
    const page = await this.periods.findAll(query, req.user.tenantId);
    return { data: page.data, total: page.total, limit: page.limit, offset: page.offset };
  }
  @Get(':id') @RequirePermission('MASTER_DATA', 'ACCOUNTING_PERIOD', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.findOne(id, req.user.tenantId) }; }
  @Post() @RequirePermission('MASTER_DATA', 'ACCOUNTING_PERIOD', 'create')
  async create(@Body() dto: CreateAccountingPeriodDto, @Req() req: any) { return { data: await this.periods.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('MASTER_DATA', 'ACCOUNTING_PERIOD', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateAccountingPeriodDto, @Req() req: any) { return { data: await this.periods.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('MASTER_DATA', 'ACCOUNTING_PERIOD', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'ACCOUNTING_PERIOD', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.setActive(id, true, req.user.tenantId, req.user) }; }
}
