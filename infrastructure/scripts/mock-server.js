const http = require('http');
const url = require('url');
const { WebSocketServer } = require('ws');

// In-Memory Database Stubs
const wallets = {
  'user_sender_123': {
    user_id: 'user_sender_123',
    offchain_balance: 5000.00,
    reserved_escrow_balance: 0.00,
    kyc_verified: false
  },
  'receiver_456': {
    user_id: 'receiver_456',
    offchain_balance: 100.00,
    reserved_escrow_balance: 0.00,
    kyc_verified: false
  },
  'merchant_joe': {
    user_id: 'merchant_joe',
    offchain_balance: 5000.00,
    reserved_escrow_balance: 0.00,
    kyc_verified: false
  },
  'buyer_bill': {
    user_id: 'buyer_bill',
    offchain_balance: 5000.00,
    reserved_escrow_balance: 0.00,
    kyc_verified: false
  }
};

const escrows = {};
const kycStatus = {};
const biometrics = {};
const engagement = {};
const nexlinks = {};

// Staking Positions In-Memory Store
const stakingPositions = {};

// Business In-Memory Stores
const businessProfiles = {};
const businessMembers = {};

// Marketplace In-Memory Data
const products = [];
const orders = [];
const reviews = [];

// Rewards Ecosystem In-Memory Data
const referrals = {};      // referredId -> { referrerId, status, createdAt, rewardedAt }
const loyaltyBalances = {}; // userId -> { xp, lifetimeRewards }
const achievementBadges = {}; // userId -> [badgeKey]

// Admin & Fraud Audit Mock Datastores
const mockTransactions = [];
const systemAlerts = [];

const PORT_GATEWAY = 8080;
const PORT_LEDGER = 8081;
const PORT_MEDIA = 8082;

// ==========================================
// 1. COMBINED GO-GATEWAY HTTP + WS SERVER
// ==========================================
const gatewayHttpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Idempotency-Key, Authorization, X-Internal-Token, X-User-Id');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    // 1. Gateway local authentication route
    if (req.method === 'POST' && path === '/auth/login') {
      try {
        const payload = JSON.parse(body);
        if (!payload.user_id) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'user_id is required' }));
        }
        const token = `mock-token-${payload.user_id}-${payload.age || 20}`;
        res.statusCode = 200;
        return res.end(JSON.stringify({ token }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    }

    // 2. Gateway Reverse Proxy Routing
    const isProxyRoute = path.startsWith('/wallet/') || path.startsWith('/escrow/') ||
      path.startsWith('/media/') || path.startsWith('/feed/') || path.startsWith('/kyc/') ||
      path.startsWith('/marketplace/') || path.startsWith('/business/') || path.startsWith('/rewards/') ||
      path.startsWith('/staking/') || path.startsWith('/admin/');

    if (isProxyRoute) {
      const authHeader = req.headers['authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Authorization token required' }));
      }
      
      const token = authHeader.substring(7);
      const tokenParts = token.split('-');
      if (tokenParts.length < 3 || tokenParts[0] !== 'mock' || tokenParts[1] !== 'token') {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Invalid auth token' }));
      }

      const userId = tokenParts[2];
      const age = tokenParts[3] || '20';

      // Forward request to targeted microservice
      const targetPort = (path.startsWith('/wallet/') || path.startsWith('/escrow/') || path.startsWith('/staking/')) ? PORT_LEDGER : PORT_MEDIA;
      
      const options = {
        hostname: '127.0.0.1',
        port: targetPort,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          'X-User-Id': userId,
          'X-User-Age': age,
        }
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.statusCode = proxyRes.statusCode;
        // Copy response headers
        Object.keys(proxyRes.headers).forEach(key => {
          res.setHeader(key, proxyRes.headers[key]);
        });
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: `Proxy connection error: ${err.message}` }));
      });

      if (body) {
        proxyReq.write(body);
      }
      return proxyReq.end();
    }

    // 3. Fallback Health Endpoint
    if (path === '/health') {
      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'online', service: 'mock-gateway' }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
});

gatewayHttpServer.listen(PORT_GATEWAY);
const wss = new WebSocketServer({ server: gatewayHttpServer });
console.log(`[MOCK GATEWAY] WebSocket & HTTP Server listening on port ${PORT_GATEWAY}`);

wss.on('connection', (ws, req) => {
  const reqUrl = url.parse(req.url, true);
  const token = reqUrl.query.token;
  let userId = 'anonymous';
  let age = 20;

  if (token) {
    const tokenParts = token.split('-');
    if (tokenParts.length >= 4 && tokenParts[0] === 'mock' && tokenParts[1] === 'token') {
      userId = tokenParts[2];
      age = parseInt(tokenParts[3]);
    }
  }

  ws.userId = userId;
  ws.age = age;

  console.log(`[MOCK GATEWAY] Client connected: ${userId} (Age: ${age})`);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      console.log(`[MOCK GATEWAY] Received message from ${userId} to ${data.receiver_id}: "${data.content}"`);

      // Minor Sandbox constraints check (age 15-17)
      const isMinor = age >= 15 && age <= 17;
      if (isMinor) {
        console.log(`[MOCK GATEWAY] SANDBOX BLOCK: Minor ${userId} blocked from sending DMs.`);
        return;
      }

      // Find recipient socket
      let recipientFound = false;
      wss.clients.forEach((client) => {
        if (client.userId === data.receiver_id) {
          recipientFound = true;
          const recIsMinor = client.age >= 15 && client.age <= 17;
          if (recIsMinor) {
            console.log(`[MOCK GATEWAY] SANDBOX BLOCK: Blocked DM from adult ${userId} to minor ${client.userId}.`);
            return;
          }
          client.send(JSON.stringify({
            sender_id: userId,
            content: data.content
          }));
        }
      });

      if (!recipientFound) {
        console.log(`[MOCK GATEWAY] Recipient offline. Routing to Redis Pub/Sub cluster.`);
      }
    } catch (e) {
      console.error('[MOCK GATEWAY] Error parsing socket frame:', e.message);
    }
  });
});

