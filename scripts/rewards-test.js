const GATEWAY_URL = 'http://127.0.0.1:8080';

async function runTests() {
  console.log('==================================================');
  console.log('STARTING NEXAREWARDS E2E INTEGRATION TESTS');
  console.log('==================================================\n');

  try {
    // 1. Establish session for referrer and referred user
    console.log('[STEP 1] Logging in referrer (merchant_joe) and referred user (new_user_99)...');
    
    const referrerLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'merchant_joe',
      age: 30
    });
    const referrerToken = referrerLogin.token;
    console.log(` - Referrer logged in. JWT: ${referrerToken.substring(0, 25)}...`);

    const referredLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'new_user_99',
      age: 22
    });
    const referredToken = referredLogin.token;
    console.log(` - Referred user logged in. JWT: ${referredToken.substring(0, 25)}...`);

    // Get initial wallet balance of referrer
    const initialWallet = await getJson(`${GATEWAY_URL}/wallet/balance`, referrerToken);
    const initialReferrerBalance = initialWallet.offchain_balance;
    console.log(` - Referrer initial offchain balance: ${initialReferrerBalance} NEXA`);

    // 2. Register referral link
    console.log('\n[STEP 2] Registering referral linking new_user_99 to referrer merchant_joe...');
    const refRes = await postJson(`${GATEWAY_URL}/rewards/register-referral`, {
      referredId: 'new_user_99'
    }, referrerToken);
    console.log(` - Referral registered: ${refRes.message}`);

    // Verify referrer dashboard
    let referrerDashboard = await getJson(`${GATEWAY_URL}/rewards/dashboard/merchant_joe`, referrerToken);
    console.log(` - Referrer dashboard: XP = ${referrerDashboard.xp}, Pending Referrals = ${referrerDashboard.pendingReferralsCount}`);
    if (referrerDashboard.pendingReferralsCount !== 1) {
      throw new Error(`Expected pending referral count 1, got ${referrerDashboard.pendingReferralsCount}`);
    }

    // 3. Execute Face Verification for new_user_99 (simulating file upload to trigger kyc verify)
    console.log('\n[STEP 3] Simulating face verification for referred user (new_user_99)...');
    const boundary = '----WebKitFormBoundaryE2ETest';
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="userId"\r\n\r\nnew_user_99\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="face.jpg"\r\nContent-Type: image/jpeg\r\n\r\nmock-file-content-here\r\n--${boundary}--`;
    
    const kycResponse = await fetch(`${GATEWAY_URL}/kyc/verify-face`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Authorization': `Bearer ${referredToken}`
      },
      body
    });
    if (!kycResponse.ok) {
      const txt = await kycResponse.text();
      throw new Error(`KYC face verification failed: ${txt}`);
    }
    const kycRes = await kycResponse.json();
    console.log(` - KYC verification result: ${kycRes.status} (confidence: ${kycRes.confidence}%)`);

    // 4. Verify referral rewards processed successfully
    console.log('\n[STEP 4] Verifying referral reward payouts...');
    const updatedWallet = await getJson(`${GATEWAY_URL}/wallet/balance`, referrerToken);
    const updatedReferrerBalance = updatedWallet.offchain_balance;
    console.log(` - Referrer new offchain balance: ${updatedReferrerBalance} NEXA`);
    
    const balanceDiff = updatedReferrerBalance - initialReferrerBalance;
    if (balanceDiff !== 25.0) {
      throw new Error(`Expected referrer balance to increase by 25 NEXA, but increased by ${balanceDiff}`);
    }
    console.log(' => SUCCESS: 25.0 NEXA referral reward successfully disbursed to referrer.');

    referrerDashboard = await getJson(`${GATEWAY_URL}/rewards/dashboard/merchant_joe`, referrerToken);
    console.log(` - Referrer updated dashboard: XP = ${referrerDashboard.xp}, Paid Referrals = ${referrerDashboard.paidReferralsCount}`);
    if (referrerDashboard.xp !== 500 || referrerDashboard.paidReferralsCount !== 1) {
      throw new Error(`Referrer stats mismatch: expected 500 XP and 1 Paid Referral, got XP ${referrerDashboard.xp}, Paid ${referrerDashboard.paidReferralsCount}`);
    }
    console.log(' => SUCCESS: 500 XP awarded to referrer.');

    // 5. Setup staking position for referred user (new_user_99) to test LOCK_MASTER badge trigger
    console.log('\n[STEP 5] Setting up a staking position for new_user_99 (unlocks LOCK_MASTER check)...');
    const stakeRes = await postJson(`${GATEWAY_URL}/staking/stake`, {
      amount: 1000.00,
      lock_days: 30
    }, referredToken);
    console.log(` - Staked successfully. Position ID: ${stakeRes.position_id}, Tier: ${stakeRes.tier}`);

    // 6. Create product as merchant_joe and have new_user_99 buy and complete orders
    console.log('\n[STEP 6] Listing product for merchant_joe...');
    const productData = {
      title: 'Holographic Deck',
      description: 'Luxury virtual interface deck.',
      price: 100.00,
      category: 'GEAR',
      stock: 50,
      images: ['https://example.com/deck.jpg']
    };
    const productRes = await postJson(`${GATEWAY_URL}/marketplace/products`, productData, referrerToken);
    const productId = productRes.productId;
    console.log(` - Product listed. ID: ${productId}`);

    // Complete 3 purchases to trigger MERCH_KING (>=3 completed orders) & LOCK_MASTER (active staking)
    console.log('\n[STEP 7] Simulating 3 consecutive purchases & escrow completions...');
    
    for (let i = 1; i <= 3; i++) {
      console.log(`\n --- Order #${i} execution ---`);
      
      // Place Order
      const orderRes = await postJson(`${GATEWAY_URL}/marketplace/orders`, {
        productId: productId,
        quantity: 1,
        shippingAddress: {
          name: 'New User',
          street: '456 Grid Way',
          city: 'Nexa Ville',
          country: 'NexaWorld'
        }
      }, referredToken);
      const orderId = orderRes.orderId;
      console.log(`   * Order placed. ID: ${orderId}, Escrow ID: ${orderRes.escrowId}`);

      // Ship Order
      await postJson(`${GATEWAY_URL}/marketplace/orders/${orderId}/ship`, {
        trackingNumber: `TRACK-REF-ST-${i}`
      }, referrerToken);
      console.log(`   * Order marked as SHIPPED`);

      // Complete Order
      const completeRes = await postJson(`${GATEWAY_URL}/marketplace/orders/${orderId}/complete`, {
        signature: 'mock-signature-rewards-e2e'
      }, referredToken);
      console.log(`   * Order completed. Message: ${completeRes.message}`);

      // Check cashback is paid (1% of 100.00 = 1.00 NEXA per order)
      const balanceDoc = await getJson(`${GATEWAY_URL}/rewards/dashboard/new_user_99`, referredToken);
      console.log(`   * new_user_99 dashboard stats: XP = ${balanceDoc.xp}, Lifetime Rewards = ${balanceDoc.lifetimeRewards} NEXA, Badges: [${balanceDoc.badges.join(', ')}]`);
    }

    // After 3 orders, new_user_99 should have:
    // - 3 completed orders: triggers MERCH_KING (+500 XP)
    // - active staking: triggers LOCK_MASTER (+500 XP)
    // - 3 completed orders cashback: 3 * 100 XP = 300 XP
    // - Total XP expected: 300 + 500 (MERCH_KING) + 500 (LOCK_MASTER) = 1300 XP
    const finalDashboard = await getJson(`${GATEWAY_URL}/rewards/dashboard/new_user_99`, referredToken);
    console.log('\n[STEP 8] Verifying final rewards and milestone badges...');
    console.log(` - final XP: ${finalDashboard.xp}`);
    console.log(` - final Lifetime Rewards: ${finalDashboard.lifetimeRewards} NEXA`);
    console.log(` - Unlocked Badges: [${finalDashboard.badges.join(', ')}]`);

    if (!finalDashboard.badges.includes('MERCH_KING') || !finalDashboard.badges.includes('LOCK_MASTER')) {
      throw new Error(`Milestone badges not unlocked correctly. Expected [MERCH_KING, LOCK_MASTER], got [${finalDashboard.badges.join(', ')}]`);
    }
    if (finalDashboard.xp !== 1300) {
      throw new Error(`Expected final XP 1300, got ${finalDashboard.xp}`);
    }
    if (finalDashboard.lifetimeRewards !== 3.0) {
      throw new Error(`Expected lifetime cashback rewards 3.0 NEXA, got ${finalDashboard.lifetimeRewards}`);
    }
    console.log(' => SUCCESS: All loyalty XP cashback payouts and achievement milestone badges verified successfully.');

    // 7. Verify leaderboard ranking
    console.log('\n[STEP 9] Fetching global leaderboard...');
    const leaderboard = await getJson(`${GATEWAY_URL}/rewards/leaderboard`, referredToken);
    console.log(' - Leaderboard standings:');
    leaderboard.forEach((user, idx) => {
      console.log(`   #${idx + 1} User: ${user.userId} | XP: ${user.xp} | Lifetime Cashbacks: ${user.lifetimeRewards} NEXA`);
    });

    if (leaderboard[0].userId !== 'new_user_99' || leaderboard[1].userId !== 'merchant_joe') {
      throw new Error('Leaderboard sorting incorrect. Expected new_user_99 first, merchant_joe second.');
    }
    console.log(' => SUCCESS: XP Leaderboard sorting confirmed.');

    console.log('\n==================================================');
    console.log('ALL NEXAREWARDS ECOSYSTEM INTEGRATION TESTS PASSED!');
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
