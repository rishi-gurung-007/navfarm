import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { RequisitionService } from './requisition.service';
import { CreateRequisitionDto, DecideRequisitionDto } from './dto/requisition.dto';

@ApiTags('Procurement Requisitions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@FarmScoped()
@Controller('requisition')
export class RequisitionController {
  constructor(private readonly requisitions: RequisitionService) {}

  @Get()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: 'Requisitions visible in the active scope, newest first' })
  async findAll(@Req() req: any, @Query('company_id') companyId?: string, @Query('status') status?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.findAll({ company_id: companyId, status }, tenantId);
    return { success: true, message: 'Requisitions retrieved successfully.', data };
  }

  @Get(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiParam({ name: 'id' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.findOne(id, tenantId);
    return { success: true, message: 'Requisition retrieved successfully.', data };
  }

  @Post()
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Draft a requisition (BBP §16: Items/FA/Services with approval)' })
  async create(@Body() dto: CreateRequisitionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.create(dto, tenantId, req.user);
    return { success: true, message: 'Requisition drafted.', data };
  }

  @Post(':id/submit')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'DRAFT → PENDING_APPROVAL, raising the linked approval request (§17.2)' })
  @ApiParam({ name: 'id' })
  async submit(@Param('id') id: string, @Body() body: { note?: string } | undefined, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.submit(id, body?.note, tenantId, req.user);
    return { success: true, message: 'Requisition submitted for approval.', data };
  }

  @Post(':id/approve')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Approve through the linked approval request; optional D365BC PO number (§7.2 step 7)' })
  @ApiParam({ name: 'id' })
  async approve(@Param('id') id: string, @Body() dto: DecideRequisitionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.decide(id, dto, 'APPROVED', tenantId, req.user);
    return { success: true, message: 'Requisition approved.', data };
  }

  @Post(':id/reject')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Reject with a mandatory reason (§17.1 flow step 4)' })
  @ApiParam({ name: 'id' })
  async reject(@Param('id') id: string, @Body() dto: DecideRequisitionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.decide(id, dto, 'REJECTED', tenantId, req.user);
    return { success: true, message: 'Requisition rejected.', data };
  }

  @Post(':id/link-po')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Store the D365BC PO number on an approved requisition (§7.2 step 7)' })
  @ApiParam({ name: 'id' })
  async linkPo(@Param('id') id: string, @Body() body: { linked_po_no: string }, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.linkPo(id, body.linked_po_no, tenantId, req.user);
    return { success: true, message: 'PO number linked.', data };
  }
}
