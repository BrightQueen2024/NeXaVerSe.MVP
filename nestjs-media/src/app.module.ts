import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { MediaController } from './media/media.controller';
import { MediaService } from './media/media.service';
import { FeedController } from './feed/feed.controller';
import { FeedService } from './feed/feed.service';
import { KycController } from './kyc/kyc.controller';
import { KycService } from './kyc/kyc.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MediaController, FeedController, KycController],
  providers: [MediaService, FeedService, KycService],
})
export class AppModule {}
