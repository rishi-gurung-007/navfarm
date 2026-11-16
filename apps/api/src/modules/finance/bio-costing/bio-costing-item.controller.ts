import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { BioCostingItemService } from './bio-costing-item.service';
import { CreateItemFairValueRateDto } from './bio-costing-item.dto';

/** The costing inputs a biological item carries outside its own columns (the Bio Asset Costing tab). Finance setup, so it uses the GL mappings' permission. */
@ApiTags('Bio-Asset Costing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bio-costing/items')
export class BioCostingItemController {
  constructor(private readonly items: BioCostingItemService) {}

  private tenant = (req: any): string => req.user?.tenantId || req['tenantId'];

  @Get(':itemId/rates')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'view')
  @ApiOperation({ summary: 'The dated fair-value rates of a biological item, latest first' })
  async rates(@Param('itemId') itemId: string, @Req() req: any) {
    return { success: true, data: await this.items.listRates(itemId, this.tenant(req)) };
  }

  @Post(':itemId/rates')
  @RequirePermission('MASTER_DATA', 'GL_MAPPING', 'edit')
  @ApiOperation({ summary: 'Add a dated fair-value rate (expected weight and price per kg) to an item costed by fair value; rates are never edited or locked' })
  async addRate(@Param('itemId') itemId: string, @Body() dto: CreateItemFairValueRateDto, @Req() req: any) {
    return { success: true, message: 'Rate added.', data: await this.items.addRate(itemId, dto, this.tenant(req), req.user?.userId) };
  }
}
