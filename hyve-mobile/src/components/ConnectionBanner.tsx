import React, {useEffect, useState} from 'react';
import {View, Text, StyleSheet, Animated} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import {colors} from '../utils/theme';

export function ConnectionBanner() {
  const [connected, setConnected] = useState(true);
  const opacity = useState(new Animated.Value(0))[0];

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const isConnected = state.isConnected ?? true;
      setConnected(isConnected);
      Animated.timing(opacity, {
        toValue: isConnected ? 0 : 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    });
    return () => unsubscribe();
  }, [opacity]);

  if (connected) return null;

  return (
    <Animated.View style={[styles.banner, {opacity}]}>
      <Text style={styles.text}>⚠ No Internet Connection</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.red,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
