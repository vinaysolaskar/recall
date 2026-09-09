import { supabase } from '../../infrastructure/supabase/client.js';
import { VoiceSyncError } from '../voice/service.js';

export type CaptureStatusSummary = {
    captureId: string;
    jobStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
    jobError: string | null;
    generatedTranscript: string | null;
    editedTranscript: string | null;
};

// BUG 4: explicit update/insert strategy so each operation touches ONLY its
// own column. A merge-upsert that omits a column could theoretically null it
// out depending on PostgREST behavior; an explicit UPDATE (then INSERT on
// miss) guarantees generated_transcript and edited_transcript stay independent.

export async function upsertGeneratedTranscript(input: { userId: string; memoryId: string; captureId: string; generatedTranscript: string | null }): Promise<void> {
    await updateOrInsert(input.captureId, {
        user_id: input.userId,
        memory_id: input.memoryId,
        generated_transcript: input.generatedTranscript,
    });
}

export async function upsertEditedTranscript(input: { userId: string; memoryId: string; captureId: string; editedTranscript: string | null }): Promise<void> {
    await updateOrInsert(input.captureId, {
        user_id: input.userId,
        memory_id: input.memoryId,
        edited_transcript: input.editedTranscript,
    });
}

// Clears ONLY the edited_transcript for a capture. The generated transcript is
// preserved. No-op if the row does not exist yet.
export async function clearEditedTranscript(userId: string, captureId: string): Promise<void> {
    const { error } = await supabase
        .from('capture_transcripts')
        .update({ edited_transcript: null, updated_at: new Date().toISOString() })
        .eq('capture_id', captureId)
        .eq('user_id', userId);

    if (error) {
        throw new VoiceSyncError('Could not clear the edited transcript.', 500);
    }
}

// Updates the row if it exists; otherwise inserts it. Only the provided columns
// are written, so the other transcript column is never touched.
async function updateOrInsert(captureId: string, payload: Record<string, unknown>): Promise<void> {
    const { data: existing, error: fetchError } = await supabase
        .from('capture_transcripts')
        .select('id')
        .eq('capture_id', captureId)
        .maybeSingle();

    if (fetchError) {
        throw new VoiceSyncError('Could not load the transcript row.', 500);
    }

    if (existing) {
        const { error } = await supabase
            .from('capture_transcripts')
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq('capture_id', captureId);

        if (error) {
            throw new VoiceSyncError('Could not update the transcript.', 500);
        }
        return;
    }

    const { error } = await supabase
        .from('capture_transcripts')
        .insert({ capture_id: captureId, ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

    if (error) {
        throw new VoiceSyncError('Could not store the transcript.', 500);
    }
}

export async function getCaptureStatuses(userId: string, captureIds: string[]): Promise<CaptureStatusSummary[]> {
    const [jobsResult, transcriptsResult] = await Promise.all([
        supabase
            .from('processing_jobs')
            .select('capture_id, status, error')
            .eq('user_id', userId)
            .eq('job_type', 'TRANSCRIPTION')
            .in('capture_id', captureIds),
        supabase
            .from('capture_transcripts')
            .select('capture_id, generated_transcript, edited_transcript')
            .eq('user_id', userId)
            .in('capture_id', captureIds),
    ]);

    if (jobsResult.error) {
        throw new VoiceSyncError('Could not load capture processing status.', 500);
    }
    if (transcriptsResult.error) {
        throw new VoiceSyncError('Could not load transcripts.', 500);
    }

    const jobs = (jobsResult.data ?? []) as Array<{ capture_id: string; status: string; error: unknown }>;
    const transcripts = (transcriptsResult.data ?? []) as Array<{ capture_id: string; generated_transcript: string | null; edited_transcript: string | null }>;

    const jobByCapture = new Map(jobs.map((row) => [row.capture_id, row]));
    const transcriptByCapture = new Map(transcripts.map((row) => [row.capture_id, row]));

    return captureIds
        .filter((captureId) => jobByCapture.has(captureId) || transcriptByCapture.has(captureId))
        .map((captureId) => {
            const job = jobByCapture.get(captureId);
            const transcript = transcriptByCapture.get(captureId);
            const rawError: unknown = job?.error;
            const jobError = typeof rawError === 'string'
                ? rawError
                : rawError !== null && typeof rawError === 'object' && typeof (rawError as { message?: unknown }).message === 'string'
                    ? (rawError as { message: string }).message
                    : null;
            return {
                captureId,
                jobStatus: (job?.status ?? null) as CaptureStatusSummary['jobStatus'],
                jobError,
                generatedTranscript: transcript?.generated_transcript ?? null,
                editedTranscript: transcript?.edited_transcript ?? null,
            };
        });
}
