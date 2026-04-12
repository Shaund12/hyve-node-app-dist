import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {Badge} from '../../components/Badge';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {timeAgo} from '../../utils/format';

export function AlertHistoryScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/alert-history');
  const alerts: any[] = data?.alerts || [];

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  return (
    <ScreenContainer onRefresh={reload}>
      {alerts.length === 0 ? (
        <Card title="Alert History" icon="📜">
          <Text style={styles.empty}>No alert history yet</Text>
        </Card>
      ) : (
        alerts.map((a: any, i: number) => (
          <Card key={i}>
            <View style={styles.headerRow}>
              <Badge
                label={a.severity || 'info'}
                severity={a.severity === 'critical' ? 'error' : a.severity === 'warning' ? 'warning' : 'info'}
              />
              <Text style={styles.time}>{a.ts ? timeAgo(a.ts) : '—'}</Text>
            </View>
            <Text style={styles.message}>{a.message || '—'}</Text>
            {a.alert_type && (
              <Text style={styles.type}>{a.alert_type}</Text>
            )}
          </Card>
        ))
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  message: {color: colors.text1, fontSize: 14},
  type: {color: colors.text3, fontSize: 11, fontFamily: fonts.mono, marginTop: 6},
  time: {color: colors.text3, fontSize: 11},
  empty: {color: colors.text3, textAlign: 'center', padding: 20, fontSize: 13},
});
