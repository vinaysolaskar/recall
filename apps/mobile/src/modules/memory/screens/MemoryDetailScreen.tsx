import { useEffect, useRef, useState } from 'react';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AudioStatus } from 'expo-audio';
import type { Capture, TextCapture, VoiceCapture } from '../domain/types';
import type { LocalMemoryRepository } from '../data/localRepository';
import type { MemoryWithCaptures } from '../data/repository';
import { syncVoiceCapture } from '../data/voiceSync';
import { CreateTextMemoryScreen } from './CreateTextMemoryScreen';
import { VoiceRecordingScreen } from './VoiceRecordingScreen';

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
    const [addingVoiceCapture, setAddingVoiceCapture] = useState(false);
    const [selectedCaptureId, setSelectedCaptureId] = useState<string | null>(null);
    const [activeCaptureId, setActiveCaptureId] = useState<string | null>(null);
    const [pausedCaptureId, setPausedCaptureId] = useState<string | null>(null);
    const [finishedCaptureId, setFinishedCaptureId] = useState<string | null>(null);
    // Captures already attempted during this screen mount. Without this, every
    // surfaced state change re-armed the upload effect and a failed upload
    // looped forever, flashing through sync messages (the reported flicker).
    // A fresh mount clears it, so pending captures still retry on the next open.
    const attemptedSyncIdsRef = useRef<Set<string>>(new Set());

    // A single player is shared by every Voice Capture on this screen so only one
    // Capture can play at a time. The hook releases the native player on unmount.
    const player = useAudioPlayer(null);
    const playerStatus = useAudioPlayerStatus(player);

    // Automatically upload voice audio that has not been uploaded yet (new local
    // captures and captures that were left as pending after an offline recording).
    useEffect(() => {
        if (!data) {
            return;
        }
        const candidates = data.captures.filter((capture): capture is VoiceCapture =>
            capture.type === 'voice'
            && (capture.syncStatus === 'local'
                || capture.syncStatus === 'upload_pending'
                // A crash mid-upload leaves 'uploading'; the server tolerates a
                // repeated upload, so it is safe to retry.
                || capture.syncStatus === 'uploading')
            && !attemptedSyncIdsRef.current.has(capture.id));
        if (candidates.length === 0) {
            return;
        }
        // Mark as attempted synchronously so state updates from the sync itself
        // (for example 'uploading') cannot re-trigger another attempt.
        candidates.forEach((capture) => attemptedSyncIdsRef.current.add(capture.id));
        void Promise.all(candidates.map(async (capture) => {
            try {
                const updated = await syncVoiceCapture(repository, data.memory, capture, setData);
                if (updated) {
                    setData(updated);
                }
            } catch {
                // Upload failed locally; the Capture keeps its previous state and can be retried later.
            }
        }));
    }, [data, repository]);

    useEffect(() => {
        let mounted = true;
        // Each loaded Memory gets its own set of upload attempts.
        attemptedSyncIdsRef.current = new Set();
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

    // Detect natural playback completion so the Capture returns to a replayable
    // state instead of sticking on a stale "playing" UI.
    useEffect(() => {
        if (playerStatus.didJustFinish && activeCaptureId) {
            setFinishedCaptureId(activeCaptureId);
            setPausedCaptureId(null);
        }
    }, [activeCaptureId, playerStatus.didJustFinish]);

    // Never play audio over a new recording: pausing on the way into the record
    // screen keeps the microphone clean. The capture stays replayable afterwards.
    useEffect(() => {
        if (addingVoiceCapture && activeCaptureId) {
            player.pause();
            setPausedCaptureId(activeCaptureId);
        }
    }, [activeCaptureId, addingVoiceCapture, player]);

    function requestPlay(captureId: string) {
        const capture = data?.captures.find((item) => item.id === captureId);
        if (!capture || capture.type !== 'voice') {
            return;
        }

        if (activeCaptureId === captureId && finishedCaptureId === captureId) {
            // Replay from the start.
            player.replace(capture.audioUri);
            player.play();
            setFinishedCaptureId(null);
            setPausedCaptureId(null);
            return;
        }
        if (activeCaptureId === captureId && pausedCaptureId === captureId) {
            // Resume.
            player.play();
            setPausedCaptureId(null);
            return;
        }
        if (activeCaptureId === captureId) {
            // Pause the active Capture.
            player.pause();
            setPausedCaptureId(captureId);
            return;
        }

        // Starting another Capture stops/resets the previous one by swapping the
        // single shared player to the new source.
        player.replace(capture.audioUri);
        player.play();
        setActiveCaptureId(captureId);
        setPausedCaptureId(null);
        setFinishedCaptureId(null);
    }

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

    if (addingVoiceCapture) {
        return (
            <VoiceRecordingScreen
                memoryId={memoryId}
                onBack={() => setAddingVoiceCapture(false)}
                onSaved={(result) => {
                    setData(result);
                    setAddingVoiceCapture(false);
                }}
                repository={repository}
                saveAsNewMemory={false}
            />
        );
    }

    const selectedCapture = selectedCaptureId ? data.captures.find((capture): capture is TextCapture => capture.id === selectedCaptureId && capture.type === 'text') : null;
    if (selectedCapture) {
        return <CaptureView capture={selectedCapture} onBack={() => setSelectedCaptureId(null)} onSave={updateCapture} />;
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
                <Pressable onPress={() => setAddingVoiceCapture(true)} style={styles.addVoiceCaptureButton}><Text style={styles.addVoiceCaptureText}>+ Add Voice Capture</Text></Pressable>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <View style={styles.timeline}>
                    {data.captures.map((capture, index) => (
                        <View key={capture.id} style={styles.timelineItem}>
                            <View style={styles.timelineMarker}><View style={styles.dot} />{index < data.captures.length - 1 ? <View style={styles.line} /> : null}</View>
                            <View style={styles.captureBody}>
                                <Text style={styles.captureType}>{capture.type.toUpperCase()} CAPTURE</Text>
                                <Text style={styles.captureDate}>{formatDate(capture.capturedAt)}</Text>
                                {capture.type === 'text' ? (
                                    <>
                                        <Text numberOfLines={4} style={styles.capturePreview}>{getPreview(capture.text)}</Text>
                                        <Pressable onPress={() => setSelectedCaptureId(capture.id)} style={styles.viewCaptureButton}><Text style={styles.viewCaptureText}>View Capture</Text></Pressable>
                                    </>
                                ) : (
                                    <VoiceCaptureControls
                                        capture={capture}
                                        finished={finishedCaptureId === capture.id}
                                        isActive={activeCaptureId === capture.id}
                                        onToggle={() => requestPlay(capture.id)}
                                        paused={pausedCaptureId === capture.id}
                                        playerStatus={playerStatus}
                                    />
                                )}
                            </View>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

function CaptureView({ capture, onBack, onSave }: { capture: TextCapture; onBack: () => void; onSave: (capture: Capture, text: string) => Promise<boolean> }) {
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <ScrollView contentContainerStyle={styles.content}>
                <Pressable hitSlop={8} onPress={onBack} style={styles.backButton}><Text style={styles.backText}>Back</Text></Pressable>
                <Text style={styles.eyebrow}>{capture.type.toUpperCase()} CAPTURE</Text>
                <Text style={styles.captureDate}>{formatDate(capture.capturedAt)}</Text>
                <EditableCapture capture={capture} onSave={onSave} />
            </ScrollView>
        </View>
    );
}

function EditableCapture({ capture, onSave }: { capture: TextCapture; onSave: (capture: Capture, text: string) => Promise<boolean> }) {
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
            <TextInput maxLength={10000} multiline onChangeText={(value) => { setText(value); setEditError(''); }} scrollEnabled style={styles.editInput} textAlignVertical="top" value={text} />
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

type VoiceCaptureControlsProps = {
    capture: VoiceCapture;
    playerStatus: AudioStatus;
    isActive: boolean;
    paused: boolean;
    finished: boolean;
    onToggle: () => void;
};

function VoiceCaptureControls({ capture, playerStatus, isActive, paused, finished, onToggle }: VoiceCaptureControlsProps) {
    const syncLabel = getSyncLabel(capture);
    let buttonLabel = 'Play';
    if (isActive && paused) {
        buttonLabel = 'Resume';
    } else if (isActive && finished) {
        buttonLabel = 'Replay';
    } else if (isActive) {
        buttonLabel = 'Pause';
    }

    return (
        <>
            <View style={styles.playbackRow}>
                <Pressable onPress={onToggle} style={styles.playButton}>
                    <Text style={styles.playButtonText}>{buttonLabel}</Text>
                </Pressable>
                <Text style={styles.playbackPosition}>
                    {formatDuration(isActive ? playerStatus.currentTime : capture.durationSeconds)}
                    {' / '}
                    {formatDuration(isActive && playerStatus.duration > 0 ? playerStatus.duration : capture.durationSeconds)}
                </Text>
            </View>
            <Text style={styles.syncStatus}>{syncLabel}</Text>
        </>
    );
}

function getSyncLabel(capture: VoiceCapture): string {
    if (capture.syncStatus === 'failed') {
        return capture.syncError || 'Upload failed. The recording stays saved on this device.';
    }
    if (capture.syncStatus === 'upload_pending') {
        return 'Waiting to sync';
    }
    if (capture.syncStatus === 'uploading') {
        return 'Uploading…';
    }
    if (capture.syncStatus === 'uploaded') {
        // The upload itself succeeded; the label reflects the processing stage.
        switch (capture.processingStatus) {
            case 'completed':
                return 'Ready';
            case 'processing':
                return 'Transcribing…';
            case 'failed':
                return 'Processing failed. The recording stays saved on this device.';
            default:
                return 'Processing…';
        }
    }
    return 'Saved on device';
}

function getPreview(text: string): string {
    const singleLine = text.replace(/\s+/g, ' ').trim();
    return singleLine.length > 240 ? `${singleLine.slice(0, 240)}...` : singleLine;
}

function formatDuration(seconds: number): string {
    // Player positions arrive as high-precision floats (for example
    // 1.0089999437332153); display must always be whole seconds as MM:SS.
    const wholeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
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
    addVoiceCaptureButton: { alignItems: 'center', alignSelf: 'flex-start', borderColor: '#d96c4f', borderRadius: 8, borderWidth: 1, minHeight: 44, justifyContent: 'center', marginBottom: 24, paddingHorizontal: 14 },
    addVoiceCaptureText: { color: '#d96c4f', fontSize: 15, fontWeight: '700' },
    error: { color: '#b33a32', fontSize: 14, marginBottom: 12 },
    timeline: { paddingTop: 4 },
    timelineItem: { flexDirection: 'row' },
    timelineMarker: { alignItems: 'center', width: 24 },
    dot: { backgroundColor: '#d96c4f', borderRadius: 7, height: 14, marginTop: 4, width: 14 },
    line: { backgroundColor: '#d9d0c4', flex: 1, marginVertical: 4, width: 2 },
    captureBody: { flex: 1, paddingBottom: 28, paddingLeft: 14 },
    captureType: { color: '#39735b', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
    captureDate: { color: '#7a746d', fontSize: 13, marginBottom: 10, marginTop: 4 },
    capturePreview: { color: '#1d2a24', fontSize: 17, lineHeight: 25 },
    playbackRow: { alignItems: 'center', flexDirection: 'row', gap: 14 },
    playButton: { alignItems: 'center', backgroundColor: '#39735b', borderRadius: 8, justifyContent: 'center', minHeight: 40, minWidth: 96, paddingHorizontal: 14 },
    playButtonText: { color: '#fffaf3', fontSize: 14, fontWeight: '700' },
    playbackPosition: { color: '#52635b', fontSize: 14, fontVariant: ['tabular-nums'] },
    syncStatus: { color: '#7a746d', fontSize: 13, marginTop: 8 },
    viewCaptureButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingTop: 8 },
    viewCaptureText: { color: '#39735b', fontSize: 14, fontWeight: '700' },
    captureText: { color: '#1d2a24', fontSize: 17, lineHeight: 25 },
    editButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingTop: 8 },
    editText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
    editInput: { backgroundColor: '#fffaf3', borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, color: '#1d2a24', height: 220, padding: 12 },
    counter: { color: '#7a746d', fontSize: 13, marginTop: 6, textAlign: 'right' },
    editActions: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 10 },
    cancelButton: { justifyContent: 'center', paddingHorizontal: 12 },
    cancelText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
    smallPrimaryButton: { backgroundColor: '#d96c4f', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 10 },
    primaryText: { color: '#fffaf3', fontSize: 14, fontWeight: '700' },
    secondaryButton: { alignItems: 'center', backgroundColor: '#39735b', borderRadius: 8, padding: 14 },
    secondaryText: { color: '#fffaf3', fontSize: 15, fontWeight: '700' },
});