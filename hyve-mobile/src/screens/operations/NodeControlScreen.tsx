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
import {fmt} from '../../utils/format';
import * as api from '../../api/client';

export function NodeControlScreen() {
  const {data, loading, error, reload} = useApi<any>('/api/status', 5000);
  const {data: system} = useApi<any>('/api/system', 10000);
  const {data: disk} = useApi<any>('/api/disk-forecast');
  const [acting, setActing] = useState(false);

  if (loading && !data) return <LoadingView />;
  if (error) return <ErrorView message={error} onRetry={reload} />;
  if (!data) return null;

  const nodeAction = (action: string) => {
    const labels: Record<string, string> = {start: 'Start', stop: 'Stop', restart: 'Restart'};
    Alert.alert(`${labels[action]} Node`, `${labels[action]} the hyved process?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: labels[action],
        style: action === 'stop' ? 'destructive' : 'default',
        onPress: async () => {
          setActing(true);
          try {
            const r = await api.post(`/api/node/${action}`);
            Alert.alert(r.ok ? 'Done' : 'Error', r.ok ? `Node ${action}ed` : r.error || 'Failed');
            setTimeout(reload, 2000);
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <Card title="Node Process" icon="🖥">
        <View style={styles.row}>
          <Badge label={data.running ? 'Running' : 'Stopped'} severity={data.running ? 'success' : 'error'} />
        </View>
        {data.process && (
          <View style={[styles.row, {marginTop: 12}]}>
            <MetricCard label="PID" value={data.process.pid || '—'} mono />
            <MetricCard label="CPU" value={`${(data.process.cpu_percent || 0).toFixed(1)}%`} />
            <MetricCard label="Memory" value={`${(data.process.memory_mb || 0).toFixed(0)} MB`} />
          </View>
        )}
        <View style={[styles.row, {marginTop: 16}]}>
          <Button title="Start" onPress={() => nodeAction('start')} disabled={data.running} loading={acting} style={{flex: 1}} />
          <Button title="Restart" onPress={() => nodeAction('restart')} variant="secondary" loading={acting} style={{flex: 1}} />
          <Button title="Stop" onPress={() => nodeAction('stop')} disabled={!data.running} variant="danger" loading={acting} style={{flex: 1}} />
        </View>
      </Card>

      {system && (
        <Card title="System Resources" icon="📊">
          <View style={styles.row}>
            <MetricCard label="CPU" value={`${(system.cpu?.avg || 0).toFixed(1)}%`} color={system.cpu?.avg > 80 ? colors.red : colors.green} />
            <MetricCard label="Memory" value={`${(system.memory?.used_gb || 0).toFixed(1)} GB`} />
            <MetricCard label="Disk" value={`${(system.disk?.pct || 0).toFixed(1)}%`} color={system.disk?.pct > 90 ? colors.red : colors.green} />
          </View>
        </Card>
      )}

      {disk && (
        <Card title="Disk Forecast" icon="💾">
          <View style={styles.row}>
            <MetricCard label="Current" value={`${(disk.current?.pct || 0).toFixed(1)}%`} />
            <MetricCard label="Growth/Day" value={`${(disk.growth_per_day_pct || 0).toFixed(3)}%`} />
            <MetricCard label="Days Until Full" value={disk.forecast_days != null && disk.forecast_days > 0 ? fmt(Math.round(disk.forecast_days)) : '∞'} color={disk.forecast_days != null && disk.forecast_days < 30 ? colors.red : colors.green} />
          </View>
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
});
