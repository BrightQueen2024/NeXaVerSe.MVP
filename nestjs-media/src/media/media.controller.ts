import { Controller, Post, UseInterceptors, UploadedFile, HttpException, HttpStatus, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadMedia(
    @UploadedFile() file: Express.Multer.File,
    @Query('creator_id') creatorId: string,
  ) {
    if (!file) {
      throw new HttpException('File is required', HttpStatus.BAD_REQUEST);
    }
    if (!creatorId) {
      throw new HttpException('creator_id query param is required', HttpStatus.BAD_REQUEST);
    }

    // Call service to write to S3 and trigger async AI classification
    const result = await this.mediaService.processUpload(file, creatorId);

    return {
      statusCode: HttpStatus.ACCEPTED,
      message: 'File upload started. Content classification is running in the background.',
      mediaId: result.mediaId,
      s3Url: result.s3Url,
      status: result.status,
    };
  }
}
