import React, {Component, ReactNode} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {hasError: false, error: ''};

  static getDerivedStateFromError(error: Error) {
    return {hasError: true, error: error.message || 'Unknown error'};
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.icon}>⚠️</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.msg}>{this.state.error}</Text>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => this.setState({hasError: false, error: ''})}>
            <Text style={styles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0f1923', justifyContent: 'center', alignItems: 'center', padding: 32},
  icon: {fontSize: 48, marginBottom: 16},
  title: {fontSize: 20, fontWeight: '700', color: '#e2e8f0', marginBottom: 8},
  msg: {fontSize: 13, color: '#94a3b8', textAlign: 'center', marginBottom: 24},
  btn: {backgroundColor: '#06b6d4', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8},
  btnText: {color: '#fff', fontWeight: '600', fontSize: 14},
});
