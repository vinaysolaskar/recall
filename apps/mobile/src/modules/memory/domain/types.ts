export type CaptureType = 'text' | 'voice';

export type SyncStatus = 'local' | 'upload_pending' | 'uploading' | 'uploaded' | 'failed';

export type ProcessingStatus = 'none' | 'queued' | 'processing' | 'completed' | 'failed';

export type Memory = {
    id: string;
    createdAt: string;
    updatedAt: string;
    folderId: string | null;
};

type CaptureBase = {
    id: string;
    memoryId: string;
    type: CaptureType;
    capturedAt: string;
    createdAt: string;
    updatedAt: string;
};

export type TextCapture = CaptureBase & {
    type: 'text';
    text: string;
};

export type VoiceCapture = CaptureBase & {
    type: 'voice';
    audioUri: string;
    durationSeconds: number;
    syncStatus?: SyncStatus;
    syncError?: string | null;
    processingStatus?: ProcessingStatus;
};

export type Capture = TextCapture | VoiceCapture;