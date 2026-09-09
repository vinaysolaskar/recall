import { Router, json } from 'express';

import { requireAuth, type AuthenticatedUser } from '../auth/middleware.js';
import {
    VoiceSyncError,
    claimProcessingJob,
    deleteCaptureData,
    deleteMemoryData,
    listProcessingJobs,
    parseVoiceSyncInput,
    parseStableId,
    syncVoiceCapture,
} from './service.js';

// Voice audio payloads arrive base64-encoded inside JSON: 25 MB audio expands to
// roughly 34 MB of text, so the JSON body limit must exceed that.
const MAX_JSON_BODY = '40mb';

export const voiceRouter = Router();

voiceRouter.use(requireAuth);

voiceRouter.post('/sync', json({ limit: MAX_JSON_BODY }), async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        const input = parseVoiceSyncInput(request.body);
        const result = await syncVoiceCapture(user.id, input);
        response.status(200).json(result);
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Voice sync failed:', error);
        response.status(500).json({ error: 'The recording could not be uploaded. It stays saved on the device.' });
    }
});

voiceRouter.get('/jobs', async (_request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        response.status(200).json({ jobs: await listProcessingJobs(user.id) });
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Listing processing jobs failed:', error);
        response.status(500).json({ error: 'Could not load processing jobs.' });
    }
});

voiceRouter.post('/jobs/:jobId/claim', async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        const job = await claimProcessingJob(user.id, request.params.jobId ?? '');
        if (!job) {
            response.status(404).json({ error: 'Processing job not found.' });
            return;
        }
        response.status(200).json(job);
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Claiming processing job failed:', error);
        response.status(500).json({ error: 'Could not claim the processing job.' });
voiceRouter.delete('/captures/:captureId', async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        const captureId = parseStableId(request.params.captureId, 'captureId');
        const result = await deleteCaptureData(user.id, captureId);
        response.status(200).json(result);
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Deleting capture failed:', error);
        response.status(500).json({ error: 'Could not delete the capture.' });
    }
});

voiceRouter.delete('/memories/:memoryId', async (request, response) => {
    const user = response.locals.user as AuthenticatedUser;
    try {
        const memoryId = parseStableId(request.params.memoryId, 'memoryId');
        await deleteMemoryData(user.id, memoryId);
        response.status(200).json({ ok: true });
    } catch (error) {
        if (error instanceof VoiceSyncError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        console.error('Deleting memory failed:', error);
        response.status(500).json({ error: 'Could not delete the memory.' });
    }
});


    }
});
