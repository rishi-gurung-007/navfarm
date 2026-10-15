import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ExpenseService } from './expense.service';
import { CreateExpenseDocumentDto, CreateExpenseBodyDto, QueryExpenseDocumentDto } from './dto/expense.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Expense Documents')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('expense-documents')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Post('expense')
  @RequirePermission('FINANCE', 'EXPENSE', 'create')
  @ApiOperation({ summary: 'Create an Expense and post its journal' })
  async createExpense(@Body() dto: CreateExpenseBodyDto, @Req() req: any) {
    return this.create({ ...dto, doc_type: 'EXPENSE' }, req);
  }

  private async create(dto: CreateExpenseDocumentDto, req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.expenseService.create(dto, tenantId, req.user);
    return { success: true, message: 'Saved.', data };
  }

  @Get('locations')
  @RequirePermission('FINANCE', 'EXPENSE', 'view')
  @ApiOperation({ summary: 'Farms and sheds for the Location and Sub-Location dropdowns' })
  async locations(@Query('companyId') companyId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Retrieved.', data: await this.expenseService.locations(companyId, tenantId) };
  }

  @Get('expense')
  @RequirePermission('FINANCE', 'EXPENSE', 'view')
  async listExpenses(@Query() query: QueryExpenseDocumentDto, @Req() req: any) {
    return this.list({ ...query, doc_type: 'EXPENSE' }, req);
  }

  private async list(query: QueryExpenseDocumentDto, req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.expenseService.findAll(query, tenantId);
    return { success: true, message: 'Retrieved.', data };
  }
}
