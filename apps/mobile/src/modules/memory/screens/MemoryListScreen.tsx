import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Memory } from '../domain/types';
import { LocalMemoryRepository } from '../data/localRepository';
import { CreateTextMemoryScreen } from './CreateTextMemoryScreen';
import { MemoryDetailScreen } from './MemoryDetailScreen';
import { VoiceRecordingScreen } from './VoiceRecordingScreen';

type MemoryListScreenProps = {
    userId: string;
    userEmail: string | null;
    onLogout: () => Promise<string | null>;
};

type MemoryPreview = {
    memory: Memory;
    preview: string;
    captureCount: number;
};

type ViewState =
    | { name: 'list' }
    | { name: 'create' }
    | { name: 'voice-create' }
    | { name: 'detail'; memoryId: string };

export function MemoryListScreen({ userId, userEmail, onLogout }: MemoryListScreenProps) {
    const insets = useSafeAreaInsets();
    const [repository] = useState(() => new LocalMemoryRepository(userId));
    const [memories, setMemories] = useState<MemoryPreview[]>([]);
    const [view, setView] = useState<ViewState>({ name: 'list' });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let mounted = true;

        async function loadMemories() {
            try {
                const storedMemories = await repository.listMemories();
                const previews = await Promise.all(storedMemories.map(async (memory) => {
                    const data = await repository.getMemory(memory.id);
                    const firstCapture = data?.captures[0];
                    return {
                        memory,
                        preview: firstCapture?.type === 'text' ? firstCapture.text : firstCapture ? 'Voice recording' : 'Empty Memory',
                        captureCount: data?.captures.length ?? 0,
                    };
                }));
                if (mounted) {
                    setMemories(previews);
                    setLoading(false);
                }
            } catch {
                if (mounted) {
                    setError('Could not load your local Memories.');
                    setLoading(false);
                }
            }
        }

        loadMemories();
        return () => {
            mounted = false;
        };
    }, [repository, view]);

    async function logout() {
        const logoutError = await onLogout();
        if (logoutError) setError(logoutError);
    }

    if (view.name === 'create') {
        return <CreateTextMemoryScreen saveText={(text) => repository.createTextMemory(text)} onCancel={() => setView({ name: 'list' })} onSaved={(result) => setView({ name: 'detail', memoryId: result.memory.id })} />;
    }

    if (view.name === 'voice-create') {
        return <VoiceRecordingScreen repository={repository} onBack={() => setView({ name: 'list' })} onSaved={(result) => setView({ name: 'detail', memoryId: result.memory.id })} saveAsNewMemory />;
    }

    if (view.name === 'detail') {
        return <MemoryDetailScreen memoryId={view.memoryId} repository={repository} onBack={() => setView({ name: 'list' })} />;
    }

    if (loading) {
        return <View style={styles.centered}><ActivityIndicator color="#d96c4f" /></View>;
    }

    return (
        <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.headerRow}>
                    <View>
                        <Text style={styles.eyebrow}>RECALL</Text>
                        <Text style={styles.title}>Your Memories</Text>
                    </View>
                    <Pressable hitSlop={8} onPress={logout} style={styles.logoutButton}><Text style={styles.logoutText}>Log out</Text></Pressable>
                </View>
                {userEmail ? <Text style={styles.email}>{userEmail}</Text> : null}
                {error ? <Text style={styles.error}>{error}</Text> : null}
                {memories.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyTitle}>Nothing here yet</Text>
                        <Text style={styles.emptyText}>Save a thought and it will stay on this device.</Text>
                    </View>
                ) : (
                    <View style={styles.list}>
                        {memories.map((item) => (
                            <Pressable key={item.memory.id} onPress={() => setView({ name: 'detail', memoryId: item.memory.id })} style={styles.memoryItem}>
                                <Text numberOfLines={3} style={styles.preview}>{item.preview}</Text>
                                <Text style={styles.itemMeta}>{formatDate(item.memory.createdAt)} · {item.captureCount} {item.captureCount === 1 ? 'Capture' : 'Captures'}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}
                <View style={styles.actions}>
                    <Pressable onPress={() => setView({ name: 'create' })} style={styles.primaryButton}><Text style={styles.primaryText}>New Text Memory</Text></Pressable>
                    <Pressable onPress={() => setView({ name: 'voice-create' })} style={styles.secondaryButton}><Text style={styles.secondaryText}>New Voice Memory</Text></Pressable>
                </View>
            </ScrollView>
        </View>
    );
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f7f4ed', flex: 1 },
    centered: { alignItems: 'center', backgroundColor: '#f7f4ed', flex: 1, justifyContent: 'center' },
    content: { padding: 24 },
    headerRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
    eyebrow: { color: '#d96c4f', fontSize: 13, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
    title: { color: '#1d2a24', fontSize: 30, fontWeight: '700' },
    logoutButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
    logoutText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
    email: { color: '#7a746d', fontSize: 14, marginTop: 8 },
    error: { color: '#b33a32', fontSize: 14, marginTop: 16 },
    emptyState: { borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, marginTop: 42, padding: 24 },
    emptyTitle: { color: '#1d2a24', fontSize: 20, fontWeight: '700', marginBottom: 8 },
    emptyText: { color: '#52635b', fontSize: 15, lineHeight: 22 },
    list: { gap: 12, marginTop: 28 },
    memoryItem: { backgroundColor: '#fffaf3', borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, padding: 18 },
    preview: { color: '#1d2a24', fontSize: 17, lineHeight: 24 },
    itemMeta: { color: '#7a746d', fontSize: 13, marginTop: 12 },
    primaryButton: { alignItems: 'center', backgroundColor: '#d96c4f', borderRadius: 8, justifyContent: 'center', marginTop: 24, minHeight: 52, padding: 15 },
    primaryText: { color: '#fffaf3', fontSize: 16, fontWeight: '700' },
    actions: { gap: 12 },
    secondaryButton: { alignItems: 'center', borderColor: '#39735b', borderRadius: 8, borderWidth: 1, justifyContent: 'center', marginTop: 12, minHeight: 52, padding: 15 },
    secondaryText: { color: '#39735b', fontSize: 16, fontWeight: '700' },
});