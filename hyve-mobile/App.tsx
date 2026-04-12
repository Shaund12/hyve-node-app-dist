import React from 'react';
import {StatusBar, View, Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createMaterialTopTabNavigator} from '@react-navigation/material-top-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/Ionicons';

import {AuthProvider, useAuth} from './src/context/AuthContext';
import {LoadingView} from './src/components/Layout';
import {ErrorBoundary} from './src/components/ErrorBoundary';
import {ConnectionBanner} from './src/components/ConnectionBanner';
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
import {VoteHistoryScreen} from './src/screens/staking/VoteHistoryScreen';

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
import {AlertHistoryScreen} from './src/screens/config/AlertHistoryScreen';
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
const StakingTab = createMaterialTopTabNavigator();
function StakingTabs() {
  return (
    <View style={{flex: 1, backgroundColor: colors.bg1}}>
      <StakingTab.Navigator
        screenOptions={{
          tabBarStyle: {backgroundColor: colors.bg2, elevation: 0, shadowOpacity: 0},
          tabBarActiveTintColor: colors.cyan,
          tabBarInactiveTintColor: colors.text3,
          tabBarIndicatorStyle: {backgroundColor: colors.cyan, height: 2},
          tabBarLabelStyle: {fontSize: 12, fontWeight: '600', textTransform: 'none'},
          tabBarItemStyle: {padding: 0},
          swipeEnabled: true,
        }}>
        <StakingTab.Screen name="Balances" component={StakingScreen} />
        <StakingTab.Screen name="Signing" component={SigningScreen} />
        <StakingTab.Screen name="Delegators" component={DelegatorsScreen} />
        <StakingTab.Screen name="Governance" component={GovernanceScreen} />
        <StakingTab.Screen name="Votes" component={VoteHistoryScreen} />
      </StakingTab.Navigator>
    </View>
  );
}

// --- Analytics Tab (sub-tabs) ---
const AnalyticsTab = createMaterialTopTabNavigator();
function AnalyticsTabs() {
  return (
    <View style={{flex: 1, backgroundColor: colors.bg1}}>
      <AnalyticsTab.Navigator
        screenOptions={{
          tabBarStyle: {backgroundColor: colors.bg2, elevation: 0, shadowOpacity: 0},
          tabBarActiveTintColor: colors.cyan,
          tabBarInactiveTintColor: colors.text3,
          tabBarIndicatorStyle: {backgroundColor: colors.cyan, height: 2},
          tabBarLabelStyle: {fontSize: 12, fontWeight: '600', textTransform: 'none'},
          tabBarItemStyle: {padding: 0},
          tabBarScrollEnabled: true,
          swipeEnabled: true,
        }}>
        <AnalyticsTab.Screen name="Rewards" component={RewardsScreen} />
        <AnalyticsTab.Screen name="Earnings" component={EarningsScreen} />
        <AnalyticsTab.Screen name="Rank" component={RankHistoryScreen} />
        <AnalyticsTab.Screen name="Compare" component={ValidatorCompareScreen} />
      </AnalyticsTab.Navigator>
    </View>
  );
}

// --- Operations Tab (sub-tabs) ---
const OpsTab = createMaterialTopTabNavigator();
function OperationsTabs() {
  return (
    <View style={{flex: 1, backgroundColor: colors.bg1}}>
      <OpsTab.Navigator
        screenOptions={{
          tabBarStyle: {backgroundColor: colors.bg2, elevation: 0, shadowOpacity: 0},
          tabBarActiveTintColor: colors.cyan,
          tabBarInactiveTintColor: colors.text3,
          tabBarIndicatorStyle: {backgroundColor: colors.cyan, height: 2},
          tabBarLabelStyle: {fontSize: 12, fontWeight: '600', textTransform: 'none'},
          tabBarItemStyle: {padding: 0},
          swipeEnabled: true,
        }}>
        <OpsTab.Screen name="Node" component={NodeControlScreen} />
        <OpsTab.Screen name="Logs" component={LogsScreen} />
        <OpsTab.Screen name="Upgrades" component={UpgradesScreen} />
        <OpsTab.Screen name="RPC" component={RpcScreen} />
      </OpsTab.Navigator>
    </View>
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
      <Stack.Screen name="AlertHistory" component={AlertHistoryScreen} options={{title: 'Alert History'}} />
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
        options={{tabBarIcon: ({color, size}) => <Icon name="pulse-outline" size={size} color={color} />, tabBarLabel: 'Overview'}}
      />
      <Tab.Screen
        name="Staking"
        component={StakingTabs}
        options={{tabBarIcon: ({color, size}) => <Icon name="layers-outline" size={size} color={color} />, tabBarLabel: 'Staking'}}
      />
      <Tab.Screen
        name="Analytics"
        component={AnalyticsTabs}
        options={{tabBarIcon: ({color, size}) => <Icon name="trending-up-outline" size={size} color={color} />, tabBarLabel: 'Analytics'}}
      />
      <Tab.Screen
        name="Ops"
        component={OperationsTabs}
        options={{tabBarIcon: ({color, size}) => <Icon name="construct-outline" size={size} color={color} />, tabBarLabel: 'Ops'}}
      />
      <Tab.Screen
        name="MoreStack"
        component={MoreStack}
        options={{tabBarIcon: ({color, size}) => <Icon name="ellipsis-horizontal" size={size} color={color} />, tabBarLabel: 'More', headerShown: false}}
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
              <ConnectionBanner />
              <AuthGate />
            </NavigationContainer>
          </AuthProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;

