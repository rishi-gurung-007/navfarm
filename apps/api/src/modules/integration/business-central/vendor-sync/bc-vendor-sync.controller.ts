import { Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { BcVendorSyncService } from './bc-vendor-sync.service';
import { BcVendorWriteService } from './bc-vendor-write.service';

/**
 * Vendor sync from Business Central. Uses the Supplier master's own permissions:
 * preview and run need "edit" on suppliers (the run rewrites them), the history needs "view".
 */
@ApiTags('Integration — Business Central')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integration/business-central/vendors')
export class BcVendorSyncController {
  constructor(
    private readonly vendors: BcVendorSyncService,
    private readonly writer: BcVendorWriteService,
    private readonly cls: ClsService,
  ) {}

  private tenantId(req: any): string {
    // Same resolution as the Supplier controller.
    return req.user?.tenantId || req['tenantId'] || this.cls.get<string>('tenantId');
  }

  @Get('preview')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'edit')
  @ApiOperation({ summary: 'What a vendor sync would create, update or deactivate — writes nothing' })
  preview(@Req() req: any) {
    return this.vendors.preview(this.tenantId(req));
  }

  @Post('sync')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'edit')
  @ApiOperation({ summary: 'Pull BC vendors (NavFarm Sync ticked) into Suppliers now' })
  sync(@Req() req: any) {
    return this.vendors.sync(this.tenantId(req), 'MANUAL', req.user?.userId ?? null);
  }

  @Post('refresh-if-stale')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'view')
  @ApiQuery({ name: 'maxAgeMinutes', required: false, description: 'Default 15' })
  @ApiOperation({ summary: 'Sync vendors from BC only if the last successful sync is older than maxAgeMinutes (Suppliers screen open)' })
  refreshIfStale(@Req() req: any, @Query('maxAgeMinutes') maxAgeMinutes?: string) {
    const age = Math.min(1440, Math.max(1, Number(maxAgeMinutes) || 15));
    return this.vendors.refreshIfStale(this.tenantId(req), age, req.user?.userId ?? null);
  }

  @Get('runs')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'view')
  @ApiQuery({ name: 'limit', required: false })
  @ApiOperation({ summary: 'Recent vendor sync runs (integration_sync_log)' })
  runs(@Req() req: any, @Query('limit') limit?: string) {
    return this.vendors.recentRuns(this.tenantId(req), limit ? Number(limit) : 20);
  }

  @Get('settings')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'view')
  @ApiOperation({ summary: 'How suppliers relate to BC: master source, write-through, schedule, environment' })
  settings() {
    return this.writer.settings();
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'view')
  @ApiQuery({ name: 'search', required: false, description: 'Vendor No. prefix (e.g. VEN01) or part of the name' })
  @ApiQuery({ name: 'linked', required: false, enum: ['all', 'linked', 'unlinked'] })
  @ApiQuery({ name: 'top', required: false })
  @ApiQuery({ name: 'skip', required: false })
  @ApiOperation({ summary: 'Live Business Central vendors, with the NAVFarm supplier each is linked to' })
  list(
    @Req() req: any,
    @Query('search') search?: string,
    @Query('linked') linked?: 'all' | 'linked' | 'unlinked',
    @Query('top') top?: string,
    @Query('skip') skip?: string,
  ) {
    return this.writer.listLive(this.tenantId(req), { search, linked, top: top ? Number(top) : undefined, skip: skip ? Number(skip) : undefined });
  }

  @Post(':no/link')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'edit')
  @ApiOperation({ summary: 'Tick "NavFarm Sync" on the BC vendor and bring it in as a supplier now' })
  async link(@Req() req: any, @Param('no') no: string) {
    const supplierId = await this.writer.setNavfarmSync(no, true, this.tenantId(req), req.user?.userId ?? null);
    return { vendorNo: no, supplierId };
  }

  @Post(':no/unlink')
  @RequirePermission('MASTER_DATA', 'SUPPLIER', 'edit')
  @ApiOperation({ summary: 'Untick "NavFarm Sync" on the BC vendor; the supplier is deactivated (never deleted)' })
  async unlink(@Req() req: any, @Param('no') no: string) {
    await this.writer.setNavfarmSync(no, false, this.tenantId(req), req.user?.userId ?? null);
    const run = await this.vendors.deactivateUnlinked(this.tenantId(req), no, req.user?.userId ?? null);
    return { vendorNo: no, ...run };
  }
}
