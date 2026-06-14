const GATEWAY_URL = 'http://127.0.0.1:8080';

async function runTests() {
  console.log('==================================================');
  console.log('STARTING NEXAMARKET E2E INTEGRATION TESTS');
  console.log('==================================================\n');

  try {
    // 1. Establish sessions for merchant and buyer
    console.log('[STEP 1] Logging in users via Go Gateway to retrieve JWTs...');
    
    const merchantLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'merchant_joe',
      age: 30
    });
    const merchantToken = merchantLogin.token;
    console.log(` - Merchant logged in. JWT: ${merchantToken.substring(0, 25)}...`);

    const buyerLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'buyer_bill',
      age: 22
    });
    const buyerToken = buyerLogin.token;
    console.log(` - Buyer logged in. JWT: ${buyerToken.substring(0, 25)}...`);

    // 2. Create a product listing as the merchant
    console.log('\n[STEP 2] Creating a new product listing as merchant...');
    const productData = {
      title: 'Cybernetic Visor v2',
      description: 'Next-gen visor with augmented reality overlay.',
      price: 150.00,
      category: 'GEAR',
      stock: 10,
      images: ['https://example.com/visor.jpg']
    };
    
    const productRes = await postJson(`${GATEWAY_URL}/marketplace/products`, productData, merchantToken);
    const productId = productRes.productId;
    console.log(` - Product created successfully. ID: ${productId}`);

    // 3. Search for product listings
    console.log('\n[STEP 3] Querying product catalog for "GEAR" category...');
    const catalog = await getJson(`${GATEWAY_URL}/marketplace/products?category=GEAR`);
    const foundProduct = catalog.find(p => p._id === productId);
    if (foundProduct) {
      console.log(` - Success: Found created product "${foundProduct.title}" in catalog.`);
    } else {
      throw new Error('Created product was not found in listing catalog');
    }

    // 4. Retrieve single product details
    console.log('\n[STEP 4] Fetching specific product detail page...');
    const details = await getJson(`${GATEWAY_URL}/marketplace/products/${productId}`);
    console.log(` - Product title: ${details.title}`);
    console.log(` - Price: ${details.price} NEXA`);
    console.log(` - Stock remaining: ${details.stock}`);

    // 5. Place purchase order (triggers Rust Ledger escrow lock)
    console.log('\n[STEP 5] Buyer places order (Initiating Rust Ledger Escrow lock)...');
    const orderReq = {
      productId: productId,
      quantity: 1,
      shippingAddress: {
        name: 'Bill Gates',
        street: '123 Grid Lane',
        city: 'Nexa City',
        country: 'NexaWorld'
      }
    };
    
    const orderRes = await postJson(`${GATEWAY_URL}/marketplace/orders`, orderReq, buyerToken);
    const orderId = orderRes.orderId;
    const escrowId = orderRes.escrowId;
    console.log(` - Order placed successfully. Order ID: ${orderId}`);
    console.log(` - Ledger Escrow Vault Locked. Escrow ID: ${escrowId}`);
    console.log(` - Status: ${orderRes.status}`);

    // Check product stock decremented
    const detailsAfterOrder = await getJson(`${GATEWAY_URL}/marketplace/products/${productId}`);
    console.log(` - Stock remaining (after purchase): ${detailsAfterOrder.stock}`);
    if (detailsAfterOrder.stock !== 9) {
      throw new Error(`Expected stock 9, got ${detailsAfterOrder.stock}`);
    }

    // 6. Merchant ships the order
    console.log('\n[STEP 6] Merchant registers shipping tracking code...');
    const shipRes = await postJson(`${GATEWAY_URL}/marketplace/orders/${orderId}/ship`, {
      trackingNumber: 'TRACK-NEXA-99'
    }, merchantToken);
    console.log(` - Order updated. Status: ${shipRes.status}`);
    console.log(` - Tracking Code: ${shipRes.trackingNumber}`);

    // 7. Buyer completes order (triggers Rust Ledger escrow release)
    console.log('\n[STEP 7] Buyer verifies delivery and releases escrow...');
    const completeRes = await postJson(`${GATEWAY_URL}/marketplace/orders/${orderId}/complete`, {
      signature: '0x-mock-buyer-delivery-signature-99'
    }, buyerToken);
    console.log(` - Order finalized. Status: ${completeRes.status}`);
    console.log(` - Message: ${completeRes.message}`);

    // 8. Buyer submits a review
    console.log('\n[STEP 8] Buyer submits a 5-star product review...');
    const reviewRes = await postJson(`${GATEWAY_URL}/marketplace/products/${productId}/reviews`, {
      orderId: orderId,
      rating: 5,
      comment: 'Amazing VR field of view. Recommended!'
    }, buyerToken);
    console.log(` - Review added. Message: ${reviewRes.message}`);

    // Check product average rating update
    const detailsAfterReview = await getJson(`${GATEWAY_URL}/marketplace/products/${productId}`);
    console.log(` - Product Average Rating: ${detailsAfterReview.rating} stars`);
    console.log(` - Product Review Count: ${detailsAfterReview.reviewCount}`);

    // 9. Inspect merchant dashboard
    console.log('\n[STEP 9] Inspecting Merchant Analytics Dashboard...');
    const dashboard = await getJson(`${GATEWAY_URL}/marketplace/merchant/dashboard`, merchantToken);
    console.log(` - Total Products Listed: ${dashboard.products.length}`);
    console.log(` - Total Inbound Orders: ${dashboard.orders.length}`);
    console.log(` - Total Completed Sales Volume: ${dashboard.totalSalesVolume} NEXA`);
    console.log(` - Active Pending Orders Count: ${dashboard.activeOrdersCount}`);

    console.log('\n==================================================');
    console.log('ALL NEXAMARKET INTEGRATION TESTS PASSED!');
    console.log('==================================================');

  } catch (err) {
    console.error(`\nTest pipeline failed: ${err.message}`);
    process.exit(1);
  }
}

// HTTP Helper Functions
async function postJson(url, data, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`POST ${url} failed with status ${response.status}: ${text}`);
  }
  return response.json();
}

async function getJson(url, token) {
  const headers = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GET ${url} failed with status ${response.status}: ${text}`);
  }
  return response.json();
}

runTests();
