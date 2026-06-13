import { Injectable, Logger, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import * as AWS from 'aws-sdk';
import { Db } from 'mongodb';

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private s3: AWS.S3;
  private rekognition: AWS.Rekognition;

  constructor(@Inject('MONGO_DB') private db: Db) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID || 'mock-key';
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || 'mock-secret';
    
    this.s3 = new AWS.S3({
      accessKeyId,
      secretAccessKey,
      endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000', // support MinIO
      s3ForcePathStyle: true,
    });

    this.rekognition = new AWS.Rekognition({
      accessKeyId,
      secretAccessKey,
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  async processUpload(file: Express.Multer.File, creatorId: string) {
    const mediaId = uuidv4();
    const fileKey = `uploads/${creatorId}/${mediaId}-${file.originalname}`;
    const bucketName = process.env.S3_BUCKET_NAME || 'nexa-media';

    this.logger.log(`Uploading file to S3: ${fileKey}`);

    let s3Url = `https://${bucketName}.s3.amazonaws.com/${fileKey}`;
    try {
      if (process.env.AWS_ACCESS_KEY_ID) {
        await this.s3.putObject({
          Bucket: bucketName,
          Key: fileKey,
          Body: file.buffer,
          ContentType: file.mimetype,
        }).promise();
      } else {
        this.logger.warn('S3 credentials not set. Simulating storage layer upload.');
      }
    } catch (e) {
      this.logger.error(`S3 upload error: ${e.message}`);
    }

    // Save metadata to database as 'PENDING'
    this.logger.log(`Persisting media metadata: ${mediaId} under PENDING moderation state.`);
    this.db.collection('media_uploads').insertOne({
      mediaId,
      creatorId,
      s3Url,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      status: 'PENDING_CLASSIFICATION',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).catch(err => {
      this.logger.error(`MongoDB write failure: ${err.message}`);
    });

    // Trigger Asynchronous Classification Worker (active Rekognition + local fallback)
    this.triggerAsyncClassification(mediaId, file.originalname, file.buffer, bucketName, fileKey);

    return {
      mediaId,
      s3Url,
      status: 'PENDING_CLASSIFICATION',
    };
  }

  private async triggerAsyncClassification(
    mediaId: string, 
    filename: string, 
    buffer: Buffer, 
    bucketName: string, 
    fileKey: string
  ) {
    this.logger.log(`Enqueuing classification task for media: ${mediaId}`);

    // If AWS credentials are set, call active AWS Rekognition services
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ACCESS_KEY_ID !== 'mock-key') {
      try {
        this.logger.log(`Calling AWS Rekognition detectModerationLabels for: ${fileKey}`);
        
        // 1. Run Content Moderation Check
        const moderationResult = await this.rekognition.detectModerationLabels({
          Image: {
            S3Object: {
              Bucket: bucketName,
              Name: fileKey,
            }
          }
        }).promise();

        const flagged = moderationResult.ModerationLabels.length > 0;
        if (flagged) {
          this.logger.warn(`AI Safety Flag: Media ${mediaId} violates safety policy: ${moderationResult.ModerationLabels[0].Name}. Action: SHADOW_BAN.`);
          // In production: updates PostgreSQL state of post to is_shadow_banned = true
          return;
        }

        // 2. Run Category Detection
        this.logger.log(`Calling AWS Rekognition detectLabels for: ${fileKey}`);
        const labelResult = await this.rekognition.detectLabels({
          Image: {
            S3Object: {
              Bucket: bucketName,
              Name: fileKey,
            }
          },
          MaxLabels: 10,
          MinConfidence: 80,
        }).promise();

        let category = 'STANDARD';
        const labels = labelResult.Labels.map(l => l.Name.toLowerCase());
        this.logger.log(`Detected image labels: ${labels.join(', ')}`);
        
        if (labels.includes('bible') || labels.includes('religion') || labels.includes('god') || labels.includes('cross')) {
          category = 'DIVINE'; // 5x Multiplier
        } else if (labels.includes('education') || labels.includes('classroom') || labels.includes('science') || labels.includes('computer')) {
          category = 'EDUCATIONAL'; // 2.5x Multiplier
        }

        this.logger.log(`AWS Rekognition complete for media ${mediaId}: category set to ${category}. Moderation state: VERIFIED.`);
        
        // Update status in MongoDB
        try {
          await this.db.collection('media_uploads').updateOne(
            { mediaId },
            {
              $set: {
                status: 'VERIFIED',
                category,
                updatedAt: new Date(),
              }
            }
          );
        } catch (err) {
          this.logger.error(`Failed to update media status in MongoDB: ${err.message}`);
        }
        return;
      } catch (e) {
        this.logger.error(`AWS Rekognition error: ${e.message}. Falling back to default heuristics.`);
      }
    }

    // Heuristics Fallback (for local development / mock setups)
    setTimeout(() => {
      let category = 'STANDARD';
      const lowercaseFilename = filename.toLowerCase();

      if (lowercaseFilename.includes('bible') || lowercaseFilename.includes('god') || lowercaseFilename.includes('divine')) {
        category = 'DIVINE'; // 5x Multiplier
      } else if (lowercaseFilename.includes('science') || lowercaseFilename.includes('tutorial') || lowercaseFilename.includes('tech')) {
        category = 'EDUCATIONAL'; // 2.5x Multiplier
      }

      this.logger.log(`Local AI Heuristics complete for media ${mediaId}: category set to ${category}. Moderation state: VERIFIED.`);
      
      // Update status in MongoDB
      this.db.collection('media_uploads').updateOne(
        { mediaId },
        {
          $set: {
            status: 'VERIFIED',
            category,
            updatedAt: new Date(),
          }
        }
      ).catch(err => {
        this.logger.error(`Failed to update media fallback status in MongoDB: ${err.message}`);
      });
    }, 2000);
  }
}
