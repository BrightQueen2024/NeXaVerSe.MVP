import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { Db, ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { RewardsService } from '../rewards/rewards.service';

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @Inject('MONGO_DB') private readonly db: Db,
    private readonly rewardsService: RewardsService
  ) {}

  private getLedgerUrl(): string {
    return process.env.LEDGER_URL || 'http://localhost:8081';
  }

  async createProduct(
    merchantId: string,
    title: string,
    description: string,
    price: number,
    category: string,
    stock: number,
    images: string[]
  ) {
    this.logger.log(`Creating product listing: "${title}" by merchant ${merchantId}`);
    
    if (price <= 0) {
      throw new HttpException('Price must be greater than zero', HttpStatus.BAD_REQUEST);
    }
    if (stock < 0) {
      throw new HttpException('Stock cannot be negative', HttpStatus.BAD_REQUEST);
    }

    const product = {
      merchantId,
      title,
      description,
      price,
      category: category || 'STANDARD',
      stock,
      images: images || [],
      rating: 0,
      reviewCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await this.db.collection('products').insertOne(product);
    return {
      success: true,
      productId: result.insertedId.toString(),
      product,
    };
  }

  async searchProducts(search?: string, category?: string) {
    const filter: any = {};
    
    if (category) {
      filter.category = category;
    }
    
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const products = await this.db.collection('products').find(filter).toArray();
    return products.map(p => ({
      ...p,
      _id: p._id.toString(),
    }));
  }

  async getProductDetails(productId: string) {
    if (!ObjectId.isValid(productId)) {
      throw new HttpException('Invalid product ID format', HttpStatus.BAD_REQUEST);
    }

    const product = await this.db.collection('products').findOne({ _id: new ObjectId(productId) });
    if (!product) {
      throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
    }

    return {
      ...product,
      _id: product._id.toString(),
    };
  }

  async createOrder(
    buyerId: string,
    productId: string,
    quantity: number,
    shippingAddress: any
  ) {
    this.logger.log(`Processing buy order for buyer ${buyerId}, product ${productId}, qty ${quantity}`);

    if (quantity <= 0) {
      throw new HttpException('Quantity must be greater than zero', HttpStatus.BAD_REQUEST);
    }

    if (!ObjectId.isValid(productId)) {
      throw new HttpException('Invalid product ID format', HttpStatus.BAD_REQUEST);
    }

    const productObjectId = new ObjectId(productId);

    // 1. Fetch product details and check stock
    const product = await this.db.collection('products').findOne({ _id: productObjectId });
    if (!product) {
      throw new HttpException('Product not found', HttpStatus.NOT_FOUND);
    }

    if (product.stock < quantity) {
      throw new HttpException('Insufficient product stock available', HttpStatus.BAD_REQUEST);
    }

    if (product.merchantId === buyerId) {
      throw new HttpException('Merchants cannot buy their own listed products', HttpStatus.BAD_REQUEST);
    }

    const totalPrice = product.price * quantity;
    const orderId = uuidv4();

    // 2. Perform optimistic stock lock
    const stockUpdate = await this.db.collection('products').updateOne(
      { _id: productObjectId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } }
    );

    if (stockUpdate.modifiedCount === 0) {
      throw new HttpException('Stock check failed due to concurrent checkout. Please retry.', HttpStatus.CONFLICT);
    }

    // 3. Initiate payment vault lock inside the Rust Ledger service
    const ledgerUrl = this.getLedgerUrl();
    const idempotencyKey = `order-escrow-${orderId}`;

    try {
      this.logger.log(`Contacting Rust Ledger at ${ledgerUrl}/escrow/create for order ${orderId}`);
      
      const response = await fetch(`${ledgerUrl}/escrow/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'X-User-Id': buyerId,
        },
        body: JSON.stringify({
          order_id: orderId,
          seller_id: product.merchantId,
          amount: totalPrice,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ledger connection error: ${errorText}`);
      }

      const ledgerRes = await response.json();
      const escrowId = ledgerRes.escrow_id;

      // 4. Save completed order under locked state
      const order = {
        orderId,
        buyerId,
        merchantId: product.merchantId,
        productId: productObjectId,
        quantity,
        totalPrice,
        escrowId,
        status: 'PAID_LOCKED',
        trackingNumber: '',
        shippingAddress,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.db.collection('orders').insertOne(order);
      this.logger.log(`Order ${orderId} finalized with escrow ${escrowId}`);

      return {
        success: true,
        orderId,
        escrowId,
        status: 'PAID_LOCKED',
        totalPrice,
      };

    } catch (err) {
      this.logger.error(`Failed to lock escrow for order ${orderId}: ${err.message}`);
      
      // Roll back stock decrement
      await this.db.collection('products').updateOne(
        { _id: productObjectId },
        { $inc: { stock: quantity } }
      );

      throw new HttpException(
        `Payment processing failed: ${err.message}`,
        HttpStatus.PAYMENT_REQUIRED
      );
    }
  }

  async shipOrder(orderId: string, merchantId: string, trackingNumber: string) {
    this.logger.log(`Marking order ${orderId} as shipped by merchant ${merchantId}`);

    const order = await this.db.collection('orders').findOne({ orderId });
    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    if (order.merchantId !== merchantId) {
      throw new HttpException('Unauthorized. Only the listing merchant can ship items.', HttpStatus.FORBIDDEN);
    }

    if (order.status !== 'PAID_LOCKED') {
      throw new HttpException(`Cannot ship order in current status: ${order.status}`, HttpStatus.BAD_REQUEST);
    }

    await this.db.collection('orders').updateOne(
      { orderId },
      {
        $set: {
          status: 'SHIPPED',
          trackingNumber,
          updatedAt: new Date(),
        }
      }
    );

    return {
      success: true,
      status: 'SHIPPED',
      trackingNumber,
    };
  }

  async completeOrder(orderId: string, buyerId: string, signature: string) {
    this.logger.log(`Completing order ${orderId} and releasing escrow for buyer ${buyerId}`);

    const order = await this.db.collection('orders').findOne({ orderId });
    if (!order) {
      throw new HttpException('Order not found', HttpStatus.NOT_FOUND);
    }

    if (order.buyerId !== buyerId) {
      throw new HttpException('Unauthorized. Only the ordering buyer can finalize receipt.', HttpStatus.FORBIDDEN);
    }

    if (order.status !== 'SHIPPED' && order.status !== 'PAID_LOCKED') {
      throw new HttpException(`Cannot complete order in current status: ${order.status}`, HttpStatus.BAD_REQUEST);
    }

    // Call Rust Ledger escrow release
    const ledgerUrl = this.getLedgerUrl();
    const escrowId = order.escrowId;

    try {
      this.logger.log(`Contacting Rust Ledger at ${ledgerUrl}/escrow/release/${escrowId} to disburse funds`);
      
      const response = await fetch(`${ledgerUrl}/escrow/release/${escrowId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signature: signature || 'ssh-ed25519-mock-buyer-delivery-signature',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ledger release failure: ${errorText}`);
      }

      await this.db.collection('orders').updateOne(
        { orderId },
        {
          $set: {
            status: 'COMPLETED',
            updatedAt: new Date(),
          }
        }
      );

      // Trigger cashback and XP rewards checks
      this.rewardsService.processMarketplaceCashback(orderId).catch(err => {
        this.logger.error(`Error processing order cashback: ${err.message}`);
      });

      return {
        success: true,
        status: 'COMPLETED',
        message: 'Funds released to merchant. Order finalized.',
      };

    } catch (err) {
      this.logger.error(`Escrow release failed: ${err.message}`);
      throw new HttpException(
        `Failed to release escrow funds: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async addReview(
    productId: string,
    orderId: string,
    reviewerId: string,
    rating: number,
    comment: string
  ) {
    this.logger.log(`Adding review for product ${productId} on order ${orderId}`);

    if (rating < 1 || rating > 5) {
      throw new HttpException('Rating must be between 1 and 5 stars', HttpStatus.BAD_REQUEST);
    }

    if (!ObjectId.isValid(productId)) {
      throw new HttpException('Invalid product ID format', HttpStatus.BAD_REQUEST);
    }

    const productObjectId = new ObjectId(productId);

    // Verify order exists and is completed by this reviewer
    const order = await this.db.collection('orders').findOne({ orderId, buyerId: reviewerId, productId: productObjectId });
    if (!order) {
      throw new HttpException('No matching completed order found for validation.', HttpStatus.BAD_REQUEST);
    }

    if (order.status !== 'COMPLETED') {
      throw new HttpException('Cannot write reviews until order status is COMPLETED', HttpStatus.BAD_REQUEST);
    }

    // Check if review already exists for this order
    const existing = await this.db.collection('reviews').findOne({ orderId });
    if (existing) {
      throw new HttpException('You have already submitted a review for this order', HttpStatus.CONFLICT);
    }

    const review = {
      orderId,
      productId: productObjectId,
      reviewerId,
      rating,
      comment: comment || '',
      createdAt: new Date(),
    };

    await this.db.collection('reviews').insertOne(review);

    // Update product ratings average and count
    const reviews = await this.db.collection('reviews').find({ productId: productObjectId }).toArray();
    const count = reviews.length;
    const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / count;

    await this.db.collection('products').updateOne(
      { _id: productObjectId },
      {
        $set: {
          rating: parseFloat(avg.toFixed(1)),
          reviewCount: count,
          updatedAt: new Date(),
        }
      }
    );

    return {
      success: true,
      message: 'Review registered successfully.',
    };
  }

  async getMerchantDashboard(merchantId: string) {
    const products = await this.db.collection('products').find({ merchantId }).toArray();
    const orders = await this.db.collection('orders').find({ merchantId }).toArray();

    const formattedProducts = products.map(p => ({ ...p, _id: p._id.toString() }));
    const formattedOrders = orders.map(o => ({ ...o, _id: o._id.toString(), productId: o.productId.toString() }));

    const totalSalesVolume = orders
      .filter(o => o.status === 'COMPLETED')
      .reduce((sum, o) => sum + parseFloat(o.totalPrice.toString()), 0);

    return {
      products: formattedProducts,
      orders: formattedOrders,
      totalSalesVolume,
      activeOrdersCount: orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'REFUNDED').length,
    };
  }
}
