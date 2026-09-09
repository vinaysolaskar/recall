import { useEffect, useRef, useState } from 'react';
import { Alert, ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { supabase } from '../../../infrastructure/supabase/client';

import type { AudioStatus } from 'expo-audio';
import type { Capture, TextCapture, VoiceCapture } from '../domain/types';
import type { LocalMemoryRepository } from '../data/localRepository';
import type { MemoryWithCaptures } from '../data/repository';
import { syncVoiceCapture, deleteVoiceCapture, deleteVoiceMemory } from '../data/voiceSync';
import { fetchVoiceCaptureStatuses, mapJobStatusToProcessing, saveEditedTranscript, type TranscriptStatusMap, type VoiceTranscriptStatus } from '../data/voiceTranscripts';
import { CreateTextMemoryScreen } from './CreateTextMemoryScreen';
import { VoiceRecordingScreen } from './VoiceRecordingScreen';

export const MAX_TRANSCRIPT_CHARS = 24000;

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
    // Transcript + processing status loaded from the backend for uploaded captures.
    const [transcripts, setTranscripts] = useState<TranscriptStatusMap>({});
    const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
    const [transcriptDraft, setTranscriptDraft] = useState('');
    const [savingTranscript, setSavingTranscript] = useState(false);

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
        setTranscripts({});
        setEditingTranscriptId(null);
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

    // Poll the backend for uploaded voice captures' processing status and transcript.
    // Polling stops once every visible job settles (COMPLETED or FAILED) so it
    // does not run forever; a fresh screen load resumes it for new captures.
    useEffect(() => {
        if (!data) {
            return;
        }
        const uploadedIds = data.captures
            .filter((capture): capture is VoiceCapture => capture.type === 'voice' && capture.syncStatus === 'uploaded')
            .map((capture) => capture.id);
        if (uploadedIds.length === 0) {
            return;
        }
        let mounted = true;
        let intervalId: ReturnType<typeof setInterval> | null = null;

        const tick = async () => {
            try {
                const statuses = await fetchVoiceCaptureStatuses(uploadedIds);
                if (!mounted) {
                    return;
                }
                setTranscripts(statuses);
                const values = Object.values(statuses);
                const settled = values.length > 0 && values.every((status) => status.jobStatus === 'COMPLETED' || status.jobStatus === 'FAILED');
                for (const status of values) {
                    await repository.updateCaptureSync(status.captureId, 'uploaded', null, mapJobStatusToProcessing(status.jobStatus));
                }
                if (settled && intervalId) {
                    clearInterval(intervalId);
                }
            } catch {
                // Offline or processing not ready; keep the current local UI state.

            
}
        };

        void tick();
        intervalId = setInterval(() => {
            void tick();
        }, 8000);

        return () => {
            mounted = false;
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [data, repository]);

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

    async function saveTranscriptEdit(capture: VoiceCapture) {
        const trimmed = transcriptDraft.trim();
        if (trimmed.length > MAX_TRANSCRIPT_CHARS) {
            setError(`Transcript must be ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters or fewer.`);
            return;
        }
        setSavingTranscript(true);
        try {
            const normalized = trimmed.length === 0 ? null : trimmed;
            await saveEditedTranscript(capture.id, normalized);
            setTranscripts((current) => ({
                ...current,
                [capture.id]: {
                    ...(current[capture.id] ?? {
                        captureId: capture.id,
                        jobStatus: 'COMPLETED',
                        jobError: null,
                        generatedTranscript: null,
                        editedTranscript: null,
                    }),
                    editedTranscript: normalized,
                },
            }));
            setEditingTranscriptId(null);
            setTranscriptDraft('');
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not save the transcript.');
        } finally {
            setSavingTranscript(false);
        }
    }

    function startTranscriptEdit(capture: VoiceCapture) {
        const status = transcripts[capture.id];
        setTranscriptDraft(status?.editedTranscript ?? status?.generatedTranscript ?? '');
        setEditingTranscriptId(capture.id);
    }

    async function deleteCapture(capture: Capture) {
        // Optimistically remove the Capture from the local timeline immediately,
        // then clean up server-side data (transcript, job, storage audio) and
        // the local audio file for voice Captures. Removing it from `data` also
        // stops any in-progress upload/sync polling for this Capture.
        try {
            if (capture.type === 'voice') {
                const token = (await supabase.auth.getSession()).data.session?.access_token;
                if (token) {
                    try {
                        await deleteVoiceCapture(capture.id);
                    } catch (error) {
                        setError(error instanceof Error ? error.message : 'Could not fully delete the capture online.');
                    }
                }
                if (capture.audioUri) {
                    await FileSystem.deleteAsync(capture.audioUri, { idempotent: true }).catch(() => undefined);
                }
            }
            setData(await repository.deleteCapture(capture.id));
            setTranscripts((current) => {
                if (!current[capture.id]) {
                    return current;
                }
                const next = { ...current };
                delete next[capture.id];
                return next;
            });
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not delete the capture.');
        }
    }

    async function confirmDeleteMemory() {
        Alert.alert('Delete Memory?', 'This removes the Memory and its Captures from this device.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        const token = (await supabase.auth.getSession()).data.session?.access_token;
                        if (token) {
                            try {
                                await deleteVoiceMemory(memoryId);
                            } catch (error) {
                                setError(error instanceof Error ? error.message : 'Could not fully delete the Memory online.');
                            }
                        }
                        await repository.deleteMemory(memoryId);
                        onBack();
                    } catch {
                        setError('Could not delete this Memory locally.');
                    }
                },
            },
        ]);
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
                                        editing={editingTranscriptId === capture.id}
                                        editError={error}
                                        finished={finishedCaptureId === capture.id}
                                        isActive={activeCaptureId === capture.id}
                                        onCancelEdit={() => { setEditingTranscriptId(null); setTranscriptDraft(''); }}
                                        onDraftChange={(value) => setTranscriptDraft(value)}
                                        onStartEdit={() => startTranscriptEdit(capture)}
                                        onToggle={() => requestPlay(capture.id)}
                                        onSaveEdit={() => void saveTranscriptEdit(capture)}
                                        paused={pausedCaptureId === capture.id}
                                        playerStatus={playerStatus}
                                        savingEdit={savingTranscript}
                                        transcript={transcripts[capture.id]}
                                        transcriptDraft={transcriptDraft}
                                    />
                                )}
                                <Pressable onPress={() => void deleteCapture(capture)} style={styles.deleteCaptureButton}><Text style={styles.deleteCaptureText}>Delete capture</Text></Pressable>
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
    editing: boolean;
    editError: string;
    finished: boolean;
    isActive: boolean;
    onCancelEdit: () => void;
    onDraftChange: (value: string) => void;
    onStartEdit: () => void;
    onSaveEdit: () => void;
    onToggle: () => void;
    paused: boolean;
    playerStatus: AudioStatus;
    savingEdit: boolean;
    transcript: VoiceTranscriptStatus | undefined;
    transcriptDraft: string;
};

