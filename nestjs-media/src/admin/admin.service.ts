import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(@Inject('MONGO_DB') private readonly db: Db) {}

  private getLedgerUrl(): string {
    return process.env.LEDGER_URL || 'http://localhost:8081';
  }

  async getSummaryStats() {
    this.logger.log('Calculating ecosystem summary stats for Admin dashboard...');

    // 1. Total users from loyalty_balances (or simple default)
    const usersCount = await this.db.collection('loyalty_balances').countDocuments();

    // 2. Query ledger or use default baseline (e.g. 105,000,000 NEXA baseline)
    let circulatingNexa = 105000000.00;
    let escrowLockValue = 0.00;
    let activeEscrowsCount = 0;

    const ledgerUrl = this.getLedgerUrl();
    try {
      // Fetch active escrows count and values if ledger exposes them or we calculate from mock/DB
      const orders = await this.db.collection('orders').find({}).toArray();
      const activeOrders = orders.filter(o => o.status === 'PAID_LOCKED' || o.status === 'SHIPPED');
      activeEscrowsCount = activeOrders.length;
      
      escrowLockValue = activeOrders.reduce((sum, o) => sum + parseFloat(o.totalPrice.toString()), 0);
    } catch (err) {
      this.logger.error(`Error aggregating orders for admin stats: ${err.message}`);
    }

    return {
      usersCount: usersCount || 10,
      circulatingNexa,
      escrowLockValue,
      activeEscrowsCount,
      activeUsers24h: 120,
      tpsPeak: 14.5
    };
  }

  async getAlerts(status?: string) {
    this.logger.log(`Fetching alerts. Filter status: ${status || 'ALL'}`);
    const query = status ? { status } : {};
    return this.db.collection('system_alerts').find(query).toArray();
  }

  async resolveAlert(alertId: string, resolution: string) {
    this.logger.log(`Resolving system alert: ${alertId} with explanation: ${resolution}`);

    if (!ObjectId.isValid(alertId)) {
      throw new HttpException('Invalid alert ID format', HttpStatus.BAD_REQUEST);
    }

    const update = await this.db.collection('system_alerts').updateOne(
      { _id: new ObjectId(alertId) },
      { $set: { status: 'RESOLVED', resolution, resolvedAt: new Date() } }
    );

    if (update.matchedCount === 0) {
      throw new HttpException('System alert not found', HttpStatus.NOT_FOUND);
    }

    return { success: true, alertId, status: 'RESOLVED' };
  }

  async getPendingKyc() {
    this.logger.log('Fetching pending business verification applications...');
    return this.db.collection('business_profiles').find({ verified: false }).toArray();
  }

  async runFraudDetectionAudit() {
    this.logger.log('Starting automated fraud detection audit...');

    const ledgerUrl = this.getLedgerUrl();
    try {
      const response = await fetch(`${ledgerUrl}/wallet/transactions`);
      if (!response.ok) {
        this.logger.error(`Failed to fetch transactions from ledger: ${response.statusText}`);
        return;
      }
      const transactions = await response.json();
      
      // Analyze transaction outbox records
      const now = new Date();
      
      // 1. Audit High Value Unverified Transfers (> 50,000 NEXA)
      for (const tx of transactions) {
        const amount = parseFloat(tx.amount.toString());
        if (amount > 50000.0) {
          const senderId = tx.sender_address;
          
          // Check KYC status of the sender
          const kycRecord = await this.db.collection('referrals').findOne({ referredId: senderId });
          // If sender has no verified record or KYC is not complete, flag it
          let isVerified = false;
          try {
            const kycStatus = await this.db.collection('kyc_status').findOne({ userId: senderId });
            isVerified = kycStatus && kycStatus.status === 'VERIFIED';
          } catch (e) {}

          if (!isVerified) {
            // Check if alert already exists for this transaction
            const exists = await this.db.collection('system_alerts').findOne({
              'details.txId': tx.id
            });
            if (!exists) {
              await this.db.collection('system_alerts').insertOne({
                alertType: 'HIGH_VALUE_UNVERIFIED',
                severity: 'CRITICAL',
                details: {
                  txId: tx.id,
                  userId: senderId,
                  amount,
                  timestamp: tx.created_at || now
                },
                status: 'OPEN',
                createdAt: new Date()
              });
              this.logger.warn(`FRAUD DETECTED: Flagged HIGH_VALUE_UNVERIFIED transfer for user ${senderId} of ${amount} NEXA`);
            }
          }
        }
      }

      // 2. Audit Velocity Exceeded (more than 5 transfers within 60 seconds)
      // Group recent transactions by sender
      const recentTxs = transactions.filter((tx: any) => {
        const txTime = new Date(tx.created_at || now);
        const diffMs = now.getTime() - txTime.getTime();
        return diffMs <= 60000; // Last 60 seconds
      });

      const senderCounts: { [key: string]: string[] } = {};
      for (const tx of recentTxs) {
        const sender = tx.sender_address;
        if (!senderCounts[sender]) {
          senderCounts[sender] = [];
        }
        senderCounts[sender].push(tx.id);
      }

      for (const [sender, txIds] of Object.entries(senderCounts)) {
        if (txIds.length > 5) {
          // Check if alert already exists for this sender's velocity within the hour
          const oneHourAgo = new Date(now.getTime() - 3600000);
          const exists = await this.db.collection('system_alerts').findOne({
            alertType: 'VELOCITY_EXCEEDED',
            'details.userId': sender,
            createdAt: { $gte: oneHourAgo }
          });
          if (!exists) {
            await this.db.collection('system_alerts').insertOne({
              alertType: 'VELOCITY_EXCEEDED',
              severity: 'WARNING',
              details: {
                userId: sender,
                txCount: txIds.length,
                txIds
              },
              status: 'OPEN',
              createdAt: new Date()
            });
            this.logger.warn(`FRAUD DETECTED: Flagged VELOCITY_EXCEEDED transfer patterns for user ${sender} (Count: ${txIds.length})`);
          }
        }
      }

    } catch (err) {
      this.logger.error(`Fraud detection audit cycle failed: ${err.message}`);
    }
  }
}
