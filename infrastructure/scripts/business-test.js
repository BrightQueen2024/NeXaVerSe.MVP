const GATEWAY_URL = 'http://127.0.0.1:8080';

async function runTests() {
  console.log('==================================================');
  console.log('STARTING NEXABUSINESS E2E INTEGRATION TESTS');
  console.log('==================================================\n');

  try {
    // 1. Log in users
    console.log('[STEP 1] Logging in Owner and Staff users...');
    const ownerLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'merchant_joe',
      age: 30
    });
    const ownerToken = ownerLogin.token;
    console.log(` - Owner logged in. JWT: ${ownerToken.substring(0, 25)}...`);

    const staffLogin = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'staff_bob',
      age: 28
    });
    const staffToken = staffLogin.token;
    console.log(` - Staff logged in. JWT: ${staffToken.substring(0, 25)}...`);

    // 2. Register business
    console.log('\n[STEP 2] Owner registering a new Football Academy...');
    const regRes = await postJson(`${GATEWAY_URL}/business/register`, {
      businessName: 'Viper Football Academy',
      businessType: 'ACADEMY'
    }, ownerToken);
    const businessId = regRes.businessId;
    console.log(` - Business onboarded successfully. ID: ${businessId}`);
    console.log(` - Initial verification status: ${regRes.profile.verified}`);

    // 3. Verify business
    console.log('\n[STEP 3] Running manual verification check on business...');
    const verifyRes = await postJson(`${GATEWAY_URL}/business/${businessId}/verify`, {}, ownerToken);
    console.log(` - Verification complete. Verified: ${verifyRes.verified}`);

    if (verifyRes.verified !== true) {
      throw new Error('Business verification status should be true');
    }

    // 4. Invite employee as Accountant
    console.log('\n[STEP 4] Owner inviting staff_bob as Accountant...');
    const inviteRes = await postJson(`${GATEWAY_URL}/business/${businessId}/members`, {
      userId: 'staff_bob',
      role: 'ACCOUNTANT'
    }, ownerToken);
    console.log(` - Invitation status: ${inviteRes.message}`);

    // 5. Test role authorization gates (Accountant tries to invite someone else)
    console.log('\n[STEP 5] Testing permission guard: Accountant tries to invite another member...');
    try {
      await postJson(`${GATEWAY_URL}/business/${businessId}/members`, {
        userId: 'staff_charlie',
        role: 'MANAGER'
      }, staffToken);
      throw new Error('Gating failed! Accountant was allowed to invite members.');
    } catch (err) {
      if (err.message.includes('403')) {
        console.log(' => SUCCESS: Accountant invitation request was blocked with 403 Forbidden.');
      } else {
        throw err;
      }
    }

    // 6. Fetch corporate dashboard analytics
    console.log('\n[STEP 6] Accountant querying corporate dashboard analytics...');
    const analytics = await getJson(`${GATEWAY_URL}/business/${businessId}/analytics`, staffToken);
    console.log(` - Retrieved ${analytics.length} daily logs entries:`);
    analytics.forEach(log => {
      console.log(`   * Date: ${log.date.substring(0, 10)} | Sales: ${log.volumeNexa} NEXA | Orders: ${log.orderCount}`);
    });

    // 7. Verify public profile & reputation score
    console.log('\n[STEP 7] Fetching public business profile and reputation score...');
    const profile = await getJson(`${GATEWAY_URL}/business/${businessId}/profile`);
    console.log(` - Business Name: ${profile.businessName}`);
    console.log(` - Reputation Score: ${profile.reputationScore}/100`);
    console.log(` - Verified Badge: ${profile.verified}`);

    console.log('\n==================================================');
    console.log('ALL NEXABUSINESS INTEGRATION TESTS PASSED!');
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
