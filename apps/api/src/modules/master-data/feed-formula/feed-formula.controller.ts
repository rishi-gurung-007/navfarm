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
import { FeedFormulaService } from './feed-formula.service';
import { CreateFeedFormulaDto, UpdateFeedFormulaDto, QueryFeedFormulaDto } from './dto/feed-formula.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Feed Formula (BOM) Master')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feed-formula')
export class FeedFormulaController {
  constructor(private readonly feedFormulaService: FeedFormulaService) {}

  @Post()
  @RequirePermission('MASTER_DATA', 'FEED_FORMULA', 'create')
  @ApiOperation({ summary: 'Register a new Feed Formula / BOM' })
  async create(@Body() dto: CreateFeedFormulaDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.feedFormulaService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Feed Formula registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'FEED_FORMULA', 'view')
  @ApiOperation({ summary: 'List all Feed Formulas matching filters' })
  async findAll(@Query() query: QueryFeedFormulaDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.feedFormulaService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Feed Formulas retrieved successfully.',
            // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'FEED_FORMULA', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Feed Formula by UUID (including ingredients)' })
  @ApiParam({ name: 'id', description: 'Formula UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.feedFormulaService.findOne(id);
    return {
      success: true,
      message: 'Feed Formula details retrieved.',
      data: result
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'FEED_FORMULA', 'edit')
  @ApiOperation({ summary: 'Update header details of an existing Feed Formula' })
  @ApiParam({ name: 'id', description: 'Formula UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateFeedFormulaDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.feedFormulaService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Feed Formula updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'FEED_FORMULA', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) a Feed Formula and its ingredients' })
  @ApiParam({ name: 'id', description: 'Formula UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.feedFormulaService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'FEED_FORMULA', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Feed Formula and its ingredients' })
  @ApiParam({ name: 'id', description: 'Formula UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.feedFormulaService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Feed Formula restored successfully.',
      data: result
    };
  }
}
