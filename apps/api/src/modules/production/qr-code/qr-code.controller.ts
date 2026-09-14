import { Controller, Get, Post, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { QrCodeService } from './qr-code.service';
import { CreateQrCodeDto, QueryQrCodeDto } from './dto/qr-code.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('QR Traceability Packs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('qr-code')
export class QrCodeController {
  constructor(private readonly qrCodeService: QrCodeService) {}

  @Post()
  @RequirePermission('PRODUCTION', 'QR_CODE', 'create')
  @ApiOperation({ summary: 'Generate a traceability pack (QR code) for a batch output — works with or without a linked QC record' })
  async create(@Body() dto: CreateQrCodeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.qrCodeService.create(dto, tenantId, req.user);
    return { success: true, message: 'Pack generated successfully.', data: result };
  }

  @Get()
  @RequirePermission('PRODUCTION', 'QR_CODE', 'view')
  @ApiOperation({ summary: 'List generated packs matching filters' })
  async findAll(@Query() query: QueryQrCodeDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.qrCodeService.findAll(query, tenantId);
    return { success: true, message: 'Packs retrieved successfully.', data: result };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'QR_CODE', 'view')
  @ApiOperation({ summary: 'Fetch a single pack' })
  @ApiParam({ name: 'id', description: 'QR/Pack UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.qrCodeService.findOne(id);
    return { success: true, message: 'Pack retrieved.', data: result };
  }

  @Post(':id/void')
  @RequirePermission('PRODUCTION', 'QR_CODE', 'delete')
  @ApiOperation({ summary: 'Void a pack (soft — the record is kept for audit)' })
  @ApiParam({ name: 'id', description: 'QR/Pack UUID' })
  async voidPack(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.qrCodeService.voidPack(id, tenantId, req.user);
  }
}
