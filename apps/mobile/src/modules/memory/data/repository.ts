import type { Capture, Memory } from '../domain/types';

export type MemoryWithCaptures = {
    memory: Memory;
    captures: Capture[];
};

export interface MemoryRepository {
    listMemories(): Promise<Memory[]>;
    getMemory(id: string): Promise<MemoryWithCaptures | null>;
    createTextMemory(text: string): Promise<MemoryWithCaptures>;
    createVoiceMemory(audioUri: string, durationSeconds: number): Promise<MemoryWithCaptures>;
    addTextCapture(memoryId: string, text: string): Promise<MemoryWithCaptures>;
    addVoiceCapture(memoryId: string, audioUri: string, durationSeconds: number): Promise<MemoryWithCaptures>;
    updateTextCapture(captureId: string, text: string): Promise<MemoryWithCaptures>;
    deleteMemory(id: string): Promise<void>;
}