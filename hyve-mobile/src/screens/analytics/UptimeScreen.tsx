import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';

function uptimeColor(pct: number): string {
  if (pct >= 99.5) return colors.green;
  if (pct >= 95) return '#4ade80';
  if (pct >= 90) return colors.orange;
  if (pct >= 50) return '#f97316';
  return colors.red;
}

export function UptimeScreen() {
  const {data} = useApi<any>('/api/uptime-heatmap');
  const days = data?.days || [];

  // Compute summary from available data
  const recentDays = days.slice(-30);
  const avg30 = recentDays.length > 0 ? recentDays.reduce((s: number, d: any) => s + (d.uptime || 0), 0) / recentDays.length : null;
  const avg7 = days.slice(-7).length > 0 ? days.slice(-7).reduce((s: number, d: any) => s + (d.uptime || 0), 0) / days.slice(-7).length : null;
  const avg24 = days.length > 0 ? days[days.length - 1]?.uptime : null;
  const worst = recentDays.length > 0 ? Math.min(...recentDays.map((d: any) => d.uptime ?? 100)) : null;

  return (
    <ScreenContainer>
      {days.length > 0 && (
        <Card title="Uptime Summary" icon="📊">
          <View style={styles.row}>
            <MetricCard label="24h Uptime" value={avg24 != null ? `${avg24.toFixed(2)}%` : '—'} color={colors.green} />
            <MetricCard label="7d Uptime" value={avg7 != null ? `${avg7.toFixed(2)}%` : '—'} color={colors.cyan} />
          </View>
          <View style={[styles.row, {marginTop: 8}]}>
            <MetricCard label="30d Uptime" value={avg30 != null ? `${avg30.toFixed(2)}%` : '—'} />
            <MetricCard label="Worst Day" value={worst != null ? `${worst.toFixed(1)}%` : '—'} color={colors.red} />
          </View>
        </Card>
      )}

      <Card title="Daily Uptime" icon="🗓️">
        {days.length === 0 ? (
          <Text style={styles.empty}>No uptime data yet</Text>
        ) : (
          <View>
            {days.slice().reverse().slice(0, 30).map((d: any, i: number) => (
              <View key={i} style={styles.dayRow}>
                <Text style={styles.dayDate}>{d.date}</Text>
                <View style={styles.barBg}>
                  <View style={[styles.barFill, {width: `${d.uptime || 0}%`, backgroundColor: uptimeColor(d.uptime || 0)}]} />
                </View>
                <Text style={[styles.dayPct, {color: uptimeColor(d.uptime || 0)}]}>
                  {(d.uptime || 0).toFixed(1)}%
                </Text>
              </View>
            ))}
          </View>
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  empty: {color: colors.text3, textAlign: 'center', paddingVertical: 20},
  dayRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: colors.bg3},
  dayDate: {width: 80, color: colors.text3, fontSize: 11},
  barBg: {flex: 1, height: 12, backgroundColor: colors.bg3, borderRadius: 4, overflow: 'hidden', marginHorizontal: 8},
  barFill: {height: '100%', borderRadius: 4},
  dayPct: {width: 50, fontSize: 11, fontFamily: 'monospace', textAlign: 'right'},
});
