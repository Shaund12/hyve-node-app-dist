import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {colors} from '../utils/theme';

const menuItems = [
  {icon: '🌐', label: 'Network', screen: 'Network'},
  {icon: '🟣', label: 'SHADE Token', screen: 'SHADE'},
  {icon: '📅', label: 'Timeline', screen: 'Timeline'},
  {icon: '🗓️', label: 'Uptime', screen: 'Uptime'},
  {icon: '📄', label: 'Tax Report', screen: 'TaxReport'},
  {icon: '🐋', label: 'Whale Alerts', screen: 'WhaleAlerts'},
  {icon: '📜', label: 'Transactions', screen: 'Transactions'},
  {icon: '📝', label: 'Notes', screen: 'Notes'},
  {icon: '🚨', label: 'Alerts', screen: 'Alerts'},
  {icon: '⚙️', label: 'Settings', screen: 'Settings'},
  {icon: '⬇️', label: 'App Update', screen: 'AppUpdate'},
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
          <Text style={styles.icon}>{item.icon}</Text>
          <Text style={styles.label}>{item.label}</Text>
          <Text style={styles.arrow}>›</Text>
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
  icon: {fontSize: 20, marginRight: 14, width: 28},
  label: {flex: 1, fontSize: 16, color: colors.text1},
  arrow: {fontSize: 22, color: colors.text3},
});
