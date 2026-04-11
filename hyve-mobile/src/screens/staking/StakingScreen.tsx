import React, {useState} from 'react';
import {View, Text, TextInput, StyleSheet, Alert} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {Button} from '../../components/Button';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {fmt, fmtHyve} from '../../utils/format';
import * as api from '../../api/client';

export function StakingScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/staking', 30000);
  const [claiming, setClaiming] = useState(false);
  const [compounding, setCompounding] = useState(false);

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const claimRewards = async () => {
    Alert.alert('Claim Rewards', 'Claim all pending rewards and commission?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Claim',
        onPress: async () => {
          setClaiming(true);
          try {
            const r = await api.post('/api/tx/claim-rewards');
            Alert.alert(r.ok ? 'Success' : 'Error', r.ok ? 'Rewards claimed!' : r.error || 'Failed');
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

  const compound = async () => {
    Alert.alert('Compound', 'Claim rewards and auto-delegate?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Compound',
        onPress: async () => {
          setCompounding(true);
          try {
            const r = await api.post('/api/tx/compound');
            Alert.alert(r.ok ? 'Success' : 'Error', r.ok ? `Compounded ${fmtHyve(r.result?.delegated_amount || 0)} HYVE` : r.error || 'Failed');
            reload();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setCompounding(false);
          }
        },
      },
    ]);
  };

  const v = data.our_validator || {};

  return (
    <ScreenContainer>
      <Card title="Balances" icon="💰">
        <View style={styles.row}>
          <MetricCard label="Available" value={fmtHyve(data.available)} color={colors.green} sub="HYVE" />
          <MetricCard label="Delegated" value={fmtHyve(data.delegated)} color={colors.cyan} sub="HYVE" />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Rewards" value={fmtHyve(data.pending_rewards)} color={colors.orange} sub="HYVE" />
          <MetricCard label="Commission" value={fmtHyve(data.pending_commission)} color={colors.purple} sub="HYVE" />
        </View>
        <View style={[styles.row, {marginTop: 12}]}>
          <MetricCard label="Total Assets" value={fmtHyve(data.total_assets || 0)} color={colors.text1} sub="HYVE" />
        </View>
      </Card>

      <Card title="Actions" icon="⚡">
        <View style={styles.row}>
          <Button title="Claim Rewards" onPress={claimRewards} loading={claiming} style={{flex: 1}} />
          <Button title="Compound" onPress={compound} loading={compounding} variant="secondary" style={{flex: 1}} />
        </View>
      </Card>

      <Card title="Our Validator" icon="🏛">
        <Text style={styles.moniker}>{v.description?.moniker || 'Unknown'}</Text>
        <View style={[styles.row, {marginTop: 8}]}>
          <MetricCard label="Rank" value={`#${v.rank || '—'}`} />
          <MetricCard label="Commission" value={`${((v.commission?.commission_rates?.rate || 0) * 100).toFixed(1)}%`} />
          <MetricCard label="Tokens" value={fmtHyve(v.tokens || 0, 0)} />
        </View>
        <View style={[styles.row, {marginTop: 8}]}>
          <Badge label={v.jailed ? 'Jailed' : v.status === 'BOND_STATUS_BONDED' ? 'Active' : 'Inactive'} severity={v.jailed ? 'error' : v.status === 'BOND_STATUS_BONDED' ? 'success' : 'warning'} />
        </View>
      </Card>

      {data.all_validators?.length > 0 && (
        <Card title={`All Validators (${data.all_validators.length})`} icon="📋">
          {data.all_validators.slice(0, 20).map((val: any, i: number) => (
            <View key={i} style={styles.valRow}>
              <Text style={styles.valRank}>#{val.rank || i + 1}</Text>
              <Text style={[styles.valName, val.is_ours && {color: colors.cyan}]} numberOfLines={1}>
                {val.description?.moniker || 'Unknown'}
              </Text>
              <Text style={styles.valTokens}>{fmtHyve(val.tokens || 0, 0)}</Text>
            </View>
          ))}
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  moniker: {color: colors.text1, fontSize: 16, fontWeight: '700'},
  valRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border},
  valRank: {color: colors.text3, fontSize: 12, width: 30, fontFamily: fonts.mono},
  valName: {color: colors.text1, fontSize: 13, flex: 1},
  valTokens: {color: colors.text2, fontSize: 12, fontFamily: fonts.mono},
});
