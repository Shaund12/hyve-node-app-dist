import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmt, fmtHyve} from '../../utils/format';

export function RewardsScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/rewards-history');
  const {data: commission} = useApi<any>('/api/commission-income');

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const rows = data?.data || [];
  const commDaily = commission?.daily || [];
  const commTotal = commission?.total || 0;

  return (
    <ScreenContainer>
      <Card title="Commission Income" icon="💎">
        <View style={styles.row}>
          <MetricCard label="Total" value={fmtHyve(commTotal)} color={colors.purple} sub="HYVE" />
          <MetricCard
            label="Today"
            value={commDaily.length > 0 ? fmtHyve(commDaily[commDaily.length - 1].earned, 6) : '—'}
            color={colors.green}
            sub="HYVE"
          />
        </View>
      </Card>

      <Card title="Recent Commission" icon="📊">
        {commDaily.slice(-14).reverse().map((d: any, i: number) => (
          <View key={i} style={styles.histRow}>
            <Text style={styles.date}>{d.day}</Text>
            <Text style={styles.earned}>{fmtHyve(d.earned, 6)}</Text>
          </View>
        ))}
        {commDaily.length === 0 && <Text style={styles.empty}>No data yet</Text>}
      </Card>

      <Card title="Rewards History (7d)" icon="📈">
        {rows.slice(-24).reverse().map((r: any, i: number) => (
          <View key={i} style={styles.histRow}>
            <Text style={styles.date}>{r.hour?.slice(5, 16)}</Text>
            <Text style={styles.earned}>{fmtHyve(r.rewards || 0, 4)}</Text>
            <Text style={[styles.earned, {color: colors.purple}]}>{fmtHyve(r.commission || 0, 4)}</Text>
          </View>
        ))}
        {rows.length === 0 && <Text style={styles.empty}>No data yet</Text>}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  histRow: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border},
  date: {color: colors.text3, fontSize: 11, fontFamily: fonts.mono, flex: 1},
  earned: {color: colors.green, fontSize: 12, fontFamily: fonts.mono},
  empty: {color: colors.text3, textAlign: 'center', padding: 20},
});
