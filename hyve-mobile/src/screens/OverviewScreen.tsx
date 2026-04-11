import React, {useEffect, useState, useRef} from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../components/Layout';
import {Card} from '../components/Card';
import {MetricCard} from '../components/MetricCard';
import {Badge} from '../components/Badge';
import {colors, fonts} from '../utils/theme';
import {fmt, fmtHyve} from '../utils/format';
import * as api from '../api/client';

export function OverviewScreen() {
  const [status, setStatus] = useState<any>(null);
  const [staking, setStaking] = useState<any>(null);
  const [signing, setSigning] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [alerts, setAlerts] = useState<any[]>([]);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Initial REST load
    Promise.all([
      api.get('/api/status').then(setStatus).catch(() => {}),
      api.get('/api/staking').then(setStaking).catch(() => {}),
      api.get('/api/signing').then(setSigning).catch(() => {}),
      api.get('/api/health-score').then(setHealth).catch(() => {}),
      api.get('/api/alerts').then(d => setAlerts(d?.alerts || [])).catch(() => {}),
    ]);

    // WebSocket for live updates
    try {
      ws.current = api.createWebSocket('/ws/live');
      ws.current.onmessage = e => {
        try {
          const d = JSON.parse(e.data);
          if (d.status) setStatus(d.status);
          if (d.staking) setStaking(d.staking);
          if (d.signing) setSigning(d.signing);
        } catch {}
      };
    } catch {}

    return () => {
      ws.current?.close();
    };
  }, []);

  const running = status?.running;
  const synced = status?.sync?.catching_up === false;
  const height = status?.sync?.latest_block_height;
  const peers = status?.peers?.count || 0;

  return (
    <ScreenContainer>
      {/* Node Status */}
      <Card title="Node Status" icon="🖥">
        <View style={styles.row}>
          <Badge
            label={running ? 'Running' : 'Stopped'}
            severity={running ? 'success' : 'error'}
          />
          <Badge
            label={synced ? 'Synced' : status?.sync?.catching_up ? 'Catching Up' : '—'}
            severity={synced ? 'success' : 'warning'}
          />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Height" value={height ? fmt(parseInt(height)) : '—'} color={colors.cyan} mono />
          <MetricCard label="Peers" value={peers} color={colors.green} />
        </View>
        {status?.process && (
          <View style={[styles.row, {marginTop: 8}]}>
            <MetricCard label="CPU" value={`${status.process.cpu_percent?.toFixed(1) ?? '—'}%`} />
            <MetricCard label="Memory" value={`${status.process.memory_mb?.toFixed(0) ?? '—'} MB`} />
            <MetricCard label="Disk" value={`${status.disk?.pct?.toFixed(1) ?? '—'}%`} />
          </View>
        )}
      </Card>

      {/* Health Score */}
      {health && (
        <Card title="Health Score" icon="💚">
          <View style={styles.row}>
            <Text style={[styles.bigScore, {color: health.score >= 80 ? colors.green : health.score >= 50 ? colors.orange : colors.red}]}>
              {health.score != null ? String(health.score) : '—'}
            </Text>
            <View style={{flex: 1, marginLeft: 16}}>
              {Object.entries(health.breakdown || {}).map(([k, v]: any) => {
                const score = typeof v === 'object' ? v.score : v;
                const max = typeof v === 'object' ? v.max : 20;
                return (
                  <View key={k} style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>{k}</Text>
                    <Text style={[styles.breakdownVal, {color: score >= max * 0.9 ? colors.green : score >= max * 0.5 ? colors.orange : colors.red}]}>
                      {String(score ?? 0)}/{max}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </Card>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <Card title="Active Alerts" icon="🚨">
          {alerts.map((a, i) => (
            <View key={i} style={[styles.alertRow, {backgroundColor: a.severity === 'critical' ? colors.redBg : colors.orangeBg}]}>
              <Text style={{color: a.severity === 'critical' ? colors.red : colors.orange, fontSize: 12}}>
                {a.severity === 'critical' ? '🔴' : '🟡'} {String(a.message ?? '')}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* Staking */}
      {staking && (
        <Card title="Staking" icon="💰">
          <View style={styles.row}>
            <MetricCard label="Available" value={fmtHyve(staking.available)} color={colors.green} />
            <MetricCard label="Delegated" value={fmtHyve(staking.delegated)} color={colors.cyan} />
          </View>
          <View style={[styles.row, {marginTop: 8}]}>
            <MetricCard label="Rewards" value={fmtHyve(staking.pending_rewards)} color={colors.orange} />
            <MetricCard label="Commission" value={fmtHyve(staking.pending_commission)} color={colors.purple} />
          </View>
          {staking.our_validator && (
            <View style={[styles.row, {marginTop: 8}]}>
              <MetricCard label="Rank" value={`#${staking.all_validators?.findIndex((v: any) => v.moniker === staking.our_validator.moniker) + 1 || '—'}`} />
              <MetricCard label="Voting Power" value={fmtHyve(staking.our_validator.tokens || 0, 0)} />
            </View>
          )}
        </Card>
      )}

      {/* Signing */}
      {signing && (
        <Card title="Signing" icon="✍️">
          <View style={styles.row}>
            <MetricCard label="Uptime" value={`${signing.uptime_pct?.toFixed(2) ?? '—'}%`} color={(signing.uptime_pct ?? 0) >= 99 ? colors.green : colors.orange} />
            <MetricCard label="Missed" value={fmt(signing.missed_blocks ?? 0)} color={(signing.missed_blocks ?? 0) > 100 ? colors.red : colors.green} />
            <MetricCard label="Window" value={`${signing.window_progress?.toFixed(0) ?? '—'}%`} />
          </View>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  bigScore: {fontSize: 48, fontWeight: '800'},
  breakdownRow: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2},
  breakdownLabel: {color: colors.text2, fontSize: 12, textTransform: 'capitalize'},
  breakdownVal: {fontSize: 12, fontWeight: '600', fontFamily: fonts.mono},
  alertRow: {padding: 10, borderRadius: 8, marginBottom: 6},
});
