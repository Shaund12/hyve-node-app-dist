import React, {ReactNode} from 'react';
import {View, Text, StyleSheet, ViewStyle} from 'react-native';
import {colors} from '../utils/theme';

interface Props {
  title?: string;
  icon?: string;
  children: ReactNode;
  style?: ViewStyle;
  right?: ReactNode;
}

export function Card({title, icon, children, style, right}: Props) {
  return (
    <View style={[styles.card, style]}>
      {title && (
        <View style={styles.header}>
          <Text style={styles.title}>
            {icon ? `${icon} ` : ''}
            {title}
          </Text>
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: {
    color: colors.text2,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
