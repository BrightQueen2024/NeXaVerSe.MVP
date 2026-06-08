import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, Text, Animated, ViewStyle } from 'react-native';

interface XpProgressBarProps {
  xp: number;
  style?: ViewStyle;
}

export const XpProgressBar: React.FC<XpProgressBarProps> = ({ xp, style }) => {
  // Determine current tier thresholds and calculate percentage
  // Novice: 0-999, Amateur: 1000-1999, Expert: 2000-99999, Leader: 100000-499999, Master: 500000+
  const getLevelRange = (currentXp: number) => {
    if (currentXp >= 500000) return { min: 500000, max: 1000000, label: 'Ultimate Track' };
    if (currentXp >= 100000) return { min: 100000, max: 500000, label: 'Leader' };
    if (currentXp >= 2000) return { min: 2000, max: 100000, label: 'Expert' };
    if (currentXp >= 1000) return { min: 1000, max: 2000, label: 'Amateur' };
    return { min: 0, max: 1000, label: 'Novice' };
  };

  const { min, max, label } = getLevelRange(xp);
  const progressRatio = Math.min(Math.max((xp - min) / (max - min), 0), 1);

  const animatedWidth = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    // Smooth progress width transition
    Animated.timing(animatedWidth, {
      toValue: progressRatio,
      duration: 1000,
      useNativeDriver: false, // width/flex layout cannot use native driver
    }).start();

    // Pulse effect on glowing milestones
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1500,
          useNativeDriver: false,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1500,
          useNativeDriver: false,
        }),
      ])
    ).start();
  }, [progressRatio]);

  const widthPercentage = animatedWidth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  // Render 5 segments representing progress
  const segments = [1, 2, 3, 4, 5];

  return (
    <View style={[styles.container, style]}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label} Progress</Text>
        <Text style={styles.percentageText}>{Math.round(progressRatio * 100)}%</Text>
      </View>

      <View style={styles.trackContainer}>
        {/* Animated Fill */}
        <Animated.View style={[styles.progressFill, { width: widthPercentage }]} />

        {/* Segment Dividers & Milestones */}
        <View style={styles.overlaySegments}>
          {segments.map((seg, idx) => {
            const milestoneRatio = idx / (segments.length - 1);
            const isReached = progressRatio >= milestoneRatio;

            return (
              <View key={seg} style={styles.segmentWrapper}>
                {idx > 0 && <View style={styles.divider} />}
                <Animated.View
                  style={[
                    styles.milestoneNode,
                    isReached ? styles.reachedNode : styles.unreachedNode,
                    isReached && {
                      opacity: pulseAnim,
                      shadowOpacity: pulseAnim,
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.footerRow}>
        <Text style={styles.xpBounds}>{min.toLocaleString()} XP</Text>
        <Text style={styles.xpCurrent}>{xp.toLocaleString()} XP</Text>
        <Text style={styles.xpBounds}>{max.toLocaleString()} XP</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    color: '#8a8a9e',
    fontSize: 12,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  percentageText: {
    color: '#3b82f6',
    fontSize: 12,
    fontWeight: '900',
  },
  trackContainer: {
    height: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    position: 'relative',
    overflow: 'visible',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 7,
    position: 'absolute',
    left: 0,
    top: 0,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 8,
    shadowOpacity: 0.6,
  },
  overlaySegments: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    pointerEvents: 'none',
  },
  segmentWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    width: 2,
    height: 14,
    backgroundColor: 'rgba(7, 10, 16, 0.65)',
  },
  milestoneNode: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    marginHorizontal: 1,
  },
  unreachedNode: {
    backgroundColor: '#070a10',
    borderColor: '#475569',
  },
  reachedNode: {
    backgroundColor: '#ffffff',
    borderColor: '#3b82f6',
    shadowColor: '#3b82f6',
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  xpBounds: {
    color: '#475569',
    fontSize: 10,
    fontWeight: '600',
  },
  xpCurrent: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
});
