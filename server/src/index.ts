import './config/index.js';
import express from 'express';
import { authRouter } from './modules/auth/routes.js';
import { voiceRouter } from './modules/voice/routes.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.get('/health', (_request, response) => {
    response.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/voice', voiceRouter);

app.listen(port, () => {
    console.log(`Recall server listening on port ${port}`);
});
