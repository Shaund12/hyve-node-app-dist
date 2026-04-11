import React from 'react';
import {StatusBar, View, Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {GestureHandlerRootView} from 'react-native-gesture-handler';

import {AuthProvider, useAuth} from './src/context/AuthContext';
import {LoadingView} from './src/components/Layout';
import {ErrorBoundary} from './src/components/ErrorBoundary';
import {colors} from './src/utils/theme';

// Auth screens
import {ConnectScreen} from './src/screens/ConnectScreen';
import {LoginScreen} from './src/screens/LoginScreen';

// Main screens
import {OverviewScreen} from './src/screens/OverviewScreen';
import {MoreScreen} from './src/screens/MoreScreen';

// Staking
import {StakingScreen} from './src/screens/staking/StakingScreen';
import {SigningScreen} from './src/screens/staking/SigningScreen';
import {DelegatorsScreen} from './src/screens/staking/DelegatorsScreen';
import {GovernanceScreen} from './src/screens/staking/GovernanceScreen';

// Analytics
import {RewardsScreen} from './src/screens/analytics/RewardsScreen';
import {EarningsScreen} from './src/screens/analytics/EarningsScreen';
import {ValidatorCompareScreen} from './src/screens/analytics/ValidatorCompareScreen';
import {TimelineScreen} from './src/screens/analytics/TimelineScreen';
import {UptimeScreen} from './src/screens/analytics/UptimeScreen';
import {TaxReportScreen} from './src/screens/analytics/TaxReportScreen';
import {RankHistoryScreen} from './src/screens/analytics/RankHistoryScreen';

// Network
import {NetworkScreen} from './src/screens/network/NetworkScreen';
import {WhaleAlertsScreen} from './src/screens/network/WhaleAlertsScreen';

// Tokens
import {ShadeScreen} from './src/screens/tokens/ShadeScreen';

// Operations
import {UpgradesScreen} from './src/screens/operations/UpgradesScreen';
import {NodeControlScreen} from './src/screens/operations/NodeControlScreen';
import {TxHistoryScreen} from './src/screens/operations/TxHistoryScreen';
import {LogsScreen} from './src/screens/operations/LogsScreen';
import {NotesScreen} from './src/screens/operations/NotesScreen';
import {RpcScreen} from './src/screens/operations/RpcScreen';

// Config
import {SettingsScreen} from './src/screens/config/SettingsScreen';
import {AlertsScreen} from './src/screens/config/AlertsScreen';
import {UpdateScreen} from './src/screens/config/UpdateScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  dark: true,
  colors: {
    primary: colors.cyan,
    background: colors.bg1,
    card: colors.bg2,
    text: colors.text1,
    border: colors.border,
    notification: colors.red,
  },
  fonts: {
    regular: {fontFamily: 'System', fontWeight: '400' as const},
    medium: {fontFamily: 'System', fontWeight: '500' as const},
    bold: {fontFamily: 'System', fontWeight: '700' as const},
    heavy: {fontFamily: 'System', fontWeight: '900' as const},
  },
};

const stackOpts = {
  headerStyle: {backgroundColor: colors.bg2},
  headerTintColor: colors.text1,
};

// --- Staking Tab (sub-tabs) ---
const StakingTab = createBottomTabNavigator();
function StakingTabs() {
  return (
    <StakingTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {backgroundColor: colors.bg2, borderTopColor: colors.border},
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.text3,
      }}>
      <StakingTab.Screen name="Balances" component={StakingScreen} options={{tabBarIcon: () => <Text>💰</Text>, tabBarLabel: 'Balances'}} />
      <StakingTab.Screen name="Signing" component={SigningScreen} options={{tabBarIcon: () => <Text>✍️</Text>, tabBarLabel: 'Signing'}} />
      <StakingTab.Screen name="Delegators" component={DelegatorsScreen} options={{tabBarIcon: () => <Text>👥</Text>, tabBarLabel: 'Delegators'}} />
      <StakingTab.Screen name="Governance" component={GovernanceScreen} options={{tabBarIcon: () => <Text>🗳️</Text>, tabBarLabel: 'Governance'}} />
    </StakingTab.Navigator>
  );
}

