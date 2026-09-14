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
import { CustomerService } from './customer.service';
import { CreateCustomerDto, UpdateCustomerDto, QueryCustomerDto } from './dto/customer.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Customer Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customer')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'CUSTOMER', 'create')
  @ApiOperation({ summary: 'Register a new Customer' })
  async create(@Body() dto: CreateCustomerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.customerService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Customer registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'CUSTOMER', 'view')
  @ApiOperation({ summary: 'List all Customers matching filters' })
  async findAll(@Query() query: QueryCustomerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.customerService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Customers retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'CUSTOMER', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Customer by UUID' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.customerService.findOne(id);
    return {
      success: true,
      message: 'Customer details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'CUSTOMER', 'edit')
  @ApiOperation({ summary: 'Update details of an existing Customer' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.customerService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Customer updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'CUSTOMER', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Customer profile' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.customerService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'CUSTOMER', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Customer profile' })
  @ApiParam({ name: 'id', description: 'Customer UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.customerService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Customer restored successfully.',
      data: result
    };
  }
}
