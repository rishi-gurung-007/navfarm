import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CountryService } from './country.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { SystemAdminGuard } from '../../../common/guards/system-admin.guard';
import { CreateCountryDto, UpdateCountryDto, CreateStateDto, UpdateStateDto } from './dto/country.dto';
import { QueryCountryDto } from './dto/country.dto';

@ApiTags('Country & State Master')
@Controller('country')
export class CountryController {
  constructor(private readonly countryService: CountryService) {}

  @Get()
  @ApiOperation({ summary: 'List countries matching filters' })
  async listCountries(@Query() query: QueryCountryDto) {
    const result = await this.countryService.listCountries(query);
    // `data` stays the array every picker already reads.
    return { success: true, message: 'Countries retrieved successfully.', ...result };
  }

  @Post()
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Create a new supported country' })
  async createCountry(@Body() body: CreateCountryDto) {
    return this.countryService.createCountry(body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Update country details' })
  @ApiParam({ name: 'id', description: 'Country UUID' })
  async updateCountry(@Param('id') id: string, @Body() body: UpdateCountryDto) {
    return this.countryService.updateCountry(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Delete a country' })
  @ApiParam({ name: 'id', description: 'Country UUID' })
  async deleteCountry(@Param('id') id: string) {
    return this.countryService.deleteCountry(id);
  }

  @Get(':id/states')
  @ApiOperation({ summary: 'Fetch all active states/provinces for a country' })
  @ApiParam({ name: 'id', description: 'Country UUID' })
  async listStates(@Param('id') id: string) {
    return this.countryService.listStates(id);
  }

  @Post(':id/states')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Add a state/province to a country' })
  @ApiParam({ name: 'id', description: 'Country UUID' })
  async createState(@Param('id') id: string, @Body() body: CreateStateDto) {
    return this.countryService.createState(id, body);
  }

  @Put('states/:stateId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Update a state/province' })
  @ApiParam({ name: 'stateId', description: 'State UUID' })
  async updateState(@Param('stateId') stateId: string, @Body() body: UpdateStateDto) {
    return this.countryService.updateState(stateId, body);
  }

  @Delete('states/:stateId')
  @UseGuards(JwtAuthGuard, SystemAdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Platform Admin: Delete a state/province' })
  @ApiParam({ name: 'stateId', description: 'State UUID' })
  async deleteState(@Param('stateId') stateId: string) {
    return this.countryService.deleteState(stateId);
  }
}
