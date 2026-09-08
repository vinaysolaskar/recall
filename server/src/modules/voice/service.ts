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

export class VoiceSyncError extends Error {
    public readonly status: number;

    public constructor(message: string, status = 400) {
        super(message);
        this.name = 'VoiceSyncError';
        this.status = status;
    }
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
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw new VoiceSyncError(`${field} must be a stable id of letters, digits and dashes.`);
    }
    return value;
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

    const job = await ensureTranscriptionJob(userId, input.memoryId, input.captureId);
    return {
        storagePath,
        jobId: job?.id ?? null,
        jobStatus: job?.status ?? null,
    };
}

function isAlreadyExistsError(error: { message?: string }): boolean {
    return typeof error.message === 'string' && error.message.toLowerCase().includes('already exists');
}

async function ensureTranscriptionJob(userId: string, memoryId: string, captureId: string): Promise<ProcessingJob | null> {
    // Idempotent: a capture has exactly one transcription job (unique in the DB).
    const { data: existing } = await supabase
        .from('processing_jobs')
        .select('id, status')
        .eq('capture_id', captureId)
        .eq('job_type', 'TRANSCRIPTION')
        .maybeSingle();

    if (existing) {
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
