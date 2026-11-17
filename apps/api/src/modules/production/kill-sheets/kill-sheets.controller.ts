import { BadRequestException, Controller, Get, Param, Post, Query, Req, Res, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'node:path';
import { createReadStream } from 'node:fs';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { ConfirmKillSheetDto, PreviewKillSheetDto, QueryKillSheetsDto } from './kill-sheets.dto';
import { KillSheetsService } from './kill-sheets.service';

const spreadsheet = (_req: any, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => {
  const extension = extname(file.originalname).toLowerCase();
  cb(extension === '.xls' || extension === '.xlsx' ? null : new BadRequestException('Only .xls and .xlsx Kill Sheet workbooks are accepted.'), extension === '.xls' || extension === '.xlsx');
};

@ApiTags('Kill Sheets') @ApiBearerAuth() @UseGuards(JwtAuthGuard, RolesGuard) @FarmScoped() @Controller('kill-sheets')
export class KillSheetsController {
  constructor(private readonly service: KillSheetsService) {}
  private tenant(req: any) { return req.user?.tenantId || req.tenantId; }
  @Get() @RequirePermission('PRODUCTION', 'BATCH', 'view') list(@Query() query: QueryKillSheetsDto, @Req() req: any) { return this.service.list(query, this.tenant(req)); }
  @Get(':id') @RequirePermission('PRODUCTION', 'BATCH', 'view') detail(@Param('id') id: string, @Req() req: any) { return this.service.detail(id, this.tenant(req)); }
  @Get(':id/file/:kind') @RequirePermission('PRODUCTION', 'BATCH', 'view') async file(@Param('id') id: string, @Param('kind') kind: string, @Req() req: any, @Res() res: any) { if (kind !== 'individual' && kind !== 'summary') throw new BadRequestException('File kind must be individual or summary.'); const file = await this.service.file(id, kind, this.tenant(req)); res.setHeader('Content-Disposition', `attachment; filename="${file.name.replace(/["\\\r\n]/g, '_')}"`); res.setHeader('Content-Type', 'application/octet-stream'); return createReadStream(file.path).pipe(res); }
  @Post('preview') @RequirePermission('PRODUCTION', 'BATCH', 'edit') @ApiConsumes('multipart/form-data') @ApiBody({ schema: { type: 'object', properties: { farm_id: { type: 'string' }, batch_id: { type: 'string' }, individual: { type: 'string', format: 'binary' }, summary: { type: 'string', format: 'binary' } }, required: ['farm_id', 'batch_id', 'individual'] } })
@UseInterceptors(FileFieldsInterceptor([{ name: 'individual', maxCount: 1 }, { name: 'summary', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 2 }, fileFilter: spreadsheet }))
  preview(@UploadedFiles() files: { individual?: Express.Multer.File[]; summary?: Express.Multer.File[] }, @Req() req: any) { const individual = files?.individual?.[0]; const summary = files?.summary?.[0]; const dto: PreviewKillSheetDto = { farm_id: req.body?.farm_id, batch_id: req.body?.batch_id }; return this.service.preview(dto, individual, summary, this.tenant(req), req.user?.userId); }
  @Post(':id/summary') @RequirePermission('PRODUCTION', 'BATCH', 'edit') @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileFieldsInterceptor([{ name: 'summary', maxCount: 1 }], { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 }, fileFilter: spreadsheet }))
  attachSummary(@Param('id') id: string, @UploadedFiles() files: { summary?: Express.Multer.File[] }, @Req() req: any) { return this.service.attachSummary(id, files?.summary?.[0], this.tenant(req)); }
  @Post(':id/confirm') @RequirePermission('PRODUCTION', 'BATCH', 'edit') confirm(@Param('id') id: string, @Req() req: any) { return this.service.confirm(id, req.body as ConfirmKillSheetDto, this.tenant(req), req.user?.userId); }
  @Get(':id/carcasses') @RequirePermission('PRODUCTION', 'BATCH', 'view') carcasses(@Param('id') id: string, @Query() query: QueryKillSheetsDto, @Req() req: any) { return this.service.records(id, 'carcasses', query, this.tenant(req)); }
  @Get(':id/products') @RequirePermission('PRODUCTION', 'BATCH', 'view') products(@Param('id') id: string, @Query() query: QueryKillSheetsDto, @Req() req: any) { return this.service.records(id, 'products', query, this.tenant(req)); }
}
