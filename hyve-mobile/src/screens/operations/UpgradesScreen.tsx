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
import {fmt, mbStr} from '../../utils/format';
import * as api from '../../api/client';

export function UpgradesScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/upgrades');
  const [downloading, setDownloading] = useState(false);
  const [applying, setApplying] = useState(false);

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const plan = data.current_plan;
  const lb = data.local_binary || {};
  const ub = data.upgrade_binary || {};
  const rb = data.remote_binary || {};
  const urlOk = data.release_url_configured;

  const download = () => {
    Alert.alert('Download Binary', 'Download latest binary from release server?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Download',
        onPress: async () => {
          setDownloading(true);
          try {
            const r = await api.post('/api/upgrades/download', undefined, 600000);
            Alert.alert(r.ok ? 'Downloaded!' : 'Error', r.ok ? `Downloaded ${mbStr(r.size)}` : r.error || 'Failed');
            reload();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setDownloading(false);
          }
        },
      },
    ]);
  };

  const apply = () => {
    Alert.alert('Apply Upgrade', 'This will stop the node, swap the binary, and restart. Continue?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Apply',
        style: 'destructive',
        onPress: async () => {
          setApplying(true);
          try {
            const r = await api.post('/api/upgrades/apply');
            Alert.alert(r.ok ? 'Applied!' : 'Error', r.ok ? `Node ${r.node_started ? 'restarted' : 'needs manual start'}` : r.error || 'Failed');
            reload();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setApplying(false);
          }
        },
      },
    ]);
  };

  const rollback = () => {
    Alert.alert('Rollback', 'Restore previous binary and restart?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Rollback',
        style: 'destructive',
        onPress: async () => {
          try {
            const r = await api.post('/api/upgrades/rollback');
            Alert.alert(r.ok ? 'Rolled Back' : 'Error', r.ok ? 'Previous binary restored' : r.error || 'Failed');
            reload();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      {/* Pending Upgrade */}
      <Card title="Pending Upgrade" icon="⬆">
        {plan ? (
          <>
            <Text style={[styles.planName, {color: colors.orange}]}>{plan.name}</Text>
            <Text style={styles.planHeight}>Height {fmt(parseInt(plan.height || 0))} ({fmt(parseInt(plan.height || 0) - data.current_height)} blocks away)</Text>
          </>
        ) : (
          <>
            <Text style={[styles.planName, {color: colors.green}]}>None</Text>
            <Text style={styles.planHeight}>No upgrade scheduled</Text>
          </>
        )}
      </Card>

      {/* Binary Status */}
      <Card title="Binaries" icon="📦">
        <View style={styles.row}>
          <MetricCard label="Active" value={lb.size > 0 ? mbStr(lb.size) : 'Missing'} color={lb.size > 0 ? colors.green : colors.red} />
          <MetricCard label="Staged" value={ub.exists ? mbStr(ub.size) : 'None'} color={ub.exists ? colors.cyan : colors.text3} />
          <MetricCard label="Remote" value={urlOk && rb.size > 0 ? mbStr(rb.size) : urlOk ? 'Unavailable' : 'N/A'} color={urlOk ? colors.cyan : colors.text3} />
        </View>
        {lb.sha256 && (
          <Text style={styles.sha}>Active: {lb.sha256.slice(0, 16)}…</Text>
        )}
        {ub.exists && ub.sha256 && (
          <Text style={styles.sha}>Staged: {ub.sha256.slice(0, 16)}…</Text>
        )}
      </Card>

      {/* Actions */}
      <Card title="Actions" icon="🔧">
        {!urlOk && (
          <View style={[styles.notice, {backgroundColor: colors.orangeBg}]}>
            <Text style={{color: colors.orange, fontSize: 12}}>Set BINARY_RELEASE_URL in .env to enable downloads</Text>
          </View>
        )}
        {data.new_binary_available && (
          <View style={[styles.notice, {backgroundColor: colors.cyanBg, marginBottom: 8}]}>
            <Text style={{color: colors.cyan, fontSize: 12, fontWeight: '600'}}>New binary available!</Text>
          </View>
        )}
        <View style={styles.row}>
          <Button title="Download" onPress={download} loading={downloading} disabled={!urlOk || !(rb.size > 0)} style={{flex: 1}} />
          <Button title="Apply" onPress={apply} loading={applying} disabled={!ub.exists} variant="secondary" style={{flex: 1}} />
          <Button title="Rollback" onPress={rollback} variant="danger" style={{flex: 1}} />
        </View>
      </Card>

      {/* History */}
      <Card title="Upgrade History" icon="📜">
        {(data.upgrade_history || []).map((u: any, i: number) => (
          <View key={i} style={styles.histRow}>
            <View style={{flex: 1}}>
              <Text style={styles.histName}>#{u.proposal_id} {u.name}</Text>
              <Text style={styles.histHeight}>Height {fmt(u.height)}</Text>
            </View>
            <Badge label={u.applied ? 'Applied' : 'Pending'} severity={u.applied ? 'success' : 'warning'} />
          </View>
        ))}
        {(!data.upgrade_history || data.upgrade_history.length === 0) && (
          <Text style={styles.empty}>No upgrade proposals</Text>
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 8},
  planName: {fontSize: 18, fontWeight: '700'},
  planHeight: {color: colors.text3, fontSize: 12, marginTop: 4},
  sha: {color: colors.text3, fontSize: 10, fontFamily: fonts.mono, marginTop: 6},
  notice: {padding: 10, borderRadius: 8, marginBottom: 4},
  histRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border},
  histName: {color: colors.text1, fontSize: 13, fontWeight: '600'},
  histHeight: {color: colors.text3, fontSize: 11, fontFamily: fonts.mono, marginTop: 2},
  empty: {color: colors.text3, textAlign: 'center', padding: 20},
});
