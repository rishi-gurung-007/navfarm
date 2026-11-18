import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../../common/guards/system-admin.guard';
import { BcConnectionService } from './bc-connection.service';

/**
 * Platform-administrator diagnostics for the Business Central connection. Read-only; returns no credentials.
 */
@ApiTags('Integration — Business Central')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SystemAdminGuard)
@Controller('integration/business-central')
export class BusinessCentralController {
  constructor(private readonly connection: BcConnectionService) {}

  @Get('status')
  @ApiOperation({
    summary: 'Test the Business Central connection step by step (configuration → token → environment → company)',
  })
  status() {
    return this.connection.check();
  }

  @Get('companies')
  @ApiOperation({ summary: 'Companies in the configured Business Central environment' })
  companies() {
    return this.connection.listCompanies();
  }
}
