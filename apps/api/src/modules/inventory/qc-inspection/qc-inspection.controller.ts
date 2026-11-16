import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { QcInspectionService } from './qc-inspection.service';
import { ApproveQcDeviationDto, CompleteQcInspectionDto, QueryQcInspectionDto, RefuseQcDeviationDto, SettleQcRejectionDto } from './dto/qc-inspection.dto';

@ApiTags('QC Inspection')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('qc-inspection')
export class QcInspectionController {
  constructor(private readonly service: QcInspectionService) {}

  @Get()
  @RequirePermission('INVENTORY', 'QC_INSPECTION', 'view')
  @ApiOperation({ summary: 'List QC inspections' })
  async findAll(@Query() query: QueryQcInspectionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.findAll(query, tenantId);
    return { success: true, message: 'QC inspections retrieved.', data };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'QC_INSPECTION', 'view')
  @ApiOperation({ summary: 'One QC inspection with its checks' })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string) {
    const data = await this.service.findOne(id);
    return { success: true, message: 'QC inspection retrieved.', data };
  }

  @Post(':id/complete')
  @RequirePermission('INVENTORY', 'QC_INSPECTION', 'edit')
  @ApiOperation({ summary: 'Complete an inspection. A pass writes the Inventory Ledger entry for the accepted quantity.' })
  async complete(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: CompleteQcInspectionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.complete(id, dto, tenantId, req.user);
    return { success: true, message: 'QC inspection completed.', data };
  }

  @Post(':id/approve-deviation')
  @RequirePermission('INVENTORY', 'QC_INSPECTION', 'approve')
  @ApiOperation({ summary: 'Approve accepting a failed lot with a deviation. Writes the Inventory Ledger entry.' })
  async approve(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ApproveQcDeviationDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.approveDeviation(id, dto, tenantId, req.user);
    return { success: true, message: 'Deviation approved.', data };
  }

  @Post(':id/reject-deviation')
  @RequirePermission('INVENTORY', 'QC_INSPECTION', 'approve')
  @ApiOperation({ summary: 'Refuse a deviation: the lot is failed whole and nothing is posted.' })
  async reject(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RefuseQcDeviationDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.rejectDeviation(id, dto, tenantId, req.user);
    return { success: true, message: 'Deviation refused.', data };
  }

  @Post(':id/settle-rejection')
  @RequirePermission('INVENTORY', 'QC_INSPECTION', 'edit')
  @ApiOperation({ summary: 'Record the final disposition of a rejected quantity held for a decision (return to supplier or scrap). Recorded only: nothing is posted.' })
  async settleRejection(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SettleQcRejectionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.service.settleRejection(id, dto, tenantId, req.user);
    return { success: true, message: 'Rejected quantity settled.', data };
  }
}
