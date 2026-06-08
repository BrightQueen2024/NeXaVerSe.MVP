import { Controller, Post, Get, Body, Param, Query, HttpStatus, HttpException } from '@nestjs/common';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Post('engagement')
  async recordEngagement(
    @Body() body: { postId: string; type: 'view' | 'like' | 'share'; count?: number }
  ) {
    if (!body.postId || !body.type) {
      throw new HttpException('postId and type are required', HttpStatus.BAD_REQUEST);
    }
    if (!['view', 'like', 'share'].includes(body.type)) {
      throw new HttpException('Invalid engagement type', HttpStatus.BAD_REQUEST);
    }

    await this.feedService.recordEngagement(body.postId, body.type, body.count || 1);
    return {
      statusCode: HttpStatus.OK,
      message: 'Engagement recorded successfully.',
    };
  }

  @Post('link')
  async linkPost(
    @Body() body: { postId: string; linkerId: string }
  ) {
    if (!body.postId || !body.linkerId) {
      throw new HttpException('postId and linkerId are required', HttpStatus.BAD_REQUEST);
    }

    await this.feedService.registerNexLink(body.postId, body.linkerId);
    return {
      statusCode: HttpStatus.CREATED,
      message: 'NexLink curation referral registered.',
    };
  }

  @Get('rewards/:postId')
  async getRewards(
    @Param('postId') postId: string,
    @Query('creator_id') creatorId: string,
    @Query('category') category: 'STANDARD' | 'EDUCATIONAL' | 'DIVINE' = 'STANDARD',
  ) {
    if (!creatorId) {
      throw new HttpException('creator_id is required', HttpStatus.BAD_REQUEST);
    }

    return this.feedService.calculateNexaRewards(postId, creatorId, category);
  }
}
