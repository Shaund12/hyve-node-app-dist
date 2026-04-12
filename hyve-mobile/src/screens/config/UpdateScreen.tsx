import React, {useState, useEffect, useCallback} from 'react';
import {View, Text, StyleSheet, Alert, Linking} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {MetricCard} from '../../components/MetricCard';
import {Badge} from '../../components/Badge';
import {Button} from '../../components/Button';
import {LoadingView} from '../../components/Layout';
import {colors, fonts} from '../../utils/theme';

const CURRENT_VERSION = '1.4';
const UPDATE_BASE_URL = 'https://validator.pyvendr.com';
const VERSION_URL = `${UPDATE_BASE_URL}/mobile/version.json`;

function compareVersions(current: string, remote: string): number {
  const a = current.split('.').map(Number);
  const b = remote.split('.').map(Number);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function UpdateScreen() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkError, setCheckError] = useState('');
  const [downloading, setDownloading] = useState(false);

  const checkForUpdate = useCallback(async () => {
    setLoading(true);
    setCheckError('');
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(VERSION_URL, {signal: controller.signal});
      clearTimeout(timer);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const json = await res.json();
      json.available = !!(json.version && json.url);
      setData(json);
    } catch (e: any) {
      setCheckError(e.name === 'AbortError' ? 'Request timed out' : e.message || 'Failed to check for updates');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkForUpdate();
  }, [checkForUpdate]);

  const downloadApk = useCallback(async () => {
    const apkUrl = data?.url;

    Alert.alert(
      'Download Update',
      `Download version ${data?.version}?\n\nThe APK will open in your browser for download and installation.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Download',
          onPress: async () => {
            setDownloading(true);
            try {
              await Linking.openURL(apkUrl);
            } catch (e: any) {
              Alert.alert('Error', e.message || 'Download failed');
            } finally {
              setDownloading(false);
            }
          },
        },
      ],
    );
  }, [data]);

  if (loading && !data) return <LoadingView />;

  const remoteVersion = data?.version || '';
  const hasUpdate =
    data?.available && remoteVersion && compareVersions(CURRENT_VERSION, remoteVersion) < 0;
  const isLatest =
    data?.available && remoteVersion && compareVersions(CURRENT_VERSION, remoteVersion) >= 0;

  return (
    <ScreenContainer>
      <Card title="Current Version" icon="📱">
        <View style={styles.row}>
          <MetricCard label="Installed" value={CURRENT_VERSION} color={colors.cyan} mono />
          <MetricCard
            label="Latest"
            value={data?.available ? remoteVersion : '—'}
            color={hasUpdate ? colors.orange : colors.green}
            mono
          />
        </View>
        <View style={{marginTop: 12}}>
          {hasUpdate && (
            <Badge label="Update Available" severity="warning" />
          )}
          {isLatest && (
            <Badge label="Up to Date" severity="success" />
          )}
          {checkError ? (
            <Badge label="Check failed" severity="error" />
          ) : !data?.available && !loading ? (
            <Badge label="No release found" severity="info" />
          ) : null}
        </View>
        {checkError ? (
          <Text style={styles.errorText}>{checkError}</Text>
        ) : null}
      </Card>

      <Card title="Update Source" icon="🌐">
        <Text style={styles.sourceUrl}>{UPDATE_BASE_URL}</Text>
        <Text style={styles.sourceHint}>
          Updates are distributed by the Hyve developers. All node operators
          receive the same build from this central server.
        </Text>
      </Card>

      {data?.available && (
        <Card title="Release Info" icon="📦">
          {data.changelog && (
            <Text style={styles.changelog}>{data.changelog}</Text>
          )}
          <View style={styles.row}>
            <MetricCard label="Version" value={remoteVersion} mono />
            {data.size_bytes != null && (
              <MetricCard label="Size" value={formatBytes(data.size_bytes)} />
            )}
            {data.build_date && (
              <MetricCard label="Built" value={data.build_date} />
            )}
          </View>
        </Card>
      )}

      {hasUpdate && (
        <Card title="Install Update" icon="⬇️">
          <Text style={styles.instructions}>
            Tap download to open the APK in your browser. Once downloaded,
            open the file to install. You may need to allow installs from
            unknown sources.
          </Text>
          <Button
            title={downloading ? 'Opening…' : `Download v${remoteVersion}`}
            onPress={downloadApk}
            loading={downloading}
            style={{marginTop: 12}}
          />
        </Card>
      )}

      <Button
        title="Check for Updates"
        onPress={checkForUpdate}
        variant="secondary"
        style={{marginTop: 4}}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: 12},
  changelog: {
    color: colors.text2,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  instructions: {
    color: colors.text3,
    fontSize: 12,
    lineHeight: 18,
  },
  sourceUrl: {
    color: colors.cyan,
    fontSize: 13,
    fontFamily: fonts.mono,
    marginBottom: 8,
  },
  sourceHint: {
    color: colors.text3,
    fontSize: 12,
    lineHeight: 18,
  },
  errorText: {
    color: colors.red,
    fontSize: 12,
    marginTop: 8,
  },
});
