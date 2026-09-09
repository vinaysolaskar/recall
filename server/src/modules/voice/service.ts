import { supabase } from '../../infrastructure/supabase/client.js';

export const VOICE_BUCKET = 'voice-audio';

// Mirrors the mobile domain limit (MAX_AUDIO_BYTES = 25 * 1024 * 1024).
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const MAX_BASE64_LENGTH = Math.ceil(MAX_AUDIO_BYTES / 3) * 4;
const BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;

const ALLOWED_EXTENSIONS = new Set(['m4a', 'mp3', 'wav', 'webm']);

const MIME_TYPES: Record<string, string> = {
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    webm: 'audio/webm',
};

const ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;

// Matches the PRD transcript edit limit (MAX_LLM_INPUT_CHARS).
export const MAX_TRANSCRIPT_CHARS = 24000;

export class VoiceSyncError extends Error {
    public readonly status: number;

    public constructor(message: string, status = 400) {
        super(message);
        this.name = 'VoiceSyncError';
        this.status = status;
    }
}

export function parseStableId(value: unknown, field: string): string {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw new VoiceSyncError(`${field} must be a stable id of letters, digits and dashes.`);
    }
    return value;
}

export function parseCaptureIdList(value: unknown): string[] {
    const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : '';
    const unique = [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0))];
    if (unique.length === 0) {
        throw new VoiceSyncError('captureIds is required.');
    }
    if (unique.length > 50) {
        throw new VoiceSyncError('Too many captureIds requested.');
    }
    return unique.map((id) => parseStableId(id, 'captureId'));
}

export type VoiceSyncInput = {
    memoryId: string;
    captureId: string;
    durationSeconds: number;
    extension: string;
    audioBase64: string;
};

export type VoiceSyncResult = {
    storagePath: string;
    jobId: string | null;
    jobStatus: string | null;
};

export type ProcessingJob = {
    id: string;
    status: string;
};

export function parseVoiceSyncInput(body: unknown): VoiceSyncInput {
    if (typeof body !== 'object' || body === null) {
        throw new VoiceSyncError('A sync payload is required.');
    }
    const payload = body as Record<string, unknown>;

    const memoryId = parseId(payload.memoryId, 'memoryId');
    const captureId = parseId(payload.captureId, 'captureId');

    const durationSeconds = payload.durationSeconds;
    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 900) {
        throw new VoiceSyncError('durationSeconds must be a number between 0 and 900.');
    }

    const extension = typeof payload.extension === 'string' ? payload.extension.toLowerCase().replace(/^\./, '') : '';
    if (!ALLOWED_EXTENSIONS.has(extension)) {
        throw new VoiceSyncError('Unsupported audio extension.');
    }

    const audioBase64 = payload.audioBase64;
    if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
        throw new VoiceSyncError('Audio content is required.');
    }
    if (audioBase64.length > MAX_BASE64_LENGTH) {
        throw new VoiceSyncError('This recording is over the 25 MB limit. It stays saved on the device.', 413);
    }
    if (!BASE64_PATTERN.test(audioBase64)) {
        throw new VoiceSyncError('Audio content must be base64 encoded.');
    }

    return { memoryId, captureId, durationSeconds, extension, audioBase64 };
}

function parseId(value: unknown, field: string): string {
    return parseStableId(value, field);
}

export function buildStoragePath(userId: string, memoryId: string, captureId: string, extension: string): string {
    // User-scoped path; never one global audio namespace.
    return `users/${userId}/memories/${memoryId}/captures/${captureId}.${extension}`;
}

