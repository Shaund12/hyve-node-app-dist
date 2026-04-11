import React, {useState} from 'react';
import {View, Text, TextInput, Switch, StyleSheet, Alert} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Button} from '../../components/Button';
import {Badge} from '../../components/Badge';
import {useAuth} from '../../context/AuthContext';
import {useApi} from '../../hooks/useApi';
import {colors} from '../../utils/theme';
import * as api from '../../api/client';

export function SettingsScreen() {
  const {logout, serverUrl} = useAuth();
  const {data: alertCfg, reload: reloadAlerts} = useApi<any>('/api/alert-config');
  const {data: discordCfg} = useApi<any>('/api/notifications/config');
  const {data: autoCmp, reload: reloadAuto} = useApi<any>('/api/auto-compound');
  const {data: txStatus} = useApi<any>('/api/tx/status');

  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const changePw = async () => {
    if (newPw.length < 8) {
      Alert.alert('Error', 'New password must be at least 8 characters');
      return;
    }
    setChangingPw(true);
    try {
      const r = await api.post('/api/auth/change-password', {current_password: curPw, new_password: newPw});
      if (r.ok) {
        Alert.alert('Success', 'Password changed');
        setCurPw('');
        setNewPw('');
      } else {
        Alert.alert('Error', r.error || 'Failed');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setChangingPw(false);
    }
  };

  const toggleAutoCompound = async () => {
    try {
      await api.post('/api/auto-compound', {
        enabled: !autoCmp?.enabled,
        threshold: autoCmp?.threshold || 10,
        interval_hours: autoCmp?.interval_hours || 24,
      });
      reloadAuto();
    } catch {}
  };

  return (
    <ScreenContainer>
      <Card title="Connection" icon="🔗">
        <Text style={styles.label}>Server</Text>
        <Text style={styles.serverUrl}>{serverUrl}</Text>
        <View style={{marginTop: 12}}>
          <Badge
            label={txStatus?.key_configured ? 'Signing Active' : 'Read-Only Mode'}
            severity={txStatus?.key_configured ? 'success' : 'warning'}
          />
        </View>
      </Card>

      <Card title="Change Password" icon="🔒">
        <TextInput
          style={styles.input}
          placeholder="Current password"
          placeholderTextColor={colors.text3}
          value={curPw}
          onChangeText={setCurPw}
          secureTextEntry
        />
        <TextInput
          style={styles.input}
          placeholder="New password (min 8 chars)"
          placeholderTextColor={colors.text3}
          value={newPw}
          onChangeText={setNewPw}
          secureTextEntry
        />
        <Button title="Change Password" onPress={changePw} loading={changingPw} variant="secondary" />
      </Card>

      {alertCfg && (
        <Card title="Alert Thresholds" icon="🚨">
          <View style={styles.row}>
            <MetricCard label="Missed Warn" value={alertCfg.missed_blocks_warn} />
            <MetricCard label="Missed Crit" value={alertCfg.missed_blocks_crit} />
          </View>
          <View style={[styles.row, {marginTop: 8}]}>
            <MetricCard label="Uptime Warn" value={`${alertCfg.uptime_warn}%`} />
            <MetricCard label="Low Balance" value={`${alertCfg.low_balance} HYVE`} />
          </View>
        </Card>
      )}

      {autoCmp && (
        <Card title="Auto-Compound" icon="♻️">
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Enabled</Text>
            <Switch
              value={autoCmp.enabled}
              onValueChange={toggleAutoCompound}
              trackColor={{false: colors.bg3, true: colors.cyan}}
            />
          </View>
          <View style={[styles.row, {marginTop: 8}]}>
            <MetricCard label="Threshold" value={`${autoCmp.threshold} HYVE`} />
            <MetricCard label="Interval" value={`${autoCmp.interval_hours}h`} />
          </View>
        </Card>
      )}

      <Card title="Discord Notifications" icon="💬">
        <Badge
          label={discordCfg?.discord?.configured ? (discordCfg.discord.enabled ? 'Active' : 'Disabled') : 'Not Configured'}
          severity={discordCfg?.discord?.enabled ? 'success' : 'warning'}
        />
      </Card>

      <Button title="Sign Out" onPress={logout} variant="danger" style={{marginTop: 8}} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  label: {color: colors.text3, fontSize: 11, textTransform: 'uppercase', marginBottom: 4},
  serverUrl: {color: colors.cyan, fontSize: 13, fontFamily: 'monospace'},
  input: {
    backgroundColor: colors.bg3,
    borderRadius: 8,
    padding: 12,
    color: colors.text1,
    fontSize: 14,
    marginBottom: 8,
  },
  switchRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  switchLabel: {color: colors.text1, fontSize: 14},
});
