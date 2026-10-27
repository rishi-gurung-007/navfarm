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
import { SupplierService } from './supplier.service';
import { CreateSupplierDto, UpdateSupplierDto, QuerySupplierDto } from './dto/supplier.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Supplier Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('supplier')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'create')
  @ApiOperation({ summary: 'Register a new Supplier' })
  async create(@Body() dto: CreateSupplierDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.supplierService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Supplier registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'view')
  @ApiOperation({ summary: 'List all Suppliers matching filters' })
  async findAll(@Query() query: QuerySupplierDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.supplierService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Suppliers retrieved successfully.',
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Supplier by UUID' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.supplierService.findOne(id);
    return {
      success: true,
      message: 'Supplier details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Supplier' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateSupplierDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.supplierService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Supplier updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Supplier profile' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.supplierService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Supplier profile' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.supplierService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Supplier restored successfully.',
      data: result
    };
  }

  @Patch(':id/approve')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'approve')
  @ApiOperation({ summary: 'Approve a Supplier — required before it can be used on a PO/GRN' })
  @ApiParam({ name: 'id', description: 'Supplier UUID' })
  async approve(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.supplierService.approve(id, tenantId, req.user);
    return {
      success: true,
      message: 'Supplier approved successfully.',
      data: result
    };
  }
}
