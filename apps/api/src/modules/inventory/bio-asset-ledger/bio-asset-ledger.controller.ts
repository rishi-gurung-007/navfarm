import { Controller, Get, Post, Body, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ledgerRowsToCsv, ledgerRowsToXlsx, type LedgerExportColumn } from '../inventory-ledger/inventory-ledger-export';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BioAssetLedgerService } from './bio-asset-ledger.service';
import { CreateBioAssetLedgerDto, ExportBioAssetLedgerDto, QueryBioAssetLedgerDto, QueryBioAssetLedgerEntriesDto } from './dto/bio-asset-ledger.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Bio-Asset Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bio-asset-ledger')
@FarmScoped()
export class BioAssetLedgerController {
  constructor(private readonly bioAssetLedgerService: BioAssetLedgerService) {}

  @Post()
  @RequirePermission('INVENTORY', 'BIO_ASSET_LEDGER', 'create')
  @ApiOperation({ summary: 'Record a manual Bio-Asset Ledger entry (mortality, growth, fair-value adjustment, etc.)' })
  async create(@Body() dto: CreateBioAssetLedgerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.bioAssetLedgerService.create(dto, tenantId, req.user);
    return { success: true, message: 'Bio-Asset Ledger entry recorded successfully.', data: result };
  }

  @Get('entries')
  @RequirePermission('INVENTORY', 'BIO_ASSET_LEDGER', 'view')
  @ApiOperation({ summary: 'Bio Asset Ledger page: animal registrations (+1) and deaths (-1), filtered like the Inventory Ledger' })
  async entries(@Query() query: QueryBioAssetLedgerEntriesDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.bioAssetLedgerService.entries(query, tenantId);
    return { success: true, message: 'Bio Asset Ledger entries retrieved successfully.', data: result };
  }

  @Get('export')
  @RequirePermission('INVENTORY', 'BIO_ASSET_LEDGER', 'view')
  @ApiOperation({ summary: 'Download every Bio Asset Ledger entry matching the filters as an Excel (.xlsx) or CSV file' })
  async export(@Query() query: ExportBioAssetLedgerDto, @Req() req: any, @Res() res: Response) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const { rows, truncated } = await this.bioAssetLedgerService.entriesForExport(query, tenantId);
    const format = query.format === 'csv' ? 'csv' : 'xlsx';
    const filename = `bio-asset-ledger-entries-${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Export-Row-Count, X-Export-Truncated');
    res.setHeader('X-Export-Row-Count', String(rows.length));
    res.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(ledgerRowsToCsv(rows, BIO_EXPORT_COLUMNS));
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(await ledgerRowsToXlsx(rows, BIO_EXPORT_COLUMNS, 'Bio Asset Ledger Entries'));
  }

  @Get()
  @RequirePermission('INVENTORY', 'BIO_ASSET_LEDGER', 'view')
  @ApiOperation({ summary: 'List Bio-Asset Ledger entries matching filters' })
  async findAll(@Query() query: QueryBioAssetLedgerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.bioAssetLedgerService.findAll(query, tenantId);
    return { success: true, message: 'Bio-Asset Ledger entries retrieved successfully.', data: result };
  }
}

type BioExportRow = Awaited<ReturnType<BioAssetLedgerService['entries']>>[number];

/** The Bio Asset Ledger export: the page's columns, as the Inventory Ledger export lays out its own. */
const BIO_EXPORT_COLUMNS: LedgerExportColumn<BioExportRow>[] = [
  { key: 'entry_no', header: 'Entry No.', kind: 'number', width: 11 },
  { key: 'posting_date', header: 'Posting Date', kind: 'date', width: 14 },
  { key: 'document_type', header: 'Document Type', kind: 'text', width: 20 },
  { key: 'document_no', header: 'Document No.', kind: 'text', width: 20 },
  { key: 'source_grn_no', header: 'Source GRN', kind: 'text', width: 14 },
  { key: 'transaction_type', header: 'Transaction Type', kind: 'text', width: 20 },
  { key: 'item_code', header: 'Item No.', kind: 'text', width: 18 },
  { key: 'item_description', header: 'Item Description', kind: 'text', width: 32 },
  { key: 'warehouse_code', header: 'Location Code', kind: 'text', width: 22 },
  { key: 'warehouse_name', header: 'Location', kind: 'text', width: 26 },
  { key: 'quantity', header: 'Quantity', kind: 'number', width: 12 },
  { key: 'uom', header: 'UOM', kind: 'text', width: 8 },
  { key: 'rate', header: 'Unit Cost', kind: 'number', width: 14 },
  { key: 'amount', header: 'Amount', kind: 'number', width: 14 },
  { key: 'animal_code', header: 'Animal', kind: 'text', width: 16 },
  { key: 'batch_no', header: 'Batch No.', kind: 'text', width: 16 },
  { key: 'created_by', header: 'Created By', kind: 'text', width: 38 },
  { key: 'created_at', header: 'Created At', kind: 'datetime', width: 20 },
];
