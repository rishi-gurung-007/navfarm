import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { FarmScoped } from '../../../common/farm-scope';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CreateFeedStockCountDto, QueryFeedStockCountDto, UpdateFeedStockCountDto } from './dto/feed-stock-count.dto';
import { FeedStockCountService } from './feed-stock-count.service';

@ApiTags('Feed Stock Count')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feed-stock-count')
@FarmScoped()
export class FeedStockCountController {
  constructor(private readonly service: FeedStockCountService) {}

  @Get()
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'List physical silo counts for one authorized farm' })
  async list(@Query() query: QueryFeedStockCountDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return { success: true, data: await this.service.list(query, tenantId) };
  }

  @Get(':id')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: 'Read one physical silo count and its immutable snapshot evidence' })
  async detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return { success: true, data: await this.service.findOne(id, tenantId) };
  }

  @Post()
  @RequirePermission('INVENTORY', 'LEDGER', 'create')
  @ApiOperation({ summary: 'Capture a draft physical silo count from ledger evidence' })
  async create(@Body() dto: CreateFeedStockCountDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return { success: true, data: await this.service.create(dto, tenantId, req.user) };
  }

  @Put(':id')
  @RequirePermission('INVENTORY', 'LEDGER', 'edit')
  @ApiOperation({ summary: 'Correct counted quantity or reason while the count is draft' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateFeedStockCountDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return { success: true, data: await this.service.update(id, dto, tenantId, req.user) };
  }

  @Post(':id/submit')
  @RequirePermission('INVENTORY', 'LEDGER', 'edit')
  @ApiOperation({ summary: 'Submit draft evidence for later approval; does not post inventory' })
  async submit(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req.tenantId;
    return { success: true, data: await this.service.submit(id, tenantId, req.user) };
  }
}
