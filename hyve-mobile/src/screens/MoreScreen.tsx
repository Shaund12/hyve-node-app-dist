import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import {colors} from '../utils/theme';

const menuItems = [
  {icon: 'globe-outline', label: 'Network', screen: 'Network'},
  {icon: 'diamond-outline', label: 'SHADE Token', screen: 'SHADE'},
  {icon: 'time-outline', label: 'Timeline', screen: 'Timeline'},
  {icon: 'checkmark-circle-outline', label: 'Uptime', screen: 'Uptime'},
  {icon: 'document-text-outline', label: 'Tax Report', screen: 'TaxReport'},
  {icon: 'fish-outline', label: 'Whale Alerts', screen: 'WhaleAlerts'},
  {icon: 'receipt-outline', label: 'Transactions', screen: 'Transactions'},
  {icon: 'create-outline', label: 'Notes', screen: 'Notes'},
  {icon: 'notifications-outline', label: 'Alerts', screen: 'Alerts'},
  {icon: 'alert-circle-outline', label: 'Alert History', screen: 'AlertHistory'},
  {icon: 'settings-outline', label: 'Settings', screen: 'Settings'},
  {icon: 'download-outline', label: 'App Update', screen: 'AppUpdate'},
];

export function MoreScreen() {
  const nav = useNavigation<any>();

  return (
    <ScrollView style={styles.container}>
      {menuItems.map(item => (
        <TouchableOpacity
          key={item.screen}
          style={styles.row}
          onPress={() => nav.navigate(item.screen)}
          activeOpacity={0.6}>
          <Icon name={item.icon} size={22} color={colors.cyan} style={styles.icon} />
          <Text style={styles.label}>{item.label}</Text>
          <Icon name="chevron-forward" size={18} color={colors.text3} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.bg1},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  icon: {marginRight: 14, width: 28, textAlign: 'center'},
  label: {flex: 1, fontSize: 16, color: colors.text1},
});
