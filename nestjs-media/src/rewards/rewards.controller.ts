import { Controller, Post, Get, Body, Param, Headers, HttpStatus, HttpException } from '@nestjs/common';
import { RewardsService } from './rewards.service';

@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('dashboard/:userId')
  async getDashboard(@Param('userId') userId: string) {
    if (!userId) {
      throw new HttpException('userId parameter is required', HttpStatus.BAD_REQUEST);
    }
    return this.rewardsService.getDashboard(userId);
  }

  @Post('register-referral')
  async registerReferral(
    @Headers('X-User-Id') referrerId: string,
    @Body() body: { referredId: string }
  ) {
    if (!referrerId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.referredId) {
      throw new HttpException('referredId is required to map referral linkage', HttpStatus.BAD_REQUEST);
    }

    return this.rewardsService.registerReferral(referrerId, body.referredId);
  }

  @Get('leaderboard')
  async getLeaderboard() {
    return this.rewardsService.getLeaderboard();
  }
}
