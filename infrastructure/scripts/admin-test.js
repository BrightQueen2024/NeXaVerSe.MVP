const GATEWAY_URL = 'http://127.0.0.1:8080';

async function runTests() {
  console.log('==================================================');
  console.log('STARTING NEXAADMIN E2E INTEGRATION TESTS');
  console.log('==================================================\n');

  try {
    // 1. Establish sessions
    console.log('[STEP 1] Logging in normal user (buyer_bill) and administrator (admin_super)...');
    
    const userLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'buyer_bill',
      age: 25
    });
    const userToken = userLogin.token;
    console.log(` - User logged in. JWT: ${userToken.substring(0, 25)}...`);

    const adminLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'admin_super',
      age: 35
    });
    const adminToken = adminLogin.token;
    console.log(` - Admin logged in. JWT: ${adminToken.substring(0, 25)}...`);

    // 2. Test permission gating: normal user tries to access admin routes
    console.log('\n[STEP 2] Verifying security gate: normal user attempts admin requests...');
    try {
      await getJson(`${GATEWAY_URL}/admin/stats/summary`, userToken);
      throw new Error('Security gate failed! Normal user was permitted to query admin summary stats.');
    } catch (err) {
      if (err.message.includes('403')) {
        console.log(' => SUCCESS: Unauthorized access blocked with 403 Forbidden.');
      } else {
        throw err;
      }
    }

    // 3. Fetch summary stats as Admin
    console.log('\n[STEP 3] Fetching ecosystem summary stats as Admin...');
    const stats = await getJson(`${GATEWAY_URL}/admin/stats/summary`, adminToken);
    console.log(` - summary: Users = ${stats.usersCount}, Circulating NEXA = ${stats.circulatingNexa}, Escrow Locks Value = ${stats.escrowLockValue} NEXA`);
    if (stats.usersCount === undefined || stats.circulatingNexa !== 105000000) {
      throw new Error('Ecosystem summary metrics values mismatch');
    }

    // 4. Simulate transactions to trigger fraud checks
    console.log('\n[STEP 4] Simulating rapid transfers to trigger VELOCITY_EXCEEDED alert...');
    // Send 6 rapid transfers of 1 NEXA each (limit is 5 in 60s)
    for (let i = 1; i <= 6; i++) {
      await postJson(`${GATEWAY_URL}/wallet/transfer`, {
        receiver_id: 'receiver_456',
        amount: 1.0
      }, userToken);
    }
    console.log(' - Dispatched 6 rapid transfers.');

    console.log('\n[STEP 5] Simulating high value transfer from unverified user to trigger HIGH_VALUE_UNVERIFIED alert...');
    // Create an unverified user (whale_bill)
    const whaleLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'whale_bill',
      age: 28
    });
    const whaleToken = whaleLogin.token;
    
    // Transfer 60,000 NEXA
    await postJson(`${GATEWAY_URL}/wallet/transfer`, {
      receiver_id: 'merchant_joe',
      amount: 60000.00
    }, whaleToken);
    console.log(' - Dispatched 60,000 NEXA transfer from unverified whale_bill.');

    // Wait 1.5 seconds for mock background cron to audit mockTransactions and write alerts
    console.log('\n[STEP 6] Waiting 1.5s for background fraud checks audit...');
    await new Promise(resolve => setTimeout(resolve, 1500));

    // 5. Query open alerts
    console.log('\n[STEP 7] Fetching active open system alerts...');
    const alerts = await getJson(`${GATEWAY_URL}/admin/alerts?status=OPEN`, adminToken);
    console.log(` - Retrieved ${alerts.length} open alerts:`);
    alerts.forEach(alert => {
      console.log(`   * Alert ID: ${alert._id} | Type: ${alert.alertType} | Severity: ${alert.severity}`);
    });

    const velocityAlert = alerts.find(a => a.alertType === 'VELOCITY_EXCEEDED');
    const highValueAlert = alerts.find(a => a.alertType === 'HIGH_VALUE_UNVERIFIED');

    if (!velocityAlert) {
      throw new Error('VELOCITY_EXCEEDED alert was not triggered');
    }
    if (!highValueAlert) {
      throw new Error('HIGH_VALUE_UNVERIFIED alert was not triggered');
    }
    console.log(' => SUCCESS: Both velocity and high value alerts detected.');

    // 6. Resolve high-value alert
    console.log(`\n[STEP 8] Resolving high-value alert (${highValueAlert._id})...`);
    const resolveRes = await postJson(`${GATEWAY_URL}/admin/alerts/${highValueAlert._id}/resolve`, {
      resolution: 'whale_bill manually verified via video conference callback.'
    }, adminToken);
    console.log(` - Alert resolved status: ${resolveRes.success}`);

    // Verify status updated
    const updatedAlerts = await getJson(`${GATEWAY_URL}/admin/alerts`, adminToken);
    const resolvedCheck = updatedAlerts.find(a => a._id === highValueAlert._id);
    console.log(` - Verified resolved alert status: ${resolvedCheck.status} | Resolution: "${resolvedCheck.resolution}"`);
    if (resolvedCheck.status !== 'RESOLVED' || resolvedCheck.resolution === undefined) {
      throw new Error('Alert resolution failed to save correctly');
    }
    console.log(' => SUCCESS: Alert status updated to RESOLVED.');

    // 7. Onboard corporate business in pending state
    console.log('\n[STEP 9] Registering a pending business to verify KYC compliance board...');
    const businessRegister = await postJson(`${GATEWAY_URL}/business/register`, {
      businessName: 'Apex Sports Club',
      businessType: 'ACADEMY'
    }, userToken);
    console.log(` - Business profile registered. ID: ${businessRegister.businessId} | Verified: ${businessRegister.profile.verified}`);

    // Fetch pending Kyc board
    console.log('\n[STEP 10] Fetching pending KYC/business onboard applications...');
    const pendingKyc = await getJson(`${GATEWAY_URL}/admin/kyc/pending`, adminToken);
    console.log(` - Retrieved ${pendingKyc.length} pending applications:`);
    pendingKyc.forEach(app => {
      console.log(`   * Business: ${app.businessName} | Type: ${app.businessType} | Owner: ${app.ownerId}`);
    });

    const foundApp = pendingKyc.find(a => (a._id === businessRegister.businessId || a.id === businessRegister.businessId));
    if (!foundApp) {
      throw new Error('Pending business application not found in KYC list');
    }
    console.log(' => SUCCESS: Pending business application verified on compliance board.');

    console.log('\n==================================================');
    console.log('ALL NEXAADMIN INTEGRATION TESTS PASSED!');
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
