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
    if (process.env.REDIS_URL) {
      this.redis = new Redis(process.env.REDIS_URL);
    } else {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      });
    }
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

    // Fetch creator's staking tier to apply booster multiplier
    let stakingBooster = 1.0;
    let stakingTier = 'NONE';
    try {
      const ledgerUrl = process.env.LEDGER_URL || 'http://localhost:8081';
      const response = await fetch(`${ledgerUrl}/staking/dashboard/${creatorId}`);
      if (response.ok) {
        const stakingData = await response.json();
        stakingTier = stakingData.current_tier || 'NONE';
        if (stakingTier === 'BRONZE') stakingBooster = 1.0;
        else if (stakingTier === 'SILVER') stakingBooster = 1.5;
        else if (stakingTier === 'GOLD') stakingBooster = 2.2;
        else if (stakingTier === 'PLATINUM') stakingBooster = 3.5;
      }
    } catch (err) {
      this.logger.error(`Failed to fetch creator staking tier: ${err.message}`);
    }

    // NexLink Content Routing Graph Split Check (Creator vs Linker)
    // Check if this content has a referral link relationship in Redis
    const linkerId = await this.redis.get(`nexlink:origin:${postId}`);

    if (linkerId) {
      const creatorShare = totalNexaReward * 0.60 * stakingBooster;
      const linkerShare = totalNexaReward * 0.40;

      this.logger.log(`Post ${postId} contains active NexLink. Curation Split: 60% with ${stakingBooster}x staking boost (${creatorShare} NEXA) to Creator ${creatorId}, 40% (${linkerShare} NEXA) to Linker ${linkerId}`);

      return {
        postId,
        engagementScore: es,
        multiplier,
        stakingTier,
        stakingBooster,
        totalReward: creatorShare + linkerShare,
        splits: [
          { recipientId: creatorId, role: 'CREATOR', amount: creatorShare },
          { recipientId: linkerId, role: 'LINKER', amount: linkerShare }
        ]
      };
    }

    const boostedTotal = totalNexaReward * stakingBooster;
    return {
      postId,
      engagementScore: es,
      multiplier,
      stakingTier,
      stakingBooster,
      totalReward: boostedTotal,
      splits: [
        { recipientId: creatorId, role: 'CREATOR', amount: boostedTotal }
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
