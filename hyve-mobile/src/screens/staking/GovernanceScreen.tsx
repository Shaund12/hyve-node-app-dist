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
import {fmt, fmtHyve, timeAgo} from '../../utils/format';
import * as api from '../../api/client';

export function GovernanceScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/governance');
  const [voting, setVoting] = useState<string | null>(null);

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  const proposals = data?.proposals || [];

  const vote = (id: string, option: string) => {
    Alert.alert('Vote', `Vote ${option} on proposal #${id}?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Confirm',
        onPress: async () => {
          setVoting(id);
          try {
            const r = await api.post('/api/tx/vote', {proposal_id: id, option});
            Alert.alert(r.ok ? 'Voted!' : 'Error', r.ok ? `Voted ${option} on #${id}` : r.error || 'Failed');
            reload();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setVoting(null);
          }
        },
      },
    ]);
  };

  const statusSeverity = (s: string) => {
    if (s.includes('VOTING')) return 'info';
    if (s.includes('PASSED')) return 'success';
    if (s.includes('REJECTED')) return 'error';
    return 'warning';
  };

  return (
    <ScreenContainer>
      {proposals.map((p: any) => (
        <Card key={p.id}>
          <View style={styles.headerRow}>
            <Text style={styles.propId}>#{p.id}</Text>
            <Badge label={p.status?.replace('PROPOSAL_STATUS_', '') || '—'} severity={statusSeverity(p.status)} />
          </View>
          <Text style={styles.title}>{p.title}</Text>
          {p.summary && <Text style={styles.summary} numberOfLines={3}>{p.summary}</Text>}

          {p.voting_end_time && (
            <Text style={styles.meta}>Voting ends: {new Date(p.voting_end_time).toISOString().split('T')[0]}</Text>
          )}

          {p.my_vote && (
            <View style={{marginTop: 6}}>
              <Badge label={`Voted: ${p.my_vote}`} severity="success" />
            </View>
          )}

          {p.tally && (
            <View style={[styles.row, {marginTop: 8}]}>
              <MetricCard label="Yes" value={fmtHyve(p.tally.yes || 0, 0)} color={colors.green} />
              <MetricCard label="No" value={fmtHyve(p.tally.no || 0, 0)} color={colors.red} />
              <MetricCard label="Abstain" value={fmtHyve(p.tally.abstain || 0, 0)} />
            </View>
          )}

          {p.status?.includes('VOTING') && !p.my_vote && (
            <View style={[styles.row, {marginTop: 12}]}>
              <Button title="Yes" onPress={() => vote(p.id, 'yes')} loading={voting === p.id} style={{flex: 1}} />
              <Button title="No" onPress={() => vote(p.id, 'no')} variant="danger" loading={voting === p.id} style={{flex: 1}} />
              <Button title="Abstain" onPress={() => vote(p.id, 'abstain')} variant="secondary" loading={voting === p.id} style={{flex: 1}} />
            </View>
          )}
        </Card>
      ))}
      {proposals.length === 0 && (
        <Card><Text style={styles.empty}>No proposals found</Text></Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 8},
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8},
  propId: {color: colors.text3, fontSize: 13, fontFamily: fonts.mono, fontWeight: '600'},
  title: {color: colors.text1, fontSize: 15, fontWeight: '700'},
  summary: {color: colors.text2, fontSize: 12, marginTop: 4, lineHeight: 18},
  meta: {color: colors.text3, fontSize: 11, marginTop: 6},
  empty: {color: colors.text3, textAlign: 'center', padding: 20, fontSize: 13},
});
