import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { RequirePermission } from '../../../../common/decorators/require-permission.decorator';
import { FaConversionService } from './fa-conversion.service';
import { ApproveFaConversionDto, PostFaConversionDto, QueryFaConversionDto, RejectFaConversionDto, RequestFaConversionDto } from './fa-conversion.dto';

/** TDD row 11: FA to Inventory conversion of a culled breeding animal. The farm requests; Finance (the journal permission) approves and posts. */
@ApiTags('FA to Inventory Conversion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fa-conversions')
export class FaConversionController {
  constructor(private readonly conversions: FaConversionService) {}

  private tenant = (req: any): string => req.user?.tenantId || req['tenantId'];
  private company = (req: any): string => req.headers['x-active-company-id'] || req.user?.companyId;

  @Get()
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  async list(@Query() q: QueryFaConversionDto, @Req() req: any) {
    return { success: true, data: await this.conversions.findAll(q, this.tenant(req), this.company(req)) };
  }

  @Get(':id')
  @RequirePermission('PIGGERY', 'ANIMAL', 'view')
  async one(@Param('id') id: string, @Req() req: any) {
    return { success: true, data: await this.conversions.findOne(id, this.tenant(req)) };
  }

  @Post()
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  @ApiOperation({ summary: 'Raise a conversion request for an animal taken out of production' })
  async request(@Body() dto: RequestFaConversionDto, @Req() req: any) {
    return { success: true, message: 'Conversion requested.', data: await this.conversions.request(dto, this.tenant(req), req.user?.userId) };
  }

  @Patch(':id/approve')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Finance approves with a market value; not the person who raised it' })
  async approve(@Param('id') id: string, @Body() dto: ApproveFaConversionDto, @Req() req: any) {
    return { success: true, message: 'Conversion approved.', data: await this.conversions.approve(id, dto, this.tenant(req), req.user?.userId) };
  }

  @Patch(':id/reject')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  async reject(@Param('id') id: string, @Body() dto: RejectFaConversionDto, @Req() req: any) {
    return { success: true, message: 'Conversion rejected.', data: await this.conversions.reject(id, dto, this.tenant(req), req.user?.userId) };
  }

  @Patch(':id/cancel')
  @RequirePermission('PIGGERY', 'ANIMAL', 'edit')
  async cancel(@Param('id') id: string, @Req() req: any) {
    return { success: true, message: 'Conversion cancelled.', data: await this.conversions.cancel(id, this.tenant(req), req.user?.userId) };
  }

  @Post(':id/post')
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Post an approved conversion: the animal leaves as CONVERTED_INV, book value relieved, received into inventory at the market value' })
  async post(@Param('id') id: string, @Body() dto: PostFaConversionDto, @Req() req: any) {
    return { success: true, message: 'Conversion posted.', data: await this.conversions.post(id, dto, this.tenant(req), req.user?.userId) };
  }
}
