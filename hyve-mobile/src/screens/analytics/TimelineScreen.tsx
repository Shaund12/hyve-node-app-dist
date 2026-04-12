import React from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import {timeAgo, fmtHyve} from '../../utils/format';

export function TimelineScreen() {
  const {data, reload} = useApi<any>('/api/timeline');
  const events = data?.events || [];

  const iconFor = (type: string) => {
    switch (type) {
      case 'reward': return '💰';
      case 'delegation': return '📥';
      case 'undelegation': return '📤';
      case 'vote': return '🗳️';
      case 'slash': return '⚠️';
      case 'commission': return '💎';
      case 'compound': return '♻️';
      default: return '📌';
    }
  };

  const severityFor = (type: string): 'success' | 'warning' | 'error' | 'info' => {
    switch (type) {
      case 'slash': return 'error';
      case 'undelegation': return 'warning';
      case 'reward':
      case 'compound':
      case 'delegation': return 'success';
      default: return 'info';
    }
  };

  return (
    <ScreenContainer onRefresh={reload}>
      <Card title="Activity Timeline" icon="📅">
        {events.length === 0 ? (
          <Text style={styles.empty}>No activity recorded yet</Text>
        ) : (
          events.map((ev: any, i: number) => (
            <View key={i} style={styles.evRow}>
              <View style={styles.timeline}>
                <Text style={styles.icon}>{iconFor(ev.type)}</Text>
                {i < events.length - 1 && <View style={styles.connector} />}
              </View>
              <View style={styles.evContent}>
                <View style={styles.evHeader}>
                  <Badge label={ev.type} severity={severityFor(ev.type)} />
                  <Text style={styles.time}>{timeAgo(ev.ts)}</Text>
                </View>
                <Text style={styles.desc} numberOfLines={2}>
                  {ev.title || ev.detail || ev.type}
                </Text>
                {ev.amount != null && (
                  <Text style={styles.amount}>{fmtHyve(ev.amount)} HYVE</Text>
                )}
              </View>
            </View>
          ))
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {color: colors.text3, textAlign: 'center', paddingVertical: 20},
  evRow: {flexDirection: 'row', marginBottom: 4},
  timeline: {width: 32, alignItems: 'center'},
  icon: {fontSize: 16, marginBottom: 4},
  connector: {width: 2, flex: 1, backgroundColor: colors.bg3},
  evContent: {flex: 1, paddingLeft: 8, paddingBottom: 12},
  evHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4},
  time: {color: colors.text3, fontSize: 11},
  desc: {color: colors.text2, fontSize: 13},
  amount: {color: colors.cyan, fontSize: 12, fontFamily: 'monospace', marginTop: 2},
});
