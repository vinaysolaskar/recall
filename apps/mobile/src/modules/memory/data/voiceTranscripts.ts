import { apiBaseUrl } from '../../../infrastructure/api/client';
import { supabase } from '../../../infrastructure/supabase/client';
import type { ProcessingStatus } from '../domain/types';

export type VoiceTranscriptStatus = {
    captureId: string;
    jobStatus: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | null;
    jobError: string | null;
    generatedTranscript: string | null;
    editedTranscript: string | null;
};

export type TranscriptStatusMap = Record<string, VoiceTranscriptStatus>;

function mapServerStatuses(raw: unknown): TranscriptStatusMap {
    const result: TranscriptStatusMap = {};
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { captures?: unknown }).captures)) {
        return result;
    }
    for (const entry of (raw as { captures: unknown[] }).captures) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const row = entry as Record<string, unknown>;
        const captureId = typeof row.captureId === 'string' ? row.captureId : '';
        if (!captureId) {
            continue;
        }
        const jobStatus = row.jobStatus;
        result[captureId] = {
            captureId,
            jobStatus: jobStatus === 'PENDING' || jobStatus === 'PROCESSING' || jobStatus === 'COMPLETED' || jobStatus === 'FAILED'
                ? jobStatus
                : null,
            jobError: typeof row.jobError === 'string' ? row.jobError : null,
            generatedTranscript: typeof row.generatedTranscript === 'string' ? row.generatedTranscript : null,
            editedTranscript: typeof row.editedTranscript === 'string' ? row.editedTranscript : null,
        };
    }
    return result;
}

/** Maps the backend job status to the domain ProcessingStatus used in labels. */
export function mapJobStatusToProcessing(jobStatus: VoiceTranscriptStatus['jobStatus']): ProcessingStatus {
    switch (jobStatus) {
        case 'PENDING':
            return 'queued';
        case 'PROCESSING':
            return 'processing';
        case 'COMPLETED':
            return 'completed';
        case 'FAILED':
            return 'failed';
        default:
            return 'none';
    }
}

export async function fetchVoiceCaptureStatuses(captureIds: string[]): Promise<TranscriptStatusMap> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
        throw new Error('Not signed in.');
    }

    const response = await fetch(`${apiBaseUrl}/processing/transcripts/status?captureIds=${encodeURIComponent(captureIds.join(','))}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
        throw new Error('Could not load transcripts.');
    }

    return mapServerStatuses(await response.json());
}

export async function saveEditedTranscript(captureId: string, editedTranscript: string | null): Promise<void> {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
        throw new Error('Not signed in.');
    }

    const response = await fetch(`${apiBaseUrl}/processing/transcripts/${encodeURIComponent(captureId)}/edited`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ editedTranscript }),
    });

    if (!response.ok) {
        let message = 'Could not save the transcript.';
        try {
            const body = await response.json();
            if (typeof body?.error === 'string') {
                message = body.error;
            }
        } catch {
            // Keep the default message when there is no JSON body.
        }
        throw new Error(message);
    }
}