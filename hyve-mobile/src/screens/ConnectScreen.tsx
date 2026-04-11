import React, {useState} from 'react';
import {View, Text, TextInput, StyleSheet, KeyboardAvoidingView} from 'react-native';
import {useAuth} from '../context/AuthContext';
import {Button} from '../components/Button';
import {colors} from '../utils/theme';

export function ConnectScreen() {
  const {setServer} = useAuth();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const connect = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Enter your dashboard URL');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const testUrl = trimmed.replace(/\/$/, '');
      const res = await fetch(`${testUrl}/api/auth/check`, {
        method: 'GET',
        headers: {'Content-Type': 'application/json'},
      });
      if (res.ok || res.status === 401) {
        await setServer(testUrl);
      } else {
        setError('Could not reach dashboard at this URL');
      }
    } catch {
      setError('Connection failed. Check the URL and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View style={styles.inner}>
        <Text style={styles.logo}>⬡</Text>
        <Text style={styles.title}>Hyve Validator</Text>
        <Text style={styles.subtitle}>Connect to your dashboard</Text>

        <TextInput
          style={styles.input}
          placeholder="https://your-server:8420"
          placeholderTextColor={colors.text3}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Connect" onPress={connect} loading={loading} style={{marginTop: 8}} />
        <Text style={styles.hint}>
          Enter the URL of your Hyve Validator Dashboard.{'\n'}
          The dashboard must be running and accessible from this device.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg1,
    justifyContent: 'center',
  },
  inner: {
    padding: 32,
  },
  logo: {
    fontSize: 48,
    color: colors.cyan,
    textAlign: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text1,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: colors.text2,
    textAlign: 'center',
    marginBottom: 32,
    marginTop: 4,
  },
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    color: colors.text1,
    fontSize: 15,
    marginBottom: 8,
  },
  error: {
    color: colors.red,
    fontSize: 12,
    marginBottom: 8,
  },
  hint: {
    color: colors.text3,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 16,
  },
});
