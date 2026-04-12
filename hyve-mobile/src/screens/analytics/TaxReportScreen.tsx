import React, {useState} from 'react';
import {View, Text, StyleSheet, Alert} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Button} from '../../components/Button';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import {fmt, fmtHyve} from '../../utils/format';

export function TaxReportScreen() {
  const [days, setDays] = useState(365);
  const {data, loading, reload} = useApi<any>(`/api/tax-report?days=${days}`);
  const report = data;

  return (
    <ScreenContainer onRefresh={reload}>
      <Card title={`Tax Report — Last ${days} days`} icon="📄">
        <View style={styles.yearRow}>
          <Button
            title="30d"
            onPress={() => setDays(30)}
            variant={days === 30 ? 'primary' : 'secondary'}
            style={styles.yearBtn}
          />
          <Button
            title="90d"
            onPress={() => setDays(90)}
            variant={days === 90 ? 'primary' : 'secondary'}
            style={styles.yearBtn}
          />
          <Button
            title="365d"
            onPress={() => setDays(365)}
            variant={days === 365 ? 'primary' : 'secondary'}
            style={styles.yearBtn}
          />
        </View>
      </Card>

      {report && (
        <>
          <Card title="Summary" icon="💰">
            <View style={styles.row}>
              <MetricCard
                label="Total"
                value={`${fmtHyve(report.total)} HYVE`}
                color={colors.green}
              />
              <MetricCard
                label="Events"
                value={fmt(report.events?.length || 0)}
              />
            </View>
          </Card>

          {report.events && report.events.length > 0 && (
            <Card title="Events" icon="📊">
              {report.events.slice(0, 50).map((ev: any, i: number) => (
                <View key={i} style={styles.monthRow}>
                  <Text style={styles.monthName}>{ev.ts?.split('T')[0] || '—'}</Text>
                  <Text style={styles.monthVal}>
                    {fmtHyve(ev.amount)} HYVE
                  </Text>
                  <Text style={styles.monthTx}>{ev.event}</Text>
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  yearRow: {flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12},
  yearBtn: {paddingHorizontal: 16, paddingVertical: 6},
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  monthName: {flex: 1, color: colors.text2, fontSize: 13},
  monthVal: {color: colors.green, fontSize: 13, fontFamily: 'monospace'},
  monthTx: {color: colors.text3, fontSize: 12, marginLeft: 12, width: 50, textAlign: 'right'},
});
