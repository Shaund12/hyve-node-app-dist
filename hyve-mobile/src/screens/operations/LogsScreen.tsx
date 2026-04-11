import React, {useEffect, useRef, useState} from 'react';
import {View, Text, FlatList, StyleSheet, AppState} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {Button} from '../../components/Button';
import {Badge} from '../../components/Badge';
import {colors} from '../../utils/theme';
import {createWebSocket} from '../../api/client';
import * as api from '../../api/client';

interface LogLine {
  id: string;
  text: string;
  level: 'info' | 'warn' | 'error';
}

function classifyLine(line: string): LogLine['level'] {
  const l = line.toLowerCase();
  if (l.includes('err') || l.includes('panic') || l.includes('fatal')) return 'error';
  if (l.includes('warn')) return 'warn';
  return 'info';
}

export function LogsScreen() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [paused, setPaused] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    // Load initial log tail via REST
    (async () => {
      try {
        const r = await api.get('/api/logs?lines=100');
        if (r.lines) {
          setLines(
            r.lines.map((t: string) => ({
              id: String(++idRef.current),
              text: t,
              level: classifyLine(t),
            })),
          );
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;

    const connect = () => {
      try {
        ws = createWebSocket('/ws/logs');
        wsRef.current = ws;

        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          if (!closed) setTimeout(connect, 3000);
        };
        ws.onmessage = (e) => {
          if (paused) return;
          const text = e.data;
          setLines(prev => {
            const next = [
              ...prev,
              {id: String(++idRef.current), text, level: classifyLine(text)},
            ];
            return next.length > 500 ? next.slice(-500) : next;
          });
        };
      } catch {}
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, [paused]);

  const levelColor = (l: LogLine['level']) =>
    l === 'error' ? colors.red : l === 'warn' ? colors.orange : colors.text2;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Badge label={connected ? 'Live' : 'Disconnected'} severity={connected ? 'success' : 'error'} />
        <View style={styles.toolbarButtons}>
          <Button
            title={paused ? 'Resume' : 'Pause'}
            onPress={() => setPaused(p => !p)}
            variant="secondary"
            style={styles.toolBtn}
          />
          <Button
            title="Clear"
            onPress={() => setLines([])}
            variant="secondary"
            style={styles.toolBtn}
          />
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={lines}
        keyExtractor={i => i.id}
        style={styles.list}
        onContentSizeChange={() => !paused && listRef.current?.scrollToEnd({animated: false})}
        renderItem={({item}) => (
          <Text style={[styles.line, {color: levelColor(item.level)}]} selectable>
            {item.text}
          </Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: colors.bg1},
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.bg2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toolbarButtons: {flexDirection: 'row', gap: 8},
  toolBtn: {paddingHorizontal: 12, paddingVertical: 6},
  list: {flex: 1, padding: 8},
  line: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
    paddingVertical: 1,
  },
});
