import React from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import {fmt} from '../../utils/format';

export function RankHistoryScreen() {
  const {data} = useApi<any>('/api/rank-history');
  const snapshots = data?.history || [];
  const current = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const prev = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null;

  const rankDelta = current && prev ? prev.rank - current.rank : 0;

  return (
    <ScreenContainer>
      {current && (
        <Card title="Current Rank" icon="🏆">
          <View style={styles.row}>
            <MetricCard label="Rank" value={`#${current.rank}`} color={colors.cyan} />
            <MetricCard
              label="Change"
              value={rankDelta > 0 ? `↑ ${rankDelta}` : rankDelta < 0 ? `↓ ${Math.abs(rankDelta)}` : '—'}
              color={rankDelta > 0 ? colors.green : rankDelta < 0 ? colors.red : colors.text3}
            />
          </View>
          <View style={[styles.row, {marginTop: 8}]}>
            <MetricCard label="Voting Power" value={fmt(current.voting_power)} />
            <MetricCard label="Active Set" value={`${current.total_validators || '—'}`} />
          </View>
        </Card>
      )}

      <Card title="Rank History" icon="📈">
        {snapshots.length === 0 ? (
          <Text style={styles.empty}>No rank snapshots yet</Text>
        ) : (
          snapshots
            .slice()
            .reverse()
            .slice(0, 50)
            .map((s: any, i: number) => (
              <View key={i} style={styles.snapRow}>
                <Text style={styles.snapTime}>
                  {new Date(s.ts).toISOString().split('T')[0]}
                </Text>
                <Text style={styles.snapRank}>#{s.rank}</Text>
                <Text style={styles.snapVp}>{fmt(s.voting_power)} VP</Text>
              </View>
            ))
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  empty: {color: colors.text3, textAlign: 'center', paddingVertical: 20},
  snapRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  snapTime: {flex: 1, color: colors.text3, fontSize: 12},
  snapRank: {color: colors.cyan, fontSize: 14, fontWeight: '600', width: 50},
  snapVp: {color: colors.text2, fontSize: 12, fontFamily: 'monospace', width: 100, textAlign: 'right'},
});
