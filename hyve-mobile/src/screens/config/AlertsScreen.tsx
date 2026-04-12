import React, {useState} from 'react';
import {View, Text, TextInput, Switch, StyleSheet, Alert, ScrollView} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Button} from '../../components/Button';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import * as api from '../../api/client';

export function AlertsScreen() {
  const {data: alertCfg, reload} = useApi<any>('/api/alert-config');
  const {data: notifCfg, reload: reloadNotif} = useApi<any>('/api/notifications/config');
  const [saving, setSaving] = useState(false);

  const [missedWarn, setMissedWarn] = useState('');
  const [missedCrit, setMissedCrit] = useState('');
  const [uptimeWarn, setUptimeWarn] = useState('');
  const [lowBal, setLowBal] = useState('');

  // Sync state from API
  React.useEffect(() => {
    if (alertCfg) {
      setMissedWarn(String(alertCfg.missed_blocks_warn ?? ''));
      setMissedCrit(String(alertCfg.missed_blocks_crit ?? ''));
      setUptimeWarn(String(alertCfg.uptime_warn ?? ''));
      setLowBal(String(alertCfg.low_balance ?? ''));
    }
  }, [alertCfg]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const r = await api.post('/api/alert-config', {
        missed_blocks_warn: parseInt(missedWarn) || 10,
        missed_blocks_crit: parseInt(missedCrit) || 50,
        uptime_warn: parseFloat(uptimeWarn) || 95,
        low_balance: parseFloat(lowBal) || 1,
      });
      if (r.ok) {
        Alert.alert('Success', 'Alert config saved');
        reload();
      } else {
        Alert.alert('Error', r.error || 'Failed');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const testDiscord = async () => {
    try {
      const r = await api.post('/api/notifications/test', {});
      Alert.alert(r.ok ? 'Success' : 'Error', r.ok ? 'Test notification sent' : r.error || 'Failed');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const refreshAll = async () => { await reload(); await reloadNotif(); };

  return (
    <ScreenContainer onRefresh={refreshAll}>
      <Card title="Alert Thresholds" icon="🚨">
        <View style={styles.field}>
          <Text style={styles.label}>Missed Blocks (Warning)</Text>
          <TextInput
            style={styles.input}
            value={missedWarn}
            onChangeText={setMissedWarn}
            keyboardType="numeric"
            placeholderTextColor={colors.text3}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Missed Blocks (Critical)</Text>
          <TextInput
            style={styles.input}
            value={missedCrit}
            onChangeText={setMissedCrit}
            keyboardType="numeric"
            placeholderTextColor={colors.text3}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Uptime Warning (%)</Text>
          <TextInput
            style={styles.input}
            value={uptimeWarn}
            onChangeText={setUptimeWarn}
            keyboardType="decimal-pad"
            placeholderTextColor={colors.text3}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Low Balance (HYVE)</Text>
          <TextInput
            style={styles.input}
            value={lowBal}
            onChangeText={setLowBal}
            keyboardType="decimal-pad"
            placeholderTextColor={colors.text3}
          />
        </View>
        <Button title="Save Config" onPress={saveConfig} loading={saving} />
      </Card>

      <Card title="Discord Notifications" icon="💬">
        <Badge
          label={
            notifCfg?.discord?.configured
              ? notifCfg.discord.enabled
                ? 'Active'
                : 'Disabled'
              : 'Not Configured'
          }
          severity={notifCfg?.discord?.enabled ? 'success' : 'warning'}
        />
        {notifCfg?.discord?.configured && (
          <View style={{marginTop: 12}}>
            <Button
              title="Send Test Notification"
              onPress={testDiscord}
              variant="secondary"
            />
          </View>
        )}
      </Card>

      {alertCfg && (
        <Card title="Active Alerts" icon="⚡">
          {(alertCfg.active_alerts || []).length === 0 ? (
            <Text style={styles.noAlerts}>No active alerts</Text>
          ) : (
            (alertCfg.active_alerts || []).map((a: any, i: number) => (
              <View key={i} style={styles.alertRow}>
                <Badge label={a.severity || 'warning'} severity={a.severity || 'warning'} />
                <Text style={styles.alertMsg}>{a.message}</Text>
              </View>
            ))
          )}
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  field: {marginBottom: 12},
  label: {color: colors.text3, fontSize: 11, textTransform: 'uppercase', marginBottom: 4},
  input: {
    backgroundColor: colors.bg3,
    borderRadius: 8,
    padding: 12,
    color: colors.text1,
    fontSize: 14,
  },
  row: {flexDirection: 'row', gap: 12},
  noAlerts: {color: colors.text3, textAlign: 'center', paddingVertical: 12},
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg3,
  },
  alertMsg: {flex: 1, color: colors.text2, fontSize: 13},
});
