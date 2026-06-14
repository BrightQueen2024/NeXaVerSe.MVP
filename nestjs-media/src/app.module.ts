import { Module, OnModuleInit } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { FeedController } from './feed/feed.controller';
import { FeedService } from './feed/feed.service';
import { KycController } from './kyc/kyc.controller';
import { KycService } from './kyc/kyc.service';
import { MarketplaceController } from './marketplace/marketplace.controller';
import { MarketplaceService } from './marketplace/marketplace.service';
import { BusinessController } from './business/business.controller';
import { BusinessService } from './business/business.service';
import { RewardsController } from './rewards/rewards.controller';
import { RewardsService } from './rewards/rewards.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MediaController, FeedController, KycController, MarketplaceController, BusinessController, RewardsController, AdminController],
  providers: [MediaService, FeedService, KycService, MarketplaceService, BusinessService, RewardsService, AdminService],
})
export class AppModule implements OnModuleInit {
  constructor(private readonly adminService: AdminService) {}

  onModuleInit() {
    // Run fraud check periodically. 10 minutes in production, 2 seconds for E2E tests validation
    const intervalMs = process.env.NODE_ENV === 'test' ? 2000 : 600000;
    setInterval(() => {
      this.adminService.runFraudDetectionAudit().catch(err => {
        console.error('Scheduled fraud detection audit cycle error:', err);
      });
    }, intervalMs);
  }
}
