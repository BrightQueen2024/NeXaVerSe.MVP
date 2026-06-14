import { Controller, Post, Get, Body, Param, Headers, HttpStatus, HttpException, Query } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private verifyAdminRole(adminId: string) {
    if (!adminId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!adminId.startsWith('admin_')) {
      throw new HttpException('Forbidden. Administrative credentials required.', HttpStatus.FORBIDDEN);
    }
  }

  @Get('stats/summary')
  async getSummaryStats(@Headers('X-User-Id') adminId: string) {
    this.verifyAdminRole(adminId);
    return this.adminService.getSummaryStats();
  }

  @Get('alerts')
  async getAlerts(
    @Headers('X-User-Id') adminId: string,
    @Query('status') status?: string
  ) {
    this.verifyAdminRole(adminId);
    return this.adminService.getAlerts(status);
  }

  @Post('alerts/:id/resolve')
  async resolveAlert(
    @Headers('X-User-Id') adminId: string,
    @Param('id') id: string,
    @Body() body: { resolution: string }
  ) {
    this.verifyAdminRole(adminId);
    if (!body.resolution) {
      throw new HttpException('resolution comment is required to settle system alert', HttpStatus.BAD_REQUEST);
    }
    return this.adminService.resolveAlert(id, body.resolution);
  }

  @Get('kyc/pending')
  async getPendingKyc(@Headers('X-User-Id') adminId: string) {
    this.verifyAdminRole(adminId);
    return this.adminService.getPendingKyc();
  }
}
