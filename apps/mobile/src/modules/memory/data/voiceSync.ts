import * as FileSystem from 'expo-file-system/legacy';

import { apiBaseUrl } from '../../../infrastructure/api/client';
import { supabase } from '../../../infrastructure/supabase/client';
import { MAX_AUDIO_BYTES } from '../domain/constants';
import type { Memory, VoiceCapture } from '../domain/types';
import type { MemoryWithCaptures } from './repository';
import type { LocalMemoryRepository } from './localRepository';

const inFlightCaptures = new Set<string>();

function getExtension(audioUri: string): string {
    const name = audioUri.split(/[\\/]/).pop() ?? '';
    const dot = name.lastIndexOf('.');
    return dot >= 0 ? name.slice(dot + 1).toLowerCase() : 'm4a';
}

/**
 * Uploads a persisted Voice Capture's original audio to the authenticated backend,
 * which stores it in private, user-scoped Supabase Storage and creates a processing
 * job. The local source file is never deleted or modified.
 *
 * Outcomes update the Capture through the repository:
 * - `uploaded` (+ `queued` processing) when the upload + job creation succeeded.
 * - `upload_pending` when the device is offline or the network failed (kept local).
 * - `failed` when the file is too large (>25 MB) or the server rejected it (kept local).
 */
export async function syncVoiceCapture(
    repository: LocalMemoryRepository,
    memory: Memory,
    capture: VoiceCapture,
    onPhaseChange?: (result: MemoryWithCaptures) => void,
): Promise<MemoryWithCaptures | null> {
    // 'uploading' may legitimately be retried: a crash mid-upload leaves a capture
    // in that state, and the backend tolerates a repeated upload for the same
    // capture. inFlightCaptures prevents true concurrent double-uploads.
    if (capture.syncStatus === 'uploaded' || inFlightCaptures.has(capture.id)) {
        return null;
    }
    inFlightCaptures.add(capture.id);

    try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
            return await repository.updateCaptureSync(capture.id, 'failed', 'You are not signed in.');
        }

        const fileInfo = await FileSystem.getInfoAsync(capture.audioUri);
        if (!fileInfo.exists) {
            return await repository.updateCaptureSync(capture.id, 'failed', 'The original audio file is missing.');
        }

        if (fileInfo.size > MAX_AUDIO_BYTES) {
            return await repository.updateCaptureSync(
                capture.id,
                'failed',
                'This recording is over the 25 MB limit. It stays saved on this device.',
            );
        }

        const uploading = await repository.updateCaptureSync(capture.id, 'uploading');
        onPhaseChange?.(uploading);
        const audioBase64 = await FileSystem.readAsStringAsync(capture.audioUri, { encoding: FileSystem.EncodingType.Base64 });

        const response = await fetch(`${apiBaseUrl}/voice/sync`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                captureId: capture.id,
                durationSeconds: capture.durationSeconds,
                extension: getExtension(capture.audioUri),
                memoryId: memory.id,
                audioBase64,
            }),
        });

        if (response.ok) {
            return await repository.updateCaptureSync(capture.id, 'uploaded', null, 'queued');
        }

        if (response.status === 401 || response.status === 403) {
            return await repository.updateCaptureSync(capture.id, 'failed', 'Could not verify your account. Please log in again.');
        }

        let message = 'The recording could not be uploaded.';
        try {
            const body = await response.json();
            if (typeof body?.error === 'string') {
                message = body.error;
            }
        } catch {
            // Keep the default message when the response has no JSON body.
        }
        return await repository.updateCaptureSync(capture.id, 'failed', message);
    } catch {
        // Transient failure (offline, timeout, server unreachable, local read
        // hiccup): keep the local Capture, do not claim a specific cause, and let
        // a later attempt (for example the next detail open) retry.
        return await repository.updateCaptureSync(capture.id, 'upload_pending', 'The upload did not finish and will be retried.');
    } finally {
        inFlightCaptures.delete(capture.id);
    }
}