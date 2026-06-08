import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);
  private redis: Redis;

  // Weight constants
  private readonly W_VIEW = 1.0;
  private readonly W_LIKE = 3.0;
  private readonly W_SHARE = 5.0;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  // Record an engagement event inside hourly Redis buckets
  async recordEngagement(postId: string, type: 'view' | 'like' | 'share', count: number = 1) {
    const currentHour = Math.floor(Date.now() / 3600000); // Unix timestamp in hours
    const bucketKey = `feed:engagement:${postId}:${type}`;
    
    // Increment count in the hourly bucket
    await this.redis.hincrby(bucketKey, currentHour.toString(), count);
    // Set 48 hour TTL to automatically clean up old buckets
    await this.redis.expire(bucketKey, 172800); 

    this.logger.log(`Recorded ${type} for post ${postId} in hour bucket ${currentHour}`);
  }

  // Calculate moving 24h Engagement Score (ES) in O(1)
  async getMovingEngagementScore(postId: string): Promise<number> {
    const currentHour = Math.floor(Date.now() / 3600000);
    const hours24Ago = currentHour - 24;

    const views = await this.sumBucketValues(`feed:engagement:${postId}:view`, hours24Ago, currentHour);
    const likes = await this.sumBucketValues(`feed:engagement:${postId}:like`, hours24Ago, currentHour);
    const shares = await this.sumBucketValues(`feed:engagement:${postId}:share`, hours24Ago, currentHour);

    return (views * this.W_VIEW) + (likes * this.W_LIKE) + (shares * this.W_SHARE);
  }

  private async sumBucketValues(key: string, startHour: number, endHour: number): Promise<number> {
    const fields = [];
    for (let h = startHour; h <= endHour; h++) {
      fields.push(h.toString());
    }

    const values = await this.redis.hmget(key, ...fields);
    return values.reduce((sum, val) => sum + (val ? parseInt(val) : 0), 0);
  }

  // Calculate NEXA distributions based on category multipliers & splits
  async calculateNexaRewards(postId: string, creatorId: string, category: 'STANDARD' | 'EDUCATIONAL' | 'DIVINE'): Promise<any> {
    const es = await this.getMovingEngagementScore(postId);

    // Dynamic Category Multiplier
    let multiplier = 1.0;
    if (category === 'EDUCATIONAL') multiplier = 2.5;
    if (category === 'DIVINE') multiplier = 5.0;

    const totalNexaReward = es * multiplier * 0.1; // Base conversion factor of 0.1 NEXA per point

    // NexLink Content Routing Graph Split Check (Creator vs Linker)
    // Check if this content has a referral link relationship in Redis
    const linkerId = await this.redis.get(`nexlink:origin:${postId}`);

    if (linkerId) {
      const creatorShare = totalNexaReward * 0.60;
      const linkerShare = totalNexaReward * 0.40;

      this.logger.log(`Post ${postId} contains active NexLink. Curation Split: 60% (${creatorShare} NEXA) to Creator ${creatorId}, 40% (${linkerShare} NEXA) to Linker ${linkerId}`);

      return {
        postId,
        engagementScore: es,
        multiplier,
        totalReward: totalNexaReward,
        splits: [
          { recipientId: creatorId, role: 'CREATOR', amount: creatorShare },
          { recipientId: linkerId, role: 'LINKER', amount: linkerShare }
        ]
      };
    }

    return {
      postId,
      engagementScore: es,
      multiplier,
      totalReward: totalNexaReward,
      splits: [
        { recipientId: creatorId, role: 'CREATOR', amount: totalNexaReward }
      ]
    };
  }

  // Register a curation link in the NexLink Graph
  async registerNexLink(postId: string, linkerId: string) {
    // Graph relationship stored as key mapping in Redis for fast split route extraction
    await this.redis.set(`nexlink:origin:${postId}`, linkerId);
    this.logger.log(`Registered NexLink relationship: Linker ${linkerId} shared Post ${postId}`);
  }
}
