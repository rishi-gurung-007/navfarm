import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ReportingPeriodService } from './reporting-period.service';
import { CreateReportingPeriodDto, GenerateReportingPeriodsDto, QueryReportingPeriodDto, UpdateReportingPeriodDto } from './reporting-period.dto';

// A company master (spec D20). Periods are company-wide, not a farm's — exempt from farm scope.
@ApiTags('Reporting Period Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reporting-period')
export class ReportingPeriodController {
  constructor(private readonly periods: ReportingPeriodService) {}
  @Get() @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'view')
  async list(@Query() query: QueryReportingPeriodDto, @Req() req: any) { return { data: await this.periods.findAll(query, req.user.tenantId) }; }
  @Get(':id') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.findOne(id, req.user.tenantId) }; }
  @Post('generate') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'create')
  async generate(@Body() dto: GenerateReportingPeriodsDto, @Req() req: any) { return { data: await this.periods.generate(dto, req.user.tenantId, req.user) }; }
  @Post() @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'create')
  async create(@Body() dto: CreateReportingPeriodDto, @Req() req: any) { return { data: await this.periods.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateReportingPeriodDto, @Req() req: any) { return { data: await this.periods.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/activate') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'edit')
  async activate(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.activate(id, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.activate(id, req.user.tenantId, req.user) }; }
}
