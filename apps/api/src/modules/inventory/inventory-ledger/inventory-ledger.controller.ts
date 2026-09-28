import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryLedgerService } from './inventory-ledger.service';
import { QueryInventoryLedgerDto, QueryStockBalanceDto, QueryAvailableLotsDto, QueryAvailableSerialsDto } from './dto/inventory-ledger.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

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

  @Get('balance')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Current on-hand stock quantity/value per item and warehouse (FIFO layers summed)' })
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
  @ApiOperation({ summary: 'List available lot numbers with remaining stock for an item and warehouse (FIFO/expiry sorted)' })
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
  @ApiOperation({ summary: 'List available serial numbers with remaining stock for an item and warehouse' })
  async getAvailableSerials(@Query() query: QueryAvailableSerialsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.ledgerService.getAvailableSerials(query, tenantId);
    return {
      success: true,
      message: 'Available serials retrieved successfully.',
      data: result,
    };
  }
}

