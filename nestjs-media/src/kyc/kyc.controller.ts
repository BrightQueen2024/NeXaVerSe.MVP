import { Controller, Post, Get, Body, Param, UseInterceptors, UploadedFiles, HttpException, HttpStatus } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { KycService } from './kyc.service';

@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('register-biometrics')
  async registerBiometrics(
    @Body() body: { userId: string; biometricPublicKey: string }
  ) {
    if (!body.userId || !body.biometricPublicKey) {
      throw new HttpException('userId and biometricPublicKey are required', HttpStatus.BAD_REQUEST);
    }
    return this.kycService.registerBiometrics(body.userId, body.biometricPublicKey);
  }

  @Post('verify-face')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'selfie', maxCount: 1 },
    { name: 'document', maxCount: 1 }
  ]))
  async verifyFace(
    @UploadedFiles() files: { selfie?: Express.Multer.File[]; document?: Express.Multer.File[] },
    @Body('userId') userId: string
  ) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }
    if (!files || !files.selfie || !files.document) {
      throw new HttpException('Both selfie and document files are required', HttpStatus.BAD_REQUEST);
    }

    return this.kycService.verifyFace(userId, files.selfie[0], files.document[0]);
  }

  @Get('status/:userId')
  async getStatus(@Param('userId') userId: string) {
    if (!userId) {
      throw new HttpException('userId is required', HttpStatus.BAD_REQUEST);
    }
    return this.kycService.getKycStatus(userId);
  }
}
