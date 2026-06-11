import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
  }

  async registerBiometrics(userId: string, biometricPublicKey: string) {
    this.logger.log(`Registering biometric Secure Enclave public key for user: ${userId}`);
    await this.redis.set(`kyc:biometrics:${userId}`, biometricPublicKey);
    return {
      success: true,
      message: 'Biometric Secure Enclave key registered successfully.',
    };
  }

  async verifyFace(userId: string, selfie: Express.Multer.File, document: Express.Multer.File) {
    this.logger.log(`Initiating facial verification check for user: ${userId}`);

    // Update status to pending
    await this.redis.set(`kyc:status:${userId}`, 'PENDING');

    // Simulate facial recognition processing delay and Rekognition similarity comparison
    const matchConfidence = this.simulateFacialComparison(selfie, document);

    if (matchConfidence >= 95.0) {
      this.logger.log(`Facial verification SUCCESS for user ${userId}. Match confidence: ${matchConfidence}%`);
      await this.redis.set(`kyc:status:${userId}`, 'VERIFIED');
      
      // Update Rust Ledger service database state via webhook or direct API request
      await this.notifyLedgerOfKycSuccess(userId);

      return {
        success: true,
        status: 'VERIFIED',
        confidence: matchConfidence,
        message: 'Identity verification completed successfully.',
      };
    } else {
      this.logger.warn(`Facial verification FAILED for user ${userId}. Match confidence: ${matchConfidence}%`);
      await this.redis.set(`kyc:status:${userId}`, 'FAILED');
      return {
        success: false,
        status: 'FAILED',
        confidence: matchConfidence,
        message: 'Facial match confidence fell below 95% threshold.',
      };
    }
  }

  async getKycStatus(userId: string) {
    const status = await this.redis.get(`kyc:status:${userId}`);
    return {
      userId,
      status: status || 'UNVERIFIED',
    };
  }

  private simulateFacialComparison(selfie: Express.Multer.File, document: Express.Multer.File): number {
    // In production, this integrates with AWS Rekognition or FaceTec SDK:
    // const params = {
    //   SourceImage: { Bytes: document.buffer },
    //   TargetImage: { Bytes: selfie.buffer },
    //   SimilarityThreshold: 95.0
    // };
    // const response = await rekognition.compareFaces(params).promise();
    // return response.FaceMatches[0].Similarity;

    // Simulated check: if files are non-empty, simulate high match rate (98.5%) unless flagged
    if (selfie.size > 0 && document.size > 0) {
      if (selfie.originalname.includes('fail') || document.originalname.includes('fail')) {
        return 82.4; // Force fail logic for QA integration tests
      }
      return 98.6;
    }
    return 0.0;
  }

  private async notifyLedgerOfKycSuccess(userId: string) {
    this.logger.log(`Webhook callback dispatched: notifying rust-ledger of KYC state change for user ${userId}`);
    const ledgerUrl = process.env.LEDGER_URL || 'http://localhost:8081';
    try {
      const response = await fetch(`${ledgerUrl}/wallet/kyc-webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!response.ok) {
        this.logger.error(`Failed to notify ledger. HTTP status: ${response.status}`);
      } else {
        const result = await response.json();
        this.logger.log(`Ledger KYC webhook success: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      this.logger.error(`Error notifying ledger webhook: ${err.message}`);
    }
  }
}