function VoiceCaptureControls({ capture, editing, editError, finished, isActive, onCancelEdit, onDraftChange, onStartEdit, onSaveEdit, onToggle, paused, playerStatus, savingEdit, transcript, transcriptDraft }: VoiceCaptureControlsProps) {
    const syncLabel = getSyncLabel(capture);
    let buttonLabel = 'Play';
    if (isActive && paused) {
        buttonLabel = 'Resume';
    } else if (isActive && finished) {
        buttonLabel = 'Replay';
    } else if (isActive) {
        buttonLabel = 'Pause';
    }

    const displayTranscript = transcript?.editedTranscript ?? transcript?.generatedTranscript;

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
            {displayTranscript ? (
                <View style={styles.transcriptBox}>
                    <Text style={styles.transcriptText}>{displayTranscript}</Text>
                    <Pressable onPress={onStartEdit} style={styles.editButton}><Text style={styles.editText}>Edit transcript</Text></Pressable>
                </View>
            ) : transcript?.jobStatus === 'COMPLETED' || transcript?.jobStatus === 'FAILED' ? (
                <Text style={styles.syncStatus}>
                    {transcript.jobStatus === 'FAILED'
                        ? transcript.jobError || 'Transcription failed. The recording stays saved on this device.'
                        : 'Ready'}
                </Text>
            ) : null}
            {editing ? (
                <View style={styles.transcriptEditor}>
                    <TextInput autoCapitalize="sentences" maxLength={MAX_TRANSCRIPT_CHARS} multiline onChangeText={onDraftChange} placeholder="Transcript" placeholderTextColor="#8a8178" scrollEnabled style={styles.editInput} textAlignVertical="top" value={transcriptDraft} />
                    <Text style={styles.counter}>{transcriptDraft.length.toLocaleString()} / {MAX_TRANSCRIPT_CHARS.toLocaleString()}</Text>
                    {editError ? <Text style={styles.error}>{editError}</Text> : null}
                    <View style={styles.editActions}>
                        <Pressable disabled={savingEdit} onPress={onCancelEdit} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel</Text></Pressable>
                        <Pressable disabled={savingEdit} onPress={onSaveEdit} style={styles.smallPrimaryButton}>{savingEdit ? <ActivityIndicator color="#fffaf3" /> : <Text style={styles.primaryText}>Save</Text>}</Pressable>
                    </View>
                </View>
            ) : null}
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
    transcriptBox: { backgroundColor: '#fffaf3', borderColor: '#d9d0c4', borderRadius: 8, borderWidth: 1, marginTop: 10, padding: 12 },
    transcriptText: { color: '#1d2a24', fontSize: 15, lineHeight: 22 },
    transcriptEditor: { marginTop: 10 },
    viewCaptureButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingTop: 8 },
    viewCaptureText: { color: '#39735b', fontSize: 14, fontWeight: '700' },
    captureText: { color: '#1d2a24', fontSize: 17, lineHeight: 25 },
    editButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingTop: 8 },
    editText: { color: '#39735b', fontSize: 14, fontWeight: '600' },
    deleteCaptureButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingTop: 8 },
    deleteCaptureText: { color: '#b33a32', fontSize: 14, fontWeight: '600' },
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