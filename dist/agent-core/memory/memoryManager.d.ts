import { ProjectMemory, MemoryType } from '../../types';
import { Logger } from '../logger/logger';
export declare class MemoryManager {
    private supabase;
    private logger;
    private memoryCache;
    private maxCacheSize;
    constructor(logger: Logger);
    storeMemory(projectId: string, memoryType: MemoryType, content: Record<string, any>, importanceScore?: number, embedding?: number[]): Promise<ProjectMemory>;
    retrieveMemories(projectId: string, memoryType?: MemoryType, limit?: number, minImportance?: number): Promise<ProjectMemory[]>;
    getMemoryById(memoryId: string): Promise<ProjectMemory | null>;
    updateMemory(memoryId: string, updates: Partial<Pick<ProjectMemory, 'content' | 'importance_score' | 'memory_type'>>): Promise<ProjectMemory | null>;
    deleteMemory(memoryId: string): Promise<boolean>;
    storeInsight(projectId: string, insight: string, context: Record<string, any>, importance?: number): Promise<ProjectMemory>;
    storePattern(projectId: string, pattern: string, examples: string[], frequency: number, importance?: number): Promise<ProjectMemory>;
    storeError(projectId: string, error: string, solution: string, context: Record<string, any>, importance?: number): Promise<ProjectMemory>;
    storeSuccess(projectId: string, action: string, outcome: string, metrics: Record<string, number>, importance?: number): Promise<ProjectMemory>;
    storePreference(projectId: string, preference: string, value: any, reasoning: string, importance?: number): Promise<ProjectMemory>;
    storeContext(projectId: string, contextType: string, data: Record<string, any>, importance?: number): Promise<ProjectMemory>;
    getInsights(projectId: string, limit?: number): Promise<ProjectMemory[]>;
    getPatterns(projectId: string, limit?: number): Promise<ProjectMemory[]>;
    getErrors(projectId: string, limit?: number): Promise<ProjectMemory[]>;
    getSuccesses(projectId: string, limit?: number): Promise<ProjectMemory[]>;
    getPreferences(projectId: string): Promise<ProjectMemory[]>;
    getRecentContext(projectId: string, contextType?: string): Promise<ProjectMemory[]>;
    searchMemories(projectId: string, searchTerm: string, memoryType?: MemoryType, limit?: number): Promise<ProjectMemory[]>;
    getLearningsSummary(projectId: string): Promise<Record<string, any>>;
    private addToCache;
    private updateInCache;
    private removeFromCache;
    private updateAccessCounts;
    cleanupOldMemories(retentionDays?: number): Promise<void>;
    exportProjectMemories(projectId: string): Promise<ProjectMemory[]>;
    importProjectMemories(projectId: string, memories: ProjectMemory[]): Promise<number>;
    clearProjectCache(projectId: string): void;
    getCacheStats(): Record<string, any>;
}
//# sourceMappingURL=memoryManager.d.ts.map