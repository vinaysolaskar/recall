import { supabase } from '../../infrastructure/supabase/client.js';
import { VOICE_BUCKET } from '../voice/service.js';
import { getTranscriptionProvider } from '../transcription/groqWhisperProvider.js';
import { TranscriptionError, type TranscriptionProvider } from '../transcription/provider.js';
import { upsertGeneratedTranscript } from './transcripts.js';

const MAX_ATTEMPTS = 3;
const CLAIM_BATCH_SIZE = 1;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const BACKOFF_BASE_MS = 5000;
const POLL_INTERVAL_MS = 15_000;

type LoadedJob = {
    id: string;
    user_id: string;
    memory_id: string;
    capture_id: string;
    status: string;
    attempts: number;
    storage_path: string | null;
};

function backoffDelayMs(attempt: number): number {
    // attempt is 2 or 3 after claim; 5s, 10s, ... capped at 60s.
    return Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), 60_000);
}

function filenameFromStoragePath(storagePath: string): string {
    return storagePath.split('/').pop() ?? 'recording.m4a';
}

/**
 * Requeues jobs that were stuck in PROCESSING during a crash so they can be
 * retried. Safe to call every poll tick.
 */
async function requeueStaleProcessingJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
    const now = new Date().toISOString();

    const { error } = await supabase
        .from('processing_jobs')
        .update({
            status: 'PENDING',
            available_at: now,
            updated_at: now,
        })
        .eq('status', 'PROCESSING')
        .lt('updated_at', staleBefore);

    if (error) {
        console.error('[worker] Could not requeue stale processing jobs:', error.message);
    }
}

/**
 * Claims the oldest eligible PENDING TRANSCRIPTION job.
 *
 * BUG B: FAILED jobs are terminal and are never re-claimed. Only PENDING jobs
 * are eligible, so a job that has exhausted retries (FAILED) stays terminal.
 *
 * Jobs without storage_path are also excluded because the worker cannot
 * download audio without a storage path.
 */
async function claimNextJob(): Promise<LoadedJob | null> {
    await requeueStaleProcessingJobs();

    const now = new Date().toISOString();

    const { data: candidate, error: fetchError } = await supabase
        .from('processing_jobs')
        .select('id, user_id, memory_id, capture_id, status, attempts, storage_path')
        .eq('job_type', 'TRANSCRIPTION')
        .eq('status', 'PENDING')
        .lt('available_at', now)
        .lt('attempts', MAX_ATTEMPTS)
        .not('storage_path', 'is', null)
        .order('created_at', { ascending: true })
        .limit(CLAIM_BATCH_SIZE)
        .maybeSingle();

    if (fetchError) {
        console.error(
            '[worker] Could not find a transcription job:',
            fetchError.message,
        );
        return null;
    }

    if (!candidate) {
        return null;
    }

    // Atomic transition: only succeeds if the job is still in the status we saw.
    const { data, error: claimError } = await supabase
        .from('processing_jobs')
        .update({
            status: 'PROCESSING',
            attempts: candidate.attempts + 1,
            available_at: now,
            updated_at: now,
        })
        .eq('id', candidate.id)
        .eq('status', candidate.status)
        .eq('attempts', candidate.attempts)
        .select('id, user_id, memory_id, capture_id, status, attempts, storage_path')
        .maybeSingle();

    if (claimError) {
        console.error(
            `[worker] Could not claim transcription job ${candidate.id}:`,
            claimError.message,
        );
        return null;
    }

    if (!data) {
        // Another worker claimed it first.
        return null;
    }

    // CHANGED:
    // Defensive validation after the atomic claim as well.
    // This protects us if the database changes between SELECT and UPDATE.
    if (!data.storage_path) {
        console.error(
            `[worker] Claimed transcription job ${data.id} without storage_path. ` +
            `capture_id=${data.capture_id}, memory_id=${data.memory_id}`,
        );

        // Put it into FAILED rather than retrying forever.
        await supabase
            .from('processing_jobs')
            .update({
                status: 'FAILED',
                error: {
                    message: 'The job has no audio storage path.',
                    attempts: data.attempts,
                },
                updated_at: new Date().toISOString(),
            })
            .eq('id', data.id)
            .eq('status', 'PROCESSING');

        return null;
    }

    return data as LoadedJob;
}

async function downloadAudioBytes(storagePath: string | null): Promise<Buffer> {
    if (!storagePath) {
        // CHANGED:
        // This remains a permanent error. Missing storage_path is a database/
        // job creation problem, not a temporary provider problem.
        throw new TranscriptionError(
            'The job has no audio storage path.',
            { transient: false },
        );
    }

    const { data, error } = await supabase.storage
        .from(VOICE_BUCKET)
        .download(storagePath);

    if (error) {
        // CHANGED:
        // Include the storage path in server-side logs, but do not expose
        // unnecessary storage details in the TranscriptionError message.
        console.error(
            `[worker] Could not download audio from storage: ${storagePath}`,
            error.message,
        );

        throw new TranscriptionError(
            'The stored audio could not be downloaded.',
            { transient: true },
        );
    }

    return Buffer.from(await data.arrayBuffer());
}

