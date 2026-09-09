// Provider abstraction: processing logic depends on this interface, never on
// Groq directly. Swapping providers later must not touch job/worker code.

export type TranscriptionRequest = {
    /** Raw bytes of the stored original audio. */
    audioBytes: Buffer;
    /** Filename (including extension) so the provider can set the correct media type. */
    filename: string;
};

export type TranscriptionResult = {
    /** Transcript exactly as returned by the provider, in the spoken language. */
    text: string;
};

export class TranscriptionError extends Error {
    /** Transient errors are retried with backoff; permanent ones fail immediately. */
    public readonly transient: boolean;

    public constructor(message: string, options: { transient: boolean }) {
        super(message);
        this.name = 'TranscriptionError';
        this.transient = options.transient;
    }
}

export interface TranscriptionProvider {
    readonly name: string;
    transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}
