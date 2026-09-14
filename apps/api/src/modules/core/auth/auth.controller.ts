import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, Request, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterAdminDto } from './dto/register-admin.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Deliberately unguarded: the first user of an empty tenant registers with no
  // session. AuthService.registerAdmin verifies any bearer token itself and
  // requires one once the tenant has users.
  @Post('register-admin')
  @ApiOperation({ summary: 'Register the initial Company Admin (Step 9 of setup)' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Administrative account created successfully.' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Email address already exists.' })
  async registerAdmin(
    @Body() dto: RegisterAdminDto,
    @Request() req,
  ) {
    const authHeader = req?.headers?.authorization;
    return this.authService.registerAdmin(dto, authHeader);
  }

  // Same authorization as GET /user: this lists every user with roles and
  // phone numbers, so a signed-in operator must not reach it on a session alone.
  // Admin user types pass RolesGuard without consulting the grant table.
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequirePermission('RBAC', 'USER', 'view')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all users in the active tenant workspace' })
  async listUsers(@Request() req) {
    return this.authService.listUsers(req.user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current logged-in user profile' })
  async getProfile(@Request() req) {
    return this.authService.getProfile(req.user.userId);
  }

  @Post('login')
  @ApiOperation({ summary: 'Authenticate user credentials' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Login successful (tokens returned) or MFA required.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid email or password.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Exchange a valid refresh token for a new access + refresh token pair' })
  @ApiResponse({ status: HttpStatus.OK, description: 'New tokens issued.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid or expired refresh token.' })
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refreshToken(dto.refresh_token);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the given refresh token, ending the session server-side' })
  async logout(@Body() dto: RefreshDto) {
    await this.authService.logout(dto.refresh_token);
    return { success: true };
  }

  @Post('mfa/verify')
  @ApiOperation({ summary: 'Verify 6-digit MFA TOTP code to complete login' })
  @ApiResponse({ status: HttpStatus.OK, description: 'MFA verified and tokens returned.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid code.' })
  async verifyMfa(@Body() dto: VerifyMfaDto) {
    return this.authService.verifyMfa(dto);
  }

  @Post('mfa/qr')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate and retrieve TOTP secret and QR code URI' })
  async generateMfaQr(@Request() req) {
    return this.authService.generateMfaQr(req.user.userId, req.user.email);
  }

  @Patch('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the current user\'s profile fields' })
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(req.user.userId, dto);
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the current user\'s password' })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(req.user.userId, dto);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the current user\'s active (non-revoked, non-expired) sessions' })
  async listSessions(@Request() req) {
    return this.authService.listSessions(req.user.userId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke one of the current user\'s sessions' })
  async revokeSession(@Request() req, @Param('sessionId') sessionId: string) {
    return this.authService.revokeSession(req.user.userId, sessionId);
  }

  @Get('notification-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the current user\'s per-category notification channel preferences' })
  async getNotificationPreferences(@Request() req) {
    return this.authService.getNotificationPreferences(req.user.userId);
  }

  @Patch('notification-preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the current user\'s notification channel preferences' })
  async updateNotificationPreferences(@Request() req, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.authService.updateNotificationPreferences(req.user.userId, dto);
  }
}
