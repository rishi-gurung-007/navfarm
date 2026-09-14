import { Controller, Get, Post, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BioAssetLedgerService } from './bio-asset-ledger.service';
import { CreateBioAssetLedgerDto, QueryBioAssetLedgerDto } from './dto/bio-asset-ledger.dto';
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

  @Get()
  @RequirePermission('INVENTORY', 'BIO_ASSET_LEDGER', 'view')
  @ApiOperation({ summary: 'List Bio-Asset Ledger entries matching filters' })
  async findAll(@Query() query: QueryBioAssetLedgerDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.bioAssetLedgerService.findAll(query, tenantId);
    return { success: true, message: 'Bio-Asset Ledger entries retrieved successfully.', data: result };
  }
}
