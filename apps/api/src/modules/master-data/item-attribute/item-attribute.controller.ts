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
  Patch,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ItemAttributeService } from './item-attribute.service';
import { CreateItemAttributeDto, UpdateItemAttributeDto, QueryItemAttributeDto } from './dto/item-attribute.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Item Attribute Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('item-attribute')
export class ItemAttributeController {
  constructor(private readonly itemAttributeService: ItemAttributeService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM_ATTRIBUTE', 'create')
  @ApiOperation({ summary: 'Define a new item attribute (e.g. Protein %, Colour)' })
  async create(@Body() dto: CreateItemAttributeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemAttributeService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item attribute created successfully.',
      data: result,
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM_ATTRIBUTE', 'view')
  @ApiOperation({ summary: 'List item attributes matching filters' })
  async findAll(@Query() query: QueryItemAttributeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemAttributeService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Item attributes retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_ATTRIBUTE', 'view')
  @ApiOperation({ summary: 'Fetch a single item attribute by UUID' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.itemAttributeService.findOne(id);
    return {
      success: true,
      message: 'Item attribute details retrieved.',
      data: result,
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_ATTRIBUTE', 'edit')
  @ApiOperation({ summary: 'Update an existing item attribute' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateItemAttributeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemAttributeService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item attribute updated successfully.',
      data: result,
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM_ATTRIBUTE', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) an item attribute' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.itemAttributeService.remove(id, tenantId, req.user);
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'ITEM_ATTRIBUTE', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted item attribute' })
  @ApiParam({ name: 'id', description: 'Attribute UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemAttributeService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Item attribute restored successfully.',
      data: result,
    };
  }
}
