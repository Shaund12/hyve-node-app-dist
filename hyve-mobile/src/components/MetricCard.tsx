import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {colors, fonts} from '../utils/theme';

interface Props {
  label: string;
  value: string | number;
  color?: string;
  mono?: boolean;
  sub?: string;
}

export function MetricCard({label, value, color, mono, sub}: Props) {
  const display = value != null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—');
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Text
        style={[
          styles.value,
          color ? {color} : {},
          mono ? {fontFamily: fonts.mono} : {},
        ]}
        numberOfLines={1}>
        {display}
      </Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minWidth: 90,
  },
  label: {
    color: colors.text3,
    fontSize: 11,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  value: {
    color: colors.text1,
    fontSize: 18,
    fontWeight: '700',
  },
  sub: {
    color: colors.text3,
    fontSize: 10,
    marginTop: 2,
  },
});
