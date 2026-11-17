import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { BudgetService } from './budget.service';
import { BudgetListQueryDto } from './budget-list-query.dto';

export { BudgetListQueryDto };

/**
 * GM Dashboard Budget master under /piggery/budget, guarded by module PIGGERY, resource BUDGET. Lines belong to a
 * farm, so the controller is farm-scoped; the service names every problem in plain words.
 */
@ApiTags('Piggery Budget') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('piggery/budget')
export class BudgetController {
  constructor(private readonly budgets: BudgetService) {}

  @Get() @RequirePermission('PIGGERY', 'BUDGET', 'view')
  list(@Query() query: BudgetListQueryDto, @Req() req: any) {
    return this.budgets.findAll(query, req.user.tenantId);
  }

  /** Declared before ':id' so "metrics" is not read as a budget id. */
  @Get('metrics') @RequirePermission('PIGGERY', 'BUDGET', 'view')
  metrics() {
    return { data: this.budgets.metrics() };
  }

  @Get(':id') @RequirePermission('PIGGERY', 'BUDGET', 'view')
  async get(@Param('id') id: string, @Req() req: any) {
    return { data: await this.budgets.findOne(id, req.user.tenantId) };
  }

  @Post() @RequirePermission('PIGGERY', 'BUDGET', 'create')
  async create(@Body() body: Record<string, unknown>, @Req() req: any) {
    return { data: await this.budgets.create(body, req.user.tenantId, req.user) };
  }

  @Put(':id') @RequirePermission('PIGGERY', 'BUDGET', 'edit')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: any) {
    return { data: await this.budgets.update(id, body, req.user.tenantId, req.user) };
  }

  @Delete(':id') @RequirePermission('PIGGERY', 'BUDGET', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) {
    return { data: await this.budgets.deactivate(id, req.user.tenantId, req.user) };
  }

  @Patch(':id/restore') @RequirePermission('PIGGERY', 'BUDGET', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) {
    return { data: await this.budgets.restore(id, req.user.tenantId, req.user) };
  }
}
