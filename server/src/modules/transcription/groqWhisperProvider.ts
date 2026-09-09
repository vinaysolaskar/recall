import { config } from '../../config/index.js';
import {
    TranscriptionError,
    type TranscriptionProvider,
    type TranscriptionRequest,
    type TranscriptionResult,
} from './provider.js';

const GROQ_TRANSCRIPTIONS_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const WHISPER_MODEL = 'whisper-large-v3';
const REQUEST_TIMEOUT_MS = 120_000;

const CONTENT_TYPES: Record<string, string> = {
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    webm: 'audio/webm',
};

function contentTypeForFilename(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

// CHANGED: Keep the provider's actual error message so worker logs can tell us
// whether the failure is authentication, file size, invalid audio, rate limiting,
// or another provider-side validation problem.
function errorForStatus(status: number, detail = ''): TranscriptionError {
    const suffix = detail ? `: ${detail}` : '';

    // Rate limiting stays transient (bounded retries); it must never silently
    // escalate to a paid tier.
    if (status === 429) {
        return new TranscriptionError(
            `The transcription provider is rate limiting requests (status ${status}). The job will be retried${suffix}`,
            { transient: true },
        );
    }

    // Credential problems are permanent until the server configuration changes.
    if (status === 401 || status === 403) {
        return new TranscriptionError(
            `The transcription provider rejected the server credentials (status ${status})${suffix}`,
            { transient: false },
        );
    }

    // Provider file-size rejection is permanent for this recording.
    if (status === 413) {
        return new TranscriptionError(
            `The audio file is too large for the transcription provider (status ${status})${suffix}`,
            { transient: false },
        );
    }

    // Other 5xx provider errors are transient.
    if (status >= 500) {
        return new TranscriptionError(
            `The transcription provider had a temporary problem (status ${status})${suffix}`,
            { transient: true },
        );
    }

    // Other 4xx errors are considered permanent.
    return new TranscriptionError(
        `The transcription provider rejected the request (status ${status})${suffix}`,
        { transient: false },
    );
}

// CHANGED: Read the provider's error response body without logging credentials,
// audio contents, or the full response.
async function getProviderErrorDetail(response: Response): Promise<string> {
    try {
        const body = await response.json() as {
            error?: {
                message?: unknown;
            };
            message?: unknown;
        };

        if (typeof body.error?.message === 'string') {
            return body.error.message.slice(0, 500);
        }

        if (typeof body.message === 'string') {
            return body.message.slice(0, 500);
        }
    } catch {
        // Fall through to a plain-text response attempt.
    }

    try {
        const text = await response.text();
        return text.trim().slice(0, 500);
    } catch {
        return '';
    }
}

export class GroqWhisperProvider implements TranscriptionProvider {
    public readonly name = 'groq-whisper-large-v3';

    public async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
        // No language or translation parameters are sent: whisper-large-v3 returns
        // the spoken language as-is, which preserves multilingual and
        // code-switched speech.
        const form = new FormData();

        const audioBuffer = request.audioBytes.buffer.slice(
            request.audioBytes.byteOffset,
            request.audioBytes.byteOffset + request.audioBytes.byteLength,
        ) as ArrayBuffer;

        form.append(
            'file',
            new Blob(
                [audioBuffer],
                { type: contentTypeForFilename(request.filename) },
            ),
            request.filename,
        );

        form.append('model', WHISPER_MODEL);
        form.append('response_format', 'json');

        let response: Response;

        try {
            response = await fetch(GROQ_TRANSCRIPTIONS_ENDPOINT, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.groqApiKey}`,
                },
                body: form,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
        } catch (error) {
            // CHANGED: Preserve a useful timeout/network distinction while still
            // treating transport failures as transient.
            const reason = error instanceof Error ? error.message : String(error);

            throw new TranscriptionError(
                `Could not reach the transcription provider${reason ? `: ${reason}` : ''}`,
                { transient: true },
            );
        }

        if (!response.ok) {
            // CHANGED: Previously the response body was discarded. This is the
            // key diagnostic fix for the current "permanent or attempts exhausted"
            // messages.
            const detail = await getProviderErrorDetail(response);

            throw errorForStatus(response.status, detail);
        }

        const payload = (await response.json().catch(() => null)) as {
            text?: unknown;
        } | null;

        if (!payload || typeof payload.text !== 'string') {
            throw new TranscriptionError(
                'The transcription provider returned an unexpected response.',
                { transient: true },
            );
        }

        return { text: payload.text };
    }
}

let providerInstance: TranscriptionProvider | null = null;

export function getTranscriptionProvider(): TranscriptionProvider {
    if (!providerInstance) {
        providerInstance = new GroqWhisperProvider();
    }

    return providerInstance;
}