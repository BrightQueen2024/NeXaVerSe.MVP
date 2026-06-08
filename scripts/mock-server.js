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
  }
};

const escrows = {};
const kycStatus = {};
const biometrics = {};
const engagement = {};
const nexlinks = {};

const PORT_GATEWAY = 8080;
const PORT_LEDGER = 8081;
const PORT_MEDIA = 8082;

// ==========================================
// 1. GO-GATEWAY WEBSOCKET MOCK SERVER
// ==========================================
const wss = new WebSocketServer({ port: PORT_GATEWAY });
console.log(`[MOCK GATEWAY] WebSocket Server listening on port ${PORT_GATEWAY}`);

wss.on('connection', (ws, req) => {
  const reqUrl = url.parse(req.url, true);
  const userId = reqUrl.query.user_id;
  const age = parseInt(reqUrl.query.age || '20');

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
        console.log(`[MOCK GATEWAY] SANDBOX BLOCK: Minor ${userId} blocked from sending DMs without mutual friends.`);
        return;
      }

      // Find recipient socket
      let recipientFound = false;
      wss.clients.forEach((client) => {
        if (client.userId === data.receiver_id) {
          recipientFound = true;
          // Apply sandbox check on recipient
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

    if (req.method === 'POST' && parsedUrl.pathname === '/wallet/transfer') {
      const payload = JSON.parse(body);
      const senderId = 'user_sender_123';
      const sender = wallets[senderId];

      if (!sender) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Sender wallet not found' }));
      }

      if (sender.offchain_balance < payload.amount) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Insufficient funds' }));
      }

      // KYC limits check (1000 NEXA threshold)
      if (payload.amount > 1000 && !sender.kyc_verified) {
        console.log(`[MOCK LEDGER] TRANSACTION BLOCKED: Transfer of ${payload.amount} exceeds unverified limit for ${senderId}`);
        res.statusCode = 403;
        return res.end(JSON.stringify({ error: 'Transaction exceeds unverified threshold. Please complete KYC.' }));
      }

      // Deduct/Credit
      sender.offchain_balance -= payload.amount;
      if (wallets[payload.receiver_id]) {
        wallets[payload.receiver_id].offchain_balance += payload.amount;
      }

      console.log(`[MOCK LEDGER] Transfer of ${payload.amount} completed. Sender balance: ${sender.offchain_balance}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'success', message: 'Transfer processed off-chain.' }));
    }

    if (req.method === 'POST' && parsedUrl.pathname === '/escrow/create') {
      const payload = JSON.parse(body);
      const buyerId = 'user_sender_123';
      const buyer = wallets[buyerId];

      if (!buyer || buyer.offchain_balance < payload.amount) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'Insufficient funds' }));
      }

      // KYC check
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

      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'success', escrow_id: escrowId, state: 'LOCKED' }));
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
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');

    // KYC: Register Biometrics
    if (req.method === 'POST' && parsedUrl.pathname === '/kyc/register-biometrics') {
      const payload = JSON.parse(body);
      biometrics[payload.userId] = payload.biometricPublicKey;
      console.log(`[MOCK NestJS] Registered biometric key for ${payload.userId}`);
      res.statusCode = 200;
      return res.end(JSON.stringify({ success: true }));
    }

    // KYC: Status Check
    if (req.method === 'GET' && parsedUrl.pathname.startsWith('/kyc/status/')) {
      const parts = parsedUrl.pathname.split('/');
      const userId = parts[parts.length - 1];
      res.statusCode = 200;
      return res.end(JSON.stringify({ userId, status: kycStatus[userId] || 'UNVERIFIED' }));
    }

    // KYC: Face Verification (Multipart Simulation)
    if (req.method === 'POST' && parsedUrl.pathname === '/kyc/verify-face') {
      // Extract userId from simulated multipart payload
      const match = body.match(/name="userId"\r\n\r\n([^\r\n]+)/);
      const userId = match ? match[1] : 'user_sender_123';

      console.log(`[MOCK NestJS] Processing face verification for ${userId}...`);
      kycStatus[userId] = 'VERIFIED';
      
      // Sync KYC status to our local ledger database simulation
      if (wallets[userId]) {
        wallets[userId].kyc_verified = true;
      }

      res.statusCode = 200;
      return res.end(JSON.stringify({ success: true, status: 'VERIFIED', confidence: 98.6 }));
    }

    // P2E: Engagement Increment
    if (req.method === 'POST' && parsedUrl.pathname === '/feed/engagement') {
      const payload = JSON.parse(body);
      const key = `${payload.postId}:${payload.type}`;
      engagement[key] = (engagement[key] || 0) + (payload.count || 1);
      res.statusCode = 200;
      return res.end(JSON.stringify({ statusCode: 200, message: 'Engagement recorded' }));
    }

    // P2E: NexLink Share
    if (req.method === 'POST' && parsedUrl.pathname === '/feed/link') {
      const payload = JSON.parse(body);
      nexlinks[payload.postId] = payload.linkerId;
      res.statusCode = 201;
      return res.end(JSON.stringify({ statusCode: 201, message: 'NexLink registered' }));
    }

    // P2E: Check Rewards
    if (req.method === 'GET' && parsedUrl.pathname.startsWith('/feed/rewards/')) {
      const parts = parsedUrl.pathname.split('/');
      const postId = parts[parts.length - 1].split('?')[0];
      const creatorId = parsedUrl.query.creator_id;
      const category = parsedUrl.query.category || 'STANDARD';

      const views = engagement[`${postId}:view`] || 0;
      const likes = engagement[`${postId}:like`] || 0;
      const shares = engagement[`${postId}:share`] || 0;

      // Score formula
      const es = (views * 1.0) + (likes * 3.0) + (shares * 5.0);
      let multiplier = 1.0;
      if (category === 'EDUCATIONAL') multiplier = 2.5;
      if (category === 'DIVINE') multiplier = 5.0;

      const totalReward = es * multiplier * 0.1;
      const linkerId = nexlinks[postId];

      if (linkerId) {
        return res.end(JSON.stringify({
          postId,
          engagementScore: es,
          multiplier,
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
        totalReward,
        splits: [
          { recipientId: creatorId, role: 'CREATOR', amount: totalReward }
        ]
      }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not Found' }));
  });
});
mediaServer.listen(PORT_MEDIA);
console.log(`[MOCK NestJS] HTTP Server listening on port ${PORT_MEDIA}`);
console.log('\nAll mock servers started successfully! Ready for E2E integration runner.\n');
