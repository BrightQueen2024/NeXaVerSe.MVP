import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Db } from 'mongodb';

@Injectable()
export class RewardsService {
  private readonly logger = new Logger(RewardsService.name);

  constructor(@Inject('MONGO_DB') private readonly db: Db) {}

  private getLedgerUrl(): string {
    return process.env.LEDGER_URL || 'http://localhost:8081';
  }

  async getDashboard(userId: string) {
    this.logger.log(`Fetching rewards dashboard for user: ${userId}`);

    // 1. Get XP & loyalty balance
    const balance = await this.db.collection('loyalty_balances').findOne({ userId });
    const xp = balance ? balance.xp : 0;
    const lifetimeRewards = balance ? balance.lifetimeRewards : 0;

    // 2. Count referrals
    const referrals = await this.db.collection('referrals').find({ referrerId: userId }).toArray();
    const pendingCount = referrals.filter(r => r.status === 'PENDING_KYC').length;
    const paidCount = referrals.filter(r => r.status === 'REWARD_PAID').length;

    // 3. Fetch badges
    const badgesDoc = await this.db.collection('achievement_badges').find({ userId }).toArray();
    const badges = badgesDoc.map(b => b.badgeKey);

    return {
      userId,
      xp,
      lifetimeRewards,
      pendingReferralsCount: pendingCount,
      paidReferralsCount: paidCount,
      badges,
      referralCode: `NEXA-REF-${userId.toUpperCase()}`,
    };
  }

  async registerReferral(referrerId: string, referredId: string) {
    this.logger.log(`Registering referral mapping: ${referredId} invited by ${referrerId}`);

    if (referrerId === referredId) {
      throw new HttpException('Users cannot refer themselves', HttpStatus.BAD_REQUEST);
    }

    const existing = await this.db.collection('referrals').findOne({ referredId });
    if (existing) {
      throw new HttpException('Referred user is already mapped to a referrer', HttpStatus.CONFLICT);
    }

    await this.db.collection('referrals').insertOne({
      referrerId,
      referredId,
      status: 'PENDING_KYC',
      createdAt: new Date(),
    });

    return {
      success: true,
      message: 'Referral link registered under PENDING_KYC status.',
    };
  }

