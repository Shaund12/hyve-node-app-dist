import React, {useState} from 'react';
import {View, Text, StyleSheet, Alert} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {Button} from '../../components/Button';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmtHyve} from '../../utils/format';
import * as api from '../../api/client';

export function ShadeScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/shade', 30000);
  const [claiming, setClaiming] = useState(false);

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const claimShade = () => {
    if (!data.claimable) {
      Alert.alert('Not claimable', 'No SHADE rewards to claim right now');
      return;
    }
    Alert.alert('Claim SHADE', `Claim ${fmtHyve(data.pending_reward)} SHADE?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Claim',
        onPress: async () => {
          setClaiming(true);
          try {
            const r = await api.post('/api/tx/claim-shade');
            Alert.alert(r.ok ? 'Claimed!' : 'Error', r.ok ? 'SHADE rewards claimed' : r.error || 'Failed');
            reload();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setClaiming(false);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <Card title="SHADE Token" icon="🌑">
        <View style={styles.row}>
          <MetricCard label="Balance" value={fmtHyve(data.balance || 0)} color={colors.purple} sub="SHADE" />
          <MetricCard label="Pending" value={fmtHyve(data.pending_reward || 0)} color={colors.orange} sub="SHADE" />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Total Claimed" value={fmtHyve(data.total_claimed || 0)} sub="SHADE" />
          <MetricCard label="Allocation" value={fmtHyve(data.allocation || 0)} sub="SHADE" />
        </View>
      </Card>

      <Card title="Claim" icon="⚡">
        <View style={styles.row}>
          <Badge label={data.claimable ? 'Claimable' : 'Not Yet'} severity={data.claimable ? 'success' : 'warning'} />
          <Badge label={data.is_active ? 'Active' : 'Inactive'} severity={data.is_active ? 'success' : 'error'} />
        </View>
        <Button title="Claim SHADE" onPress={claimShade} loading={claiming} disabled={!data.claimable} style={{marginTop: 12}} />
      </Card>

      <Card title="Emission Stats" icon="📊">
        <View style={styles.row}>
          <MetricCard label="Claim %" value={`${(data.claim_pct || 0).toFixed(1)}%`} color={colors.cyan} />
          <MetricCard label="Epoch" value={data.current_epoch || 0} />
        </View>
        <View style={[styles.row, {marginTop: 8}]}>
          <MetricCard label="Per Period" value={fmtHyve(data.emission_per_period || 0, 0)} sub="SHADE" />
          <MetricCard label="Total Supply" value={fmtHyve(data.total_supply || 0, 0)} sub="SHADE" />
        </View>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
});
