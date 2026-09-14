import { Controller, Get, Post, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ApprovalService } from './approval.service';
import { CreateApprovalRequestDto, DecideApprovalDto, QueryApprovalDto } from './dto/approval.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';

@ApiTags('Operational Approvals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('approval')
@FarmScoped()
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get()
  @RequirePermission('PRODUCTION', 'APPROVAL', 'view')
  @ApiOperation({ summary: 'List approval requests' })
  async findAll(@Query() query: QueryApprovalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.findAll(query, tenantId);
    return { success: true, message: 'Approval requests retrieved successfully.', data };
  }

  @Get('counts')
  @RequirePermission('PRODUCTION', 'APPROVAL', 'view')
  @ApiOperation({ summary: 'Pending / approved / rejected counts for the tab badges' })
  async counts(@Query() query: QueryApprovalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.counts(query, tenantId);
    return { success: true, message: 'Approval counts retrieved successfully.', data };
  }

  @Get(':id')
  @RequirePermission('PRODUCTION', 'APPROVAL', 'view')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.findOne(id, tenantId);
    return { success: true, message: 'Approval request retrieved successfully.', data };
  }

  @Post()
  @RequirePermission('PRODUCTION', 'APPROVAL', 'create')
  @ApiOperation({ summary: 'Raise an approval request' })
  async create(@Body() dto: CreateApprovalRequestDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.create(dto, tenantId, req.user);
    return { success: true, message: 'Approval request submitted successfully.', data };
  }

  @Post(':id/approve')
  @RequirePermission('PRODUCTION', 'APPROVAL', 'approve')
  async approve(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.approve(id, tenantId, req.user);
    return { success: true, message: 'Request approved.', data };
  }

  @Post(':id/reject')
  @RequirePermission('PRODUCTION', 'APPROVAL', 'approve')
  async reject(@Param('id') id: string, @Body() dto: DecideApprovalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.reject(id, dto, tenantId, req.user);
    return { success: true, message: 'Request rejected.', data };
  }

  @Delete(':id')
  @RequirePermission('PRODUCTION', 'APPROVAL', 'delete')
  @ApiOperation({ summary: 'Withdraw a pending request' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.approvalService.remove(id, tenantId, req.user);
    return { success: true, message: 'Request withdrawn.', data };
  }
}
