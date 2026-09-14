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
import { GlAccountService } from './gl-account.service';
import { CreateGlAccountDto, UpdateGlAccountDto, QueryGlAccountDto } from './dto/gl-account.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('G/L Account (Chart of Accounts)')
@ApiBearerAuth()
// Chart of Accounts (BBP-1 §1.6) places this catalog in Business Central. That integration is not built,
// so the catalog stays writable here and the frontend notice states the blueprint's
// position. Re-add a write guard when the BC sync endpoint lands.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gl-account')
export class GlAccountController {
  constructor(private readonly glAccountService: GlAccountService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'GL_ACCOUNT', 'create')
  @ApiOperation({ summary: 'Register a new G/L Account' })
  async create(@Body() dto: CreateGlAccountDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.glAccountService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'G/L Account registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'GL_ACCOUNT', 'view')
  @ApiOperation({ summary: 'List all G/L Accounts matching filters' })
  async findAll(@Query() query: QueryGlAccountDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.glAccountService.findAll(query, tenantId);
    return {
      success: true,
      message: 'G/L Accounts retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'GL_ACCOUNT', 'view')
  @ApiOperation({ summary: 'Fetch details of a single G/L Account by UUID' })
  @ApiParam({ name: 'id', description: 'G/L Account UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.glAccountService.findOne(id);
    return {
      success: true,
      message: 'G/L Account details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'GL_ACCOUNT', 'edit')
  @ApiOperation({ summary: 'Update details of an existing G/L Account' })
  @ApiParam({ name: 'id', description: 'G/L Account UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateGlAccountDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.glAccountService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'G/L Account updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'GL_ACCOUNT', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a G/L Account' })
  @ApiParam({ name: 'id', description: 'G/L Account UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.glAccountService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'GL_ACCOUNT', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted G/L Account' })
  @ApiParam({ name: 'id', description: 'G/L Account UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.glAccountService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'G/L Account restored successfully.',
      data: result
    };
  }
}
