import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmt, fmtHyve} from '../../utils/format';

export function EarningsScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/earnings-calc');
  const {data: staking} = useApi<any>('/api/staking');

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const delegated = staking?.delegated || 0;
  const apr = data.apr || 0;
  const daily = (delegated * (apr / 100)) / 365;
  const monthly = daily * 30;
  const yearly = delegated * (apr / 100);

  return (
    <ScreenContainer onRefresh={reload}>
      <Card title="Earnings Projector" icon="🧮">
        <View style={styles.row}>
          <MetricCard label="APR" value={`${apr.toFixed(2)}%`} color={colors.cyan} />
          <MetricCard label="Delegated" value={fmtHyve(delegated, 2)} color={colors.green} sub="HYVE" />
        </View>
      </Card>

      <Card title="Projected Earnings" icon="📈">
        <View style={styles.row}>
          <MetricCard label="Daily" value={fmtHyve(daily, 4)} color={colors.green} sub="HYVE" />
          <MetricCard label="Monthly" value={fmtHyve(monthly, 2)} color={colors.cyan} sub="HYVE" />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Yearly" value={fmtHyve(yearly, 2)} color={colors.purple} sub="HYVE" />
        </View>
      </Card>

      <Card title="Network Stats" icon="🌐">
        <View style={styles.row}>
          <MetricCard label="Inflation" value={`${(data.inflation || 0).toFixed(2)}%`} />
          <MetricCard label="Bonded" value={fmtHyve(data.bonded_tokens || 0, 0)} sub="HYVE" />
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
});
