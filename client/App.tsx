import React, { useState, useEffect, useRef } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  ScrollView, 
  TextInput, 
  ActivityIndicator, 
  Alert, 
  SafeAreaView, 
  StatusBar,
  Animated,
  Platform
} from 'react-native';
import { BiometricWalletService } from './src/services/biometrics';
import { CosmicCard } from './src/components/CosmicCard';
import { VaultLock } from './src/components/VaultLock';
import { XpProgressBar } from './src/components/XpProgressBar';
import { RankBadge } from './src/components/RankBadge';

export default function App() {
  // Navigation
  const [activeTab, setActiveTab] = useState<'NEXSTREAM' | 'CHAT' | 'ESCROW' | 'SANDBOX'>('NEXSTREAM');

  // Gamified XP & Ranks
  const [xp, setXp] = useState(12500);
  const [userRank, setUserRank] = useState('Expert');

  // Wallet States
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState('450.50');
  const [txAmount, setTxAmount] = useState('100');
  const [loading, setLoading] = useState(false);

  // Chat & Presence States
  const [userId, setUserId] = useState('user_client_88');
  const [userAge, setUserAge] = useState('16'); // Sandbox default is minor (16)
  const [receiverId, setReceiverId] = useState('adult_25');
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<Array<{ sender: string; content: string }>>([
    { sender: 'system', content: 'Sandbox gateway initialized.' },
    { sender: 'adult_25', content: 'Hey, are we locking the Genesis visor in escrow?' }
  ]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [isTyping, setIsTyping] = useState(false);

  // Authentication State
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // KYC States
  const [kycStatus, setKycStatus] = useState<'UNVERIFIED' | 'PENDING' | 'VERIFIED'>('UNVERIFIED');
  const [kycProgress, setKycProgress] = useState(0);

  // Escrow Marketplace States
  const [escrowRole, setEscrowRole] = useState<'BUYER' | 'SELLER'>('BUYER');
  const [escrowAmount, setEscrowAmount] = useState('150.00');
  const [escrowItem, setEscrowItem] = useState('Cybernetic Genesis Visor #949');
  const [escrowLogs, setEscrowLogs] = useState<string[]>(['No active vault locked on-chain.']);
  const [lastEscrowId, setLastEscrowId] = useState<string | null>(null);

  const getHttpUrl = () => {
    const wsUrl = process.env.EXPO_PUBLIC_GATEWAY_URL || 'ws://localhost:8080';
    return wsUrl.replace(/^ws/, 'http');
  };

  useEffect(() => {
    const fetchKycStatus = async () => {
      try {
        const httpUrl = getHttpUrl();
        const res = await fetch(`${httpUrl}/kyc/status/${userId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status) {
            setKycStatus(data.status);
          }
        }
      } catch (err) {
        console.log('KYC status fetch error:', err);
      }
    };
    if (isAuthenticated) {
      fetchKycStatus();
    }
  }, [userId, activeTab, isAuthenticated]);

  // Dynamic Rank Engine
  useEffect(() => {
    if (xp >= 500000) setUserRank('Ultimate');
    else if (xp >= 100000) setUserRank('Master');
    else if (xp >= 50000) setUserRank('Leader');
    else if (xp >= 10000) setUserRank('Expert');
    else if (xp >= 5000) setUserRank('Professional');
    else if (xp >= 2000) setUserRank('Amateur');
    else setUserRank('Novice');
  }, [xp]);

  // Connect to local WebSocket gateway
  const connectChat = (currentUserId?: string, currentUserAge?: string) => {
    if (ws) ws.close();
    
    const targetId = currentUserId || userId;
    const targetAge = currentUserAge || userAge;
    
    try {
      const gatewayUrl = process.env.EXPO_PUBLIC_GATEWAY_URL || 'ws://localhost:8080';
      const socket = new WebSocket(`${gatewayUrl}/ws?user_id=${targetId}&age=${targetAge}`);
      
      socket.onopen = () => {
        Alert.alert('Connected', `Securely connected as ${targetId} (Age: ${targetAge})`);
        setMessages(prev => [...prev, { sender: 'system', content: `Secure WS connected for ${targetId}.` }]);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setMessages(prev => [...prev, { sender: data.sender_id, content: data.content }]);
      };

      socket.onclose = () => {
        setMessages(prev => [...prev, { sender: 'system', content: 'WebSocket connection closed.' }]);
      };

      setWs(socket);
    } catch (e) {
      Alert.alert('Connection Error', 'Go websocket gateway is currently offline.');
    }
  };

  // Send DM message via WS
  const sendChatMessage = () => {
    // Age check block
    if (parseInt(userAge) < 18) {
      Alert.alert('Access Denied', 'Minor sandbox limits block outbound DM packets.');
      return;
    }

    if (!chatInput.trim()) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      const payload = {
        sender_id: userId,
        receiver_id: receiverId,
        content: chatInput
      };
      ws.send(JSON.stringify(payload));
    }

    setMessages(prev => [...prev, { sender: userId, content: chatInput }]);
    setChatInput('');
    setIsTyping(false);
  };

  // Create Secured Wallet via FaceID/Fingerprint
  const handleEnrollWallet = async () => {
    setLoading(true);
    try {
      const derivedAddress = await BiometricWalletService.createSecuredWallet();
      if (derivedAddress) {
        // Register key on backend MongoDB Atlas
        const httpUrl = getHttpUrl();
        const res = await fetch(`${httpUrl}/kyc/register-biometrics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: userId,
            biometricPublicKey: 'ssh-ed25519-mock-biometric-key-enclave',
          }),
        });

        if (res.ok) {
          setAddress(derivedAddress);
          setXp(prev => prev + 1500); // Level XP reward
          Alert.alert('Wallet Activated', `Secure Enclave Key registered and synced.\nAddress: ${derivedAddress}`);
        } else {
          Alert.alert('Registration Error', 'Failed to register biometric credentials on backend.');
        }
      }
    } catch (e: any) {
      Alert.alert('Biometric Error', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Sign transfer transaction with biometrics
  const handleSignCheckout = async () => {
    if (!address) {
      Alert.alert('Warning', 'Please enroll biometric wallet first.');
      return;
    }
    setLoading(true);
    try {
      const txHash = `0x-tx-hash-nexa-transfer-${Date.now()}`;
      const signature = await BiometricWalletService.signTransaction(txHash);

      const httpUrl = getHttpUrl();
      const idempotencyKey = `idemp-tx-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      const res = await fetch(`${httpUrl}/wallet/transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          receiver_id: receiverId,
          amount: parseFloat(escrowAmount), // claim or transfer amount
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setXp(prev => prev + 500);
        Alert.alert('Success', `Transaction signed & processed off-chain!\nOutbox ID: ${data.outbox_id}\nSignature: ${signature.substring(0, 30)}...`);
      } else {
        const errText = await res.text();
        Alert.alert('Transaction Failed', errText || 'Transfer failed on backend ledger.');
      }
    } catch (e: any) {
      Alert.alert('Auth Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  // Trigger selfie matching mock KYC
  const handleStartKYC = async () => {
    setKycStatus('PENDING');
    setKycProgress(0);
    
    // Simulate face matching animation scan
    let progress = 0;
    const interval = setInterval(() => {
      progress += 25;
      setKycProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
      }
    }, 500);

    try {
      const httpUrl = getHttpUrl();
      const formData = new FormData();
      formData.append('userId', userId);
      
      const blobSelfie = new Blob(['mock-selfie-data'], { type: 'image/jpeg' });
      const blobDoc = new Blob(['mock-doc-data'], { type: 'image/jpeg' });
      
      formData.append('selfie', blobSelfie, 'selfie.jpg');
      formData.append('document', blobDoc, 'passport.jpg');

      const res = await fetch(`${httpUrl}/kyc/verify-face`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setKycStatus('VERIFIED');
          setXp(prev => prev + 3000); // Heavy XP grant
          Alert.alert('KYC Verified', 'Facial recognition match: 99.1% similarity. On-chain trading limits unlocked.');
        } else {
          setKycStatus('UNVERIFIED');
          Alert.alert('KYC Failed', data.message || 'Facial verification failed.');
        }
      } else {
        setKycStatus('UNVERIFIED');
        Alert.alert('KYC Error', 'Server returned error during facial verification.');
      }
    } catch (err) {
      setKycStatus('UNVERIFIED');
      Alert.alert('Connection Error', 'KYC service is currently offline.');
    }
  };

  const handleEscrowLockSuccess = async () => {
    try {
      const httpUrl = getHttpUrl();
      const orderId = `order-${Date.now()}`;
      const idempotencyKey = `escrow-lock-${Date.now()}`;

      const res = await fetch(`${httpUrl}/escrow/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': idempotencyKey,
          'X-User-Id': userId,
        },
        body: JSON.stringify({
          order_id: orderId,
          seller_id: receiverId,
          amount: parseFloat(escrowAmount),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setLastEscrowId(data.escrow_id);
        setXp(prev => prev + 2000);
        setEscrowLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Escrow Lock Sealed. ID: ${data.escrow_id}`,
          `Asset: ${escrowItem}`,
          `Locked Value: ${escrowAmount} NEXA`,
          ...prev
        ]);
        Alert.alert('Success', `Vault Locked and Anchored on Ledger!\nEscrow ID: ${data.escrow_id}`);
      } else {
        const errorText = await res.text();
        Alert.alert('Escrow Lock Failed', errorText);
      }
    } catch (err) {
      Alert.alert('Connection Error', 'Failed to anchor escrow vault on ledger.');
    }
  };

  const handleReleaseEscrow = async () => {
    if (!lastEscrowId) return;
    setLoading(true);
    try {
      const httpUrl = getHttpUrl();
      const res = await fetch(`${httpUrl}/escrow/release/${lastEscrowId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signature: 'ssh-ed25519-mock-buyer-delivery-signature',
        }),
      });

      if (res.ok) {
        setXp(prev => prev + 2500);
        setEscrowLogs(prev => [
          `[${new Date().toLocaleTimeString()}] Escrow Released! ID: ${lastEscrowId}`,
          `Funds credited to seller account.`,
          ...prev
        ]);
        Alert.alert('Escrow Released', `Funds successfully released to seller!\nEscrow ID: ${lastEscrowId}`);
        setLastEscrowId(null);
      } else {
        const errorText = await res.text();
        Alert.alert('Release Failed', errorText);
      }
    } catch (err) {
      Alert.alert('Connection Error', 'Escrow engine is currently offline.');
    } finally {
      setLoading(false);
    }
  };

  const isMinor = parseInt(userAge) < 18;

  // Render login screen if unauthenticated
  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.loginContainer}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={styles.loginContent}>
          <View style={styles.loginHeader}>
            <Text style={styles.loginLogoText}>NEXAVERSE</Text>
            <Text style={styles.loginSubText}>DECENTRALIZED NODE GATEWAY</Text>
          </View>
          
          <View style={styles.loginCard}>
            <Text style={styles.loginCardTitle}>Secure Host Grid Node Auth</Text>
            <Text style={styles.loginCardDesc}>
              Configure your network credentials below to establish a secure WebSocket session.
            </Text>

            <Text style={styles.loginInputLabel}>User Identity (Node ID):</Text>
            <TextInput
              style={styles.loginInput}
              value={userId}
              onChangeText={setUserId}
              placeholder="e.g. user_client_88"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.loginInputLabel}>Age Parameters (Compliance check):</Text>
            <TextInput
              style={styles.loginInput}
              value={userAge}
              onChangeText={setUserAge}
              placeholder="e.g. 16"
              placeholderTextColor="#555"
              keyboardType="numeric"
            />

            <TouchableOpacity
              style={styles.loginBtn}
              onPress={() => {
                if (!userId.trim()) {
                  Alert.alert('Error', 'Please enter a valid User Identity.');
                  return;
                }
                setIsAuthenticated(true);
                connectChat(userId, userAge);
              }}
            >
              <Text style={styles.loginBtnText}>Establish Connection Grid</Text>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.biometricLoginBtn}
              onPress={async () => {
                try {
                  const success = await BiometricWalletService.authenticate();
                  if (success) {
                    setIsAuthenticated(true);
                    connectChat(userId, userAge);
                    Alert.alert('Biometric Login Success', 'Hardware credentials authorized.');
                  } else {
                    Alert.alert('Biometric Login Failed', 'Hardware check returned false.');
                  }
                } catch (err: any) {
                  Alert.alert('Biometric Auth Error', err.message);
                }
              }}
            >
              <Text style={styles.biometricLoginBtnText}>🔑 Authenticate with Secure Enclave</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.appContainer}>
      <StatusBar barStyle="light-content" />
      
      {/* BRAND HEADER */}
      <View style={styles.brandHeader}>
        <View>
          <Text style={styles.logoText}>NEXAVERSE</Text>
          <Text style={styles.logoSubText}>SYSTEM STATUS: <Text style={isMinor ? styles.sandboxStatus : styles.liveStatus}>{isMinor ? 'MINOR SANDBOX' : 'FULL PRODUCTION'}</Text></Text>
        </View>

        <View style={styles.walletHeaderPill}>
          <Text style={styles.walletHeaderBal}>{balance} <Text style={styles.nexaSymbol}>NEXA</Text></Text>
          <Text style={styles.walletHeaderAddr} numberOfLines={1} ellipsizeMode="middle">
            {address ? address : 'No Wallet Key'}
          </Text>
        </View>
      </View>

      {/* CORE GAMIFICATION HEADER */}
      <View style={styles.progressionBar}>
        <View style={styles.progressionRow}>
          <RankBadge rank={userRank} style={styles.badgeWidget} />
          <View style={styles.xpProgressWrapper}>
            <XpProgressBar xp={xp} />
          </View>
        </View>
      </View>

      {/* TAB NAVIGATION SELECTOR */}
      <View style={styles.navBar}>
        {(['NEXSTREAM', 'CHAT', 'ESCROW', 'SANDBOX'] as const).map((tab) => (
          <TouchableOpacity 
            key={tab} 
            style={[styles.navTab, activeTab === tab && styles.navTabActive]} 
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.navTabText, activeTab === tab && styles.navTabTextActive]}>
              {tab === 'NEXSTREAM' ? 'NexStream' : tab === 'CHAT' ? 'Corridor' : tab === 'ESCROW' ? 'Escrow' : 'Sandbox'}
            </Text>
            {activeTab === tab && <View style={styles.activeIndicatorLine} />}
          </TouchableOpacity>
        ))}
      </View>

      {/* ACTIVE SCREEN BODY */}
      <ScrollView style={styles.bodyScroll} contentContainerStyle={styles.bodyContent}>
        
        {/* ==================== SCREEN 1: NEXSTREAM SOCIAL FEED ==================== */}
        {activeTab === 'NEXSTREAM' && (
          <View>
            <Text style={styles.sectionTitle}>NexStream P2E Social Node</Text>
            <Text style={styles.sectionSubtitle}>Watch verified content streams and claim immediate token airdrops.</Text>

            {/* DIVINE TIER POST */}
            <CosmicCard tier="DIVINE" style={styles.feedCard}>
              <View style={styles.postHeader}>
                <View style={styles.avatarPlaceholder} />
                <View>
                  <Text style={styles.postAuthor}>@nexa_alpha_pioneer</Text>
                  <Text style={styles.postMeta}>Genesis Node | 5m ago</Text>
                </View>
                <View style={styles.earnTagDivine}>
                  <Text style={styles.earnTagText}>+250 NEXA</Text>
                </View>
              </View>
              <Text style={styles.postBody}>
                The Genesis NeXaVerSe Smart Contracts are now live on-chain! Watch the visual preview and sign with your Secure Enclave wallet to claim.
              </Text>
              
              <View style={styles.postMediaStub}>
                <Text style={styles.mediaLabel}>▶ VIDEO: NeXaVerSe Cinematic Launch Trailer (30s)</Text>
              </View>

              <TouchableOpacity 
                style={styles.postActionBtnDivine} 
                onPress={() => {
                  if (!address) {
                    Alert.alert('Authentication required', 'Enroll a secured biometric wallet key first in the Sandbox tab.');
                  } else {
                    handleSignCheckout();
                  }
                }}
              >
                <Text style={styles.postActionBtnText}>Biometric Claim Video Earn</Text>
              </TouchableOpacity>
            </CosmicCard>

            {/* EDUCATIONAL TIER POST */}
            <CosmicCard tier="EDUCATIONAL" style={styles.feedCard}>
              <View style={styles.postHeader}>
                <View style={styles.avatarPlaceholderGold} />
                <View>
                  <Text style={styles.postAuthor}>@nexa_academy</Text>
                  <Text style={styles.postMeta}>Compliance Officer | 1h ago</Text>
                </View>
                <View style={styles.earnTagGold}>
                  <Text style={styles.earnTagText}>+50 NEXA</Text>
                </View>
              </View>
              <Text style={styles.postBody}>
                Lesson 4: Understanding Atomic Escrow Multi-Sig Mechanics. Read about sandbox compliance and answer the security quiz.
              </Text>
              
              <TouchableOpacity style={styles.postActionBtnGold} onPress={() => setXp(prev => prev + 600)}>
                <Text style={styles.postActionBtnTextGold}>Complete Quiz (+600 XP)</Text>
              </TouchableOpacity>
            </CosmicCard>

            {/* STANDARD POST */}
            <CosmicCard tier="STANDARD" style={styles.feedCard}>
              <View style={styles.postHeader}>
                <View style={styles.avatarPlaceholderSlate} />
                <View>
                  <Text style={styles.postAuthor}>@block_builder</Text>
                  <Text style={styles.postMeta}>Community Node | 3h ago</Text>
                </View>
              </View>
              <Text style={styles.postBody}>
                Just built my first custom Sandbox UI dashboard. Pure CSS custom stylesheet transitions are running smoothly. Zero compilation overhead!
              </Text>
            </CosmicCard>
          </View>
        )}

        {/* ==================== SCREEN 2: CHAT CORRIDOR ==================== */}
        {activeTab === 'CHAT' && (
          <View>
            <View style={styles.titleWithIndicator}>
              <Text style={styles.sectionTitle}>Chat Corridor</Text>
              <View style={[styles.statusIndicatorCircle, ws ? styles.statusGreen : styles.statusRed]} />
            </View>
            <Text style={styles.sectionSubtitle}>WebSocket client routed through NeXaVerSe Presence Gateway.</Text>

            {/* Presence indicator hub */}
            <View style={styles.onlineGrid}>
              <Text style={styles.gridLabel}>Active Room Nodes:</Text>
              <View style={styles.nodesContainer}>
                <View style={styles.activeUserBadge}><Text style={styles.activeUserText}>● @alpha_pioneer</Text></View>
                <View style={styles.activeUserBadge}><Text style={styles.activeUserText}>● @nexa_academy</Text></View>
                <View style={styles.activeUserBadge}><Text style={styles.activeUserText}>● @adult_25</Text></View>
                <View style={[styles.activeUserBadge, styles.activeUserSelf]}><Text style={[styles.activeUserText, {color: '#3b82f6'}]}>● {userId} (You)</Text></View>
              </View>
            </View>

            <TouchableOpacity style={styles.connectButton} onPress={() => connectChat()}>
              <Text style={styles.connectButtonText}>{ws ? 'Re-Connect WebSocket Node' : 'Establish Presence Connection'}</Text>
            </TouchableOpacity>

            {/* Message window */}
            <View style={styles.chatBox}>
              <ScrollView style={styles.messageScroll}>
                {messages.map((m, idx) => (
                  <View 
                    key={idx} 
                    style={[
                      styles.chatMessageBubble,
                      m.sender === 'system' ? styles.msgSystem : (m.sender === userId ? styles.msgSelf : styles.msgOther)
                    ]}
                  >
                    {m.sender !== 'system' && <Text style={styles.chatSenderTag}>{m.sender}</Text>}
                    <Text style={m.sender === 'system' ? styles.chatMsgTextSystem : styles.chatMsgText}>{m.content}</Text>
                  </View>
                ))}
              </ScrollView>
            </View>

            {/* Typing Indicator */}
            {isTyping && (
              <Text style={styles.typingIndicatorText}>💬 You are composing a message packet...</Text>
            )}

            {/* Minor Input Gating */}
            {isMinor ? (
              <View style={styles.gatedSecurityNotice}>
                <Text style={styles.securityNoticeHeader}>⚠️ DM CHANNEL LOCKED</Text>
                <Text style={styles.securityNoticeBody}>
                  Minor Sandbox limits block outbound Direct Messages to unverified nodes. Set age to 18+ in Sandbox settings to unlock input channels.
                </Text>
              </View>
            ) : (
              <View style={styles.chatInputRow}>
                <View style={styles.recipientConfig}>
                  <Text style={styles.tinyLabel}>Target Node:</Text>
                  <TextInput 
                    style={styles.recipientInput} 
                    value={receiverId} 
                    onChangeText={setReceiverId} 
                    placeholder="Receiver ID"
                    placeholderTextColor="#555"
                  />
                </View>
                <View style={styles.msgInputWrapper}>
                  <TextInput 
                    style={styles.messageInput} 
                    value={chatInput} 
                    onChangeText={(val) => {
                      setChatInput(val);
                      setIsTyping(val.length > 0);
                    }}
                    placeholder="Type encrypted message..."
                    placeholderTextColor="#555"
                  />
                  <TouchableOpacity style={styles.sendBtn} onPress={sendChatMessage}>
                    <Text style={styles.sendBtnText}>SEND</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ==================== SCREEN 3: ESCROW MARKETPLACE ==================== */}
        {activeTab === 'ESCROW' && (
          <View>
            <Text style={styles.sectionTitle}>Escrow Marketplace</Text>
            <Text style={styles.sectionSubtitle}>Atomic ledger settlement and dual-signed assets protection.</Text>

            {/* Age restrictions check */}
            {isMinor ? (
              <View style={styles.gatedSecurityNotice}>
                <Text style={styles.securityNoticeHeader}>🔒 ASSET TRADING GATED</Text>
                <Text style={styles.securityNoticeBody}>
                  On-chain escrow settlement and speculative assets are hidden from minor sandbox accounts. Verify legal age (18+) on the Sandbox tab to interact.
                </Text>
              </View>
            ) : (
              <View>
                {/* Role Switcher */}
                <View style={styles.escrowSwitcherContainer}>
                  <TouchableOpacity 
                    style={[styles.escrowSwitchBtn, escrowRole === 'BUYER' && styles.escrowSwitchActive]}
                    onPress={() => setEscrowRole('BUYER')}
                  >
                    <Text style={[styles.escrowSwitchText, escrowRole === 'BUYER' && styles.escrowSwitchTextActive]}>BUYER PANEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.escrowSwitchBtn, escrowRole === 'SELLER' && styles.escrowSwitchActive]}
                    onPress={() => setEscrowRole('SELLER')}
                  >
                    <Text style={[styles.escrowSwitchText, escrowRole === 'SELLER' && styles.escrowSwitchTextActive]}>SELLER PANEL</Text>
                  </TouchableOpacity>
                </View>

                {escrowRole === 'BUYER' ? (
                  <View>
                    <CosmicCard style={styles.marketplaceListingCard}>
                      <Text style={styles.listingLabel}>Active Buyer Bid Listing:</Text>
                      <Text style={styles.listingTitle}>{escrowItem}</Text>
                      <View style={styles.listingPriceRow}>
                        <Text style={styles.listingPriceLabel}>Settlement Price:</Text>
                        <Text style={styles.listingPriceVal}>{escrowAmount} <Text style={styles.nexaSymbol}>NEXA</Text></Text>
                      </View>
                      
                      {/* Vault lock component */}
                      <VaultLock amount={escrowAmount} onLockComplete={handleEscrowLockSuccess} />
                    </CosmicCard>

                    {/* ESCROW LEDGER LOGS */}
                    <CosmicCard style={styles.logsCard}>
                      <Text style={styles.logsTitle}>On-Chain Escrow Audit Log</Text>
                      {escrowLogs.map((log, idx) => (
                        <Text key={idx} style={styles.logLine}>{log}</Text>
                      ))}
                    </CosmicCard>
                  </View>
                ) : (
                  <View>
                    <CosmicCard style={styles.marketplaceListingCard}>
                      <Text style={styles.listingLabel}>Scaffold New On-Chain Listing</Text>
                      
                      <Text style={styles.inputLabel}>Asset Name:</Text>
                      <TextInput 
                        style={styles.formInput} 
                        value={escrowItem} 
                        onChangeText={setEscrowItem} 
                        placeholder="e.g. Cybernetic Visor"
                        placeholderTextColor="#555"
                      />

                      <Text style={styles.inputLabel}>Lock Value (NEXA):</Text>
                      <TextInput 
                        style={styles.formInput} 
                        value={escrowAmount} 
                        onChangeText={setEscrowAmount} 
                        placeholder="100.00"
                        placeholderTextColor="#555"
                        keyboardType="numeric"
                      />

                      <TouchableOpacity 
                        style={styles.submitListingBtn}
                        onPress={() => {
                          setEscrowLogs(prev => [
                            `[${new Date().toLocaleTimeString()}] Registered listing: ${escrowItem} for ${escrowAmount} NEXA.`,
                            ...prev
                          ]);
                          Alert.alert('Listing Created', 'On-chain listing prepared. Switch to Buyer Panel to test escrow lock.');
                        }}
                      >
                        <Text style={styles.submitListingText}>Publish Escrow Offer</Text>
                      </TouchableOpacity>

                      {lastEscrowId && (
                        <View style={{ marginTop: 20, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#222' }}>
                          <Text style={styles.listingLabel}>Active Escrow Vault to Release:</Text>
                          <View style={styles.addressBox}>
                            <Text style={styles.addressBoxText} numberOfLines={1}>{lastEscrowId}</Text>
                          </View>
                          <TouchableOpacity 
                            style={[styles.submitListingBtn, { backgroundColor: '#10b981' }]}
                            onPress={handleReleaseEscrow}
                          >
                            <Text style={[styles.submitListingText, { color: '#070a10' }]}>🔑 Release Escrow Funds to Seller</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </CosmicCard>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* ==================== SCREEN 4: SANDBOX CONFIG & KYC ==================== */}
        {activeTab === 'SANDBOX' && (
          <View>
            <Text style={styles.sectionTitle}>Sandbox Node Control Room</Text>
            <Text style={styles.sectionSubtitle}>Configure sandbox environment states, identity status, and simulation variables.</Text>

            {/* AGE CONTROLLER CARD */}
            <CosmicCard style={styles.controlCard}>
              <Text style={styles.controlCardTitle}>Age Verification Config</Text>
              <Text style={styles.controlDesc}>
                Directly adjust your age to test compliance gates. Under 18 will trigger the Minor Sandbox limits, disabling escrow trading and blocking messaging inputs.
              </Text>

              <View style={styles.ageControlRow}>
                <Text style={styles.controlLabel}>Age Parameter:</Text>
                <TextInput 
                  style={styles.ageInput} 
                  value={userAge} 
                  onChangeText={(val) => {
                    setUserAge(val);
                    setMessages(prev => [...prev, { sender: 'system', content: `Environment Age changed to ${val}.` }]);
                  }}
                  keyboardType="numeric"
                />
                <Text style={styles.ageSuffix}>Years Old</Text>
              </View>

              <View style={styles.quickAgeButtons}>
                <TouchableOpacity 
                  style={[styles.quickAgeBtn, isMinor && styles.quickAgeBtnActive]}
                  onPress={() => {
                    setUserAge('16');
                    setMessages(prev => [...prev, { sender: 'system', content: 'Environment Age changed to 16.' }]);
                  }}
                >
                  <Text style={styles.quickAgeText}>Set Minor (16)</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.quickAgeBtn, !isMinor && styles.quickAgeBtnActive]}
                  onPress={() => {
                    setUserAge('22');
                    setMessages(prev => [...prev, { sender: 'system', content: 'Environment Age changed to 22.' }]);
                  }}
                >
                  <Text style={styles.quickAgeText}>Set Adult (22)</Text>
                </TouchableOpacity>
              </View>
            </CosmicCard>

            {/* KYC IDENTITY PROVISIONING */}
            <CosmicCard style={styles.controlCard}>
              <Text style={styles.controlCardTitle}>Biometric KYC Verification</Text>
              <View style={styles.kycStatusRow}>
                <Text style={styles.controlLabel}>Status Indicator:</Text>
                <Text style={[
                  styles.kycValue, 
                  kycStatus === 'VERIFIED' ? styles.greenText : kycStatus === 'PENDING' ? styles.orangeText : styles.redText
                ]}>{kycStatus}</Text>
              </View>

              {kycStatus === 'UNVERIFIED' && (
                <View>
                  <Text style={styles.controlDesc}>
                    Required to unlock full cryptographic trading. Compares dynamic camera streams against registered document IDs.
                  </Text>
                  <TouchableOpacity style={styles.kycBtn} onPress={handleStartKYC}>
                    <Text style={styles.kycBtnText}>Start Facial Biometrics</Text>
                  </TouchableOpacity>
                </View>
              )}

              {kycStatus === 'PENDING' && (
                <View style={styles.kycProgressWrapper}>
                  <Text style={styles.scanningText}>SCANNING RETINAL & FACIAL STRUCTURES...</Text>
                  <View style={styles.kycTrack}>
                    <View style={[styles.kycFill, { width: `${kycProgress}%` }]} />
                  </View>
                  <Text style={styles.scanningPercent}>{kycProgress}%</Text>
                </View>
              )}

              {kycStatus === 'VERIFIED' && (
                <View style={styles.verifiedZone}>
                  <Text style={styles.verifiedHeader}>✓ SECURE NODE IDENTITY ESTABLISHED</Text>
                  <Text style={styles.verifiedDesc}>
                    Verified on-chain via zk-SNARK proof hashing. Wallet bounds and transfer gates are fully open.
                  </Text>
                </View>
              )}
            </CosmicCard>

            {/* BIOMETRIC HARDWARE KEY ENROLLMENT */}
            <CosmicCard style={styles.controlCard}>
              <Text style={styles.controlCardTitle}>Biometric Wallet Controller</Text>
              {address ? (
                <View>
                  <Text style={styles.addressDisplay}>🔑 Wallet key derived and locked in hardware:</Text>
                  <View style={styles.addressBox}>
                    <Text style={styles.addressBoxText} numberOfLines={1}>{address}</Text>
                  </View>
                  <Text style={styles.controlDesc}>
                    Transactions must be signed using device face/fingerprint authentication.
                  </Text>
                  <TouchableOpacity style={styles.signTestBtn} onPress={handleSignCheckout} disabled={loading}>
                    {loading ? <ActivityIndicator color="#070a10" /> : <Text style={styles.signTestBtnText}>Test Biometric Signature</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  <Text style={styles.controlDesc}>
                    Associate this device Node with a physical Secure Enclave seed key. Registers cryptographic signatures immediately.
                  </Text>
                  <TouchableOpacity style={styles.enrollBtn} onPress={handleEnrollWallet} disabled={loading}>
                    {loading ? <ActivityIndicator color="#070a10" /> : <Text style={styles.enrollBtnText}>Enroll Secure Enclave Wallet</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </CosmicCard>

            {/* SIMULATE XP ACTIONS */}
            <CosmicCard style={styles.controlCard}>
              <Text style={styles.controlCardTitle}>Simulation Engine</Text>
              <Text style={styles.controlDesc}>
                Quick XP grants to test progression ranks from Novice through Ultimate Core.
              </Text>
              <View style={styles.simulationBtnRow}>
                <TouchableOpacity style={styles.simBtn} onPress={() => setXp(prev => prev + 1000)}>
                  <Text style={styles.simBtnText}>+1,000 XP</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.simBtn} onPress={() => setXp(prev => prev + 10000)}>
                  <Text style={styles.simBtnText}>+10,000 XP</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.simBtn} onPress={() => setXp(prev => prev + 100000)}>
                  <Text style={styles.simBtnText}>+100,000 XP</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity 
                style={[styles.simBtn, styles.resetBtn]} 
                onPress={() => {
                  setXp(500);
                  setAddress(null);
                  setKycStatus('UNVERIFIED');
                  setMessages([
                    { sender: 'system', content: 'Sandbox states hard reset completed.' }
                  ]);
                  Alert.alert('Reset Successful', 'All local sandbox states reverted to default.');
                }}
              >
                <Text style={styles.resetBtnText}>Reset Local Node States</Text>
              </TouchableOpacity>
            </CosmicCard>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  appContainer: {
    flex: 1,
    backgroundColor: '#070A10', // Deep Void Black
  },
  brandHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 36 : 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  logoText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  logoSubText: {
    color: '#64748b',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 0.8,
    marginTop: 2,
  },
  sandboxStatus: {
    color: '#f59e0b', // gold glow warning
  },
  liveStatus: {
    color: '#3b82f6', // Sapphire active
  },
  walletHeaderPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'flex-end',
    maxWidth: 160,
  },
  walletHeaderBal: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  nexaSymbol: {
    color: '#3b82f6',
    fontWeight: '900',
  },
  walletHeaderAddr: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  progressionBar: {
    backgroundColor: 'rgba(15, 23, 42, 0.3)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  progressionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  badgeWidget: {
    marginRight: 10,
  },
  xpProgressWrapper: {
    flex: 1,
  },
  navBar: {
    flexDirection: 'row',
    backgroundColor: '#0c101a',
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  navTab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    position: 'relative',
  },
  navTabActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.04)',
  },
  navTabText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  navTabTextActive: {
    color: '#3b82f6',
  },
  activeIndicatorLine: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    width: '40%',
    backgroundColor: '#3b82f6',
    borderRadius: 1,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  bodyScroll: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 4,
    marginBottom: 16,
    lineHeight: 15,
  },
  feedCard: {
    marginBottom: 16,
  },
  postHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#3b82f6',
    marginRight: 10,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  avatarPlaceholderGold: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f59e0b',
    marginRight: 10,
    borderWidth: 1.5,
    borderColor: '#ffffff',
  },
  avatarPlaceholderSlate: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#64748b',
    marginRight: 10,
  },
  postAuthor: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  postMeta: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 1,
  },
  earnTagDivine: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: '#3b82f6',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginLeft: 'auto',
  },
  earnTagGold: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderWidth: 1,
    borderColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginLeft: 'auto',
  },
  earnTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '900',
  },
  postBody: {
    color: '#cbd5e1',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  postMediaStub: {
    backgroundColor: 'rgba(7, 10, 16, 0.6)',
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  mediaLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800',
  },
  postActionBtnDivine: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  postActionBtnGold: {
    backgroundColor: '#f59e0b',
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#f59e0b',
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  postActionBtnText: {
    color: '#070a10',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  postActionBtnTextGold: {
    color: '#070a10',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  titleWithIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicatorCircle: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  statusGreen: {
    backgroundColor: '#10b981',
    shadowColor: '#10b981',
    shadowOpacity: 0.8,
    shadowRadius: 3,
  },
  statusRed: {
    backgroundColor: '#ef4444',
  },
  onlineGrid: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    marginBottom: 12,
  },
  gridLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  nodesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  activeUserBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    marginBottom: 4,
  },
  activeUserSelf: {
    borderColor: 'rgba(59, 130, 246, 0.3)',
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
  },
  activeUserText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '700',
  },
  connectButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 12,
  },
  connectButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  chatBox: {
    height: 180,
    backgroundColor: 'rgba(7, 10, 16, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 10,
    marginBottom: 10,
  },
  messageScroll: {
    flex: 1,
  },
  chatMessageBubble: {
    padding: 8,
    borderRadius: 8,
    marginBottom: 8,
    maxWidth: '85%',
  },
  msgSystem: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
  },
  msgSelf: {
    alignSelf: 'flex-end',
    backgroundColor: '#1e3a8a',
  },
  msgOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#1e293b',
  },
  chatSenderTag: {
    color: '#3b82f6',
    fontSize: 9,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  chatMsgText: {
    color: '#ffffff',
    fontSize: 12,
  },
  chatMsgTextSystem: {
    color: '#64748b',
    fontSize: 10,
    fontStyle: 'italic',
  },
  typingIndicatorText: {
    color: '#3b82f6',
    fontSize: 10,
    marginBottom: 10,
    marginLeft: 4,
  },
  chatInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recipientConfig: {
    width: 80,
    marginRight: 6,
  },
  tinyLabel: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  recipientInput: {
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    color: '#ffffff',
    fontSize: 11,
    padding: 6,
  },
  msgInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    alignItems: 'center',
    paddingRight: 4,
    marginTop: 11,
  },
  messageInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 12,
    padding: 8,
  },
  sendBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  sendBtnText: {
    color: '#070a10',
    fontSize: 10,
    fontWeight: '900',
  },
  gatedSecurityNotice: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginVertical: 10,
  },
  securityNoticeHeader: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 6,
  },
  securityNoticeBody: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  escrowSwitcherContainer: {
    flexDirection: 'row',
    backgroundColor: '#0c101a',
    borderRadius: 8,
    padding: 3,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  escrowSwitchBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  escrowSwitchActive: {
    backgroundColor: '#3b82f6',
  },
  escrowSwitchText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  escrowSwitchTextActive: {
    color: '#070a10',
  },
  marketplaceListingCard: {
    marginBottom: 16,
  },
  listingLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  listingTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  listingPriceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  listingPriceLabel: {
    color: '#64748b',
    fontSize: 12,
  },
  listingPriceVal: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  logsCard: {
    padding: 12,
  },
  logsTitle: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
    borderBottomWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    paddingBottom: 4,
  },
  logLine: {
    color: '#10b981',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 10,
    marginBottom: 4,
  },
  inputLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 4,
  },
  formInput: {
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    color: '#ffffff',
    padding: 8,
    fontSize: 12,
  },
  submitListingBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  submitListingText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  controlCard: {
    marginBottom: 16,
  },
  controlCardTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  controlDesc: {
    color: '#64748b',
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 12,
  },
  ageControlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  controlLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  ageInput: {
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 6,
    color: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: 14,
    fontWeight: 'bold',
    width: 60,
    textAlign: 'center',
  },
  ageSuffix: {
    color: '#cbd5e1',
    fontSize: 12,
    marginLeft: 8,
  },
  quickAgeButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  quickAgeBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  quickAgeBtnActive: {
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59, 130, 246, 0.06)',
  },
  quickAgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  kycStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  kycValue: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  greenText: {
    color: '#10b981',
  },
  orangeText: {
    color: '#f59e0b',
  },
  redText: {
    color: '#ef4444',
  },
  kycBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  kycBtnText: {
    color: '#070a10',
    fontSize: 12,
    fontWeight: '900',
  },
  kycProgressWrapper: {
    alignItems: 'center',
    marginVertical: 6,
  },
  scanningText: {
    color: '#f59e0b',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  kycTrack: {
    height: 6,
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 3,
    overflow: 'hidden',
  },
  kycFill: {
    height: '100%',
    backgroundColor: '#f59e0b',
  },
  scanningPercent: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 4,
  },
  verifiedZone: {
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#10b981',
    padding: 12,
  },
  verifiedHeader: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '900',
    marginBottom: 4,
  },
  verifiedDesc: {
    color: '#a7f3d0',
    fontSize: 10,
    lineHeight: 14,
  },
  addressDisplay: {
    color: '#cbd5e1',
    fontSize: 11,
    marginBottom: 6,
  },
  addressBox: {
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    padding: 8,
    marginBottom: 10,
  },
  addressBoxText: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  signTestBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  signTestBtnText: {
    color: '#070a10',
    fontSize: 12,
    fontWeight: '900',
  },
  enrollBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  enrollBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  simulationBtnRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  simBtn: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 6,
    paddingVertical: 8,
    alignItems: 'center',
  },
  simBtnText: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: 'bold',
  },
  resetBtn: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
    marginTop: 6,
  },
  resetBtnText: {
    color: '#ef4444',
    fontSize: 11,
    fontWeight: 'bold',
  },
  loginContainer: {
    flex: 1,
    backgroundColor: '#070A10', // Deep Void Black
  },
  loginContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  loginHeader: {
    alignItems: 'center',
    marginBottom: 40,
  },
  loginLogoText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: 6,
    textShadowColor: 'rgba(59, 130, 246, 0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  loginSubText: {
    color: '#3b82f6',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 2,
    marginTop: 8,
  },
  loginCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.1,
    shadowRadius: 15,
  },
  loginCardTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  loginCardDesc: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 20,
  },
  loginInputLabel: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  loginInput: {
    backgroundColor: '#0c101a',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    color: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
  loginBtn: {
    backgroundColor: '#3b82f6',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#3b82f6',
    shadowOpacity: 0.4,
    shadowRadius: 5,
  },
  loginBtnText: {
    color: '#070a10',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: 'bold',
    marginHorizontal: 12,
  },
  biometricLoginBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  biometricLoginBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
