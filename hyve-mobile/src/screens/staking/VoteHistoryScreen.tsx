import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {Badge} from '../../components/Badge';
import {LoadingView, ErrorView} from '../../components/Layout';
import {useApi} from '../../hooks/useApi';
import {colors, fonts} from '../../utils/theme';
import {timeAgo} from '../../utils/format';

const voteColor: Record<string, string> = {
  yes: colors.green,
  no: colors.red,
  abstain: colors.text3,
  no_with_veto: colors.orange,
};

export function VoteHistoryScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/governance-votes');
  const votes: any[] = data?.votes || [];

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;

  return (
    <ScreenContainer onRefresh={reload}>
      {votes.length === 0 ? (
        <Card title="Vote History" icon="🗳">
          <Text style={styles.empty}>No governance votes recorded yet</Text>
        </Card>
      ) : (
        votes.map((v: any, i: number) => (
          <Card key={i}>
            <View style={styles.headerRow}>
              <Text style={styles.propId}>#{v.proposal_id}</Text>
              <Badge
                label={v.option || '—'}
                severity={v.option === 'yes' ? 'success' : v.option === 'no' ? 'error' : 'warning'}
              />
            </View>
            {v.title && <Text style={styles.title}>{v.title}</Text>}
            <Text style={styles.time}>{v.ts ? timeAgo(v.ts) : '—'}</Text>
          </Card>
        ))
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6},
  propId: {color: colors.text3, fontSize: 13, fontFamily: fonts.mono, fontWeight: '600'},
  title: {color: colors.text1, fontSize: 14, fontWeight: '600'},
  time: {color: colors.text3, fontSize: 11, marginTop: 6},
  empty: {color: colors.text3, textAlign: 'center', padding: 20, fontSize: 13},
});
