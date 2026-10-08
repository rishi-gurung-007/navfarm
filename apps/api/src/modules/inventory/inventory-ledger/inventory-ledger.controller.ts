import { Controller, Get, Param, Query, Req, Res, UseGuards, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryLedgerService } from './inventory-ledger.service';
import { ExportInventoryLedgerDto, QueryInventoryLedgerDto, QueryStockBalanceDto, QueryAvailableLotsDto, QueryAvailableSerialsDto } from './dto/inventory-ledger.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { ledgerRowsToCsv, ledgerRowsToXlsx } from './inventory-ledger-export';

// Read-only: ledger rows are only ever written internally by document
// posting (Goods Receipt now; Issue/Transfer/Adjustment later), never via a
// direct create/update/delete endpoint here.
@ApiTags('Inventory Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory-ledger')
@FarmScoped()
export class InventoryLedgerController {
  constructor(private readonly ledgerService: InventoryLedgerService) {}

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'List Inventory Ledger entries matching filters' })
  async findAll(@Query() query: QueryInventoryLedgerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.ledgerService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Inventory ledger entries retrieved successfully.',
      data: result,
    };
  }

  @Get('export')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Download every Inventory Ledger entry matching the filters as an Excel (.xlsx) or CSV file' })
  async export(@Query() query: ExportInventoryLedgerDto, @Req() req: any, @Res() res: Response) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const { rows, truncated } = await this.ledgerService.findAllForExport(query, tenantId);
    const format = query.format === 'csv' ? 'csv' : 'xlsx';
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `inventory-ledger-entries-${stamp}.${format}`;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Row-Count, X-Export-Truncated');
    res.setHeader('X-Export-Row-Count', String(rows.length));
    res.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(ledgerRowsToCsv(rows));
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(await ledgerRowsToXlsx(rows));
  }

  @Get('balance')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Current on-hand stock quantity/value per item and location (FIFO layers summed)' })
  async getBalance(@Query() query: QueryStockBalanceDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.ledgerService.getStockBalance(query, tenantId);
    return {
      success: true,
      message: 'Stock balance retrieved successfully.',
      data: result,
    };
  }

  @Get('available-lots')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'List available lot numbers with remaining stock for an item and location (FIFO/expiry sorted)' })
  async getAvailableLots(@Query() query: QueryAvailableLotsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.ledgerService.getAvailableLots(query, tenantId);
    return {
      success: true,
      message: 'Available lots retrieved successfully.',
      data: result,
    };
  }

  @Get('available-serials')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'List available serial numbers with remaining stock for an item and location' })
  async getAvailableSerials(@Query() query: QueryAvailableSerialsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.ledgerService.getAvailableSerials(query, tenantId);
    return {
      success: true,
      message: 'Available serials retrieved successfully.',
      data: result,
    };
  }

  @Get('item-history/:itemId')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Get complete purchase and consumption ledger history for an item' })
  async getItemHistory(
    @Param('itemId') itemId: string,
    @Query('companyId') companyId: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const activeCompanyId = companyId || req.user?.companyId;
    const result = await this.ledgerService.getItemLedgerHistory(itemId, activeCompanyId, tenantId);
    return {
      success: true,
      message: 'Inventory ledger history retrieved successfully.',
      data: result,
    };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Get details of a specific inventory ledger entry including FIFO applications' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.ledgerService.findOneWithDetails(id, tenantId);
    if (!result) {
      throw new NotFoundException(`Inventory ledger entry '${id}' not found.`);
    }
    return {
      success: true,
      message: 'Inventory ledger entry retrieved successfully.',
      data: result,
    };
  }
}

