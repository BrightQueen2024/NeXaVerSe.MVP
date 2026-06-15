import { Controller, Post, Get, Body, Param, Query, Headers, HttpStatus, HttpException } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Post('products')
  async createProduct(
    @Headers('X-User-Id') merchantId: string,
    @Body() body: { title: string; description: string; price: number; category?: string; stock?: number; images?: string[] }
  ) {
    if (!merchantId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.title || body.price === undefined) {
      throw new HttpException('title and price are required product attributes', HttpStatus.BAD_REQUEST);
    }
    
    return this.marketplaceService.createProduct(
      merchantId,
      body.title,
      body.description || '',
      body.price,
      body.category,
      body.stock ?? 1,
      body.images || []
    );
  }

  @Get('products')
  async listProducts(
    @Query('search') search?: string,
    @Query('category') category?: string
  ) {
    return this.marketplaceService.searchProducts(search, category);
  }

  @Get('products/:id')
  async getProduct(@Param('id') id: string) {
    return this.marketplaceService.getProductDetails(id);
  }

  @Post('orders')
  async createOrder(
    @Headers('X-User-Id') buyerId: string,
    @Body() body: { productId: string; quantity: number; shippingAddress: any }
  ) {
    if (!buyerId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.productId || !body.quantity || !body.shippingAddress) {
      throw new HttpException('productId, quantity, and shippingAddress are required for order creation', HttpStatus.BAD_REQUEST);
    }

    return this.marketplaceService.createOrder(
      buyerId,
      body.productId,
      body.quantity,
      body.shippingAddress
    );
  }

  @Post('orders/:id/ship')
  async shipOrder(
    @Headers('X-User-Id') merchantId: string,
    @Param('id') orderId: string,
    @Body() body: { trackingNumber: string }
  ) {
    if (!merchantId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.trackingNumber) {
      throw new HttpException('trackingNumber is required to mark order as shipped', HttpStatus.BAD_REQUEST);
    }

    return this.marketplaceService.shipOrder(orderId, merchantId, body.trackingNumber);
  }

  @Post('orders/:id/complete')
  async completeOrder(
    @Headers('X-User-Id') buyerId: string,
    @Param('id') orderId: string,
    @Body() body: { signature: string }
  ) {
    if (!buyerId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }

    return this.marketplaceService.completeOrder(orderId, buyerId, body.signature);
  }

  @Post('products/:id/reviews')
  async addReview(
    @Headers('X-User-Id') reviewerId: string,
    @Param('id') productId: string,
    @Body() body: { orderId: string; rating: number; comment: string }
  ) {
    if (!reviewerId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }
    if (!body.orderId || body.rating === undefined) {
      throw new HttpException('orderId and rating are required to write a review', HttpStatus.BAD_REQUEST);
    }

    return this.marketplaceService.addReview(
      productId,
      body.orderId,
      reviewerId,
      body.rating,
      body.comment
    );
  }

  @Get('merchant/dashboard')
  async getDashboard(@Headers('X-User-Id') merchantId: string) {
    if (!merchantId) {
      throw new HttpException('Missing identity credentials header X-User-Id', HttpStatus.UNAUTHORIZED);
    }

    return this.marketplaceService.getMerchantDashboard(merchantId);
  }
}