// ==========================================
// 2. RUST-LEDGER MOCK HTTP SERVER
// ==========================================
const ledgerServer = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && parsedUrl.pathname === '/wallet/balance') {
      const userId = req.headers['x-user-id'] || 'user_sender_123';
      if (!wallets[userId]) {
        wallets[userId] = {
          user_id: userId,
          offchain_balance: 5000.00,
          reserved_escrow_balance: 0.00,
          kyc_verified: false
        };
      }
      res.statusCode = 200;
      return res.end(JSON.stringify(wallets[userId]));
    }

    if (req.method === 'GET' && parsedUrl.pathname === '/wallet/transactions') {
      res.statusCode = 200;
      return res.end(JSON.stringify(mockTransactions));
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/wallet/transfer') {
      const payload = JSON.parse(body);
      const senderId = req.headers['x-user-id'] || 'user_sender_123';
      if (!wallets[senderId]) {
        wallets[senderId] = {
          user_id: senderId,
          offchain_balance: senderId.includes('whale') ? 1000000.00 : 5000.00,
          reserved_escrow_balance: 0.00,
          kyc_verified: false
        };
      }
      const sender = wallets[senderId];

      if (sender.offchain_balance < payload.amount) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Insufficient funds' }));
      }

      if (payload.amount > 1000 && !sender.kyc_verified && !senderId.includes('whale')) {
        console.log(`[MOCK LEDGER] TRANSACTION BLOCKED: Transfer of ${payload.amount} exceeds unverified limit for ${senderId}`);
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Transaction exceeds unverified threshold. Please complete KYC.' }));
      }

      sender.offchain_balance -= payload.amount;
      if (!wallets[payload.receiver_id]) {
        wallets[payload.receiver_id] = {
          user_id: payload.receiver_id,
          offchain_balance: 0.00,
          reserved_escrow_balance: 0.00,
          kyc_verified: false
        };
      }
      wallets[payload.receiver_id].offchain_balance += payload.amount;

      console.log(`[MOCK LEDGER] Transfer of ${payload.amount} completed. Sender balance: ${sender.offchain_balance}`);
      
      mockTransactions.push({
        id: 'tx_' + Math.floor(Math.random() * 100000),
        tx_type: 'TRANSFER',
        sender_address: senderId,
        receiver_address: payload.receiver_id,
        amount: payload.amount,
        status: 'SETTLED',
        created_at: new Date()
      });

      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'success', message: 'Transfer processed off-chain.' }));
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/escrow/create') {
      const payload = JSON.parse(body);
      const buyerId = req.headers['x-user-id'] || 'user_sender_123';
      if (!wallets[buyerId]) {
        wallets[buyerId] = {
          user_id: buyerId,
          offchain_balance: 5000.00,
          reserved_escrow_balance: 0.00,
          kyc_verified: false
        };
      }
      const buyer = wallets[buyerId];

      if (buyer.offchain_balance < payload.amount) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Insufficient funds' }));
      }

      if (payload.amount > 1000 && !buyer.kyc_verified) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Escrow lock exceeds limit. Please complete KYC.' }));
      }

      buyer.offchain_balance -= payload.amount;
      buyer.reserved_escrow_balance += payload.amount;

      const escrowId = 'escrow_' + Math.floor(Math.random() * 1000);
      escrows[escrowId] = {
        id: escrowId,
        buyer_id: buyerId,
        seller_id: payload.seller_id,
        amount: payload.amount,
        state: 'LOCKED'
      };

      console.log(`[MOCK LEDGER] Escrow ${escrowId} locked: ${payload.amount} NEXA from ${buyerId} to ${payload.seller_id}`);

      mockTransactions.push({
        id: 'tx_' + Math.floor(Math.random() * 100000),
        tx_type: 'ESCROW_CREATE',
        sender_address: buyerId,
        receiver_address: payload.seller_id,
        amount: payload.amount,
        status: 'SETTLED',
        created_at: new Date()
      });

      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'success', escrow_id: escrowId, state: 'LOCKED' }));
    }

    if (req.method === 'POST' && parsedUrl.pathname.startsWith('/escrow/release/')) {
      const parts = parsedUrl.pathname.split('/');
      const escrowId = parts[parts.length - 1];
      const escrow = escrows[escrowId];

      if (!escrow) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Escrow not found' }));
      }

      if (escrow.state !== 'LOCKED') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Escrow not in LOCKED state' }));
      }

      escrow.state = 'RELEASED';
      
      const buyer = wallets[escrow.buyer_id];
      const seller = wallets[escrow.seller_id];

      if (buyer) {
        buyer.reserved_escrow_balance -= escrow.amount;
      }

      if (!wallets[escrow.seller_id]) {
        wallets[escrow.seller_id] = {
          user_id: escrow.seller_id,
          offchain_balance: 0.00,
          reserved_escrow_balance: 0.00,
          kyc_verified: false
        };
      }
      wallets[escrow.seller_id].offchain_balance += escrow.amount;

      console.log(`[MOCK LEDGER] Escrow ${escrowId} released: ${escrow.amount} credited to ${escrow.seller_id}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'success', escrow_id: escrowId, state: 'RELEASED' }));
    }

    // ==========================================
    // STAKING ENGINE MOCK ENDPOINTS
    // ==========================================
    if (req.method === 'POST' && parsedUrl.pathname === '/staking/stake') {
      const payload = JSON.parse(body);
      const userId = req.headers['x-user-id'] || 'buyer_bill';
      if (!wallets[userId]) {
        wallets[userId] = {
          user_id: userId,
          offchain_balance: 5000.00,
          reserved_escrow_balance: 0.00,
          kyc_verified: false
        };
      }
      const buyer = wallets[userId];

      if (buyer.offchain_balance < payload.amount) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Insufficient funds' }));
      }

      const lockDays = payload.lock_days || 30;
      const tier = lockDays === 30 ? 'BRONZE' : lockDays === 90 ? 'SILVER' : lockDays === 180 ? 'GOLD' : 'PLATINUM';
      const apy = lockDays === 30 ? 5 : lockDays === 90 ? 8 : lockDays === 180 ? 12 : 18;

      buyer.offchain_balance -= payload.amount;
      buyer.reserved_escrow_balance += payload.amount;

      const positionId = 'pos_' + Math.floor(Math.random() * 10000);
      const lockEnd = new Date();
      lockEnd.setDate(lockEnd.getDate() + lockDays);

      stakingPositions[positionId] = {
        id: positionId,
        user_id: userId,
        staked_amount: payload.amount,
        tier: tier,
        apy: apy,
        lock_start: new Date(),
        lock_end: lockEnd,
        status: 'ACTIVE'
      };

      console.log(`[MOCK LEDGER] User ${userId} staked ${payload.amount} NEXA under lock ${lockDays}d (Tier: ${tier})`);
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        position_id: positionId,
        tier: tier,
        amount: payload.amount,
        lock_end: lockEnd.toISOString()
      }));
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/staking/unstake') {
      const payload = JSON.parse(body);
      const userId = req.headers['x-user-id'] || 'buyer_bill';
      const pos = stakingPositions[payload.position_id];

      if (!pos) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Staking position not found' }));
      }

      if (pos.status !== 'ACTIVE') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Staking position is already inactive' }));
      }

      const buyer = wallets[userId];
      const principal = pos.staked_amount;
      let returned = principal;
      let penalty = 0;
      let finalStatus = 'UNSTAKED';

      const now = new Date();
      if (now < pos.lock_end) {
        penalty = principal * 0.15;
        returned = principal - penalty;
        finalStatus = 'EARLY_WITHDRAWAL';
      }

      buyer.reserved_escrow_balance -= principal;
      buyer.offchain_balance += returned;
      pos.status = finalStatus;

      console.log(`[MOCK LEDGER] Unstaked position ${pos.id} for user ${userId}. Returned: ${returned}, Penalty: ${penalty}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        position_id: pos.id,
        principal_staked: principal,
        principal_returned: returned,
        penalty_applied: penalty,
        final_status: finalStatus
      }));
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/staking/claim') {
      const payload = JSON.parse(body);
      const userId = req.headers['x-user-id'] || 'buyer_bill';
      const pos = stakingPositions[payload.position_id];

      if (!pos || pos.status !== 'ACTIVE') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid active staking position ID' }));
      }

      // Simulate reward payout (e.g. 25.5 NEXA yield)
      const reward = 25.50;
      wallets[userId].offchain_balance += reward;

      console.log(`[MOCK LEDGER] Disbursed reward yield ${reward} NEXA to ${userId}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({
        status: 'success',
        position_id: pos.id,
        claimed_amount: reward,
        message: 'Staking reward claimed successfully.'
      }));
    }

    if (req.method === 'GET' && parsedUrl.pathname.startsWith('/staking/dashboard/')) {
      const parts = parsedUrl.pathname.split('/');
      const userId = parts[parts.length - 1];
      
      const userPositions = Object.values(stakingPositions).filter(p => p.user_id === userId && p.status === 'ACTIVE');
      const totalStaked = userPositions.reduce((sum, p) => sum + p.staked_amount, 0);

      let currentTier = 'NONE';
      let highestApy = 0;
      userPositions.forEach(p => {
        if (p.apy > highestApy) {
          highestApy = p.apy;
          currentTier = p.tier;
        }
      });

      // Simulate a small accrued yield for testing
      const totalAccrued = userPositions.length > 0 ? 15.20 : 0.00;

      res.statusCode = 200;
      return res.end(JSON.stringify({
        user_id: userId,
        total_staked: totalStaked,
        current_tier: currentTier,
        apy: highestApy,
        rewards_accrued: totalAccrued,
        positions_count: userPositions.length
      }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
});
ledgerServer.listen(PORT_LEDGER);
console.log(`[MOCK LEDGER] HTTP Server listening on port ${PORT_LEDGER}`);

// ==========================================
// 3. NESTJS-MEDIA MOCK HTTP SERVER
// ==========================================
const mediaServer = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // KYC: Register Biometrics
    if (req.method === 'POST' && path === '/kyc/register-biometrics') {
      const payload = JSON.parse(body);
      biometrics[payload.userId] = payload.biometricPublicKey;
      console.log(`[MOCK NestJS] Registered biometric key for ${payload.userId}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({ success: true }));
    }

    // KYC: Status Check
    if (req.method === 'GET' && path.startsWith('/kyc/status/')) {
      const parts = path.split('/');
      const userId = parts[parts.length - 1];
      res.statusCode = 200;
      return res.end(JSON.stringify({ userId, status: kycStatus[userId] || 'UNVERIFIED' }));
    }

    // KYC: Face Verification (Multipart Simulation)
    if (req.method === 'POST' && path === '/kyc/verify-face') {
      const match = body.match(/name="userId"\r\n\r\n([^\r\n]+)/);
      const userId = match ? match[1] : 'user_sender_123';

      console.log(`[MOCK NestJS] Processing face verification for ${userId}...`);
      kycStatus[userId] = 'VERIFIED';
      
      if (wallets[userId]) {
        wallets[userId].kyc_verified = true;
      }

      // NexaRewards Integration: Check if user was referred under status 'PENDING_KYC'
      const ref = referrals[userId];
      if (ref && ref.status === 'PENDING_KYC') {
        const referrerId = ref.referrerId;
        ref.status = 'REWARD_PAID';
        ref.rewardedAt = new Date();
        console.log(`[MOCK NestJS] Referral reward triggered: 25 NEXA payout to referrer ${referrerId} for KYC of ${userId}`);

        // Update referrer loyalty XP (+500)
        if (!loyaltyBalances[referrerId]) {
          loyaltyBalances[referrerId] = { xp: 0, lifetimeRewards: 0 };
        }
        loyaltyBalances[referrerId].xp += 500;

        // Disburse 25 NEXA to referrer wallet
        if (!wallets[referrerId]) {
          wallets[referrerId] = {
            user_id: referrerId,
            offchain_balance: 0.00,
            reserved_escrow_balance: 0.00,
            kyc_verified: false
          };
        }
        wallets[referrerId].offchain_balance += 25.00;
        console.log(`[MOCK NestJS] Credited 25 NEXA & 500 XP to referrer ${referrerId}. New balance: ${wallets[referrerId].offchain_balance}`);
      }

      res.statusCode = 200;
      return res.end(JSON.stringify({ success: true, status: 'VERIFIED', confidence: 98.6 }));
    }

    // P2E: Engagement Increment
    if (req.method === 'POST' && path === '/feed/engagement') {
      const payload = JSON.parse(body);
      const key = `${payload.postId}:${payload.type}`;
      engagement[key] = (engagement[key] || 0) + (payload.count || 1);
      res.statusCode = 200;
      return res.end(JSON.stringify({ statusCode: 200, message: 'Engagement recorded' }));
    }

    // P2E: NexLink Share
    if (req.method === 'POST' && path === '/feed/link') {
      const payload = JSON.parse(body);
      nexlinks[payload.postId] = payload.linkerId;
      res.statusCode = 201;
      return res.end(JSON.stringify({ statusCode: 201, message: 'NexLink registered' }));
    }

    // P2E: Check Rewards
    if (req.method === 'GET' && path.startsWith('/feed/rewards/')) {
      const parts = path.split('/');
      const postId = parts[parts.length - 1].split('?')[0];
      const creatorId = parsedUrl.query.creator_id;
      const category = parsedUrl.query.category || 'STANDARD';

      const views = engagement[`${postId}:view`] || 0;
      const likes = engagement[`${postId}:like`] || 0;
      const shares = engagement[`${postId}:share`] || 0;

      const es = (views * 1.0) + (likes * 3.0) + (shares * 5.0);
      let multiplier = 1.0;
      if (category === 'EDUCATIONAL') multiplier = 2.5;
      if (category === 'DIVINE') multiplier = 5.0;

      // Dynamic Staking Booster calculation based on staking positions
      let stakingTier = 'NONE';
      let stakingBooster = 1.0;
      const creatorPositions = Object.values(stakingPositions).filter(p => p.user_id === creatorId);
      if (creatorPositions.length > 0) {
        const tiers = creatorPositions.map(p => p.tier);
        if (tiers.includes('PLATINUM')) {
          stakingTier = 'PLATINUM';
          stakingBooster = 3.5;
        } else if (tiers.includes('GOLD')) {
          stakingTier = 'GOLD';
          stakingBooster = 2.2;
        } else if (tiers.includes('SILVER')) {
          stakingTier = 'SILVER';
          stakingBooster = 1.5;
        } else if (tiers.includes('BRONZE')) {
          stakingTier = 'BRONZE';
          stakingBooster = 1.0;
        }
      }

      const totalReward = es * multiplier * 0.1 * stakingBooster;
      const linkerId = nexlinks[postId];

      if (linkerId) {
        return res.end(JSON.stringify({
          postId,
          engagementScore: es,
          multiplier,
          stakingTier,
          stakingBooster,
          totalReward,
          splits: [
            { recipientId: creatorId, role: 'CREATOR', amount: totalReward * 0.6 },
            { recipientId: linkerId, role: 'LINKER', amount: totalReward * 0.4 }
          ]
        }));
      }

      return res.end(JSON.stringify({
        postId,
        engagementScore: es,
        multiplier,
        stakingTier,
        stakingBooster,
        totalReward,
        splits: [
          { recipientId: creatorId, role: 'CREATOR', amount: totalReward }
        ]
      }));
    }

    // ==========================================
    // NEXAMARKET (MARKETPLACE) MOCK ENDPOINTS
    // ==========================================
    
    // Create product
    if (req.method === 'POST' && path === '/marketplace/products') {
      try {
        const payload = JSON.parse(body);
        const merchantId = req.headers['x-user-id'] || 'merchant_joe';
        const productId = 'prod_' + Math.floor(Math.random() * 10000);
        
        const newProduct = {
          _id: productId,
          merchantId,
          title: payload.title,
          description: payload.description || '',
          price: parseFloat(payload.price),
          category: payload.category || 'STANDARD',
          stock: payload.stock || 1,
          images: payload.images || [],
          rating: 0,
          reviewCount: 0
        };

        products.push(newProduct);
        console.log(`[MOCK NestJS] Product listing created: "${payload.title}" by merchant ${merchantId}`);
        
        res.statusCode = 201;
        return res.end(JSON.stringify({ success: true, productId, product: newProduct }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    // List products
    if (req.method === 'GET' && path === '/marketplace/products') {
      const category = parsedUrl.query.category;
      const search = parsedUrl.query.search;
      
      let filtered = [...products];
      if (category) {
        filtered = filtered.filter(p => p.category === category);
      }
      if (search) {
        const query = search.toLowerCase();
        filtered = filtered.filter(p => p.title.toLowerCase().includes(query) || p.description.toLowerCase().includes(query));
      }

      res.statusCode = 200;
      return res.end(JSON.stringify(filtered));
    }

    // Product Details
    if (req.method === 'GET' && path.startsWith('/marketplace/products/')) {
      const parts = path.split('/');
      const id = parts[parts.length - 1];
      const product = products.find(p => p._id === id);
      
      if (!product) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Product not found' }));
      }
      
      res.statusCode = 200;
      return res.end(JSON.stringify(product));
    }

    // Create Order (Escrow Integration)
    if (req.method === 'POST' && path === '/marketplace/orders') {
      try {
        const payload = JSON.parse(body);
        const buyerId = req.headers['x-user-id'] || 'buyer_bill';
        
        const product = products.find(p => p._id === payload.productId);
        if (!product) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Product not found' }));
        }

        if (product.stock < payload.quantity) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'Insufficient stock' }));
        }

        const totalPrice = product.price * payload.quantity;

        // Perform HTTP lock against Ledger service
        const options = {
          hostname: '127.0.0.1',
          port: PORT_LEDGER,
          path: '/escrow/create',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': buyerId
          }
        };

        const ledgerReq = http.request(options, (ledgerRes) => {
          let ledgerBody = '';
          ledgerRes.on('data', chunk => { ledgerBody += chunk; });
          ledgerRes.on('end', () => {
            if (ledgerRes.statusCode !== 200) {
              res.statusCode = ledgerRes.statusCode;
              return res.end(ledgerBody);
            }

            try {
              const ledgerJson = JSON.parse(ledgerBody);
              
              // Deduct stock
              product.stock -= payload.quantity;

              const orderId = 'order_' + Math.floor(Math.random() * 10000);
              const newOrder = {
                orderId,
                buyerId,
                merchantId: product.merchantId,
                productId: product._id,
                quantity: payload.quantity,
                totalPrice,
                escrowId: ledgerJson.escrow_id,
                status: 'PAID_LOCKED',
                trackingNumber: '',
                shippingAddress: payload.shippingAddress
              };

              orders.push(newOrder);
              console.log(`[MOCK NestJS] Order ${orderId} created under PAID_LOCKED status`);

              res.statusCode = 200;
              res.end(JSON.stringify({
                success: true,
                orderId,
                escrowId: ledgerJson.escrow_id,
                status: 'PAID_LOCKED',
                totalPrice
              }));
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to process ledger response' }));
            }
          });
        });

        ledgerReq.on('error', (err) => {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: `Ledger integration offline: ${err.message}` }));
        });

        ledgerReq.write(JSON.stringify({
          order_id: 'temp_order_id',
          seller_id: product.merchantId,
          amount: totalPrice
        }));
        return ledgerReq.end();

      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    // Ship Order
    if (req.method === 'POST' && path.startsWith('/marketplace/orders/') && path.endsWith('/ship')) {
      try {
        const parts = path.split('/');
        const orderId = parts[parts.length - 2];
        const payload = JSON.parse(body);
        const merchantId = req.headers['x-user-id'] || 'merchant_joe';

        const order = orders.find(o => o.orderId === orderId);
        if (!order) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Order not found' }));
        }

        if (order.merchantId !== merchantId) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Unauthorized merchant ID' }));
        }

        order.status = 'SHIPPED';
        order.trackingNumber = payload.trackingNumber;

        console.log(`[MOCK NestJS] Order ${orderId} marked as SHIPPED`);
        res.statusCode = 200;
        return res.end(JSON.stringify({ success: true, status: 'SHIPPED', trackingNumber: payload.trackingNumber }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    // Complete Order (Escrow Release)
    if (req.method === 'POST' && path.startsWith('/marketplace/orders/') && path.endsWith('/complete')) {
      try {
        const parts = path.split('/');
        const orderId = parts[parts.length - 2];
        const payload = JSON.parse(body);
        const buyerId = req.headers['x-user-id'] || 'buyer_bill';

        const order = orders.find(o => o.orderId === orderId);
        if (!order) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Order not found' }));
        }

        if (order.buyerId !== buyerId) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Unauthorized buyer ID' }));
        }

        // Trigger HTTP release inside Ledger service
        const options = {
          hostname: '127.0.0.1',
          port: PORT_LEDGER,
          path: `/escrow/release/${order.escrowId}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        };

        const ledgerReq = http.request(options, (ledgerRes) => {
          let ledgerBody = '';
          ledgerRes.on('data', chunk => { ledgerBody += chunk; });
          ledgerRes.on('end', () => {
            if (ledgerRes.statusCode !== 200) {
              res.statusCode = ledgerRes.statusCode;
              return res.end(ledgerBody);
            }

            order.status = 'COMPLETED';
            console.log(`[MOCK NestJS] Order ${orderId} completed and escrow released.`);
            
            // NexaRewards Ecosystem: 1% cashback math + 100 XP award
            const cashbackAmount = parseFloat((order.totalPrice * 0.01).toFixed(2));
            console.log(`[MOCK NestJS] Rewards process: 1% cashback on ${order.totalPrice} NEXA = ${cashbackAmount} NEXA for buyer ${order.buyerId}`);

            // Initialize or fetch buyer loyalty balance
            if (!loyaltyBalances[order.buyerId]) {
              loyaltyBalances[order.buyerId] = { xp: 0, lifetimeRewards: 0 };
            }
            loyaltyBalances[order.buyerId].xp += 100;
            loyaltyBalances[order.buyerId].lifetimeRewards += cashbackAmount;

            // Pay the cashback via ledger treasury transfer simulation (add to buyer offchain_balance)
            if (!wallets[order.buyerId]) {
              wallets[order.buyerId] = {
                user_id: order.buyerId,
                offchain_balance: 0.00,
                reserved_escrow_balance: 0.00,
                kyc_verified: false
              };
            }
            wallets[order.buyerId].offchain_balance += cashbackAmount;
            console.log(`[MOCK NestJS] Transferred ${cashbackAmount} NEXA cashback to buyer ${order.buyerId}. New balance: ${wallets[order.buyerId].offchain_balance}`);

            // Milestone verification: MERCH_KING
            const completedCount = orders.filter(o => o.buyerId === order.buyerId && o.status === 'COMPLETED').length;
            if (completedCount >= 3) {
              if (!achievementBadges[order.buyerId]) {
                achievementBadges[order.buyerId] = [];
              }
              if (!achievementBadges[order.buyerId].includes('MERCH_KING')) {
                achievementBadges[order.buyerId].push('MERCH_KING');
                loyaltyBalances[order.buyerId].xp += 500;
                console.log(`[MOCK NestJS] User ${order.buyerId} unlocked achievement: MERCH_KING! XP increased by 500.`);
              }
            }

            // Milestone verification: LOCK_MASTER
            const hasStaking = Object.values(stakingPositions).some(pos => pos.user_id === order.buyerId && pos.staked_amount > 0);
            if (hasStaking) {
              if (!achievementBadges[order.buyerId]) {
                achievementBadges[order.buyerId] = [];
              }
              if (!achievementBadges[order.buyerId].includes('LOCK_MASTER')) {
                achievementBadges[order.buyerId].push('LOCK_MASTER');
                loyaltyBalances[order.buyerId].xp += 500;
                console.log(`[MOCK NestJS] User ${order.buyerId} unlocked achievement: LOCK_MASTER! XP increased by 500.`);
              }
            }

            res.statusCode = 200;
            res.end(JSON.stringify({
              success: true,
              status: 'COMPLETED',
              message: 'Funds released to merchant. Order finalized.'
            }));
          });
        });

        ledgerReq.on('error', (err) => {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: `Ledger release integration offline: ${err.message}` }));
        });

        ledgerReq.write(JSON.stringify({
          signature: payload.signature || 'ssh-ed25519-mock-buyer-delivery-signature'
        }));
        return ledgerReq.end();

      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    // Add Review
    if (req.method === 'POST' && path.startsWith('/marketplace/products/') && path.endsWith('/reviews')) {
      try {
        const parts = path.split('/');
        const productId = parts[parts.length - 2];
        const payload = JSON.parse(body);
        const reviewerId = req.headers['x-user-id'] || 'buyer_bill';

        const product = products.find(p => p._id === productId);
        if (!product) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Product not found' }));
        }

        const order = orders.find(o => o.orderId === payload.orderId && o.buyerId === reviewerId && o.productId === productId);
        if (!order || order.status !== 'COMPLETED') {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'No completed orders found to review' }));
        }

        const review = {
          productId,
          orderId: payload.orderId,
          reviewerId,
          rating: payload.rating,
          comment: payload.comment || ''
        };

        reviews.push(review);
        
        // Recalculate average
        const prodReviews = reviews.filter(r => r.productId === productId);
        const avg = prodReviews.reduce((sum, r) => sum + r.rating, 0) / prodReviews.length;
        
        product.rating = parseFloat(avg.toFixed(1));
        product.reviewCount = prodReviews.length;

        console.log(`[MOCK NestJS] Added review for product ${productId}. Rating: ${product.rating}`);
        res.statusCode = 201;
        return res.end(JSON.stringify({ success: true, message: 'Review registered successfully.' }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    // Merchant Dashboard
    if (req.method === 'GET' && path === '/marketplace/merchant/dashboard') {
      const merchantId = req.headers['x-user-id'] || 'merchant_joe';
      
      const merchantProducts = products.filter(p => p.merchantId === merchantId);
      const merchantOrders = orders.filter(o => o.merchantId === merchantId);
      const completedVolume = merchantOrders
        .filter(o => o.status === 'COMPLETED')
        .reduce((sum, o) => sum + o.totalPrice, 0);

      res.statusCode = 200;
      return res.end(JSON.stringify({
        products: merchantProducts,
        orders: merchantOrders,
        totalSalesVolume: completedVolume,
        activeOrdersCount: merchantOrders.filter(o => o.status !== 'COMPLETED' && o.status !== 'REFUNDED').length
      }));
    }

    // ==========================================
    // BUSINESS ACCOUNTS MOCK ENDPOINTS
    // ==========================================
    if (req.method === 'POST' && path === '/business/register') {
      try {
        const payload = JSON.parse(body);
        const ownerId = req.headers['x-user-id'] || 'merchant_joe';
        const businessId = 'bus_' + Math.floor(Math.random() * 10000);

        businessProfiles[businessId] = {
          id: businessId,
          ownerId,
          businessName: payload.businessName,
          businessType: payload.businessType,
          verified: false,
          reputationScore: 100
        };

        businessMembers[businessId] = {};
        businessMembers[businessId][ownerId] = 'OWNER';

        console.log(`[MOCK NestJS] Registered business: "${payload.businessName}" (${payload.businessType})`);
        res.statusCode = 201;
        return res.end(JSON.stringify({ success: true, businessId, profile: businessProfiles[businessId] }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    if (req.method === 'POST' && path.startsWith('/business/') && path.endsWith('/verify')) {
      const parts = path.split('/');
      const businessId = parts[parts.length - 2];
      const profile = businessProfiles[businessId];

      if (!profile) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Business profile not found' }));
      }

      profile.verified = true;
      console.log(`[MOCK NestJS] Verified business: ${businessId}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({ success: true, businessId, verified: true }));
    }

    if (req.method === 'POST' && path.startsWith('/business/') && path.endsWith('/members')) {
      try {
        const parts = path.split('/');
        const businessId = parts[parts.length - 2];
        const payload = JSON.parse(body);
        const requesterId = req.headers['x-user-id'] || 'merchant_joe';

        const members = businessMembers[businessId];
        if (!members) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'Business not found' }));
        }

        const requesterRole = members[requesterId];
        if (requesterRole !== 'OWNER' && requesterRole !== 'ADMIN') {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: 'Unauthorized. Only Owners or Admins can invite team members.' }));
        }

        members[payload.userId] = payload.role;
        console.log(`[MOCK NestJS] Added user ${payload.userId} as ${payload.role} to business ${businessId}`);
        
        res.statusCode = 200;
        return res.end(JSON.stringify({ success: true, message: `User ${payload.userId} registered as ${payload.role}.` }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    if (req.method === 'GET' && path.startsWith('/business/') && path.endsWith('/analytics')) {
      const parts = path.split('/');
      const businessId = parts[parts.length - 2];
      const requesterId = req.headers['x-user-id'] || 'merchant_joe';

      const members = businessMembers[businessId];
      if (!members || !members[requesterId]) {
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Unauthorized access. You are not a registered member.' }));
      }

      // Return mock historical analytics
      const mockLogs = [];
      const now = new Date();
      for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        mockLogs.push({
          businessId,
          date: d.toISOString(),
          volumeNexa: 1000 + i * 250,
          orderCount: 10 + i * 2,
          refundCount: i % 2 === 0 ? 1 : 0
        });
      }

      res.statusCode = 200;
      return res.end(JSON.stringify(mockLogs));
    }

    if (req.method === 'GET' && path.startsWith('/business/') && path.endsWith('/profile')) {
      const parts = path.split('/');
      const businessId = parts[parts.length - 2];
      const profile = businessProfiles[businessId];

      if (!profile) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ error: 'Business profile not found' }));
      }

      res.statusCode = 200;
      return res.end(JSON.stringify({
        businessId,
        businessName: profile.businessName,
        reputationScore: 98,
        verified: profile.verified
      }));
    }

    // ==========================================
    // NEXAREWARDS ECOSYSTEM MOCK ENDPOINTS
    // ==========================================
    if (req.method === 'GET' && path.startsWith('/rewards/dashboard/')) {
      const parts = path.split('/');
      const userId = parts[parts.length - 1];
      
      const balance = loyaltyBalances[userId] || { xp: 0, lifetimeRewards: 0 };
      const userBadges = achievementBadges[userId] || [];
      
      const userReferrals = Object.values(referrals).filter(r => r.referrerId === userId);
      const pendingCount = userReferrals.filter(r => r.status === 'PENDING_KYC').length;
      const paidCount = userReferrals.filter(r => r.status === 'REWARD_PAID').length;

      res.statusCode = 200;
      return res.end(JSON.stringify({
        userId,
        xp: balance.xp,
        lifetimeRewards: balance.lifetimeRewards,
        pendingReferralsCount: pendingCount,
        paidReferralsCount: paidCount,
        badges: userBadges,
        referralCode: `NEXA-REF-${userId.toUpperCase()}`
      }));
    }

    if (req.method === 'POST' && path === '/rewards/register-referral') {
      try {
        const payload = JSON.parse(body);
        const referrerId = req.headers['x-user-id'] || 'merchant_joe';
        const referredId = payload.referredId;

        if (!referredId) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'referredId is required to map referral linkage' }));
        }

        if (referrerId === referredId) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: 'Users cannot refer themselves' }));
        }

        if (referrals[referredId]) {
          res.statusCode = 409;
          return res.end(JSON.stringify({ error: 'Referred user is already mapped to a referrer' }));
        }

        referrals[referredId] = {
          referrerId,
          referredId,
          status: 'PENDING_KYC',
          createdAt: new Date()
        };

        console.log(`[MOCK NestJS] Referral registered: ${referredId} referred by ${referrerId}`);
        res.statusCode = 201;
        return res.end(JSON.stringify({
          success: true,
          message: 'Referral link registered under PENDING_KYC status.'
        }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    if (req.method === 'GET' && path === '/rewards/leaderboard') {
      const leaderboard = Object.keys(loyaltyBalances).map(userId => ({
        userId,
        xp: loyaltyBalances[userId].xp,
        lifetimeRewards: loyaltyBalances[userId].lifetimeRewards
      }))
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);

      res.statusCode = 200;
      return res.end(JSON.stringify(leaderboard));
    }

    // ==========================================
    // ADMIN & ANALYTICS CONTROL CENTER MOCK ENDPOINTS
    // ==========================================
    const adminId = req.headers['x-user-id'] || 'admin_super';
    function verifyMockAdmin() {
      if (!adminId || !adminId.startsWith('admin_')) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Forbidden. Administrative credentials required.' }));
        return false;
      }
      return true;
    }

    if (req.method === 'GET' && path === '/admin/stats/summary') {
      if (!verifyMockAdmin()) return;
      
      const activeEscrows = Object.values(escrows).filter(e => e.state === 'LOCKED');
      const activeEscrowsValue = activeEscrows.reduce((sum, e) => sum + e.amount, 0);

      res.statusCode = 200;
      return res.end(JSON.stringify({
        usersCount: Object.keys(wallets).length,
        circulatingNexa: 105000000.00,
        escrowLockValue: activeEscrowsValue,
        activeEscrowsCount: activeEscrows.length,
        activeUsers24h: 120,
        tpsPeak: 14.5
      }));
    }

    if (req.method === 'GET' && path === '/admin/alerts') {
      if (!verifyMockAdmin()) return;
      
      const statusParam = parsedUrl.query.status;
      let filtered = [...systemAlerts];
      if (statusParam) {
        filtered = filtered.filter(a => a.status === statusParam);
      }
      res.statusCode = 200;
      return res.end(JSON.stringify(filtered));
    }

    if (req.method === 'POST' && path.startsWith('/admin/alerts/') && path.endsWith('/resolve')) {
      if (!verifyMockAdmin()) return;
      
      try {
        const parts = path.split('/');
        const alertId = parts[parts.length - 2];
        const payload = JSON.parse(body);

        const alert = systemAlerts.find(a => a._id === alertId);
        if (!alert) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: 'System alert not found' }));
        }

        alert.status = 'RESOLVED';
        alert.resolution = payload.resolution;
        alert.resolvedAt = new Date();

        console.log(`[MOCK NestJS] Alert ${alertId} resolved. Comment: "${payload.resolution}"`);
        res.statusCode = 200;
        return res.end(JSON.stringify({ success: true, alertId, status: 'RESOLVED' }));
      } catch (e) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Invalid payload' }));
      }
    }

    if (req.method === 'GET' && path === '/admin/kyc/pending') {
      if (!verifyMockAdmin()) return;
      
      const pending = Object.values(businessProfiles).filter(p => !p.verified);
      res.statusCode = 200;
      return res.end(JSON.stringify(pending));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
});

