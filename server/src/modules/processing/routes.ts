import { Router, json } from 'express';

import { requireAuth, type AuthenticatedUser } from '../auth/middleware.js';
import { MAX_TRANSCRIPT_CHARS, VoiceSyncError, parseCaptureIdList, parseStableId } from '../voice/service.js';
import { getCaptureStatuses, upsertEditedTranscript, clearEditedTranscript } from './transcripts.js';
import { supabase } from '../../infrastructure/supabase/client.js';

export const processingRouter = Router();

processingRouter.use(requireAuth);

// Returns the processing status and transcript (generated + edited) for a set of
// voice captures. Ownership is enforced by filtering on the authenticated user.
processingRouter.get('/transcripts/status', async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        const captureIds = parseCaptureIdList(request.query.captureIds);
        const statuses = await getCaptureStatuses(user.id, captureIds);
        response.status(200).json({ captures: statuses });
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Loading transcript status failed:', error);
        response.status(500).json({ error: 'Could not load transcripts.' });
    }
});

// Persists the user-edited transcript. The generated transcript is preserved
// (merge-upsert only touches edited_transcript). Editing never creates a new
// processing job. Empty/whitespace values clear the edit and fall back to the
// generated transcript.
//
// BUG 3: null clears the edited transcript; a string saves/updates it; undefined
// or a missing field is invalid.
processingRouter.post('/transcripts/:captureId/edited', json(), async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        const captureId = parseStableId(request.params.captureId, 'captureId');
        const body = request.body as Record<string, unknown> | undefined;
        if (!body || typeof body.editedTranscript === 'undefined') {
            throw new VoiceSyncError('editedTranscript is required.');
        }

        const { editedTranscript } = body;

        // null clears the edited transcript (falls back to generated).
        if (editedTranscript === null) {
            await clearEditedTranscript(user.id, captureId);
            response.status(200).json({ ok: true });
            return;
        }

        if (typeof editedTranscript !== 'string') {
            throw new VoiceSyncError('editedTranscript must be a string or null.');
        }
        if (editedTranscript.length > MAX_TRANSCRIPT_CHARS) {
            throw new VoiceSyncError(`Transcript must be ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters or fewer.`);
        }

        // Ownership gate: the capture must belong to this user (a processing job
        // exists for this user + capture), so users cannot write arbitrary rows.
        const { data: job, error: jobError } = await supabase
            .from('processing_jobs')
            .select('id, memory_id')
            .eq('user_id', user.id)
            .eq('capture_id', captureId)
            .eq('job_type', 'TRANSCRIPTION')
            .maybeSingle();

        if (jobError) {
            throw new VoiceSyncError('Could not verify the capture.', 500);
        }
        if (!job) {
            response.status(404).json({ error: 'Capture not found.' });
            return;
        }

        const trimmed = editedTranscript.trim();
        await upsertEditedTranscript({
            userId: user.id,
            memoryId: job.memory_id,
            captureId,
            editedTranscript: trimmed.length === 0 ? null : trimmed,
        });

        response.status(200).json({ ok: true });
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Saving edited transcript failed:', error);
        response.status(500).json({ error: 'Could not save the transcript.' });
    }
});