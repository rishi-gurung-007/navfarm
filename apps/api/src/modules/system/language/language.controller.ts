import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { LanguageService } from './language.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../../common/guards/system-admin.guard';
import { ResolveTranslationDto, AddTranslationDto, CreateLanguageDto, UpdateLanguageDto } from './dto/language.dto';

@ApiTags('Localization Engine')
@Controller('language')
export class LanguageController {
  constructor(private readonly languageService: LanguageService) {}

  @Get()
  @ApiOperation({ summary: 'Fetch all active languages configured in the system' })
  async listLanguages() {
    return this.languageService.listLanguages();
  }

  @Post('resolve')
  @ApiOperation({ summary: 'Resolve UI label/message based on user and company priority settings' })
  async resolveTranslation(@Body() body: ResolveTranslationDto) {
    const value = await this.languageService.resolveTranslation(
      body.userId ?? null,
      body.companyId,
      body.moduleCode,
      body.key,
    );
    return { translation: value };
  }

  @Post('translation')
  // Translations are platform-wide copy; like the language CRUD beside it, only
  // a platform admin may write them. It was the one write left unguarded.
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register/Update translation record' })
  async addTranslation(@Body() body: AddTranslationDto) {
    return this.languageService.addTranslation(body.langId, body.moduleCode, body.key, body.value);
  }

  @Post()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Create a new supported display language' })
  async createLanguage(@Body() body: CreateLanguageDto) {
    return this.languageService.createLanguage(body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Update language configurations' })
  @ApiParam({ name: 'id', description: 'Language UUID' })
  async updateLanguage(@Param('id') id: string, @Body() body: UpdateLanguageDto) {
    return this.languageService.updateLanguage(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Delete a supported language' })
  @ApiParam({ name: 'id', description: 'Language UUID' })
  async deleteLanguage(@Param('id') id: string) {
    return this.languageService.deleteLanguage(id);
  }
}
