import './config/index.js';
import express from 'express';
import { authRouter } from './modules/auth/routes.js';
import { voiceRouter } from './modules/voice/routes.js';
import { processingRouter } from './modules/processing/routes.js';
import { startTranscriptionWorker } from './modules/processing/worker.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/voice', voiceRouter);
app.use('/processing', processingRouter);

// Simple database-backed transcription worker. Disable with
// ENABLE_TRANSCRIPTION_WORKER=false when running the backend without Groq.
const shouldRunWorker = process.env.ENABLE_TRANSCRIPTION_WORKER !== 'false';
const stopWorker = shouldRunWorker ? startTranscriptionWorker() : null;

app.listen(port, () => {
    console.log(`Recall server listening on port ${port}`);
});

process.on('SIGINT', () => {
    stopWorker?.();
    process.exit(0);
});
process.on('SIGTERM', () => {
    stopWorker?.();
    process.exit(0);
});