  async processKycReward(referredId: string) {
    this.logger.log(`Scanning referrals mapping for newly KYC-verified user: ${referredId}`);

    const record = await this.db.collection('referrals').findOne({ referredId, status: 'PENDING_KYC' });
    if (!record) {
      return; // No pending referral found, skip reward payouts
    }

    const referrerId = record.referrerId;
    this.logger.log(`Processing referral reward: crediting 25 NEXA to referrer ${referrerId} for verifying ${referredId}`);

    // 1. Update status
    await this.db.collection('referrals').updateOne(
      { referredId },
      { $set: { status: 'REWARD_PAID', rewardedAt: new Date() } }
    );

    // 2. Increment Referrer XP by 500
    await this.db.collection('loyalty_balances').updateOne(
      { userId: referrerId },
      { $inc: { xp: 500 } },
      { upsert: true }
    );

    // 3. Dispatch 25.0 NEXA payout transfer via Rust Ledger
    const ledgerUrl = this.getLedgerUrl();
    const idempotencyKey = `ref-reward-${referredId}`;

    try {
      await fetch(`${ledgerUrl}/wallet/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'X-User-Id': 'nexa_rewards_treasury',
        },
        body: JSON.stringify({
          receiver_id: referrerId,
          amount: 25.00,
        }),
      });
      this.logger.log(`Referral payment successfully settled for referrer ${referrerId}`);
    } catch (err) {
      this.logger.error(`Failed to transfer referral reward to ${referrerId}: ${err.message}`);
    }
  }

  async processMarketplaceCashback(orderId: string) {
    this.logger.log(`Calculating marketplace cashback for finalized order: ${orderId}`);

    // 1. Fetch order details from MongoDB
    const order = await this.db.collection('orders').findOne({ orderId });
    if (!order) {
      this.logger.warn(`Order ${orderId} not found in database. Skipping cashback.`);
      return;
    }

    const buyerId = order.buyerId;
    const priceNum = parseFloat(order.totalPrice.toString());
    const cashback = priceNum * 0.01; // 1% cashback

    this.logger.log(`Cashback calculation: 1% of ${priceNum} NEXA = ${cashback} NEXA for buyer ${buyerId}`);

    // 2. Add 100 XP to buyer
    await this.db.collection('loyalty_balances').updateOne(
      { userId: buyerId },
      { $inc: { xp: 100 } },
      { upsert: true }
    );

    if (cashback > 0) {
      // 3. Dispatch cashback payout via Rust Ledger
      const ledgerUrl = this.getLedgerUrl();
      const idempotencyKey = `cashback-order-${orderId}`;

      try {
        await fetch(`${ledgerUrl}/wallet/transfer`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
            'X-User-Id': 'nexa_rewards_treasury',
          },
          body: JSON.stringify({
            receiver_id: buyerId,
            amount: cashback,
          }),
        });

        // 4. Update lifetime rewards tracking
        await this.db.collection('loyalty_balances').updateOne(
          { userId: buyerId },
          { $inc: { lifetimeRewards: cashback } }
        );
        this.logger.log(`Cashback of ${cashback} NEXA transferred to buyer ${buyerId}`);
      } catch (err) {
        this.logger.error(`Failed to transfer cashback reward to ${buyerId}: ${err.message}`);
      }
    }

    // 5. Evaluate milestone achievements
    await this.checkMilestones(buyerId);
  }

  async checkMilestones(userId: string) {
    this.logger.log(`Auditing milestone achievements for user: ${userId}`);

    // 1. Audit Completed Orders Milestone
    const completedOrders = await this.db.collection('orders').countDocuments({
      buyerId: userId,
      status: 'COMPLETED'
    });

    if (completedOrders >= 3) {
      const added = await this.awardBadge(userId, 'MERCH_KING');
      if (added) {
        this.logger.log(`User ${userId} unlocked milestone achievement: MERCH_KING`);
      }
    }

    // 2. Audit Staking lock Milestone
    try {
      const ledgerUrl = this.getLedgerUrl();
      const response = await fetch(`${ledgerUrl}/staking/dashboard/${userId}`);
      if (response.ok) {
        const stakingData = await response.json();
        const stakedNum = parseFloat(stakingData.total_staked?.toString() || '0');
        if (stakedNum > 0) {
          const added = await this.awardBadge(userId, 'LOCK_MASTER');
          if (added) {
            this.logger.log(`User ${userId} unlocked milestone achievement: LOCK_MASTER`);
          }
        }
      }
    } catch (err) {
      this.logger.error(`Staking dashboard check failed during milestones audit: ${err.message}`);
    }
  }

  private async awardBadge(userId: string, badgeKey: string): Promise<boolean> {
    const existing = await this.db.collection('achievement_badges').findOne({ userId, badgeKey });
    if (existing) {
      return false; // Already unlocked
    }

    // Award badge
    await this.db.collection('achievement_badges').insertOne({
      userId,
      badgeKey,
      awardedAt: new Date(),
    });

    // Award 500 XP milestone bonus
    await this.db.collection('loyalty_balances').updateOne(
      { userId },
      { $inc: { xp: 500 } },
      { upsert: true }
    );

    return true;
  }

  async getLeaderboard() {
    this.logger.log('Retrieving global loyalty XP leaderboard...');
    const leaderboard = await this.db.collection('loyalty_balances')
      .find({})
      .sort({ xp: -1 })
      .limit(10)
      .toArray();

    return leaderboard.map(l => ({
      userId: l.userId,
      xp: l.xp,
      lifetimeRewards: l.lifetimeRewards,
    }));
  }
}
