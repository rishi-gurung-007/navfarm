import { Controller, Get, Post, Put, Delete, Param, Body, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JournalService } from './journal.service';
import { CreateJournalDto, UpdateJournalDto, QueryJournalDto } from './dto/journal.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Journal Entries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('journal')
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Post()
  @RequirePermission('FINANCE', 'JOURNAL', 'create')
  @ApiOperation({ summary: 'Create a draft manual Journal Entry with lines' })
  async create(@Body() dto: CreateJournalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.journalService.create(dto, tenantId, req.user);
    return { success: true, message: 'Journal Entry draft created successfully.', data: result };
  }

  @Get()
  @RequirePermission('FINANCE', 'JOURNAL', 'view')
  @ApiOperation({ summary: 'List Journal Entries matching filters' })
  async findAll(@Query() query: QueryJournalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.journalService.findAll(query, tenantId);
    return { success: true, message: 'Journal Entries retrieved successfully.', data: result };
  }

  @Get(':id/source-document')
  @RequirePermission('FINANCE', 'JOURNAL', 'view')
  @ApiOperation({ summary: 'The document a system Journal Entry was posted from, read-only, with names filled in' })
  @ApiParam({ name: 'id', description: 'Journal Entry UUID' })
  async findSourceDocument(@Param('id') id: string) {
    const result = await this.journalService.findSourceDocument(id);
    return { success: true, message: 'Source document retrieved.', data: result };
  }

  @Get(':id')
  @RequirePermission('FINANCE', 'JOURNAL', 'view')
  @ApiOperation({ summary: 'Fetch a single Journal Entry with its lines' })
  @ApiParam({ name: 'id', description: 'Journal Entry UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.journalService.findOne(id);
    return { success: true, message: 'Journal Entry details retrieved.', data: result };
  }

  @Put(':id')
  @RequirePermission('FINANCE', 'JOURNAL', 'edit')
  @ApiOperation({ summary: 'Update a DRAFT Journal Entry (header and/or lines)' })
  @ApiParam({ name: 'id', description: 'Journal Entry UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateJournalDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.journalService.update(id, dto, tenantId, req.user);
    return { success: true, message: 'Journal Entry updated successfully.', data: result };
  }

  @Delete(':id')
  @RequirePermission('FINANCE', 'JOURNAL', 'delete')
  @ApiOperation({ summary: 'Cancel a DRAFT Journal Entry' })
  @ApiParam({ name: 'id', description: 'Journal Entry UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    return this.journalService.remove(id, tenantId, req.user);
  }

  @Post(':id/post')
  @RequirePermission('FINANCE', 'JOURNAL', 'edit')
  @ApiOperation({ summary: 'Post a DRAFT Journal Entry — validates it balances (debits = credits) and locks it' })
  @ApiParam({ name: 'id', description: 'Journal Entry UUID' })
  async post(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.journalService.post(id, tenantId, req.user);
    return { success: true, message: 'Journal Entry posted successfully.', data: result };
  }
}
