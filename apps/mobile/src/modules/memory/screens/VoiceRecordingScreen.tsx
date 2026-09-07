import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAudioRecorder, requestRecordingPermissionsAsync, RecordingPresets } from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_RECORDING_SECONDS } from '../domain/constants';
import type { MemoryWithCaptures } from '../data/repository';
import type { LocalMemoryRepository } from '../data/localRepository';

type VoiceRecordingScreenProps = {
    repository: LocalMemoryRepository;
    memoryId?: string;
    onBack: () => void;
    onSaved: (result: MemoryWithCaptures) => void;
    saveAsNewMemory: boolean;
};

type RecordingStatus = 'IDLE' | 'RECORDING' | 'SAVING' | 'ERROR';
type StopReason = 'manual' | 'limit' | 'interrupted';

// Bounded wait for the asynchronous recording-status callback so finalization
// does not read an empty URL before expo-audio delivers the completed status.
const COMPLETION_TIMEOUT_MS = 2500;

export function VoiceRecordingScreen({ repository, memoryId, onBack, onSaved, saveAsNewMemory }: VoiceRecordingScreenProps) {
    const insets = useSafeAreaInsets();
    const [status, setStatus] = useState<RecordingStatus>('IDLE');
    const [message, setMessage] = useState('');
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    // recordingRef tracks the session entirely in JS. The native AudioRecorder must
    // not be polled or read after it has been stopped (its shared object is released
    // on unmount), so no native recorder property is read during finalization.
    const recordingRef = useRef(false);
    const finishingRef = useRef(false);
    const startedAtRef = useRef(0);
    const completedUrlRef = useRef<string | null>(null);
    const stopReasonRef = useRef<StopReason>('manual');
    const finalizationRef = useRef<Promise<void> | null>(null);
    const completionObservedRef = useRef(false);
    const completionWaitersRef = useRef<Array<() => void>>([]);

    // Synchronization between recorder.stop() (whose promise may resolve before
    // the native completion event arrives) and the async status callback. The
    // callback wakes any pending finalization wait via notifyCompletion();
    // waitForCompletion() resolves on that signal or a bounded timeout so the
    // flow never hangs. Only JS state is read/written here, never native
    // recorder properties.
    function notifyCompletion() {
        if (completionObservedRef.current) {
            return;
        }
        completionObservedRef.current = true;
        const waiters = completionWaitersRef.current;
        completionWaitersRef.current = [];
        waiters.forEach((wake) => wake());
    }

    function waitForCompletion(timeoutMs: number): Promise<void> {
        if (completionObservedRef.current || completedUrlRef.current) {
            return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
            const onComplete = () => {
                clearTimeout(timeoutId);
                resolve();
            };
            const timeoutId = setTimeout(() => {
                completionWaitersRef.current = completionWaitersRef.current.filter((wake) => wake !== onComplete);
                resolve();
            }, timeoutMs);
            completionWaitersRef.current.push(onComplete);
        });
    }

    // The completed recording URL comes from the status callback, never from
    // recorder.uri (which must not be read after stopping).
    const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (recordingStatus) => {
        if (recordingStatus.url) {
            completedUrlRef.current = recordingStatus.url;
        }

        if (recordingStatus.hasError) {
            stopReasonRef.current = 'interrupted';
        }

        if (recordingStatus.isFinished) {
            notifyCompletion();
        }

        if (recordingStatus.isFinished && recordingRef.current) {
            // A native completion can race the JS 15-minute timer (the recorder is
            // also configured with { forDuration: MAX_RECORDING_SECONDS }). If no
            // reason was set yet and enough time elapsed, treat it as the limit.
            if (stopReasonRef.current === 'manual' && startedAtRef.current > 0 && Date.now() - startedAtRef.current >= MAX_RECORDING_SECONDS * 1000) {
                stopReasonRef.current = 'limit';
            }
            void finalizeRecording();
            return;
        }

        if (recordingStatus.hasError && !recordingStatus.isFinished && recordingRef.current) {
            // A native error may still be followed by a completed URL. Do not fail
            // immediately: allow the completion signal/URL to arrive for a short,
            // bounded window before finalizing (which reports the error if no URL).
            const onInterruption = async () => {
                try {
                    await waitForCompletion(COMPLETION_TIMEOUT_MS);
                } finally {
                    if (recordingRef.current) {
                        void finalizeRecording();
                    }
                }
            };
            void onInterruption();
        }
    });

    useEffect(() => {
        if (status !== 'RECORDING') {
            return;
        }

        const tick = () => {
            const startedAt = startedAtRef.current || Date.now();
            const elapsed = Math.min(Math.floor((Date.now() - startedAt) / 1000), MAX_RECORDING_SECONDS);
            setElapsedSeconds(elapsed);
            if (elapsed >= MAX_RECORDING_SECONDS && recordingRef.current && !finishingRef.current) {
                void handleStop('limit');
            }
        };

        tick();
        const intervalId = setInterval(tick, 500);
        return () => clearInterval(intervalId);
    }, [status]);

    useEffect(() => () => {
        // The native recorder is released by useAudioRecorder's lifecycle hook on
        // unmount. Reading or releasing it here risks touching an already-released
        // shared object, so we only stop tracking the session. The JS interval is
        // cleared when its owning effect teardown runs on unmount.
        recordingRef.current = false;
        finishingRef.current = true;
    }, []);

    async function startRecording() {
        setMessage('');
        try {
            const permission = await requestRecordingPermissionsAsync();
            if (!permission.granted) {
                setStatus('ERROR');
                setMessage('Microphone permission is required to record a Voice Capture.');
                return;
            }

            recordingRef.current = false;
            finishingRef.current = false;
            completedUrlRef.current = null;
            stopReasonRef.current = 'manual';
            completionObservedRef.current = false;
            completionWaitersRef.current = [];
            finalizationRef.current = null;

            await recorder.prepareToRecordAsync();
            recorder.record({ forDuration: MAX_RECORDING_SECONDS });
            startedAtRef.current = Date.now();
            recordingRef.current = true;
            setElapsedSeconds(0);
            setStatus('RECORDING');
        } catch {
            recordingRef.current = false;
            setStatus('ERROR');
            setMessage('Could not start recording. Check microphone access and try again.');
        }
    }

    async function handleStop(reason: StopReason) {
        if (!recordingRef.current || finishingRef.current) {
            return;
        }
        finishingRef.current = true;
        stopReasonRef.current = reason;
        setStatus('SAVING');

        // Stop the recorder exactly once. If finalization already began (for example
        // the native side auto-stopped first), skip the native call to avoid issuing
        // a competing stop from a different lifecycle path.
        if (!finalizationRef.current) {
            try {
                await recorder.stop();
            } catch {
                // Ignore stop failures here: finalization below still saves the
                // audio when a completed URL was already received, otherwise it
                // transitions to an error state without creating a Capture.
            }

            // The completed URL is delivered asynchronously by the status callback.
            // recorder.stop() may resolve before that event arrives, so wait for the
            // completion signal (bounded) before finalizing. This reads only JS
            // state, never native recorder properties.
            await waitForCompletion(COMPLETION_TIMEOUT_MS);
        }

        if (!finalizationRef.current) {
            await finalizeRecording();
        } else {
            await finalizationRef.current;
        }
    }

    function finalizeRecording(): Promise<void> {
        if (finalizationRef.current) {
            return finalizationRef.current;
        }
        if (!recordingRef.current) {
            return Promise.resolve();
        }

        finishingRef.current = true;
        recordingRef.current = false;
        setStatus('SAVING');

        const finalization = (async () => {
            let persistentUri: string | null = null;
            try {
                const sourceUri = completedUrlRef.current;
                const documentDirectory = FileSystem.documentDirectory;
                if (!sourceUri || !documentDirectory) {
                    // No usable local source artifact: never create a misleading
                    // completed Voice Capture. Preserve anything the native side
                    // already produced by not deleting it.
                    setStatus('ERROR');
                    setMessage(stopReasonRef.current === 'interrupted'
                        ? 'Recording was interrupted. No usable audio was available.'
                        : 'The recording was not available. Nothing was saved.');
                    return;
                }

                persistentUri = `${documentDirectory}recall-voice-${Date.now()}.m4a`;
                await FileSystem.copyAsync({ from: sourceUri, to: persistentUri });

                if (!saveAsNewMemory && !memoryId) {
                    throw new Error('No Memory was selected for this Voice Capture.');
                }

                const durationSeconds = Math.min(Math.round((Date.now() - (startedAtRef.current || Date.now())) / 1000), MAX_RECORDING_SECONDS);
                const result = saveAsNewMemory
                    ? await repository.createVoiceMemory(persistentUri, durationSeconds)
                    : await repository.addVoiceCapture(memoryId ?? '', persistentUri, durationSeconds);

                if (stopReasonRef.current === 'limit') {
                    Alert.alert('Recording stopped', 'You reached the 15-minute limit. The recording was saved.');
                } else if (stopReasonRef.current === 'interrupted') {
                    Alert.alert('Recording interrupted', 'Recording was interrupted. The available audio was saved.');
                }
                onSaved(result);
            } catch (error) {
                if (persistentUri) {
                    await FileSystem.deleteAsync(persistentUri, { idempotent: true }).catch(() => undefined);
                }
                setStatus('ERROR');
                setMessage(error instanceof Error ? error.message : 'Could not save the recording locally.');
            }
        })();

        finalizationRef.current = finalization;
        return finalization;
    }

    function formatDuration(seconds: number): string {
        const roundedSeconds = Math.min(Math.floor(seconds), MAX_RECORDING_SECONDS);
        return `${String(Math.floor(roundedSeconds / 60)).padStart(2, '0')}:${String(roundedSeconds % 60).padStart(2, '0')}`;
    }

    const isRecording = status === 'RECORDING';
    return (
        <View style={[styles.safeArea, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
            <View style={styles.content}>
                <Pressable disabled={isRecording || status === 'SAVING'} hitSlop={8} onPress={onBack} style={styles.backButton}>
                    <Text style={styles.backText}>Back</Text>
                </Pressable>
                <Text style={styles.eyebrow}>{saveAsNewMemory ? 'NEW VOICE MEMORY' : 'ADD VOICE CAPTURE'}</Text>
                <Text style={styles.title}>{isRecording ? 'Recording in progress' : 'Record a moment'}</Text>
                <Text style={styles.duration}>{formatDuration(elapsedSeconds)}</Text>
                <Text style={styles.status}>
                    {status === 'IDLE' && 'Ready when you are.'}
                    {status === 'RECORDING' && 'Microphone is active.'}
                    {status === 'SAVING' && 'Saving the original audio...'}
                </Text>

                {message && status !== 'ERROR' ? (<Text style={styles.notice}>{message}</Text>) : null}
                {status === 'ERROR' && message ? (<Text style={styles.error}>{message}</Text>) : null}
                <Pressable disabled={status === 'SAVING'} onPress={isRecording ? () => void handleStop('manual') : () => void startRecording()} style={[styles.recordButton, isRecording && styles.stopButton]}>
                    {status === 'SAVING' ? <ActivityIndicator color="#fffaf3" /> : <Text style={styles.recordText}>{isRecording ? 'Stop' : 'Record'}</Text>}
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: { backgroundColor: '#f7f4ed', flex: 1 },
    content: { alignItems: 'center', flex: 1, padding: 24 },
    backButton: { alignSelf: 'flex-start', minHeight: 44, minWidth: 44, justifyContent: 'center' },
    backText: { color: '#39735b', fontSize: 15, fontWeight: '600' },
    eyebrow: { color: '#d96c4f', fontSize: 13, fontWeight: '800', letterSpacing: 2, marginTop: 54 },
    title: { color: '#1d2a24', fontSize: 30, fontWeight: '700', marginTop: 14, textAlign: 'center' },
    duration: { color: '#1d2a24', fontSize: 58, fontVariant: ['tabular-nums'], fontWeight: '700', marginTop: 42 },
    status: { color: '#52635b', fontSize: 16, marginTop: 14, textAlign: 'center' },
    notice: { color: '#39735b', fontSize: 14, marginTop: 14, textAlign: 'center' },
    error: { color: '#b33a32', fontSize: 14, marginTop: 14, textAlign: 'center' },
    recordButton: { alignItems: 'center', backgroundColor: '#d96c4f', borderRadius: 8, justifyContent: 'center', marginTop: 'auto', minHeight: 56, paddingHorizontal: 48 },
    stopButton: { backgroundColor: '#b33a32' },
    recordText: { color: '#fffaf3', fontSize: 18, fontWeight: '700' },
});