// --- Analytics Tab (sub-tabs) ---
const AnalyticsTab = createBottomTabNavigator();
function AnalyticsTabs() {
  return (
    <AnalyticsTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {backgroundColor: colors.bg2, borderTopColor: colors.border},
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.text3,
      }}>
      <AnalyticsTab.Screen name="Rewards" component={RewardsScreen} options={{tabBarIcon: () => <Text>🎁</Text>}} />
      <AnalyticsTab.Screen name="Earnings" component={EarningsScreen} options={{tabBarIcon: () => <Text>💵</Text>}} />
      <AnalyticsTab.Screen name="Rank" component={RankHistoryScreen} options={{tabBarIcon: () => <Text>🏆</Text>}} />
      <AnalyticsTab.Screen name="Compare" component={ValidatorCompareScreen} options={{tabBarIcon: () => <Text>⚖️</Text>}} />
    </AnalyticsTab.Navigator>
  );
}

// --- Operations Tab (sub-tabs) ---
const OpsTab = createBottomTabNavigator();
function OperationsTabs() {
  return (
    <OpsTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {backgroundColor: colors.bg2, borderTopColor: colors.border},
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.text3,
      }}>
      <OpsTab.Screen name="NodeCtrl" component={NodeControlScreen} options={{tabBarIcon: () => <Text>🖥️</Text>, tabBarLabel: 'Node'}} />
      <OpsTab.Screen name="Logs" component={LogsScreen} options={{tabBarIcon: () => <Text>📋</Text>}} />
      <OpsTab.Screen name="Upgrades" component={UpgradesScreen} options={{tabBarIcon: () => <Text>⬆️</Text>}} />
      <OpsTab.Screen name="RPC" component={RpcScreen} options={{tabBarIcon: () => <Text>🔌</Text>}} />
    </OpsTab.Navigator>
  );
}

// --- More Stack (extra screens) ---
function MoreStack() {
  return (
    <Stack.Navigator screenOptions={stackOpts}>
      <Stack.Screen name="MoreMenu" component={MoreScreen} options={{title: 'More'}} />
      <Stack.Screen name="Network" component={NetworkScreen} />
      <Stack.Screen name="SHADE" component={ShadeScreen} options={{title: 'SHADE Token'}} />
      <Stack.Screen name="Timeline" component={TimelineScreen} />
      <Stack.Screen name="Uptime" component={UptimeScreen} />
      <Stack.Screen name="TaxReport" component={TaxReportScreen} options={{title: 'Tax Report'}} />
      <Stack.Screen name="WhaleAlerts" component={WhaleAlertsScreen} options={{title: 'Whale Alerts'}} />
      <Stack.Screen name="Transactions" component={TxHistoryScreen} />
      <Stack.Screen name="Notes" component={NotesScreen} />
      <Stack.Screen name="Alerts" component={AlertsScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="AppUpdate" component={UpdateScreen} options={{title: 'App Update'}} />
    </Stack.Navigator>
  );
}

// --- Main Tab Bar ---
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {backgroundColor: colors.bg2},
        headerTintColor: colors.text1,
        tabBarStyle: {backgroundColor: colors.bg2, borderTopColor: colors.border, paddingBottom: 4, height: 56},
        tabBarActiveTintColor: colors.cyan,
        tabBarInactiveTintColor: colors.text3,
        tabBarLabelStyle: {fontSize: 11},
      }}>
      <Tab.Screen
        name="Overview"
        component={OverviewScreen}
        options={{tabBarIcon: () => <Text>📊</Text>, tabBarLabel: 'Overview'}}
      />
      <Tab.Screen
        name="Staking"
        component={StakingTabs}
        options={{tabBarIcon: () => <Text>💰</Text>, tabBarLabel: 'Staking', headerShown: false}}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsTabs}
        options={{tabBarIcon: () => <Text>📈</Text>, tabBarLabel: 'Analytics', headerShown: false}}
      />
      <Tab.Screen
        name="Ops"
        component={OperationsTabs}
        options={{tabBarIcon: () => <Text>⚙️</Text>, tabBarLabel: 'Ops', headerShown: false}}
      />
      <Tab.Screen
        name="MoreStack"
        component={MoreStack}
        options={{tabBarIcon: () => <Text>☰</Text>, tabBarLabel: 'More', headerShown: false}}
      />
    </Tab.Navigator>
  );
}

// --- Auth Gate ---

function AuthGate() {
  const {state} = useAuth();

  if (state === 'loading') return <LoadingView message="Loading..." />;
  if (state === 'unconfigured') return <ConnectScreen />;
  if (state === 'unauthenticated') return <LoginScreen />;
  return <MainTabs />;
}

// --- Root ---

function App() {
  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg1} />
        <ErrorBoundary>
          <AuthProvider>
            <NavigationContainer theme={navTheme}>
              <AuthGate />
            </NavigationContainer>
          </AuthProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;

