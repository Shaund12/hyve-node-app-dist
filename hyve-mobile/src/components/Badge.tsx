import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {colors} from '../utils/theme';

type Severity = 'success' | 'warning' | 'error' | 'info';

const severityColors: Record<Severity, {bg: string; fg: string}> = {
  success: {bg: colors.greenBg, fg: colors.green},
  warning: {bg: colors.orangeBg, fg: colors.orange},
  error: {bg: colors.redBg, fg: colors.red},
  info: {bg: colors.cyanBg, fg: colors.cyan},
};

export function Badge({label, severity = 'info'}: {label: string; severity?: Severity}) {
  const c = severityColors[severity];
  return (
    <View style={[styles.badge, {backgroundColor: c.bg}]}>
      <Text style={[styles.text, {color: c.fg}]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});
