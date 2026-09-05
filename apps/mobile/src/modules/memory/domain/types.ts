export type CaptureType = 'text';

export type Memory = {
    id: string;
    createdAt: string;
    updatedAt: string;
    folderId: string | null;
};

export type Capture = {
    id: string;
    memoryId: string;
    type: CaptureType;
    text: string;
    capturedAt: string;
    createdAt: string;
    updatedAt: string;
};