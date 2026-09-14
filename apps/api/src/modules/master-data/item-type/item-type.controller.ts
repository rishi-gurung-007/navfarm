import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  Patch
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ItemTypeService } from './item-type.service';
import { CreateItemTypeDto, UpdateItemTypeDto, QueryItemTypeDto } from './dto/item-type.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Item Type Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('item-type')
export class ItemTypeController {
  constructor(private readonly itemTypeService: ItemTypeService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM_TYPE', 'create')
  @ApiOperation({ summary: 'Register a new Item Type' })
  async create(@Body() dto: CreateItemTypeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemTypeService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item type registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM_TYPE', 'view')
  @ApiOperation({ summary: 'List all Item Types matching filters' })
  async findAll(@Query() query: QueryItemTypeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemTypeService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Item types retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_TYPE', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Item Type by UUID' })
  @ApiParam({ name: 'id', description: 'Item Type UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.itemTypeService.findOne(id);
    return {
      success: true,
      message: 'Item type details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_TYPE', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Item Type' })
  @ApiParam({ name: 'id', description: 'Item Type UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateItemTypeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemTypeService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item type updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_TYPE', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) an Item Type' })
  @ApiParam({ name: 'id', description: 'Item Type UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemTypeService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'ITEM_TYPE', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Item Type' })
  @ApiParam({ name: 'id', description: 'Item Type UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemTypeService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Item type restored successfully.',
      data: result
    };
  }
}
