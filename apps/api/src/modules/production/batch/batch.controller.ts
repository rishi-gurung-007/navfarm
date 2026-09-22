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
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiParam,
  ApiConsumes,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'node:path';
import { BatchService } from './batch.service';
import {
  CreateBatchDto,
  AddBatchTransactionDto,
  CloseBatchDto,
  QueryBatchDto,
  MatureBioAssetDto,
  AmortizeBioAssetDto,
  RecordFairValueDto,
  DisposeBioAssetDto,
  RenewBatchDto,
  TransferStageDto,
  BulkDailyEntryDto,
  ReopenStageDayDto,
} from './dto/batch.dto';

import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Production Batches')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('batch')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'BATCH', 'create')
  @ApiOperation({ summary: 'Create a draft Batch with input lines' })
  async create(@Body() dto: CreateBatchDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Batch draft created successfully.',
      data: result,
    };
  }

  @Post('bulk-daily-entry')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Bulk record daily operational data (feed, mortality, water, temp) across multiple batches',
  })
  async bulkDailyEntry(@Body() dto: BulkDailyEntryDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.bulkAddDailyTransactions(
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Bulk daily entries recorded successfully.',
      data: result,
    };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({ summary: 'List Batches matching filters' })
  async findAll(@Query() query: QueryBatchDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Batches retrieved successfully.',
      data: result,
    };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({
    summary:
      'Fetch a single Batch with input lines, transactions and output lines',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.batchService.findOne(id);
    return { success: true, message: 'Batch details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Edit a DRAFT Batch — header, input lines/standard-cost config (BATCH_WISE) or animal roster (ANIMAL_WISE). Refused once activated; breed/headcount refused once individual animal records already exist for it.',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async update(
    @Param('id') id: string,
    @Body() dto: CreateBatchDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Batch updated successfully.',
      data: result,
    };
  }

  @Delete(':id')
  @RequirePermission('PRODUCTION', 'BATCH', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT Batch' })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.batchService.remove(id, tenantId, req.user);
  }

  @Post(':id/activate')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Activate a DRAFT Batch — consumes input lines from inventory via FIFO and mirrors to GL',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async activate(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.activate(id, tenantId, req.user);
    return {
      success: true,
      message: 'Batch activated successfully.',
      data: result,
    };
  }

  @Get(':id/data-entry')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({
    summary:
      "Scheduled parameter lines due on a given date for this batch, with expected quantity and what's already been recorded — drives the guided Data Entry screen",
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async getDataEntry(@Param('id') id: string, @Query('date') date: string) {
    const result = await this.batchService.getDataEntry(
      id,
      date || new Date().toISOString().slice(0, 10),
    );
    return {
      success: true,
      message: 'Scheduled data-entry lines retrieved.',
      data: result,
    };
  }

  @Get(':id/posted-dates')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({
    summary:
      "Dates already posted (or posted then reopened) for this batch — drives the Data Entry screen's history dropdown. Pass stageId to scope to one ANIMAL_WISE stage.",
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async getPostedDates(
    @Param('id') id: string,
    @Query('stageId') stageId?: string,
  ) {
    const result = await this.batchService.getPostedDates(id, stageId);
    return {
      success: true,
      message: 'Posted dates retrieved.',
      data: result,
    };
  }

  @Post(':id/post-day')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'BATCH_WISE only — lock a whole-batch date once every mandatory activity has been entered; refuses further edits (no reopen path yet — posted is final)',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async postBatchDay(
    @Param('id') id: string,
    @Query('date') date: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.postBatchDay(
      id,
      date || new Date().toISOString().slice(0, 10),
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Batch day posted and locked.',
      data: result,
    };
  }

  @Post(':id/stage/:stageId/post-day')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'ANIMAL_WISE only — lock a stage/date once every mandatory activity for every animal currently in it has been entered; refuses further edits until reopened',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  @ApiParam({ name: 'stageId', description: 'Stage UUID' })
  async postStageDay(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Query('date') date: string,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.postStageDay(
      id,
      stageId,
      date || new Date().toISOString().slice(0, 10),
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Stage data posted and locked.',
      data: result,
    };
  }

  @Post(':id/stage/:stageId/reopen')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'ANIMAL_WISE only — reopen a locked stage/date for correction (does not reverse the underlying postings; reconciliation is manual)',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  @ApiParam({ name: 'stageId', description: 'Stage UUID' })
  async reopenStageDay(
    @Param('id') id: string,
    @Param('stageId') stageId: string,
    @Query('date') date: string,
    @Body() dto: ReopenStageDayDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.reopenStageDay(
      id,
      stageId,
      date || new Date().toISOString().slice(0, 10),
      dto.reason,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Stage data reopened for correction.',
      data: result,
    };
  }

  @Post(':id/transaction')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Record a daily transaction against an ACTIVE Batch (consumption, mortality, output, overhead, observation)',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async addTransaction(
    @Param('id') id: string,
    @Body() dto: AddBatchTransactionDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.addTransaction(
      id,
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Batch transaction recorded successfully.',
      data: result,
    };
  }

  @Post(':id/close')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Close an ACTIVE Batch — allocates total cost across output lines and posts them to inventory',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async close(
    @Param('id') id: string,
    @Body() dto: CloseBatchDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.close(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Batch closed successfully.',
      data: result,
    };
  }

  @Post(':id/mature')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'BIO_ASSET only — transitions PREMATURE → MATURE and sets up the amortization schedule',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async mature(
    @Param('id') id: string,
    @Body() dto: MatureBioAssetDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.matureBioAsset(
      id,
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Batch matured successfully.',
      data: result,
    };
  }

  @Post(':id/amortize')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'BIO_ASSET only, MATURE stage — runs one month of amortization (one run per calendar month)',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async amortize(
    @Param('id') id: string,
    @Body() dto: AmortizeBioAssetDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.amortizeBioAsset(
      id,
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Amortization posted successfully.',
      data: result,
    };
  }

  @Post(':id/fair-value')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'BIO_ASSET only — revalues the herd to a new fair value per unit, posting the gain or loss',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async fairValue(
    @Param('id') id: string,
    @Body() dto: RecordFairValueDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.recordFairValue(
      id,
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Fair value adjustment posted successfully.',
      data: result,
    };
  }

  @Post(':id/dispose')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'BIO_ASSET only — exits animals via HARVEST (to inventory) or SOLD (gain/loss); auto-closes once the herd is fully disposed',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async dispose(
    @Param('id') id: string,
    @Body() dto: DisposeBioAssetDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.disposeBioAsset(
      id,
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Disposal recorded successfully.',
      data: result,
    };
  }

  @Post(':id/renew')
  @RequirePermission('PRODUCTION', 'BATCH', 'create')
  @ApiOperation({
    summary:
      "Copy a CLOSED batch's config (breed, scheduler, shed, costing method, standard assumptions) into a new DRAFT batch for the next cycle — only for LOBs with batch_copy_allowed",
  })
  @ApiParam({ name: 'id', description: 'Source (CLOSED) Batch UUID' })
  async renew(
    @Param('id') id: string,
    @Body() dto: RenewBatchDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.renew(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Batch renewed successfully.',
      data: result,
    };
  }

  @Post(':id/transfer-stage')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Record a physical move to a new stage/sub-location mid-life (e.g. setter room -> hatcher room) — tracking only, no GL impact',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async transferStage(
    @Param('id') id: string,
    @Body() dto: TransferStageDto,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.transferStage(
      id,
      dto,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Batch stage transferred successfully.',
      data: result,
    };
  }

  @Post(':id/generate-scheduler')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Auto-generate a concrete scheduler and daily target curves from breed lifecycle standards',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async generateScheduler(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.generateSchedulerForBatch(
      id,
      tenantId,
      req.user,
    );
    return {
      success: true,
      message: 'Batch scheduler auto-generated from breed standards.',
      data: result,
    };
  }

  @Get(':id/performance-curves')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({
    summary:
      'Fetch day-by-day standard performance curves vs actual recorded metrics (Feed, Weight, Mortality)',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  @ApiQuery({
    name: 'animalId',
    required: false,
    description:
      'Restrict the curves to transactions attributed to this one animal',
  })
  async getPerformanceCurves(
    @Param('id') id: string,
    @Query('animalId') animalId: string | undefined,
    @Req() req: any,
  ) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.batchService.getBatchPerformanceCurves(
      id,
      tenantId,
      animalId,
    );
    return {
      success: true,
      message: 'Performance curves retrieved successfully.',
      data: result,
    };
  }

  @Post(':id/attachment')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({
    summary:
      'Upload an inspection photo/document for a daily batch log entry — stored on local/system disk',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        log_date: { type: 'string', example: '2026-08-22' },
        attachment_type: { type: 'string', example: 'IMAGE' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: resolve(process.env.UPLOADS_DIR || 'apps/api/uploads'),
        filename: (_req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(
            null,
            `batch-attachment-${uniqueSuffix}${extname(file.originalname)}`,
          );
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
      fileFilter: (_req, file, cb) => {
        const allowed = new Set([
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/heic',
          'application/pdf',
        ]);
        if (!allowed.has(file.mimetype)) {
          return cb(
            new BadRequestException(
              'Only PNG, JPG, WebP, HEIC images or PDF documents are allowed.',
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @Body('log_date') logDate: string,
    @Body('attachment_type') attachmentType: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }
    if (!logDate) {
      throw new BadRequestException('log_date is required.');
    }
    const result = await this.batchService.addAttachment(
      id,
      file,
      logDate,
      attachmentType,
      req.user?.userId,
    );
    return {
      success: true,
      message: 'Attachment uploaded successfully.',
      data: result,
    };
  }

  @Get(':id/attachment')
  @RequirePermission('PRODUCTION', 'BATCH', 'view')
  @ApiOperation({
    summary:
      'List inspection photos/documents attached to a batch, optionally filtered by log date',
  })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  async listAttachments(@Param('id') id: string, @Query('date') date?: string) {
    const result = await this.batchService.listAttachments(id, date);
    return {
      success: true,
      message: 'Attachments retrieved successfully.',
      data: result,
    };
  }

  @Delete(':id/attachment/:attachmentId')
  @RequirePermission('PRODUCTION', 'BATCH', 'edit')
  @ApiOperation({ summary: 'Delete a batch attachment' })
  @ApiParam({ name: 'id', description: 'Batch UUID' })
  @ApiParam({ name: 'attachmentId', description: 'Attachment UUID' })
  async deleteAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const result = await this.batchService.deleteAttachment(id, attachmentId);
    return {
      success: true,
      message: 'Attachment deleted successfully.',
      data: result,
    };
  }
}
