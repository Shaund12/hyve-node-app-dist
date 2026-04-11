import React, {useState} from 'react';
import {View, Text, TextInput, StyleSheet, KeyboardAvoidingView} from 'react-native';
import {useAuth} from '../context/AuthContext';
import {Button} from '../components/Button';
import {colors} from '../utils/theme';

export function LoginScreen() {
  const {login, serverUrl, setServer} = useAuth();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    if (!password) {
      setError('Enter your password');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const ok = await login(username, password);
      if (!ok) setError('Invalid credentials');
    } catch {
      setError('Login failed. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior="padding">
      <View style={styles.inner}>
        <Text style={styles.logo}>⬡</Text>
        <Text style={styles.title}>Hyve Validator</Text>
        <Text style={styles.server}>{serverUrl}</Text>

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.text3}
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.text3}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button title="Sign In" onPress={doLogin} loading={loading} style={{marginTop: 4}} />
        <Text style={styles.change} onPress={() => setServer('')}>
          Change server
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
  inner: {padding: 32},
  logo: {fontSize: 48, color: colors.cyan, textAlign: 'center', marginBottom: 8},
  title: {fontSize: 24, fontWeight: '700', color: colors.text1, textAlign: 'center'},
  server: {fontSize: 12, color: colors.text3, textAlign: 'center', marginBottom: 24, marginTop: 4},
  input: {
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 14,
    color: colors.text1,
    fontSize: 15,
    marginBottom: 10,
  },
  error: {color: colors.red, fontSize: 12, marginBottom: 8},
  change: {color: colors.text3, fontSize: 12, textAlign: 'center', marginTop: 20},
});
