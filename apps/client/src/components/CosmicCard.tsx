import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Animated, ViewStyle } from 'react-native';

interface CosmicCardProps {
  children: React.ReactNode;
  tier?: 'DIVINE' | 'EDUCATIONAL' | 'STANDARD';
  style?: ViewStyle;
}

export const CosmicCard: React.FC<CosmicCardProps> = ({ children, tier = 'STANDARD', style }) => {
  // Animation hooks for Pulsing Glow and Shimmer Glare
  const glowAnim = useRef(new Animated.Value(0.4)).current;
  const shimmerAnim = useRef(new Animated.Value(-150)).current;

  useEffect(() => {
    // 1. Continuous pulsing glow for Premium Tiers
    if (tier !== 'STANDARD') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, {
            toValue: 0.95,
            duration: 2500,
            useNativeDriver: false, // color/opacity animations can't always use native driver
          }),
          Animated.timing(glowAnim, {
            toValue: 0.4,
            duration: 2500,
            useNativeDriver: false,
          }),
        ])
      ).start();
    }

    // 2. Periodic holographic shimmer sweep (every 6 seconds)
    const runShimmer = () => {
      shimmerAnim.setValue(-150);
      Animated.timing(shimmerAnim, {
        toValue: 350,
        duration: 1500,
        useNativeDriver: false,
      }).start(() => {
        setTimeout(runShimmer, 4500);
      });
    };
    runShimmer();
  }, [tier]);

  // Determine glow outline border color based on tier
  const getGlowColor = () => {
    if (tier === 'DIVINE') return 'rgba(59, 130, 246, '; // Sapphire
    if (tier === 'EDUCATIONAL') return 'rgba(245, 158, 11, '; // Gold
    return 'rgba(100, 116, 139, '; // Slate/Standard
  };

  // Interpolated border colors
  const borderColor = glowAnim.interpolate({
    inputRange: [0.4, 0.95],
    outputRange: [`${getGlowColor()}0.25)`, `${getGlowColor()}0.85)`]
  });

  const shadowOpacity = glowAnim.interpolate({
    inputRange: [0.4, 0.95],
    outputRange: [0.15, 0.45]
  });

  return (
    <Animated.View style={[
      styles.card, 
      tier === 'DIVINE' && styles.divineShadow,
      tier === 'EDUCATIONAL' && styles.educationalShadow,
      { 
        borderColor: borderColor,
        shadowColor: tier === 'DIVINE' ? '#3b82f6' : tier === 'EDUCATIONAL' ? '#f59e0b' : 'transparent',
        shadowOpacity: tier !== 'STANDARD' ? shadowOpacity : 0,
      },
      style
    ]}>
      {/* Dynamic Glassmorphic Shimmer Overlay */}
      <Animated.View style={[
        styles.shimmer,
        { transform: [{ translateX: shimmerAnim }] }
      ]} />
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(15, 23, 42, 0.45)', // Translucent Void Navy
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  divineShadow: {
    shadowColor: '#3b82f6',
  },
  educationalShadow: {
    shadowColor: '#f59e0b',
  },
  shimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    transform: [{ rotate: '25deg' }],
    zIndex: 1,
    opacity: 0.6,
  }
});