export async function syncVoiceCapture(userId: string, input: VoiceSyncInput): Promise<VoiceSyncResult> {
    const bytes = Buffer.from(input.audioBase64, 'base64');
    if (bytes.length === 0) {
        throw new VoiceSyncError('Audio content is empty.');
    }
    if (bytes.length > MAX_AUDIO_BYTES) {
        throw new VoiceSyncError('This recording is over the 25 MB limit. It stays saved on the device.', 413);
    }

    const storagePath = buildStoragePath(userId, input.memoryId, input.captureId, input.extension);
    const contentType = MIME_TYPES[input.extension] ?? 'application/octet-stream';

    const { error: uploadError } = await supabase.storage
        .from(VOICE_BUCKET)
        .upload(storagePath, new Uint8Array(bytes), { contentType, upsert: false });

    if (uploadError && !isAlreadyExistsError(uploadError)) {
        // The original audio stays on the device; the caller keeps it and may retry.
        throw new VoiceSyncError('The audio could not be stored. Please try again later.', 502);
    }

    const job = await ensureTranscriptionJob(userId, storagePath, input.memoryId, input.captureId);
    return {
        storagePath,
        jobId: job?.id ?? null,
        jobStatus: job?.status ?? null,
    };
}

function isAlreadyExistsError(error: { message?: string }): boolean {
    return typeof error.message === 'string' && error.message.toLowerCase().includes('already exists');
}

async function ensureTranscriptionJob(userId: string, storagePath: string, memoryId: string, captureId: string): Promise<ProcessingJob | null> {
    // Idempotent: a capture has exactly one transcription job (unique in the DB).
    const { data: existing } = await supabase
        .from('processing_jobs')
        .select('id, status, storage_path')
        .eq('capture_id', captureId)
        .eq('job_type', 'TRANSCRIPTION')
        .maybeSingle();

    if (existing) {
        // A crash may have left the job without a storage path before the sync
        // finished creating the job. Backfill it now so the worker can proceed.
        if (!existing.storage_path) {
            const { error: backfillError } = await supabase
                .from('processing_jobs')
                .update({ storage_path: storagePath, updated_at: new Date().toISOString() })
                .eq('capture_id', captureId)
                .eq('job_type', 'TRANSCRIPTION');
            if (backfillError) {
                console.error('Could not backfill job storage path:', backfillError.message);
            }
        }
        return existing as ProcessingJob;
    }

    const { data, error } = await supabase
        .from('processing_jobs')
        .insert({
            user_id: userId,
            memory_id: memoryId,
            capture_id: captureId,
            job_type: 'TRANSCRIPTION',
            status: 'PENDING',
            storage_path: storagePath,
        })
        .select('id, status')
        .single();

    if (error) {
        // A concurrent sync of the same capture can win the unique
        // (job_type, capture_id) constraint; re-read that job so the caller
        // still receives a valid jobId.
        if (error.message && error.message.toLowerCase().includes('duplicate key')) {
            const { data: raced } = await supabase
                .from('processing_jobs')
                .select('id, status')
                .eq('capture_id', captureId)
                .eq('job_type', 'TRANSCRIPTION')
                .maybeSingle();
            if (raced) {
                return raced as ProcessingJob;
            }
        }

        // The audio upload itself succeeded; a later task can create the job, so
        // this failure must not make the caller lose the recording.
        console.error('Could not create the processing job:', error.message);
        return null;
    }

    return data as ProcessingJob;
}

export async function listProcessingJobs(userId: string): Promise<unknown[]> {
    const { data, error } = await supabase
        .from('processing_jobs')
        .select('id, memory_id, capture_id, job_type, status, attempts, available_at, error, created_at, updated_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        throw new VoiceSyncError('Could not load processing jobs.', 500);
    }

    return data ?? [];
}

export async function deleteCaptureData(userId: string, captureId: string): Promise<{ storagePath: string | null }> {
    // Deletes all server-side data for a single voice Capture: transcript row,
    // processing job, and the Supabase Storage audio object. Ownership is
    // enforced by scoping every query to the authenticated userId. The local
    // audio file is the client's responsibility.
    const storagePath = await deleteTranscriptAndJob(userId, captureId);
    if (storagePath) {
        await deleteStorageObject(storagePath);
    }
    return { storagePath };
}

