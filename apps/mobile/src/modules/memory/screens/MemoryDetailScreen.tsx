import { useEffect, useState } from 'react';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Capture } from '../domain/types';
import type { LocalMemoryRepository } from '../data/localRepository';
import type { MemoryWithCaptures } from '../data/repository';
import { CreateTextMemoryScreen } from './CreateTextMemoryScreen';

type MemoryDetailScreenProps = {
    memoryId: string;
    repository: LocalMemoryRepository;
    onBack: () => void;
};

export function MemoryDetailScreen({ memoryId, repository, onBack }: MemoryDetailScreenProps) {
    const insets = useSafeAreaInsets();
    const [data, setData] = useState<MemoryWithCaptures | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [addingCapture, setAddingCapture] = useState(false);

    useEffect(() => {
        let mounted = true;
        repository.getMemory(memoryId).then((result) => {
            if (mounted) {
                setData(result);
                setLoading(false);
            }
        }).catch(() => {
            if (mounted) {
                setError('Could not load this Memory.');
                setLoading(false);
            }
        });

        return () => {
            mounted = false;
        };
    }, [memoryId, repository]);

    async function updateCapture(capture: Capture, text: string): Promise<boolean> {
        const normalizedText = text.trim();
        if (!normalizedText) {
            setError('Capture text cannot be empty.');
            return false;
        }
        if (normalizedText.length > 10000) {
            setError('Text must be 10,000 characters or fewer.');
            return false;
        }

        try {
            setData(await repository.updateTextCapture(capture.id, normalizedText));
            setError('');
            return true;
        } catch {
            setError('Could not update this Capture locally.');
            return false;
        }
    }

    function confirmDelete() {
        Alert.alert('Delete Memory?', 'This removes the Memory and its Captures from this device.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await repository.deleteMemory(memoryId);
                        onBack();
                    } catch {
                        setError('Could not delete this Memory locally.');
                    }
                },
            },
        ]);
    }

    if (loading) {
        return <View style={styles.centered}><ActivityIndicator color="#d96c4f" /></View>;
    }

    if (!data) {
        return (
            <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
                <View style={styles.content}>
                    <Text style={styles.error}>{error || 'Memory not found.'}</Text>
                    <Pressable onPress={onBack} style={styles.secondaryButton}><Text style={styles.secondaryText}>Back to Memories</Text></Pressable>
                </View>
            </View>
        );
    }

    if (addingCapture) {
        return (
            <CreateTextMemoryScreen
                eyebrow="ADD CAPTURE"
                onCancel={() => setAddingCapture(false)}
                onSaved={(result) => {
                    setData(result);
                    setAddingCapture(false);
                }}
                saveLabel="Save Capture"
                saveText={(text) => repository.addTextCapture(memoryId, text)}
                title="Add to this Memory"
            />
        );
    }

    return (
        <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.headerRow}>
                    <Pressable hitSlop={8} onPress={onBack} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable>
                    <Pressable hitSlop={8} onPress={confirmDelete} style={styles.deleteButton}><Text style={styles.deleteText}>Delete</Text></Pressable>
                </View>
                <Text style={styles.eyebrow}>MEMORY</Text>
                <Text style={styles.title}>{formatDate(data.memory.createdAt)}</Text>
                <Text style={styles.meta}>{data.captures.length} {data.captures.length === 1 ? 'Capture' : 'Captures'}</Text>
                <Pressable onPress={() => setAddingCapture(true)} style={styles.addCaptureButton}><Text style={styles.addCaptureText}>+ Add Capture</Text></Pressable>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.timeline}>
                    {data.captures.map((capture, index) => (
                        <View key={capture.id} style={styles.timelineItem}>
                            <View style={styles.timelineMarker}><View style={styles.dot} />{index < data.captures.length - 1 ? <View style={styles.line} /> : null}</View>
                            <View style={styles.captureBody}>
                                <Text style={styles.captureType}>{capture.type.toUpperCase()} CAPTURE</Text>
                                <Text style={styles.captureDate}>{formatDate(capture.capturedAt)}</Text>
                                <EditableCapture capture={capture} onSave={updateCapture} />
                            </View>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

function EditableCapture({ capture, onSave }: { capture: Capture; onSave: (capture: Capture, text: string) => Promise<boolean> }) {
    const [editing, setEditing] = useState(false);
    const [text, setText] = useState(capture.text);
    const [editError, setEditError] = useState('');

    useEffect(() => {
        setText(capture.text);
    }, [capture.text]);

    if (!editing) {
        return (
            <>
                <Text style={styles.captureText}>{capture.text}</Text>
                <Pressable onPress={() => setEditing(true)} style={styles.editButton}><Text style={styles.editText}>Edit text</Text></Pressable>
            </>
        );
    }

    return (
        <>
            <TextInput maxLength={10000} multiline onChangeText={(value) => { setText(value); setEditError(''); }} style={styles.editInput} textAlignVertical="top" value={text} />
            <Text style={styles.counter}>{text.length.toLocaleString()} / 10,000</Text>
            {editError ? <Text style={styles.error}>{editError}</Text> : null}
            <View style={styles.editActions}>
                <Pressable onPress={() => { setText(capture.text); setEditError(''); setEditing(false); }} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable>
                <Pressable onPress={async () => {
                    const normalizedText = text.trim();
                    if (!normalizedText) {
                        setEditError('Capture text cannot be empty.');
                        return;
                    }
                    if (await onSave(capture, normalizedText)) setEditing(false);
                }} style={styles.smallPrimaryButton}><Text style={styles.primaryText}>Save</Text></Pressable>
            </View>
        </>
    );
}

function formatDate(value: string): string {
    return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f7f4ed', flex: 1 },
    centered: { alignItems: 'center', backgroundColor: '#f7f4ed', flex: 1, justifyContent: 'center' },
    content: { padding: 24 },
    headerRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    backButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
    backText: { color: '#39735b', fontSize: 15, fontWeight: '600' },
    deleteButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44 },
    deleteText: { color: '#b33a32', fontSize: 15, fontWeight: '600' },
    eyebrow: { color: '#d96c4f', fontSize: 13, fontWeight: '800', letterSpacing: 2, marginTop: 28, marginBottom: 10 },
    title: { color: '#1d2a24', fontSize: 27, fontWeight: '700', marginBottom: 6 },
    meta: { color: '#7a746d', fontSize: 14, marginBottom: 24 },
    addCaptureButton: { alignItems: 'center', alignSelf: 'flex-start', borderColor: '#39735b', borderRadius: 8, borderWidth: 1, minHeight: 44, justifyContent: 'center', marginBottom: 24, paddingHorizontal: 14 },
    addCaptureText: { color: '#39735b', fontSize: 15, fontWeight: '700' },
    error: { color: '#b33a32', fontSize: 14, marginBottom: 12 },
    timeline: { paddingTop: 4 },
    timelineItem: { flexDirection: 'row' },
    timelineMarker: { alignItems: 'center', width: 24 },
    dot: { backgroundColor: '#d96c4f', borderRadius: 7, height: 14, marginTop: 4, width: 14 },
    line: { backgroundColor: '#d9d0c4', flex: 1, marginVertical: 4, width: 2 },
    captureBody: { flex: 1, paddingBottom: 28, paddingLeft: 14 },
    captureType: { color: '#39735b', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
    captureDate: { color: '#7a746d', fontSize: 13, marginBottom: 10, marginTop: 4 },
    captureText: { color: '#1d2a24', fontSize: 17, lineHeight: 25 },
    editButton: { alignSelf: 'flex-start', paddingTop: 12 },
    editText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
    editInput: { backgroundColor: '#fffaf3', borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, color: '#1d2a24', minHeight: 110, padding: 12 },
    counter: { color: '#7a746d', fontSize: 13, marginTop: 6, textAlign: 'right' },
    editActions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 10 },
    cancelButton: { justifyContent: 'center', paddingHorizontal: 12 },
    cancelText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
    smallPrimaryButton: { backgroundColor: '#d96c4f', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
    primaryText: { color: '#fffaf3', fontSize: 14, fontWeight: '700' },
    secondaryButton: { alignItems: 'center', backgroundColor: '#39735b', borderRadius: 8, padding: 14 },
    secondaryText: { color: '#fffaf3', fontSize: 15, fontWeight: '700' },
});