import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ItemQcSpecService } from './item-qc-spec.service';
import { ReplaceItemQcSpecDto } from '../../inventory/qc-inspection/dto/qc-inspection.dto';

@ApiTags('Item QC Specification')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('item-qc-spec')
export class ItemQcSpecController {
  constructor(private readonly service: ItemQcSpecService) {}

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'The QC checks on an item' })
  async list(@Query('item_id', new ParseUUIDPipe()) itemId: string) {
    const data = await this.service.list(itemId);
    return { success: true, message: 'QC specification retrieved.', data };
  }

  @Put('item/:itemId')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Replace the QC checks on an item' })
  async replace(@Param('itemId', new ParseUUIDPipe()) itemId: string, @Body() dto: ReplaceItemQcSpecDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.replace(itemId, dto, tenantId, req.user);
    return { success: true, message: 'QC specification saved.', data };
  }
}
