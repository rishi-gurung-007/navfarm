import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { BatchTransferService } from './batch-transfer.service';
import { CreateBatchTransferDto, MergeBatchDto, QueryBatchTransferDto, SplitBatchDto } from './dto/batch.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

/**
 * Animal movement between batches. Kept on its own base path rather than under
 * `/batch/:id/...` so the list endpoint (`GET /batch-transfer`) is not shadowed
 * by `/batch/:id`.
 */
@ApiTags('Production Batch Transfers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('batch-transfer')
@FarmScoped()
export class BatchTransferController {
  constructor(private readonly transferService: BatchTransferService) {}

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'List animal transfers between batches' })
  async findAll(@Query() query: QueryBatchTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.transferService.findAll(query, tenantId);
    return { success: true, message: 'Transfers retrieved successfully.', data };
  }

  @Get('transferable/:batchId')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'List the live animals in a batch that are eligible to be transferred out' })
  @ApiParam({ name: 'batchId' })
  async transferable(@Param('batchId') batchId: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.transferService.listTransferableAnimals(batchId, tenantId);
    return { success: true, message: 'Transferable animals retrieved successfully.', data };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'Get one transfer with its animal lines' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.transferService.findOne(id, tenantId);
    return { success: true, message: 'Transfer retrieved successfully.', data };
  }

  @Post('from/:batchId')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Transfer a whole batch, or selected animals, from one batch to another' })
  @ApiParam({ name: 'batchId', description: 'Source batch UUID' })
  async create(@Param('batchId') batchId: string, @Body() dto: CreateBatchTransferDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.transferService.create(dto, tenantId, batchId, req.user);
    return { success: true, message: 'Transfer recorded successfully.', data };
  }

  @Post('split/:batchId')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Hold part of a cohort back as its own child batch when the rest moves on to the next stage' })
  @ApiParam({ name: 'batchId', description: 'Parent batch UUID' })
  async split(@Param('batchId') batchId: string, @Body() dto: SplitBatchDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.transferService.splitBatch(batchId, dto, tenantId, req.user);
    return { success: true, message: `Split ${dto.animal_ids.length} animal(s) into ${result.child.batch_no}.`, data: result };
  }

  @Post('merge/:batchId')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Merge a split group back into the cohort it came from and close the child batch' })
  @ApiParam({ name: 'batchId', description: 'Child batch UUID' })
  async merge(@Param('batchId') batchId: string, @Body() dto: MergeBatchDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.transferService.mergeBatch(batchId, dto, tenantId, req.user);
    return { success: true, message: `${result.merged} animal(s) merged back.`, data: result };
  }

  @Post(':id/post')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Post a draft transfer — moves the animals and their carrying value' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.transferService.post(id, tenantId, req.user);
    return { success: true, message: 'Transfer posted successfully.', data };
  }

  @Post(':id/cancel')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Cancel a draft transfer' })
  async cancel(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.transferService.cancel(id, tenantId, req.user);
    return { success: true, message: 'Transfer cancelled successfully.', data };
  }
}