async function persistGeneratedTranscript(job: LoadedJob, transcript: string): Promise<void> {
    // BUG A: persist the transcript BEFORE marking the job COMPLETED. If
    // persistence fails, the job must NOT become COMPLETED — otherwise there
    // would be a COMPLETED job with no transcript. The audio and job are
    // preserved so a later attempt can retry.
    try {
        await upsertGeneratedTranscript({
            userId: job.user_id,
            memoryId: job.memory_id,
            captureId: job.capture_id,
            generatedTranscript: transcript,
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
            `[worker] Could not persist generated transcript for job ${job.id}: ${reason}`,
        );
        // Treat persistence failure as retryable: keep the job PENDING (via
        // failJob) so it can be attempted again. Audio is preserved.
        throw new TranscriptionError(
            `Transcript persistence failed: ${reason}`,
            { transient: true },
        );
    }
}

async function markJobCompleted(job: LoadedJob): Promise<void> {
    // This runs ONLY after the transcript has been persisted successfully.
    const { error } = await supabase
        .from('processing_jobs')
        .update({
            status: 'COMPLETED',
            error: null,
            updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'PROCESSING');

    if (error) {
        console.error(
            `[worker] Could not mark job ${job.id} completed:`,
            error.message,
        );
    }
}

async function failJob(
    job: LoadedJob,
    retryable: boolean,
    message: string,
): Promise<void> {
    const nextStatus = retryable ? 'PENDING' : 'FAILED';
    const delay = retryable ? backoffDelayMs(job.attempts) : 0;

    const availableAt = retryable
        ? new Date(Date.now() + delay).toISOString()
        : new Date().toISOString();

    const { error } = await supabase
        .from('processing_jobs')
        .update({
            status: nextStatus,
            available_at: availableAt,
            error: {
                message,
                attempts: job.attempts,
            },
            updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

    if (error) {
        console.error(
            `[worker] Could not update failure state for job ${job.id}:`,
            error.message,
        );
    }
}

export async function processTranscriptionJob(
    provider: TranscriptionProvider,
    job: LoadedJob,
): Promise<void> {
    // Download + transcribe first.
    let transcript: string;
    try {
        const audioBytes = await downloadAudioBytes(job.storage_path);
        const result = await provider.transcribe({
            audioBytes,
            filename: filenameFromStoragePath(job.storage_path ?? 'recording.m4a'),
        });
        transcript = result.text;
    } catch (error) {
        await handleTranscriptionFailure(job, error);
        return;
    }

    // BUG A: persist the transcript BEFORE marking the job COMPLETED. If
    // persistence fails, handleTranscriptionFailure keeps the job retryable and
    // preserves the audio — the job never becomes COMPLETED without a transcript.
    try {
        await persistGeneratedTranscript(job, transcript);
    } catch (error) {
        await handleTranscriptionFailure(job, error);
        return;
    }

    await markJobCompleted(job);
    console.info(
        `[worker] Transcription completed for job ${job.id} (attempt ${job.attempts}/${MAX_ATTEMPTS}).`,
    );
}

async function handleTranscriptionFailure(job: LoadedJob, error: unknown): Promise<void> {
    const attempt = job.attempts;

    if (
        error instanceof TranscriptionError &&
        error.transient &&
        attempt < MAX_ATTEMPTS
    ) {
        console.warn(
            `[worker] Transcription failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${error.message}. Retrying.`,
        );
        await failJob(job, true, error.message);
    } else {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
            `[worker] Transcription failed on attempt ${attempt}/${MAX_ATTEMPTS}: ${reason}`,
        );
        await failJob(job, false, reason);
    }
}

export async function runTranscriptionWorkerTick(): Promise<void> {
    const job = await claimNextJob();

    if (!job) {
        return;
    }

    await processTranscriptionJob(
        getTranscriptionProvider(),
        job,
    );
}

export function startTranscriptionWorker(): () => void {
    // Run one tick immediately on start, then poll.
    runTranscriptionWorkerTick().catch((error) => {
        console.error(
            '[worker] Unexpected worker tick failure:',
            error instanceof Error ? error.message : String(error),
        );
    });

    const intervalId = setInterval(() => {
        runTranscriptionWorkerTick().catch((error) => {
            console.error(
                '[worker] Unexpected worker tick failure:',
                error instanceof Error ? error.message : String(error),
            );
        });
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
}