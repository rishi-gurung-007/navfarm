import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { mayDecideAnyRequisition } from './requisition.rules';
import { RequisitionService } from './requisition.service';
import { CreateRequisitionDto, DecideRequisitionDto, RequisitionReceiptDto, RequisitionShipmentDto, RequisitionTrackingDto, UpdateRequisitionDto } from './dto/requisition.dto';

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
  async findAll(@Req() req: any, @Query('company_id') companyId?: string, @Query('status') status?: string, @Query('doc_type') docType?: string, @Query('waiting_for_me') waitingForMe?: string, @Query('kind') kind?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.findAll(
      { company_id: companyId, status, doc_type: docType, waiting_for_me: waitingForMe === '1' || waitingForMe === 'true', kind: kind as 'common' | undefined },
      tenantId,
      // WP1b: the hub's waiting filter and the admin's farm-wide list need the
      // caller's type; the predicate itself lives in ApprovalService.
      { waitingForMe: waitingForMe === '1' || waitingForMe === 'true', userType: req.user?.userType },
    );
    return { success: true, message: 'Requisitions retrieved successfully.', data };
  }

  @Get('options')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiOperation({ summary: 'What the common requisition form may offer: items, resources, locations, departments, the caller Direct Transfer right' })
  async options(@Req() req: any, @Query('company_id') companyId: string, @Query('farm_id') farmId?: string) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    if (!companyId) throw new BadRequestException('company_id is required.');
    // WP1c: the caller rides along so the response can carry their own
    // Direct Transfer right (the dialog disables the checkbox without it).
    const data = await this.requisitions.options({ company_id: companyId, farm_id: farmId }, tenantId, req.user);
    return { success: true, message: 'Requisition options retrieved.', data };
  }

  @Get(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'view')
  @ApiParam({ name: 'id' })
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    // WP1b: the hub's document dialog opens precisely the cross-farm rows an
    // admin may decide — the read the dialog runs must span farms the way
    // decide()'s lock does (the review's carried-forward item).
    const data = await this.requisitions.findOne(id, tenantId, { bypassFarm: mayDecideAnyRequisition(req.user?.userType) });
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

  @Put(':id')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Edit an Open requisition — header fields and all lines (spec §6a)', description: 'Full replace of the header and every line. Omitted remarks, required_date, justification, sender_department_id become null and direct_transfer becomes false; omitted requisition_date, main_location_id, requester_department_id and purpose keep their stored values. farm_id is ignored.' })
  @ApiParam({ name: 'id' })
  async update(@Param('id') id: string, @Body() dto: UpdateRequisitionDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Requisition saved.', data };
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

  @Post(':id/release')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'approve')
  @ApiOperation({ summary: 'Release an approved requisition — Purchase records BC_PENDING, Store becomes TRANSFER_OPEN. Approval never implies release.' })
  @ApiParam({ name: 'id' })
  async release(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.release(id, tenantId, req.user);
    return { success: true, message: 'Requisition released.', data };
  }

  @Post(':id/shipment')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial shipment against a released Store requisition (its linked transfer)' })
  @ApiParam({ name: 'id' })
  async ship(@Param('id') id: string, @Body() dto: RequisitionShipmentDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Shipment posted.', data: await this.requisitions.ship(id, dto, tenantId, req.user) };
  }

  @Post(':id/receipt')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Post a partial receipt against one shipment of a released Store requisition' })
  @ApiParam({ name: 'id' })
  async receive(@Param('id') id: string, @Body() dto: RequisitionReceiptDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Receipt posted.', data: await this.requisitions.receive(id, dto, tenantId, req.user) };
  }

  @Post(':id/item-tracking')
  @RequirePermission('INVENTORY', 'STOCK_TRANSFER', 'edit')
  @ApiOperation({ summary: 'Assign Lot/Serial to released Store requisition lines that have not shipped (the From department, like the shipment)' })
  @ApiParam({ name: 'id' })
  async assignTracking(@Param('id') id: string, @Body() dto: RequisitionTrackingDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return { success: true, message: 'Item Tracking assigned.', data: await this.requisitions.assignTracking(id, dto, tenantId, req.user) };
  }

  @Post(':id/reopen')
  @RequirePermission('PROCUREMENT', 'REQUISITION', 'create')
  @ApiOperation({ summary: 'Return a rejected requisition to an editable Open draft; the decision history stays on its approval request' })
  @ApiParam({ name: 'id' })
  async reopen(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.requisitions.reopen(id, tenantId, req.user);
    return { success: true, message: 'Requisition reopened.', data };
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
