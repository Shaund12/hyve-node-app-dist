import React from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import {fmt} from '../../utils/format';

export function RpcScreen() {
  const {data} = useApi<any>('/api/rpc-metrics', 15000);
  const {data: cfg} = useApi<any>('/api/rpc-config');

  const stats: any[] = data?.stats || [];

  return (
    <ScreenContainer>
      <Card title="RPC Metrics Summary" icon="📊">
        <View style={styles.row}>
          <MetricCard label="Total Endpoints" value={stats.length} />
          <MetricCard
            label="Total Calls"
            value={fmt(stats.reduce((s, v: any) => s + (v.count || 0), 0))}
          />
        </View>
        <View style={[styles.row, {marginTop: 8}]}>
          <MetricCard
            label="Avg Latency"
            value={`${(
              stats.reduce((s, v: any) => s + (v.avg_ms || 0), 0) /
              Math.max(stats.length, 1)
            ).toFixed(1)} ms`}
          />
          <MetricCard
            label="Max Latency"
            value={`${Math.max(...stats.map((v: any) => v.max_ms || 0), 0).toFixed(1)} ms`}
          />
        </View>
      </Card>

      {cfg && (
        <Card title="RPC Configuration" icon="⚙️">
          <View style={styles.cfgRow}>
            <Text style={styles.cfgLabel}>JSON-RPC</Text>
            <Badge label={cfg.json_rpc ? 'Enabled' : 'Disabled'} severity={cfg.json_rpc ? 'success' : 'info'} />
          </View>
          <View style={styles.cfgRow}>
            <Text style={styles.cfgLabel}>REST API</Text>
            <Badge label={cfg.api ? 'Enabled' : 'Disabled'} severity={cfg.api ? 'success' : 'info'} />
          </View>
          <View style={styles.cfgRow}>
            <Text style={styles.cfgLabel}>gRPC</Text>
            <Badge label={cfg.grpc ? 'Enabled' : 'Disabled'} severity={cfg.grpc ? 'success' : 'info'} />
          </View>
        </Card>
      )}

      <Card title="Endpoint Details" icon="📋">
        {stats.length === 0 ? (
          <Text style={styles.empty}>No metrics collected yet</Text>
        ) : (
          stats.slice(0, 25).map((v: any) => (
            <View key={v.path} style={styles.epRow}>
              <Text style={styles.epPath} numberOfLines={1}>
                {v.path}
              </Text>
              <View style={styles.epStats}>
                <Text style={styles.epCount}>{v.count}</Text>
                <Text style={styles.epMs}>{v.avg_ms?.toFixed(0)}ms</Text>
              </View>
            </View>
          ))
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  cfgRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  cfgLabel: {color: colors.text2, fontSize: 13},
  cfgVal: {color: colors.text1, fontSize: 13, fontFamily: 'monospace'},
  empty: {color: colors.text3, textAlign: 'center', paddingVertical: 20},
  epRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  epPath: {flex: 1, color: colors.text1, fontSize: 12, fontFamily: 'monospace'},
  epStats: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  epCount: {color: colors.cyan, fontSize: 12},
  epMs: {color: colors.text3, fontSize: 12},
  epErr: {color: colors.red, fontSize: 12},
});
