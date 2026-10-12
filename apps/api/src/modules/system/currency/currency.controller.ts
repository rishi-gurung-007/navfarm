import { BadRequestException, ForbiddenException, Req, Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CurrencyService, ExchangeRateWriteScope } from './currency.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import {
  UpdateExchangeRateDto, CreateCurrencyDto, UpdateCurrencyDto, QueryCurrencyDto,
  CreateExchangeRateDto, UpdateExchangeRateRowDto,
} from './dto/currency.dto';

/**
 * Writes were behind SystemAdminGuard, which is a platform-operator check: a
 * tenant administrator could read the currency list but could not add so much
 * as a single currency to it. That was fine while nothing had a screen, and
 * wrong the moment Currencies became a master-data master the client maintains.
 * They now sit behind the same MASTER_DATA/<RESOURCE> permission every other
 * master uses, so a role can be granted them.
 */
@ApiTags('Currency Exchange Engine')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('currency')
export class CurrencyController {
  constructor(private readonly currencyService: CurrencyService) {}

  private exchangeRateWriteScope(req: any): ExchangeRateWriteScope {
    if (req.headers?.['x-workspace-scope'] === 'TENANT') {
      if (!['SYSTEM_ADMIN', 'TENANT_ADMIN'].includes(req.user?.userType)) {
        throw new ForbiddenException('Only a System or Tenant Admin can change legacy tenant-wide exchange rates.');
      }
      return { companyId: null, allowLegacyWrite: true };
    }
    const companyId = req.headers?.['x-active-company-id'] || req.user?.companyId;
    if (!companyId) throw new BadRequestException('Select a company workspace to change exchange rates.');
    return { companyId, allowLegacyWrite: false };
  }

  @Get()
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'view')
  @ApiOperation({ summary: 'List currencies matching filters' })
  async listCurrencies(@Query() query: QueryCurrencyDto) {
    const data = await this.currencyService.listCurrencies(query);
    return { success: true, message: 'Currencies retrieved successfully.', data };
  }

  @Get('rates')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'view')
  @ApiOperation({ summary: 'List exchange rates for the Exchange Rates tab' })
  async listRates(@Req() req: any) {
    const companyId = req.headers['x-workspace-scope'] === 'TENANT' ? null : (req.headers['x-active-company-id'] || req.user?.companyId);
    const data = await this.currencyService.listExchangeRates(companyId);
    return { success: true, message: 'Exchange rates retrieved successfully.', data };
  }

  @Post('rates')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'create')
  @ApiOperation({ summary: "Record a conversion rate; an omitted source uses the active company's base currency." })
  async createRate(@Body() body: CreateExchangeRateDto, @Req() req: any) {
    const scope = this.exchangeRateWriteScope(req);
    const data = await this.currencyService.createRate(body, scope.companyId);
    return { success: true, message: 'Exchange rate recorded successfully.', data };
  }

  @Put('rates/:rateId')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'edit')
  @ApiOperation({ summary: 'Update an exchange rate' })
  @ApiParam({ name: 'rateId', description: 'Exchange rate UUID' })
  async updateRate(@Param('rateId') rateId: string, @Body() body: UpdateExchangeRateRowDto, @Req() req: any) {
    const data = await this.currencyService.updateRate(rateId, body, this.exchangeRateWriteScope(req));
    return { success: true, message: 'Exchange rate updated successfully.', data };
  }

  @Delete('rates/:rateId')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'delete')
  @ApiOperation({ summary: 'Delete an exchange rate' })
  @ApiParam({ name: 'rateId', description: 'Exchange rate UUID' })
  async deleteRate(@Param('rateId') rateId: string, @Req() req: any) {
    const data = await this.currencyService.deleteRate(rateId, this.exchangeRateWriteScope(req));
    return { success: true, message: 'Exchange rate deleted successfully.', data };
  }

  @Post('rate')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'create')
  @ApiOperation({ summary: 'Register/Update conversion exchange rate' })
  async updateExchangeRate(@Body() body: UpdateExchangeRateDto, @Req() req: any) {
    const scope = this.exchangeRateWriteScope(req);
    return this.currencyService.updateExchangeRate(
      body.fromCurrencyId,
      body.toCurrencyId,
      body.rate,
      body.source,
      body.rateDate,
      scope.companyId,
    );
  }

  @Post()
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'create')
  @ApiOperation({ summary: 'Create a currency' })
  async createCurrency(@Body() body: CreateCurrencyDto) {
    const data = await this.currencyService.createCurrency(body);
    return { success: true, message: 'Currency created successfully.', data };
  }

  @Put(':id')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'edit')
  @ApiOperation({ summary: 'Update currency details' })
  @ApiParam({ name: 'id', description: 'Currency UUID' })
  async updateCurrency(@Param('id') id: string, @Body() body: UpdateCurrencyDto) {
    const data = await this.currencyService.updateCurrency(id, body);
    return { success: true, message: 'Currency updated successfully.', data };
  }

  @Patch(':id/restore')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'edit')
  @ApiOperation({ summary: 'Reactivate a retired currency' })
  @ApiParam({ name: 'id', description: 'Currency UUID' })
  async restoreCurrency(@Param('id') id: string) {
    const data = await this.currencyService.restoreCurrency(id);
    return { success: true, message: 'Currency restored successfully.', data };
  }

  @Delete(':id')
  @RequirePermission('MASTER_DATA', 'CURRENCY', 'delete')
  @ApiOperation({ summary: 'Retire a currency (deactivates; rates and history are kept)' })
  @ApiParam({ name: 'id', description: 'Currency UUID' })
  async deleteCurrency(@Param('id') id: string) {
    const data = await this.currencyService.deleteCurrency(id);
    return { success: true, message: 'Currency deactivated successfully.', data };
  }
}
