import { Controller, Post, Get, Body, Param, Headers, HttpStatus, HttpException } from '@nestjs/common';
import { BusinessService } from './business.service';

@Controller('business')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post('register')
  async registerBusiness(
    @Headers('X-User-Id') ownerId: string,
    @Body() body: { businessName: string; businessType: string }
  ) {
    if (!ownerId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.businessName || !body.businessType) {
      throw new HttpException('businessName and businessType are required', HttpStatus.BAD_REQUEST);
    }

    return this.businessService.registerBusiness(ownerId, body.businessName, body.businessType);
  }

  @Post(':id/verify')
  async verifyBusiness(@Param('id') id: string) {
    if (!id) {
      throw new HttpException('businessId parameter is required', HttpStatus.BAD_REQUEST);
    }
    return this.businessService.verifyBusiness(id);
  }

  @Post(':id/members')
  async addMember(
    @Headers('X-User-Id') requesterId: string,
    @Param('id') businessId: string,
    @Body() body: { userId: string; role: string }
  ) {
    if (!requesterId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.userId || !body.role) {
      throw new HttpException('userId and role are required', HttpStatus.BAD_REQUEST);
    }

    return this.businessService.addMember(businessId, requesterId, body.userId, body.role);
  }

  @Get(':id/analytics')
  async getAnalytics(
    @Headers('X-User-Id') requesterId: string,
    @Param('id') businessId: string
  ) {
    if (!requesterId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }

    return this.businessService.getAnalytics(businessId, requesterId);
  }

  @Get(':id/profile')
  async getProfile(@Param('id') businessId: string) {
    if (!businessId) {
      throw new HttpException('businessId parameter is required', HttpStatus.BAD_REQUEST);
    }
    return this.businessService.getReputation(businessId);
  }
}