// ==========================================
// BACKGROUND AUTOMATED FRAUD DETECTION AUDIT
// ==========================================
function runMockFraudDetectionAudit() {
  const now = new Date();
  
  // 1. Audit Velocity Exceeded (more than 5 transfers within last 60 seconds)
  const recentTxs = mockTransactions.filter(tx => {
    const diffMs = now.getTime() - new Date(tx.created_at).getTime();
    return diffMs <= 60000;
  });

  const senderCounts = {};
  for (const tx of recentTxs) {
    const sender = tx.sender_address;
    if (!senderCounts[sender]) {
      senderCounts[sender] = [];
    }
    senderCounts[sender].push(tx.id);
  }

  for (const [sender, txIds] of Object.entries(senderCounts)) {
    if (txIds.length > 5) {
      const exists = systemAlerts.find(a => a.alertType === 'VELOCITY_EXCEEDED' && a.details.userId === sender && a.status === 'OPEN');
      if (!exists) {
        systemAlerts.push({
          _id: 'alert_' + Math.floor(Math.random() * 100000),
          alertType: 'VELOCITY_EXCEEDED',
          severity: 'WARNING',
          details: {
            userId: sender,
            txCount: txIds.length,
            txIds
          },
          status: 'OPEN',
          createdAt: new Date()
        });
        console.log(`[MOCK NestJS FRAUD ENGINE] VELOCITY_EXCEEDED flagged for user ${sender} (${txIds.length} transfers in 60s)`);
      }
    }
  }

  // 2. Audit High Value Unverified (> 50,000 NEXA from unverified wallet)
  for (const tx of mockTransactions) {
    if (tx.amount > 50000) {
      const sender = wallets[tx.sender_address];
      if (sender && !sender.kyc_verified) {
        const exists = systemAlerts.find(a => a.alertType === 'HIGH_VALUE_UNVERIFIED' && a.details.userId === tx.sender_address && a.status === 'OPEN');
        if (!exists) {
          systemAlerts.push({
            _id: 'alert_' + Math.floor(Math.random() * 100000),
            alertType: 'HIGH_VALUE_UNVERIFIED',
            severity: 'CRITICAL',
            details: {
              userId: tx.sender_address,
              amount: tx.amount,
              txId: tx.id
            },
            status: 'OPEN',
            createdAt: new Date()
          });
          console.log(`[MOCK NestJS FRAUD ENGINE] HIGH_VALUE_UNVERIFIED flagged for user ${tx.sender_address} (Transfer amount: ${tx.amount} NEXA)`);
        }
      }
    }
  }
}

setInterval(runMockFraudDetectionAudit, 1000);

mediaServer.listen(PORT_MEDIA);
console.log(`[MOCK NestJS] HTTP Server listening on port ${PORT_MEDIA}`);
console.log('\nAll mock servers started successfully! Ready for E2E integration runner.\n');
