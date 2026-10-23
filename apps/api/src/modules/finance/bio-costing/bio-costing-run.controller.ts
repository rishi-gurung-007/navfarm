import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { BioCostingRunService } from './bio-costing-run.service';
import { BioCostingSchedulerService } from './bio-costing-scheduler.service';
import { CalculateBatchBioCostingRunDto, CalculateBioCostingRunDto, QueryBioCostingRunDto, ReverseBioCostingRunDto } from './bio-costing-run.dto';

/** Bio-asset costing runs: calculate a period, review the lines, post it, or reverse it. Finance posting, so it uses the journal permission. */
@ApiTags('Bio-Asset Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bio-costing/runs')
export class BioCostingRunController {
  constructor(private readonly runs: BioCostingRunService, private readonly scheduler: BioCostingSchedulerService) {}

  private tenant = (req: any): string => req.user?.tenantId || req['tenantId'];
  private company = (req: any): string => req.headers['x-active-company-id'] || req.user?.companyId;

  @Get()
  @RequirePermission('FINANCE', 'JOURNAL', 'view')
  async list(@Query() q: QueryBioCostingRunDto, @Req() req: any) {
    return { success: true, data: await this.runs.findAll(q, this.tenant(req), this.company(req)) };
  }

  @Get('due')
  @RequirePermission('FINANCE', 'JOURNAL', 'view')
  @ApiOperation({ summary: 'What is owed a run, per profile (finished periods not yet run), what is waiting to be posted, and what keeps failing' })
  async due(@Req() req: any) {
    return { success: true, data: await this.scheduler.dueReport(this.tenant(req), this.company(req)) };
  }

  @Post('run-due')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Run the scheduler\'s pass for this company now: calculate (and post, for profiles set to auto-post) whatever is due' })
  async runDue(@Req() req: any) {
    return { success: true, message: 'Due runs processed.', data: await this.scheduler.runDueForTenant(this.tenant(req), { companyId: this.company(req), trigger: 'MANUAL', userId: req.user?.userId }) };
  }

  @Get(':id')
  @RequirePermission('FINANCE', 'JOURNAL', 'view')
  async one(@Param('id') id: string, @Req() req: any) {
    return { success: true, data: await this.runs.findOne(id, this.tenant(req)) };
  }

  @Post('calculate')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Calculate a period for a profile: a preview of every animal\'s charge that posts nothing and can be repeated' })
  async calculate(@Body() dto: CalculateBioCostingRunDto, @Req() req: any) {
    return { success: true, message: 'Run calculated.', data: await this.runs.calculate(dto, this.tenant(req), req.user?.userId) };
  }

  @Post('calculate-batch')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Calculate a period for one batch: a run for each costing profile its animals carry, each restricted to the batch. Left without a batch, one whole-herd run per active profile' })
  async calculateBatch(@Body() dto: CalculateBatchBioCostingRunDto, @Req() req: any) {
    return { success: true, message: 'Runs calculated.', data: await this.runs.calculateBatch(dto, this.tenant(req), this.company(req), req.user?.userId) };
  }

  @Post(':id/post')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Post a calculated run: one ledger row per charged animal and one journal, reconciled before it commits' })
  async post(@Param('id') id: string, @Req() req: any) {
    return { success: true, message: 'Run posted.', data: await this.runs.post(id, this.tenant(req), req.user?.userId) };
  }

  @Post(':id/reverse')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Reverse the latest posted run of a profile: mirrored ledger rows and journal; the period can then be run again' })
  async reverse(@Param('id') id: string, @Body() dto: ReverseBioCostingRunDto, @Req() req: any) {
    return { success: true, message: 'Run reversed.', data: await this.runs.reverse(id, dto.reason, this.tenant(req), req.user?.userId) };
  }
}
