import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmt, fmtHyve, shortenAddr} from '../../utils/format';

export function DelegatorsScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/delegators');

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <ScreenContainer>
      <Card title="Delegators" icon="👥">
        <View style={styles.row}>
          <MetricCard label="Total Delegated" value={fmtHyve(data.total || 0, 2)} color={colors.cyan} sub="HYVE" />
          <MetricCard label="Count" value={data.count || 0} color={colors.green} />
        </View>
      </Card>

      <Card title="Delegator List">
        {(data.delegators || []).map((d: any, i: number) => (
          <View key={i} style={styles.delRow}>
            <Text style={styles.addr} numberOfLines={1}>{shortenAddr(d.address)}</Text>
            <View style={{alignItems: 'flex-end'}}>
              <Text style={styles.amount}>{fmtHyve(d.amount, 2)} HYVE</Text>
              <Text style={styles.pct}>{d.share_pct?.toFixed(2)}%</Text>
            </View>
          </View>
        ))}
        {(!data.delegators || data.delegators.length === 0) && (
          <Text style={styles.empty}>No delegators found</Text>
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  delRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border},
  addr: {color: colors.cyan, fontSize: 12, fontFamily: fonts.mono, flex: 1, marginRight: 8},
  amount: {color: colors.text1, fontSize: 13, fontWeight: '600'},
  pct: {color: colors.text3, fontSize: 11},
  empty: {color: colors.text3, textAlign: 'center', padding: 20},
});
