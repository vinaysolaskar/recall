import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Capture, Memory } from '../domain/types';
import type { MemoryRepository, MemoryWithCaptures } from './repository';

type LocalMemoryData = {
    memories: Memory[];
    captures: Capture[];
};

const emptyData: LocalMemoryData = { memories: [], captures: [] };
const MAX_MEMORIES = 5;

function createMemoryCapture(memoryId: string, audioUri: string, durationSeconds: number, now: string): Capture {
    return {
        id: createId(),
        memoryId,
        type: 'voice',
        audioUri,
        durationSeconds,
        capturedAt: now,
        createdAt: now,
        updatedAt: now,
    };
}

function createId(): string {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (randomUuid) {
        return randomUuid.call(globalThis.crypto);
    }

    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function sortMemories(memories: Memory[]): Memory[] {
    return [...memories].sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

function sortCaptures(captures: Capture[]): Capture[] {
    return [...captures].sort((first, second) => {
        const capturedAtOrder = first.capturedAt.localeCompare(second.capturedAt);
        return capturedAtOrder || first.createdAt.localeCompare(second.createdAt);
    });
}

export class LocalMemoryRepository implements MemoryRepository {
    private readonly storageKey: string;

    public constructor(userId: string) {
        this.storageKey = `recall.memory-capture.v1.${userId}`;
    }

    public async listMemories(): Promise<Memory[]> {
        const data = await this.readData();
        return sortMemories(data.memories);
    }

    public async getMemory(id: string): Promise<MemoryWithCaptures | null> {
        const data = await this.readData();
        const memory = data.memories.find((item) => item.id === id);
        if (!memory) {
            return null;
        }

        return {
            memory,
            captures: sortCaptures(data.captures.filter((item) => item.memoryId === id)),
        };
    }

    public async createTextMemory(text: string): Promise<MemoryWithCaptures> {
        const existingData = await this.readData();
        if (existingData.memories.length >= MAX_MEMORIES) {
            throw new Error('Memory limit reached. You can save up to 5 Memories.');
        }

        const now = new Date().toISOString();
        const memory: Memory = {
            id: createId(),
            createdAt: now,
            updatedAt: now,
            folderId: null,
        };
        const capture: Capture = {
            id: createId(),
            memoryId: memory.id,
            type: 'text',
            text,
            capturedAt: now,
            createdAt: now,
            updatedAt: now,
        };

        await this.writeData({ memories: [memory], captures: [capture] }, true);
        return { memory, captures: [capture] };
    }

    public async createVoiceMemory(audioUri: string, durationSeconds: number): Promise<MemoryWithCaptures> {
        const existingData = await this.readData();
        if (existingData.memories.length >= MAX_MEMORIES) {
            throw new Error('Memory limit reached. You can save up to 5 Memories.');
        }

        const now = new Date().toISOString();
        const memory: Memory = { id: createId(), createdAt: now, updatedAt: now, folderId: null };
        const capture = createMemoryCapture(memory.id, audioUri, durationSeconds, now);
        await this.writeData({ memories: [memory], captures: [capture] }, true);
        return { memory, captures: [capture] };
    }

    public async addTextCapture(memoryId: string, text: string): Promise<MemoryWithCaptures> {
        const data = await this.readData();
        const memoryIndex = data.memories.findIndex((item) => item.id === memoryId);
        if (memoryIndex === -1) {
            throw new Error('Memory not found.');
        }

        const now = new Date().toISOString();
        const capture: Capture = {
            id: createId(),
            memoryId,
            type: 'text',
            text,
            capturedAt: now,
            createdAt: now,
            updatedAt: now,
        };
        const memory: Memory = { ...data.memories[memoryIndex], updatedAt: now };
        data.memories[memoryIndex] = memory;
        data.captures.push(capture);
        await this.writeData(data);

        return {
            memory,
            captures: sortCaptures(data.captures.filter((item) => item.memoryId === memoryId)),
        };
    }

    public async addVoiceCapture(memoryId: string, audioUri: string, durationSeconds: number): Promise<MemoryWithCaptures> {
        const data = await this.readData();
        const memoryIndex = data.memories.findIndex((item) => item.id === memoryId);
        if (memoryIndex === -1) {
            throw new Error('Memory not found.');
        }

        const now = new Date().toISOString();
        const capture = createMemoryCapture(memoryId, audioUri, durationSeconds, now);
        const memory: Memory = { ...data.memories[memoryIndex], updatedAt: now };
        data.memories[memoryIndex] = memory;
        data.captures.push(capture);
        await this.writeData(data);

        return {
            memory,
            captures: sortCaptures(data.captures.filter((item) => item.memoryId === memoryId)),
        };
    }

    public async updateTextCapture(captureId: string, text: string): Promise<MemoryWithCaptures> {
        const data = await this.readData();
        const capture = data.captures.find((item) => item.id === captureId);
        if (!capture) {
            throw new Error('Capture not found.');
        }
        if (capture.type !== 'text') {
            throw new Error('Only text Captures can be edited as text.');
        }

        const now = new Date().toISOString();
        const updatedCapture: Capture = { ...capture, text, updatedAt: now };
        const memoryIndex = data.memories.findIndex((item) => item.id === capture.memoryId);
        if (memoryIndex === -1) {
            throw new Error('Memory not found.');
        }

        const updatedMemory: Memory = { ...data.memories[memoryIndex], updatedAt: now };
        data.captures = data.captures.map((item) => item.id === captureId ? updatedCapture : item);
        data.memories[memoryIndex] = updatedMemory;
        await this.writeData(data);

        return {
            memory: updatedMemory,
            captures: sortCaptures(data.captures.filter((item) => item.memoryId === capture.memoryId)),
        };
    }

    public async deleteMemory(id: string): Promise<void> {
        const data = await this.readData();
        await this.writeData({
            memories: data.memories.filter((item) => item.id !== id),
            captures: data.captures.filter((item) => item.memoryId !== id),
        });
    }

    private async readData(): Promise<LocalMemoryData> {
        const storedData = await AsyncStorage.getItem(this.storageKey);
        if (!storedData) {
            return { ...emptyData };
        }

        try {
            const parsedData = JSON.parse(storedData) as Partial<LocalMemoryData>;
            return {
                memories: Array.isArray(parsedData.memories) ? parsedData.memories : [],
                captures: Array.isArray(parsedData.captures) ? parsedData.captures : [],
            };
        } catch {
            return { ...emptyData };
        }
    }

    private async writeData(data: LocalMemoryData, append = false): Promise<void> {
        if (append) {
            const existingData = await this.readData();
            data = {
                memories: [...existingData.memories, ...data.memories],
                captures: [...existingData.captures, ...data.captures],
            };
        }

        await AsyncStorage.setItem(this.storageKey, JSON.stringify(data));
    }
}