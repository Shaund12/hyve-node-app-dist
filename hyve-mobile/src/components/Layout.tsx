import React, {useState, useCallback} from 'react';
import {View, ActivityIndicator, Text, StyleSheet, ScrollView, RefreshControl} from 'react-native';
import {colors} from '../utils/theme';

export function LoadingView({message}: {message?: string} = {}) {
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.cyan} />
      {message && <Text style={{color: colors.text2, marginTop: 12}}>{message}</Text>}
    </View>
  );
}

export function ErrorView({message, onRetry}: {message: string; onRetry?: () => void}) {
  return (
    <View style={styles.center}>
      <Text style={styles.error}>⚠ {message}</Text>
      {onRetry && (
        <Text style={styles.retry} onPress={onRetry}>
          Tap to retry
        </Text>
      )}
    </View>
  );
}

export function ScreenContainer({children, onRefresh}: {children: React.ReactNode; onRefresh?: () => void | Promise<void>}) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {}
    setRefreshing(false);
  }, [onRefresh]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.cyan}
            colors={[colors.cyan]}
            progressBackgroundColor={colors.bg3}
          />
        ) : undefined
      }>
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg1,
    padding: 24,
  },
  error: {
    color: colors.red,
    fontSize: 14,
    textAlign: 'center',
  },
  retry: {
    color: colors.cyan,
    fontSize: 13,
    marginTop: 12,
  },
  screen: {
    flex: 1,
    backgroundColor: colors.bg1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
});