export async function deleteMemoryData(userId: string, memoryId: string): Promise<void> {
    // Cascades deletion for an entire Memory: every capture's transcript + job,
    // then every Storage audio object under the user-scoped memory path.
    const { data: jobs, error: jobsError } = await supabase
        .from('processing_jobs')
        .select('capture_id, storage_path')
        .eq('user_id', userId)
        .eq('memory_id', memoryId)
        .eq('job_type', 'TRANSCRIPTION');

    if (jobsError) {
        throw new VoiceSyncError('Could not load captures for deletion.', 500);
    }

    const captureIds = (jobs ?? []).map((job) => job.capture_id);
    const storagePaths = (jobs ?? [])
        .map((job) => job.storage_path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0);

    if (captureIds.length > 0) {
        await deleteTranscriptsAndJobs(userId, memoryId, captureIds);
    }
    for (const storagePath of storagePaths) {
        await deleteStorageObject(storagePath);
    }
}

async function deleteTranscriptAndJob(userId: string, captureId: string): Promise<string | null> {
    const { data: job, error: jobError } = await supabase
        .from('processing_jobs')
        .select('storage_path')
        .eq('user_id', userId)
        .eq('capture_id', captureId)
        .eq('job_type', 'TRANSCRIPTION')
        .maybeSingle();

    if (jobError) {
        throw new VoiceSyncError('Could not load the capture job for deletion.', 500);
    }

    const { error: transcriptError } = await supabase
        .from('capture_transcripts')
        .delete()
        .eq('user_id', userId)
        .eq('capture_id', captureId);

    if (transcriptError) {
        throw new VoiceSyncError('Could not delete the transcript.', 500);
    }

    const { error: deleteJobError } = await supabase
        .from('processing_jobs')
        .delete()
        .eq('user_id', userId)
        .eq('capture_id', captureId)
        .eq('job_type', 'TRANSCRIPTION');

    if (deleteJobError) {
        throw new VoiceSyncError('Could not delete the processing job.', 500);
    }

    return job?.storage_path ?? null;
}

async function deleteTranscriptsAndJobs(userId: string, memoryId: string, captureIds: string[]): Promise<void> {
    const { error: transcriptError } = await supabase
        .from('capture_transcripts')
        .delete()
        .eq('user_id', userId)
        .eq('memory_id', memoryId)
        .in('capture_id', captureIds);

    if (transcriptError) {
        throw new VoiceSyncError('Could not delete transcripts.', 500);
    }

    const { error: jobError } = await supabase
        .from('processing_jobs')
        .delete()
        .eq('user_id', userId)
        .eq('memory_id', memoryId)
        .in('capture_id', captureIds)
        .eq('job_type', 'TRANSCRIPTION');

    if (jobError) {
        throw new VoiceSyncError('Could not delete processing jobs.', 500);
    }
}

async function deleteStorageObject(storagePath: string): Promise<void> {
    const { error } = await supabase.storage.from(VOICE_BUCKET).remove([storagePath]);
    if (error) {
        // Log safe metadata only (no audio contents). A failed storage delete
        // should not silently report full success.
        console.error(`[voice] Could not delete storage object: ${storagePath} (${error.message})`);
        throw new VoiceSyncError('Could not delete the stored audio.', 502);
    }
}

export async function claimProcessingJob(userId: string, jobId: string): Promise<ProcessingJob | null> {
    if (!ID_PATTERN.test(jobId)) {
        throw new VoiceSyncError('jobId is invalid.');
    }

    // Ownership check first, then a PENDING -> PROCESSING transition guarded by
    // status, so an already claimed job is never claimed twice.
    const { data: job, error: fetchError } = await supabase
        .from('processing_jobs')
        .select('id, status, attempts')
        .eq('id', jobId)
        .eq('user_id', userId)
        .maybeSingle();

    if (fetchError) {
        throw new VoiceSyncError('Could not load the processing job.', 500);
    }
    if (!job) {
        return null;
    }
    if (job.status !== 'PENDING') {
        return { id: job.id, status: job.status };
    }

    const { data, error: updateError } = await supabase
        .from('processing_jobs')
        .update({
            status: 'PROCESSING',
            attempts: job.attempts + 1,
            updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .eq('user_id', userId)
        .eq('status', 'PENDING')
        .select('id, status')
        .maybeSingle();

    if (updateError) {
        throw new VoiceSyncError('Could not claim the processing job.', 500);
    }

    return (data ?? null) as ProcessingJob | null;
}
