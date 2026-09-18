import {
  Controller,
  Get,
  Put,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InventorySetupService } from './inventory-setup.service';
import { UpdateInventorySetupDto } from './dto/inventory-setup.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Inventory Setup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory-setup')
export class InventorySetupController {
  constructor(private readonly inventorySetupService: InventorySetupService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'Get Inventory Setup for active company' })
  async getSetup(@Query('companyId') queryCompanyId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = queryCompanyId || req.headers?.['x-active-company-id'] || req.user?.companyId;

    if (!companyId) {
      throw new BadRequestException('Active company ID is required to fetch Inventory Setup.');
    }

    const result = await this.inventorySetupService.getSetup(tenantId, companyId);
    return {
      success: true,
      message: 'Inventory Setup retrieved successfully.',
      data: result,
    };
  }

  @Put()
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Update Inventory Setup for company' })
  async updateSetup(@Body() dto: UpdateInventorySetupDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = dto.company_id || req.headers?.['x-active-company-id'] || req.user?.companyId;

    if (!companyId) {
      throw new BadRequestException('Active company ID is required to update Inventory Setup.');
    }

    const result = await this.inventorySetupService.updateSetup(tenantId, companyId, dto);
    return {
      success: true,
      message: 'Inventory Setup saved successfully.',
      data: result,
    };
  }
}
