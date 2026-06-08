import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Animated, ViewStyle } from 'react-native';

interface RankBadgeProps {
  rank: string;
  style?: ViewStyle;
}

export const RankBadge: React.FC<RankBadgeProps> = ({ rank, style }) => {
  const pulseAnim = useRef(new Animated.Value(0.8)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Continuous subtle pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.8,
          duration: 1800,
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Continuous spin for Ultimate Core
    if (rank.toLowerCase() === 'ultimate') {
      Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 6000,
          useNativeDriver: true,
        })
      ).start();
    }
  }, [rank]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const renderBadgeShape = () => {
    const r = rank.toLowerCase();

    // 1. NOVICE: Grey Slate Hexagon
    if (r === 'novice') {
      return (
        <View style={styles.hexagonContainer}>
          <View style={[styles.hexPart, styles.hexTop]} />
          <View style={styles.hexCenter}>
            <Text style={styles.hexLabel}>N</Text>
          </View>
          <View style={[styles.hexPart, styles.hexBottom]} />
        </View>
      );
    }

    // 2. AMATEUR: Bronze Halo Ring
    if (r === 'amateur') {
      return (
        <View style={styles.bronzeRing}>
          <View style={styles.bronzeInnerRing}>
            <Text style={styles.bronzeLabel}>AM</Text>
          </View>
        </View>
      );
    }

    // 3. PROFESSIONAL: Dual Chrome Ribbons
    if (r === 'professional') {
      return (
        <View style={styles.chromeContainer}>
          <View style={[styles.ribbon, styles.ribbonLeft]} />
          <View style={[styles.ribbon, styles.ribbonRight]} />
          <View style={styles.chromeCore}>
            <Text style={styles.chromeLabel}>PRO</Text>
          </View>
        </View>
      );
    }

    // 4. EXPERT: Cyan Prismatic Shield
    if (r === 'expert') {
      return (
        <View style={styles.shieldContainer}>
          <View style={styles.shieldTop} />
          <View style={styles.shieldBody}>
            <Text style={styles.shieldLabel}>XP</Text>
          </View>
          <View style={styles.shieldBottom} />
        </View>
      );
    }

    // 5. LEADER: Emerald Diamond Crest
    if (r === 'leader') {
      return (
        <View style={styles.leaderCrest}>
          <View style={[styles.diamond, styles.diamondOuter]} />
          <View style={[styles.diamond, styles.diamondInner]}>
            <Text style={styles.leaderLabel}>LDR</Text>
          </View>
        </View>
      );
    }

    // 6. MASTER: Obsidian Frosted Gold Star
    if (r === 'master') {
      return (
        <View style={styles.starContainer}>
          {/* Overlapping diamonds simulating a star */}
          <View style={[styles.starPoints, { transform: [{ rotate: '0deg' }] }]} />
          <View style={[styles.starPoints, { transform: [{ rotate: '45deg' }] }]} />
          <View style={styles.starCore}>
            <Text style={styles.starLabel}>M</Text>
          </View>
        </View>
      );
    }

    // 7. ULTIMATE / Default: Holographic Dimension Core
    return (
      <Animated.View style={[styles.ultimateContainer, { transform: [{ scale: pulseAnim }] }]}>
        <Animated.View style={[styles.orbitRing, { transform: [{ rotate: spin }] }]}>
          <View style={styles.orbitNode} />
        </Animated.View>
        <Animated.View style={[styles.orbitRingInner, { transform: [{ rotate: spin }] }]}>
          <View style={styles.orbitNodeInner} />
        </Animated.View>
        <View style={styles.ultimateCore}>
          <Text style={styles.ultimateLabel}>Ω</Text>
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.badgeFrame, style]}>
      {renderBadgeShape()}
      <Text style={styles.rankTitle}>{rank.toUpperCase()}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badgeFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  rankTitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
    marginTop: 8,
    letterSpacing: 1.5,
  },

  // Novice Hexagon Styles
  hexagonContainer: {
    width: 44,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hexCenter: {
    width: 44,
    height: 26,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#64748b',
  },
  hexPart: {
    width: 0,
    height: 0,
    borderLeftWidth: 22,
    borderLeftColor: 'transparent',
    borderRightWidth: 22,
    borderRightColor: 'transparent',
  },
  hexTop: {
    borderBottomWidth: 11,
    borderBottomColor: '#334155',
  },
  hexBottom: {
    borderTopWidth: 11,
    borderTopColor: '#334155',
  },
  hexLabel: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '900',
  },

  // Amateur Bronze Halo Styles
  bronzeRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3,
    borderColor: '#d97706',
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  bronzeInnerRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bronzeLabel: {
    color: '#f59e0b',
    fontSize: 10,
    fontWeight: '900',
  },

  // Professional Chrome Ribbons
  chromeContainer: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ribbon: {
    position: 'absolute',
    width: 14,
    height: 40,
    backgroundColor: '#475569',
    borderColor: '#94a3b8',
    borderWidth: 1.5,
    borderRadius: 3,
  },
  ribbonLeft: {
    left: 2,
    transform: [{ rotate: '-15deg' }],
  },
  ribbonRight: {
    right: 2,
    transform: [{ rotate: '15deg' }],
  },
  chromeCore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  chromeLabel: {
    color: '#f8fafc',
    fontSize: 9,
    fontWeight: '900',
  },

  // Expert Cyan Shield
  shieldContainer: {
    width: 44,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldTop: {
    width: 38,
    height: 6,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: '#06b6d4',
  },
  shieldBody: {
    width: 38,
    height: 24,
    backgroundColor: 'rgba(6, 182, 212, 0.2)',
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: '#06b6d4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldBottom: {
    width: 0,
    height: 0,
    borderLeftWidth: 19,
    borderLeftColor: 'transparent',
    borderRightWidth: 19,
    borderRightColor: 'transparent',
    borderTopWidth: 12,
    borderTopColor: '#06b6d4',
  },
  shieldLabel: {
    color: '#06b6d4',
    fontSize: 11,
    fontWeight: '900',
  },

  // Leader Emerald Diamond Crest
  leaderCrest: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  diamond: {
    position: 'absolute',
    transform: [{ rotate: '45deg' }],
  },
  diamondOuter: {
    width: 34,
    height: 34,
    borderWidth: 2,
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  diamondInner: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: '#34d399',
    backgroundColor: '#064e3b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderLabel: {
    color: '#34d399',
    fontSize: 7,
    fontWeight: '900',
    transform: [{ rotate: '-45deg' }],
  },

  // Master Star Styles
  starContainer: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  starPoints: {
    position: 'absolute',
    width: 32,
    height: 32,
    backgroundColor: '#d97706',
    borderWidth: 1.5,
    borderColor: '#f59e0b',
  },
  starCore: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0f172a',
    borderWidth: 2,
    borderColor: '#f59e0b',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
    shadowColor: '#f59e0b',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 5,
  },
  starLabel: {
    color: '#f59e0b',
    fontSize: 12,
    fontWeight: '900',
  },

  // Ultimate Core Styles
  ultimateContainer: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  orbitRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.4)',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  orbitNode: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowRadius: 3,
    shadowOpacity: 0.8,
  },
  orbitRingInner: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.4)',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  orbitNodeInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ec4899',
  },
  ultimateCore: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#070a10',
    borderWidth: 2.5,
    borderColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
  },
  ultimateLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
