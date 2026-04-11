import React, {useState} from 'react';
import {View, Text, TextInput, FlatList, StyleSheet, Alert, TouchableOpacity} from 'react-native';
import {ScreenContainer} from '../../components/Layout';
import {Card} from '../../components/Card';
import {Button} from '../../components/Button';
import {colors} from '../../utils/theme';
import {useApi} from '../../hooks/useApi';
import {timeAgo} from '../../utils/format';
import * as api from '../../api/client';

interface Note {
  id: number;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export function NotesScreen() {
  const {data, reload} = useApi<any>('/api/notes');
  const notes: Note[] = data?.notes || [];

  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const startNew = () => {
    setEditing(null);
    setTitle('');
    setContent('');
  };

  const startEdit = (n: Note) => {
    setEditing(n);
    setTitle(n.title);
    setContent(n.content);
  };

  const save = async () => {
    if (!title.trim()) {
      Alert.alert('Error', 'Title is required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.post(`/api/notes/${editing.id}`, {title, content});
      } else {
        await api.post('/api/notes', {title, content});
      }
      setTitle('');
      setContent('');
      setEditing(null);
      reload();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteNote = (n: Note) => {
    Alert.alert('Delete Note', `Delete "${n.title}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.del(`/api/notes/${n.id}`);
            reload();
          } catch {}
        },
      },
    ]);
  };

  return (
    <ScreenContainer>
      <Card title={editing ? 'Edit Note' : 'New Note'} icon="📝">
        <TextInput
          style={styles.input}
          placeholder="Title"
          placeholderTextColor={colors.text3}
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          style={[styles.input, styles.multiline]}
          placeholder="Content"
          placeholderTextColor={colors.text3}
          value={content}
          onChangeText={setContent}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
        <View style={styles.btnRow}>
          <Button title="Save" onPress={save} loading={saving} style={{flex: 1}} />
          {(editing || title || content) && (
            <Button title="Cancel" onPress={startNew} variant="secondary" style={{flex: 1}} />
          )}
        </View>
      </Card>

      {notes.length === 0 ? (
        <Card title="Notes" icon="📋">
          <Text style={styles.empty}>No notes yet</Text>
        </Card>
      ) : (
        notes.map(n => (
          <TouchableOpacity key={n.id} onPress={() => startEdit(n)} onLongPress={() => deleteNote(n)}>
            <Card title={n.title} icon="📄">
              <Text style={styles.noteContent} numberOfLines={3}>
                {n.content}
              </Text>
              <Text style={styles.timestamp}>Updated {timeAgo(n.updated_at)}</Text>
            </Card>
          </TouchableOpacity>
        ))
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg3,
    borderRadius: 8,
    padding: 12,
    color: colors.text1,
    fontSize: 14,
    marginBottom: 8,
  },
  multiline: {minHeight: 80},
  btnRow: {flexDirection: 'row', gap: 8},
  empty: {color: colors.text3, textAlign: 'center', paddingVertical: 20},
  noteContent: {color: colors.text2, fontSize: 13, lineHeight: 18},
  timestamp: {color: colors.text3, fontSize: 11, marginTop: 6},
});
