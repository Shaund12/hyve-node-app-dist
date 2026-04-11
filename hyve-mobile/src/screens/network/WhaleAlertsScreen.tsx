import React from 'react';
import {View, Text, FlatList, StyleSheet} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import {fmtHyve, timeAgo, shortenAddr} from '../../utils/format';

export function WhaleAlertsScreen() {
  const {data} = useApi<any>('/api/whale-alerts', 30000);
  const alerts = data?.events || [];

  return (
    <ScreenContainer>
      <Card title="Recent Whale Events" icon="📡">
        {alerts.length === 0 ? (
          <Text style={styles.empty}>No whale transactions detected</Text>
        ) : (
          alerts.map((a: any, i: number) => (
            <View key={i} style={styles.alertRow}>
              <View style={styles.alertHeader}>
                <Badge
                  label={a.type || 'delegation'}
                  severity={
                    a.type === 'undelegation' ? 'warning' :
                    a.type === 'redelegate' ? 'info' : 'success'
                  }
                />
                <Text style={styles.time}>{timeAgo(a.ts)}</Text>
              </View>
              <View style={styles.alertBody}>
                <Text style={styles.amount}>{fmtHyve(a.amount)} HYVE</Text>
                <Text style={styles.addr} numberOfLines={1}>
                  {a.delegator ? shortenAddr(a.delegator) : 'Unknown'}
                </Text>
              </View>
              {a.from_validator && (
                <Text style={styles.detail}>
                  From: {a.from_validator_moniker || shortenAddr(a.from_validator)}
                </Text>
              )}
              {a.to_validator && (
                <Text style={styles.detail}>
                  To: {a.to_validator_moniker || shortenAddr(a.to_validator)}
                </Text>
              )}
            </View>
          ))
        )}
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {color: colors.text3, textAlign: 'center', paddingVertical: 20},
  alertRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  time: {color: colors.text3, fontSize: 11},
  alertBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  amount: {color: colors.green, fontSize: 14, fontWeight: '600', fontFamily: 'monospace'},
  addr: {color: colors.text3, fontSize: 12, fontFamily: 'monospace', maxWidth: 150},
  detail: {color: colors.text3, fontSize: 11, marginTop: 2},
});
