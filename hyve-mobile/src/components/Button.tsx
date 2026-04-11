import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
} from 'react-native';
import {colors} from '../utils/theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'danger' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

export function Button({title, onPress, variant = 'primary', loading, disabled, style}: Props) {
  const bg =
    variant === 'danger'
      ? colors.red
      : variant === 'secondary'
      ? colors.bg3
      : colors.cyan;
  const fg = variant === 'secondary' ? colors.text1 : '#000';

  return (
    <TouchableOpacity
      style={[styles.btn, {backgroundColor: bg, opacity: disabled ? 0.4 : 1}, style]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={[styles.text, {color: fg}]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
