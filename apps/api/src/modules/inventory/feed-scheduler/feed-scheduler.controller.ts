import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { isAdminUserType } from '../../../common/permissions';
import { FeedSchedulerService } from './feed-scheduler.service';
import { FEED_JOBS, isFeedJob } from './feed-scheduler.rules';
import { QueryFeedRunsDto, RunFeedJobDto } from './feed-scheduler.dto';

/**
 * Brief B, item 3: a manual "Run now" per scheduler job, admin only, for
 * testing. A COMPANY_ADMIN runs only their own company's farms; TENANT_ADMIN
 * and SYSTEM_ADMIN any company of the tenant.
 */
@ApiTags('Feed Scheduler')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feed-scheduler')
export class FeedSchedulerController {
  constructor(private readonly scheduler: FeedSchedulerService) {}

  private admin(req: any) {
    const user = req.user;
    if (!isAdminUserType(user?.userType)) throw new ForbiddenException('Only an administrator can run feed scheduler jobs.');
    return user;
  }

  @Post('run/:job')
  @HttpCode(200)
  @ApiParam({ name: 'job', enum: FEED_JOBS })
  @ApiOperation({ summary: 'Run one feed scheduler job now for the chosen farms (admin only, for testing)' })
  async run(@Param('job') job: string, @Body() dto: RunFeedJobDto, @Req() req: any) {
    const user = this.admin(req);
    if (!isFeedJob(job)) throw new BadRequestException(`Job must be one of ${FEED_JOBS.join(', ')}.`);
    let companyId = dto?.companyId;
    if (user.userType === 'COMPANY_ADMIN') {
      if (companyId && companyId !== user.companyId) throw new ForbiddenException('Not authorized for this company.');
      companyId = user.companyId;
    }
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.scheduler.runNow(job, { companyId, farmId: dto?.farmId }, tenantId, user.userId);
    return { success: true, message: `Feed scheduler job ${job} ran.`, data };
  }

  @Get('runs')
  @ApiOperation({ summary: 'Recent feed scheduler runs of this tenant (admin only)' })
  async runs(@Query() query: QueryFeedRunsDto, @Req() req: any) {
    this.admin(req);
    const data = await this.scheduler.recentRuns(req.user?.tenantId || req['tenantId'], query.limit ?? 50);
    return { success: true, message: 'Feed scheduler runs retrieved successfully.', data };
  }
}
