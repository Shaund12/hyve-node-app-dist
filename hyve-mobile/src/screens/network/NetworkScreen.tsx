import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors} from '../../utils/theme';
import {fmt, fmtHyve} from '../../utils/format';

export function NetworkScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/network', 30000);
  const {data: peers} = useApi<any>('/api/peer-quality');
  const {data: blocks} = useApi<any>('/api/blocks');

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <ScreenContainer>
      <Card title="Network Overview" icon="🌐">
        <View style={styles.row}>
          <MetricCard label="Active Validators" value={data.active_validators || 0} color={colors.green} />
          <MetricCard label="Bonded Ratio" value={`${((data.bonded_ratio || 0) * 100).toFixed(1)}%`} color={colors.cyan} />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Avg Block Time" value={`${(data.avg_block_time || 0).toFixed(1)}s`} />
          <MetricCard label="Avg Commission" value={`${((data.avg_commission || 0) * 100).toFixed(1)}%`} />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Total Supply" value={fmtHyve(data.total_supply || 0, 0)} sub="HYVE" />
          <MetricCard label="Active Proposals" value={data.active_proposals || 0} />
        </View>
      </Card>

      {peers?.peers && (
        <Card title={`Peers (${peers.peers.length})`} icon="🔗">
          {peers.peers.slice(0, 15).map((p: any, i: number) => (
            <View key={i} style={styles.peerRow}>
              <View style={{flex: 1}}>
                <Text style={styles.peerName} numberOfLines={1}>{p.moniker || p.ip}</Text>
                <Text style={styles.peerMeta}>{p.direction} · {p.ip}</Text>
              </View>
              <Text style={styles.peerRate}>↑{p.send_rate} ↓{p.recv_rate}</Text>
            </View>
          ))}
        </Card>
      )}

      {blocks?.blocks && (
        <Card title="Recent Blocks" icon="⛓">
          {blocks.blocks.slice(0, 10).map((b: any, i: number) => (
            <View key={i} style={styles.blockRow}>
              <Text style={styles.blockHeight}>#{fmt(b.height)}</Text>
              <Text style={styles.blockTxs}>{b.num_txs} txs</Text>
              <Text style={styles.blockTime}>{new Date(b.time).toLocaleTimeString()}</Text>
            </View>
          ))}
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  peerRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border},
  peerName: {color: colors.text1, fontSize: 13},
  peerMeta: {color: colors.text3, fontSize: 10, marginTop: 2},
  peerRate: {color: colors.text2, fontSize: 11, fontFamily: 'monospace'},
  blockRow: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border},
  blockHeight: {color: colors.cyan, fontSize: 12, fontFamily: 'monospace'},
  blockTxs: {color: colors.text2, fontSize: 12},
  blockTime: {color: colors.text3, fontSize: 11},
});
