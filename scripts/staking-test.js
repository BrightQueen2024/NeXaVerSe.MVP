const GATEWAY_URL = 'http://127.0.0.1:8080';
const MEDIA_URL = 'http://127.0.0.1:8082'; // Direct call for feed verification

async function runTests() {
  console.log('==================================================');
  console.log('STARTING NEXASTAKING E2E INTEGRATION TESTS');
  console.log('==================================================\n');

  try {
    // 1. Establish session
    console.log('[STEP 1] Logging in test user via Go Gateway...');
    const loginRes = await postJson(`${GATEWAY_URL}/auth/login`, {
      user_id: 'buyer_bill',
      age: 25
    });
    const token = loginRes.token;
    console.log(` - User logged in. JWT: ${token.substring(0, 25)}...`);

    // 2. Lock staking position (Silver Tier: 90 days)
    console.log('\n[STEP 2] Locking a 90-day staking position (Silver Tier)...');
    const stakeRes = await postJson(`${GATEWAY_URL}/staking/stake`, {
      amount: 5000.00,
      lock_days: 90
    }, token);
    const positionId = stakeRes.position_id;
    console.log(` - Position locked successfully. ID: ${positionId}`);
    console.log(` - Staking Tier assigned: ${stakeRes.tier}`);
    console.log(` - Lock End: ${stakeRes.lock_end}`);

    if (stakeRes.tier !== 'SILVER') {
      throw new Error(`Expected SILVER tier, got ${stakeRes.tier}`);
    }

    // 3. Retrieve Staking Dashboard metrics
    console.log('\n[STEP 3] Fetching user Staking Dashboard...');
    const dashboard = await getJson(`${GATEWAY_URL}/staking/dashboard/buyer_bill`);
    console.log(` - Total Staked: ${dashboard.total_staked} NEXA`);
    console.log(` - Current Tier: ${dashboard.current_tier}`);
    console.log(` - APY Yield: ${dashboard.apy}%`);
    console.log(` - Accrued Yield: ${dashboard.rewards_accrued} NEXA`);

    if (dashboard.current_tier !== 'SILVER' || dashboard.apy !== 8) {
      throw new Error(`Dashboard stats mismatch: tier ${dashboard.current_tier}, apy ${dashboard.apy}`);
    }

    // 4. Verify NestJS P2E Feed Integration Staking Booster
    console.log('\n[STEP 4] Testing P2E Creator Reward Staking Booster multiplier...');
    
    // Record engagement: 10 views on test_post_999
    console.log(' - Recording 10 views on "test_post_999"...');
    await postJson(`${MEDIA_URL}/feed/engagement`, {
      postId: 'test_post_999',
      type: 'view',
      count: 10
    });

    // Query rewards calculation for buyer_bill (STANDARD category)
    // Base: 10 views * 1.0 (STANDARD category) * 0.1 conversion = 1.0 NEXA
    // Silver Tier: 1.5x Staking Booster -> Expected total reward = 1.5 NEXA
    console.log(' - Querying rewards calculations for staker "buyer_bill"...');
    const rewards = await getJson(`${MEDIA_URL}/feed/rewards/test_post_999?creator_id=buyer_bill&category=STANDARD`);
    console.log(`   * Staking Tier detected: ${rewards.stakingTier}`);
    console.log(`   * Staking Booster multiplier: ${rewards.stakingBooster}x`);
    console.log(`   * Base Engagement Score: ${rewards.engagementScore}`);
    console.log(`   * Boosted Payout: ${rewards.totalReward} NEXA`);

    if (rewards.stakingBooster !== 1.5 || rewards.totalReward !== 1.5) {
      throw new Error(`Staking booster calculations failed. Expected 1.5, got booster ${rewards.stakingBooster}, total ${rewards.totalReward}`);
    }
    console.log(' => Success: Dynamic Staking Booster successfully integrated with social feed calculations.');

    // 5. Early Unstake with 15% penalty fee
    console.log('\n[STEP 5] Executing early unstake to check penalty fee calculations...');
    const unstakeRes = await postJson(`${GATEWAY_URL}/staking/unstake`, {
      position_id: positionId
    }, token);

    console.log(` - Position ID: ${unstakeRes.position_id}`);
    console.log(` - Principal Staked: ${unstakeRes.principal_staked} NEXA`);
    console.log(` - 15% Penalty Applied: ${unstakeRes.penalty_applied} NEXA`);
    console.log(` - Returned Balance: ${unstakeRes.principal_returned} NEXA`);
    console.log(` - Unstake status: ${unstakeRes.final_status}`);

    if (unstakeRes.penalty_applied !== 750 || unstakeRes.principal_returned !== 4250 || unstakeRes.final_status !== 'EARLY_WITHDRAWAL') {
      throw new Error(`Unstake penalty math mismatch. Expected penalty 750, returned 4250, status EARLY_WITHDRAWAL`);
    }

    console.log('\n==================================================');
    console.log('ALL NEXASTAKING INTEGRATION TESTS PASSED!');
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
