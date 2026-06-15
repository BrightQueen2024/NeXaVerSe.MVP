import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Animated } from 'react-native';

interface VaultLockProps {
  amount: string;
  onLockComplete?: () => void;
}

export const VaultLock: React.FC<VaultLockProps> = ({ amount, onLockComplete }) => {
  const [lockState, setLockState] = useState<'UNLOCKED' | 'LOCKING' | 'LOCKED'>('UNLOCKED');
  const [accumulated, setAccumulated] = useState(0.00);

  // Animation Refs
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  // Real-time counter ticker
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (lockState === 'LOCKED') {
      const target = parseFloat(amount);
      setAccumulated(0.00);
      
      let current = 0.00;
      interval = setInterval(() => {
        current += target / 20; // Accrues over 20 steps (1 second)
        if (current >= target) {
          setAccumulated(target);
          clearInterval(interval);
        } else {
          setAccumulated(Number(current.toFixed(2)));
        }
      }, 50);
    }
    return () => clearInterval(interval);
  }, [lockState, amount]);

  const triggerLockSequence = () => {
    if (lockState !== 'UNLOCKED') return;

    setLockState('LOCKING');
    
    // 1. Clasping/Locking Spring Animation (Hands merging)
    Animated.sequence([
      Animated.spring(scaleAnim, {
        toValue: 1.15,
        friction: 4,
        tension: 40,
        useNativeDriver: true
      }),
      // 2. Rotate Lock Cylinder
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true
      }),
      // 3. Lock Snapping Haptic Shake
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 4, duration: 50, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        useNativeDriver: true
      })
    ]).start(() => {
      setLockState('LOCKED');
      if (onLockComplete) onLockComplete();
    });
  };

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg']
  });

  return (
    <View style={styles.vaultContainer}>
      <Animated.View style={[
        styles.vaultGate,
        lockState === 'LOCKED' && styles.vaultGateActive,
        {
          transform: [
            { scale: scaleAnim },
            { translateX: shakeAnim }
          ]
        }
      ]}>
        {/* Visual 3D Dial/Padlock */}
        <View style={styles.padlockFrame}>
          <Animated.View style={[
            styles.shackle,
            lockState === 'LOCKED' ? styles.shackleLocked : styles.shackleUnlocked
          ]} />
          <Animated.View style={[
            styles.dial,
            lockState === 'LOCKED' && styles.dialLocked,
            { transform: [{ rotate: spin }] }
          ]}>
            <View style={styles.dialNotch} />
          </Animated.View>
        </View>

        {lockState === 'UNLOCKED' && (
          <TouchableOpacity style={styles.actionBtn} onPress={triggerLockSequence}>
            <Text style={styles.actionBtnText}>LOCK ESCROW VAULT</Text>
          </TouchableOpacity>
        )}

        {lockState === 'LOCKING' && (
          <Text style={styles.statusTextLocking}>ESTABLISHING CRYPTOGRAPHIC VAULT...</Text>
        )}

        {lockState === 'LOCKED' && (
          <View style={styles.lockedSection}>
            <Text style={styles.statusTextLocked}>✓ ESCROW ANCHORED ON-CHAIN</Text>
            <Text style={styles.tickerVal}>
              {accumulated.toFixed(2)} <Text style={styles.tickerSymbol}>NEXA</Text>
            </Text>
          </View>
        )}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  vaultContainer: {
    marginVertical: 12,
  },
  vaultGate: {
    backgroundColor: '#0c0d1c',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#222244',
    padding: 16,
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  vaultGateActive: {
    borderColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowOpacity: 0.35,
  },
  padlockFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
    height: 70,
    marginBottom: 10,
  },
  shackle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 5,
    borderColor: '#64748b',
    borderBottomWidth: 0,
    position: 'absolute',
    top: 5,
  },
  shackleUnlocked: {
    borderColor: '#a8a29e',
    transform: [{ translateY: -6 }, { rotate: '-20deg' }],
  },
  shackleLocked: {
    borderColor: '#3b82f6',
    transform: [{ translateY: 0 }],
  },
  dial: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1e293b',
    borderWidth: 3,
    borderColor: '#475569',
    position: 'absolute',
    bottom: 2,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  dialLocked: {
    borderColor: '#3b82f6',
  },
  dialNotch: {
    width: 4,
    height: 12,
    backgroundColor: '#ffffff',
    borderRadius: 2,
    marginTop: 2,
  },
  actionBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginTop: 5,
  },
  actionBtnText: {
    color: '#070a10',
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 1,
  },
  statusTextLocking: {
    color: '#f59e0b',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  statusTextLocked: {
    color: '#00ff66',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  lockedSection: {
    alignItems: 'center',
  },
  tickerVal: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    fontFamily: 'monospace',
  },
  tickerSymbol: {
    color: '#3b82f6',
    fontSize: 14,
  }
});
