import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmt, fmtHyve, shortenHash} from '../../utils/format';

export function TxHistoryScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/tx-history');

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const txs = data?.transactions || [];

  return (
    <ScreenContainer>
      <Card title={`Transactions (${txs.length})`} icon="📄">
        {txs.map((tx: any, i: number) => (
          <View key={i} style={styles.txRow}>
            <View style={{flex: 1}}>
              <Text style={styles.txHash}>{shortenHash(tx.hash)}</Text>
              <Text style={styles.txTypes}>{(tx.types || []).join(', ')}</Text>
              <Text style={styles.txMeta}>Height {fmt(tx.height)} · Gas {fmt(tx.gas_used)}</Text>
            </View>
            <View style={{alignItems: 'flex-end'}}>
              <Text style={[styles.txCode, {color: tx.code === 0 ? colors.green : colors.red}]}>
                {tx.code === 0 ? '✓' : '✗'}
              </Text>
              <Text style={styles.txTime}>{new Date(tx.timestamp).toLocaleDateString()}</Text>
            </View>
          </View>
        ))}
        {txs.length === 0 && <Text style={styles.empty}>No transactions found</Text>}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  txRow: {flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border},
  txHash: {color: colors.cyan, fontSize: 12, fontFamily: fonts.mono},
  txTypes: {color: colors.text1, fontSize: 12, marginTop: 2},
  txMeta: {color: colors.text3, fontSize: 10, marginTop: 2},
  txCode: {fontSize: 16, fontWeight: '700'},
  txTime: {color: colors.text3, fontSize: 10, marginTop: 2},
  empty: {color: colors.text3, textAlign: 'center', padding: 20},
});
