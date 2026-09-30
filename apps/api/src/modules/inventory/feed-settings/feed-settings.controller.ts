import { BadRequestException, Body, Controller, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { FarmScoped } from '../../../common/farm-scope';
import { QueryFeedSettingsDto, UpdateCompanyFeedSettingsDto } from './dto/feed-settings.dto';
import { FeedSettingsService } from './feed-settings.service';

@ApiTags('Feed Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feed-settings')
@FarmScoped()
export class FeedSettingsController {
  constructor(private readonly service: FeedSettingsService) {}

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Resolve effective company/farm feed-planning settings' })
  async get(@Query() query: QueryFeedSettingsDto, @Req() req: any) {
    const companyId = query.companyId || req.headers?.['x-active-company-id'] || req.user?.companyId;
    if (!companyId) throw new BadRequestException('Active company ID is required.');
    return { success: true, data: await this.service.resolve(companyId, query.farmId) };
  }

  @Put()
  @RequirePermission('MASTER_DATA', 'LOCATION', 'edit')
  @ApiOperation({ summary: 'Save company feed-planning settings' })
  async put(@Body() dto: UpdateCompanyFeedSettingsDto, @Req() req: any) {
    const companyId = dto.companyId || req.headers?.['x-active-company-id'] || req.user?.companyId;
    const tenantId = req.user?.tenantId || req.tenantId;
    if (!companyId) throw new BadRequestException('Active company ID is required.');
    return { success: true, data: await this.service.saveCompany(companyId, dto, tenantId, req.user?.userId) };
  }
}
