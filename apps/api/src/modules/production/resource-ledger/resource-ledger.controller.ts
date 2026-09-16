import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ResourceLedgerService } from './resource-ledger.service';
import { QueryResourceLedgerDto } from './dto/resource-ledger.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

// Read-only, exactly like the Inventory Ledger: rows are written by the posting
// that caused them (a Resource activity entry) and by its reversal, never by a
// create/update/delete endpoint here.
//
// Guarded by INVENTORY/LEDGER rather than a resource of its own: this is the
// same "may read the ledgers" right, and every seeded role that can read the
// Inventory Ledger already holds it. A dedicated RESOURCE_LEDGER resource is
// Rishi's call — noted in the handover.
@ApiTags('Resource Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('resource-ledger')
@FarmScoped()
export class ResourceLedgerController {
  constructor(private readonly resourceLedgerService: ResourceLedgerService) {}

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'List Resource Ledger entries matching filters (farm, resource, batch, date range)' })
  async findAll(@Query() query: QueryResourceLedgerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.resourceLedgerService.findAll(query, tenantId);
    return { success: true, message: 'Resource ledger entries retrieved successfully.', data };
  }
}
