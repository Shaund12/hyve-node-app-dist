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

export function SigningScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/signing', 15000);
  const {data: risk} = useApi<any>('/api/slash-risk', 15000);

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <ScreenContainer>
      <Card title="Signing Window" icon="✍️">
        <View style={styles.row}>
          <MetricCard label="Uptime" value={`${data.uptime_pct?.toFixed(2)}%`} color={data.uptime_pct >= 99 ? colors.green : colors.orange} />
          <MetricCard label="Missed Blocks" value={fmt(data.missed_blocks || 0)} color={data.missed_blocks > 100 ? colors.red : colors.green} />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Signed" value={fmt(data.signed_blocks || 0)} />
          <MetricCard label="Window" value={fmt(data.window || 0)} />
          <MetricCard label="Progress" value={`${data.window_progress?.toFixed(0)}%`} />
        </View>
      </Card>

      <Card title="Jail Status" icon="🔒">
        <View style={styles.row}>
          <Badge label={data.tombstoned ? 'Tombstoned' : data.jailed_until ? 'Jailed' : 'Active'} severity={data.tombstoned ? 'error' : data.jailed_until ? 'warning' : 'success'} />
        </View>
        {data.blocks_until_clean > 0 && (
          <Text style={styles.hint}>{fmt(data.blocks_until_clean)} blocks until clean window</Text>
        )}
      </Card>

      {risk && (
        <Card title="Slash Risk" icon="⚠️">
          <View style={styles.row}>
            <MetricCard label="Risk" value={`${risk.risk_pct?.toFixed(1)}%`} color={risk.zone === 'safe' ? colors.green : risk.zone === 'warning' ? colors.orange : colors.red} />
            <MetricCard label="Remaining" value={fmt(risk.remaining_before_jail || 0)} sub="blocks before jail" />
          </View>
          <View style={[styles.row, {marginTop: 8}]}>
            <Badge label={risk.zone?.toUpperCase() || '—'} severity={risk.zone === 'safe' ? 'success' : risk.zone === 'warning' ? 'warning' : 'error'} />
          </View>
          <View style={styles.gaugeContainer}>
            <View style={[styles.gaugeBar, {width: `${Math.min(risk.risk_pct || 0, 100)}%`, backgroundColor: risk.zone === 'safe' ? colors.green : risk.zone === 'warning' ? colors.orange : colors.red}]} />
          </View>
        </Card>
      )}

      <Card title="Slashing Params" icon="📜">
        <View style={styles.row}>
          <MetricCard label="Min Signed" value={`${(data.min_signed_pct * 100).toFixed(0)}%`} />
          <MetricCard label="Downtime Slash" value={`${(data.slash_downtime_pct * 100).toFixed(2)}%`} />
          <MetricCard label="Double Sign" value={`${(data.slash_double_sign_pct * 100).toFixed(0)}%`} />
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  hint: {color: colors.text3, fontSize: 11, marginTop: 8},
  gaugeContainer: {height: 6, backgroundColor: colors.bg3, borderRadius: 3, marginTop: 12, overflow: 'hidden'},
  gaugeBar: {height: '100%', borderRadius: 3},
});
