import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmt, fmtHyve} from '../../utils/format';

export function ValidatorCompareScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/validator-compare');

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const validators = data.validators || [];

  return (
    <ScreenContainer>
      <Card title="Validator Ranking" icon="🏆">
        <View style={styles.row}>
          <MetricCard label="Our Rank" value={`#${data.our_rank || '—'}`} color={colors.cyan} />
          <MetricCard label="Total" value={data.total || 0} />
        </View>
      </Card>

      <Card title="Top Validators">
        <View style={styles.tableHeader}>
          <Text style={[styles.th, {width: 30}]}>#</Text>
          <Text style={[styles.th, {flex: 1}]}>Moniker</Text>
          <Text style={[styles.th, {width: 80}]}>Tokens</Text>
          <Text style={[styles.th, {width: 50}]}>Comm</Text>
        </View>
        {validators.map((v: any, i: number) => (
          <View key={i} style={[styles.tableRow, v.is_ours && {backgroundColor: colors.cyanBg}]}>
            <Text style={[styles.td, {width: 30}]}>{v.rank}</Text>
            <Text style={[styles.td, {flex: 1, color: v.is_ours ? colors.cyan : colors.text1}]} numberOfLines={1}>
              {v.moniker}
            </Text>
            <Text style={[styles.td, {width: 80}]}>{fmtHyve(v.tokens || 0, 0)}</Text>
            <Text style={[styles.td, {width: 50}]}>{((v.commission || 0) * 100).toFixed(0)}%</Text>
          </View>
        ))}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  tableHeader: {flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border},
  th: {color: colors.text3, fontSize: 10, fontWeight: '600', textTransform: 'uppercase'},
  tableRow: {flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border},
  td: {color: colors.text2, fontSize: 12, fontFamily: fonts.mono},
});
