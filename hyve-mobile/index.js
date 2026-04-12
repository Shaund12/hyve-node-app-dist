/**
 * @format
 */

// MUST be first import — required by @react-navigation/drawer
import 'react-native-gesture-handler';

import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// Catch unhandled JS errors so they show in ErrorBoundary instead of hard crashing
const defaultHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  console.error('Global error:', error?.message || error);
  if (defaultHandler) defaultHandler(error, isFatal);
});

LogBox.ignoreAllLogs(true);

AppRegistry.registerComponent(appName, () => App);
