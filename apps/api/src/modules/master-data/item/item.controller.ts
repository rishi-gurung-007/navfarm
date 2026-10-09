import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Patch
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, resolve } from 'node:path';
import { ItemService } from './item.service';
import { CreateItemDto, UpdateItemDto, QueryItemDto, CreateItemFromTemplateDto } from './dto/item.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Item Master')
@ApiBearerAuth()
// Item Master (BBP-1 §1.5) places this catalog in Business Central. That integration is not built,
// so the catalog stays writable here and the frontend notice states the blueprint's
// position. Re-add a write guard when the BC sync endpoint lands.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller(['item', 'items'])
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

  @Post('from-template')
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Generate Item Number from Template and create draft Item Card' })
  async createFromTemplate(@Body() dto: CreateItemFromTemplateDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    const result = await this.itemService.createFromTemplate(dto, tenantId, companyId, req.user);
    return {
      success: true,
      message: 'Item generated from template successfully.',
      data: result,
    };
  }

  @Post('upload-image')
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Upload an Item photo to local disk and get back its served URL' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: resolve(process.env.UPLOADS_DIR || 'apps/api/uploads'),
        filename: (_req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `item-image-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
      fileFilter: (_req, file, cb) => {
        const allowed = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/heic']);
        if (!allowed.has(file.mimetype)) {
          return cb(new BadRequestException('Only PNG, JPG, WebP or HEIC images are allowed.'), false);
        }
        cb(null, true);
      },
    }),
  )
  async uploadImage(@UploadedFile() file: any) {
    if (!file) {
      throw new BadRequestException('No file was uploaded.');
    }
    return {
      success: true,
      message: 'Image uploaded successfully.',
      data: { url: `/uploads/${file.filename}` },
    };
  }

  @Post()
  @RequirePermission('MASTER_DATA', 'ITEM', 'create')
  @ApiOperation({ summary: 'Register a new Item with attributes' })
  async create(@Body() dto: CreateItemDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.create(dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item registered successfully.',
      data: result
    };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'List all Items matching filters' })
  async findAll(@Query() query: QueryItemDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.findAll(query, tenantId);
    return {
      success: true,
      message: 'Items retrieved successfully.',
      // `data` stays the array every caller already reads; total/limit/offset
      // are siblings the list screen pages on.
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'view')
  @ApiOperation({ summary: 'Fetch details of a single Item by UUID including mapped attributes' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async findOne(@Param('id') id: string) {
    const result = await this.itemService.findOne(id, true);
    return {
      success: true,
      message: 'Item details retrieved.',
      data: { ...result, has_inventory: await this.itemService.hasInventory(id) },
    };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Update details and attributes of an existing Item' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async update(@Param('id') id: string, @Body() dto: UpdateItemDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.update(id, dto, tenantId, req.user);
    return {
      success: true,
      message: 'Item updated successfully.',
      data: result
    };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'ITEM', 'delete')
  @ApiOperation({ summary: 'Deactivate (soft-delete) an Item profile' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.remove(id, tenantId, req.user);
    return result;
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'ITEM', 'edit')
  @ApiOperation({ summary: 'Restore a soft-deleted Item profile' })
  @ApiParam({ name: 'id', description: 'Item UUID' })
  async restore(@Param('id') id: string, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const result = await this.itemService.restore(id, tenantId, req.user);
    return {
      success: true,
      message: 'Item restored successfully.',
      data: result
    };
  }
}
