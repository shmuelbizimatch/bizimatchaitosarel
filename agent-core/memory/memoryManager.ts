import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ProjectMemory, MemoryType } from '../../types';
import { Logger } from '../logger/logger';
import { v4 as uuidv4 } from 'uuid';

export class MemoryManager {
  private supabase: SupabaseClient;
  private logger: Logger;
  private memoryCache: Map<string, ProjectMemory[]> = new Map(); // projectId -> memories
  private maxCacheSize: number = 1000;

  constructor(logger: Logger) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.logger = logger;
  }

  async storeMemory(
    projectId: string,
    memoryType: MemoryType,
    content: Record<string, any>,
    importanceScore: number = 5,
    embedding?: number[]
  ): Promise<ProjectMemory> {
    const memory: ProjectMemory = {
      id: uuidv4(),
      project_id: projectId,
      memory_type: memoryType,
      content,
      embedding,
      importance_score: Math.max(1, Math.min(10, importanceScore)), // Clamp between 1-10
      created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(),
      access_count: 0
    };

    try {
      const { data, error } = await this.supabase
        .from('memory')
        .insert([memory])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to store memory: ${error.message}`);
      }

      const storedMemory = data as ProjectMemory;

      // Update cache
      this.addToCache(projectId, storedMemory);

      await this.logger.debug('orchestrator', `Memory stored: ${storedMemory.id}`, {
        memory_id: storedMemory.id,
        project_id: projectId,
        memory_type: memoryType,
        importance_score: importanceScore
      });

      return storedMemory;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to store memory', {
        project_id: projectId,
        memory_type: memoryType,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async retrieveMemories(
    projectId: string,
    memoryType?: MemoryType,
    limit: number = 50,
    minImportance: number = 1
  ): Promise<ProjectMemory[]> {
    try {
      // Check cache first
      const cachedMemories = this.memoryCache.get(projectId);
      if (cachedMemories && cachedMemories.length > 0) {
        let filtered = cachedMemories.filter(m => m.importance_score >= minImportance);
        if (memoryType) {
          filtered = filtered.filter(m => m.memory_type === memoryType);
        }
        
        // Update access counts for retrieved memories
        await this.updateAccessCounts(filtered.slice(0, limit).map(m => m.id));
        
        return filtered
          .sort((a, b) => b.importance_score - a.importance_score)
          .slice(0, limit);
      }

      // Fetch from database
      let query = this.supabase
        .from('memory')
        .select('*')
        .eq('project_id', projectId)
        .gte('importance_score', minImportance)
        .order('importance_score', { ascending: false })
        .limit(limit);

      if (memoryType) {
        query = query.eq('memory_type', memoryType);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to retrieve memories: ${error.message}`);
      }

      const memories = (data || []) as ProjectMemory[];

      // Update cache
      this.memoryCache.set(projectId, memories);

      // Update access counts
      if (memories.length > 0) {
        await this.updateAccessCounts(memories.map(m => m.id));
      }

      await this.logger.debug('orchestrator', `Retrieved ${memories.length} memories`, {
        project_id: projectId,
        memory_type: memoryType,
        count: memories.length,
        min_importance: minImportance
      });

      return memories;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to retrieve memories', {
        project_id: projectId,
        memory_type: memoryType,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async getMemoryById(memoryId: string): Promise<ProjectMemory | null> {
    try {
      const { data, error } = await this.supabase
        .from('memory')
        .select('*')
        .eq('id', memoryId)
        .single();

      if (error || !data) {
        return null;
      }

      const memory = data as ProjectMemory;

      // Update access count
      await this.updateAccessCounts([memoryId]);

      return memory;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to retrieve memory by ID', {
        memory_id: memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async updateMemory(
    memoryId: string,
    updates: Partial<Pick<ProjectMemory, 'content' | 'importance_score' | 'memory_type'>>
  ): Promise<ProjectMemory | null> {
    try {
      const { data, error } = await this.supabase
        .from('memory')
        .update(updates)
        .eq('id', memoryId)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update memory: ${error.message}`);
      }

      const updatedMemory = data as ProjectMemory;

      // Update cache
      this.updateInCache(updatedMemory);

      await this.logger.debug('orchestrator', `Memory updated: ${memoryId}`, {
        memory_id: memoryId,
        updates
      });

      return updatedMemory;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to update memory', {
        memory_id: memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('memory')
        .delete()
        .eq('id', memoryId);

      if (error) {
        throw new Error(`Failed to delete memory: ${error.message}`);
      }

      // Remove from cache
      this.removeFromCache(memoryId);

      await this.logger.debug('orchestrator', `Memory deleted: ${memoryId}`, {
        memory_id: memoryId
      });

      return true;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to delete memory', {
        memory_id: memoryId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  // Specialized methods for different memory types
  async storeInsight(
    projectId: string,
    insight: string,
    context: Record<string, any>,
    importance: number = 7
  ): Promise<ProjectMemory> {
    return this.storeMemory(projectId, 'insight', {
      insight,
      context,
      timestamp: new Date().toISOString()
    }, importance);
  }

  async storePattern(
    projectId: string,
    pattern: string,
    examples: string[],
    frequency: number,
    importance: number = 6
  ): Promise<ProjectMemory> {
    return this.storeMemory(projectId, 'pattern', {
      pattern,
      examples,
      frequency,
      discovered_at: new Date().toISOString()
    }, importance);
  }

  async storeError(
    projectId: string,
    error: string,
    solution: string,
    context: Record<string, any>,
    importance: number = 8
  ): Promise<ProjectMemory> {
    return this.storeMemory(projectId, 'error', {
      error,
      solution,
      context,
      occurred_at: new Date().toISOString()
    }, importance);
  }

  async storeSuccess(
    projectId: string,
    action: string,
    outcome: string,
    metrics: Record<string, number>,
    importance: number = 7
  ): Promise<ProjectMemory> {
    return this.storeMemory(projectId, 'success', {
      action,
      outcome,
      metrics,
      achieved_at: new Date().toISOString()
    }, importance);
  }

  async storePreference(
    projectId: string,
    preference: string,
    value: any,
    reasoning: string,
    importance: number = 5
  ): Promise<ProjectMemory> {
    return this.storeMemory(projectId, 'preference', {
      preference,
      value,
      reasoning,
      set_at: new Date().toISOString()
    }, importance);
  }

  async storeContext(
    projectId: string,
    contextType: string,
    data: Record<string, any>,
    importance: number = 4
  ): Promise<ProjectMemory> {
    return this.storeMemory(projectId, 'context', {
      context_type: contextType,
      data,
      captured_at: new Date().toISOString()
    }, importance);
  }

  // Retrieval methods for specific memory types
  async getInsights(projectId: string, limit: number = 20): Promise<ProjectMemory[]> {
    return this.retrieveMemories(projectId, 'insight', limit, 5);
  }

  async getPatterns(projectId: string, limit: number = 30): Promise<ProjectMemory[]> {
    return this.retrieveMemories(projectId, 'pattern', limit, 4);
  }

  async getErrors(projectId: string, limit: number = 15): Promise<ProjectMemory[]> {
    return this.retrieveMemories(projectId, 'error', limit, 6);
  }

  async getSuccesses(projectId: string, limit: number = 25): Promise<ProjectMemory[]> {
    return this.retrieveMemories(projectId, 'success', limit, 5);
  }

  async getPreferences(projectId: string): Promise<ProjectMemory[]> {
    return this.retrieveMemories(projectId, 'preference', 100, 1);
  }

  async getRecentContext(projectId: string, contextType?: string): Promise<ProjectMemory[]> {
    const contexts = await this.retrieveMemories(projectId, 'context', 10, 1);
    
    if (contextType) {
      return contexts.filter(c => 
        c.content.context_type === contextType
      );
    }
    
    return contexts;
  }

  // Search memories by content
  async searchMemories(
    projectId: string,
    searchTerm: string,
    memoryType?: MemoryType,
    limit: number = 20
  ): Promise<ProjectMemory[]> {
    try {
      let query = this.supabase
        .from('memory')
        .select('*')
        .eq('project_id', projectId)
        .textSearch('content', searchTerm, {
          type: 'websearch',
          config: 'english'
        })
        .order('importance_score', { ascending: false })
        .limit(limit);

      if (memoryType) {
        query = query.eq('memory_type', memoryType);
      }

      const { data, error } = await query;

      if (error) {
        // Fallback to simple filtering if text search fails
        const allMemories = await this.retrieveMemories(projectId, memoryType, 1000);
        return allMemories.filter(memory => 
          JSON.stringify(memory.content).toLowerCase().includes(searchTerm.toLowerCase())
        ).slice(0, limit);
      }

      const memories = (data || []) as ProjectMemory[];
      
      // Update access counts
      if (memories.length > 0) {
        await this.updateAccessCounts(memories.map(m => m.id));
      }

      return memories;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to search memories', {
        project_id: projectId,
        search_term: searchTerm,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  // Get learning summary for a project
  async getLearningsSummary(projectId: string): Promise<Record<string, any>> {
    try {
      const [insights, patterns, errors, successes] = await Promise.all([
        this.getInsights(projectId, 10),
        this.getPatterns(projectId, 10),
        this.getErrors(projectId, 5),
        this.getSuccesses(projectId, 10)
      ]);

      const summary = {
        insights: {
          count: insights.length,
          recent: insights.slice(0, 3).map(i => i.content.insight),
          avg_importance: insights.reduce((sum, i) => sum + i.importance_score, 0) / (insights.length || 1)
        },
        patterns: {
          count: patterns.length,
          frequent: patterns
            .sort((a, b) => (b.content.frequency || 0) - (a.content.frequency || 0))
            .slice(0, 3)
            .map(p => p.content.pattern)
        },
        errors: {
          count: errors.length,
          recent: errors.slice(0, 2).map(e => ({
            error: e.content.error,
            solution: e.content.solution
          }))
        },
        successes: {
          count: successes.length,
          recent: successes.slice(0, 3).map(s => ({
            action: s.content.action,
            outcome: s.content.outcome
          }))
        },
        last_updated: new Date().toISOString(),
        total_memories: insights.length + patterns.length + errors.length + successes.length
      };

      await this.logger.debug('orchestrator', 'Generated learnings summary', {
        project_id: projectId,
        summary_stats: {
          insights: insights.length,
          patterns: patterns.length,
          errors: errors.length,
          successes: successes.length
        }
      });

      return summary;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to generate learnings summary', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  // Cache management
  private addToCache(projectId: string, memory: ProjectMemory): void {
    const cached = this.memoryCache.get(projectId) || [];
    cached.unshift(memory); // Add to beginning for recency
    
    // Trim cache if too large
    if (cached.length > this.maxCacheSize) {
      cached.splice(this.maxCacheSize);
    }
    
    this.memoryCache.set(projectId, cached);
  }

  private updateInCache(updatedMemory: ProjectMemory): void {
    const cached = this.memoryCache.get(updatedMemory.project_id);
    if (cached) {
      const index = cached.findIndex(m => m.id === updatedMemory.id);
      if (index >= 0) {
        cached[index] = updatedMemory;
      }
    }
  }

  private removeFromCache(memoryId: string): void {
    for (const [projectId, memories] of this.memoryCache.entries()) {
      const index = memories.findIndex(m => m.id === memoryId);
      if (index >= 0) {
        memories.splice(index, 1);
        break;
      }
    }
  }

  private async updateAccessCounts(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    try {
      const now = new Date().toISOString();
      
      // Batch update access counts
      const updates = memoryIds.map(id => ({
        id,
        last_accessed: now,
        access_count: 1 // Will be incremented by trigger in database
      }));

      for (const update of updates) {
        await this.supabase
          .from('memory')
          .update({
            last_accessed: update.last_accessed,
            access_count: this.supabase.rpc('increment_access_count', { memory_id: update.id })
          })
          .eq('id', update.id);
      }
    } catch (error) {
      // Non-critical error, just log it
      await this.logger.debug('orchestrator', 'Failed to update access counts', {
        memory_ids: memoryIds,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Memory analytics
  async getMemoryStatistics(projectId: string): Promise<Record<string, any>> {
    try {
      const { data, error } = await this.supabase
        .from('memory')
        .select('memory_type, importance_score, access_count')
        .eq('project_id', projectId);

      if (error) {
        throw new Error(`Failed to get memory statistics: ${error.message}`);
      }

      const stats = {
        total_memories: data?.length || 0,
        by_type: {} as Record<MemoryType, number>,
        by_importance: {
          high: 0, // 8-10
          medium: 0, // 5-7
          low: 0 // 1-4
        },
        avg_importance: 0,
        total_access_count: 0,
        most_accessed: 0
      };

      data?.forEach((memory: any) => {
        // Count by type
        stats.by_type[memory.memory_type] = (stats.by_type[memory.memory_type] || 0) + 1;
        
        // Count by importance level
        if (memory.importance_score >= 8) {
          stats.by_importance.high++;
        } else if (memory.importance_score >= 5) {
          stats.by_importance.medium++;
        } else {
          stats.by_importance.low++;
        }
        
        // Calculate totals
        stats.avg_importance += memory.importance_score;
        stats.total_access_count += memory.access_count || 0;
        stats.most_accessed = Math.max(stats.most_accessed, memory.access_count || 0);
      });

      if (data?.length > 0) {
        stats.avg_importance = stats.avg_importance / data.length;
      }

      return stats;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to get memory statistics', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  // Memory cleanup and maintenance
  async cleanupOldMemories(projectId: string, retentionDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Only delete low-importance memories that haven't been accessed recently
      const { error } = await this.supabase
        .from('memory')
        .delete()
        .eq('project_id', projectId)
        .lt('importance_score', 4)
        .lt('last_accessed', cutoffDate.toISOString())
        .eq('access_count', 0);

      if (error) {
        throw new Error(`Failed to cleanup old memories: ${error.message}`);
      }

      // Clear cache for this project
      this.memoryCache.delete(projectId);

      await this.logger.info('orchestrator', `Cleaned up old memories for project: ${projectId}`, {
        project_id: projectId,
        cutoff_date: cutoffDate.toISOString(),
        retention_days: retentionDays
      });
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to cleanup old memories', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Export/Import for memory migration
  async exportProjectMemories(projectId: string): Promise<ProjectMemory[]> {
    try {
      const { data, error } = await this.supabase
        .from('memory')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      if (error) {
        throw new Error(`Failed to export memories: ${error.message}`);
      }

      await this.logger.info('orchestrator', `Exported ${data?.length || 0} memories`, {
        project_id: projectId,
        count: data?.length || 0
      });

      return (data || []) as ProjectMemory[];
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to export memories', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async importProjectMemories(projectId: string, memories: ProjectMemory[]): Promise<number> {
    let imported = 0;
    
    try {
      for (const memory of memories) {
        // Update project_id and generate new ID
        const newMemory = {
          ...memory,
          id: uuidv4(),
          project_id: projectId,
          created_at: new Date().toISOString(),
          last_accessed: new Date().toISOString(),
          access_count: 0
        };

        await this.storeMemory(
          projectId,
          newMemory.memory_type,
          newMemory.content,
          newMemory.importance_score,
          newMemory.embedding
        );
        
        imported++;
      }

      await this.logger.info('orchestrator', `Imported ${imported} memories`, {
        project_id: projectId,
        imported_count: imported,
        total_provided: memories.length
      });

      return imported;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to import memories', {
        project_id: projectId,
        imported_count: imported,
        error: error instanceof Error ? error.message : String(error)
      });
      return imported;
    }
  }

  // Get memory insights for decision making
  async getRelevantMemories(
    projectId: string,
    context: string,
    taskType?: string,
    limit: number = 10
  ): Promise<ProjectMemory[]> {
    try {
      // Try semantic search first (if embeddings are available)
      let memories = await this.searchMemories(projectId, context, undefined, limit * 2);
      
      // If task type is specified, prioritize relevant memory types
      if (taskType) {
        const relevantTypes: MemoryType[] = this.getRelevantMemoryTypes(taskType);
        const typedMemories = memories.filter(m => relevantTypes.includes(m.memory_type));
        const otherMemories = memories.filter(m => !relevantTypes.includes(m.memory_type));
        
        memories = [...typedMemories, ...otherMemories];
      }

      // Sort by relevance (importance * recency * access frequency)
      memories.sort((a, b) => {
        const scoreA = this.calculateRelevanceScore(a);
        const scoreB = this.calculateRelevanceScore(b);
        return scoreB - scoreA;
      });

      return memories.slice(0, limit);
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to get relevant memories', {
        project_id: projectId,
        context: context.substring(0, 100),
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private getRelevantMemoryTypes(taskType: string): MemoryType[] {
    switch (taskType) {
      case 'scan':
        return ['pattern', 'insight', 'error'];
      case 'enhance':
        return ['success', 'preference', 'insight'];
      case 'add_modules':
        return ['pattern', 'success', 'preference'];
      default:
        return ['insight', 'success', 'pattern'];
    }
  }

  private calculateRelevanceScore(memory: ProjectMemory): number {
    const now = Date.now();
    const created = new Date(memory.created_at).getTime();
    const accessed = new Date(memory.last_accessed).getTime();
    
    // Recency factor (newer = higher score)
    const daysSinceCreated = (now - created) / (1000 * 60 * 60 * 24);
    const daysSinceAccessed = (now - accessed) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - (daysSinceCreated / 30)) * 0.3;
    const accessRecencyScore = Math.max(0, 1 - (daysSinceAccessed / 7)) * 0.2;
    
    // Importance factor
    const importanceScore = (memory.importance_score / 10) * 0.4;
    
    // Access frequency factor
    const accessScore = Math.min(1, memory.access_count / 10) * 0.1;
    
    return importanceScore + recencyScore + accessRecencyScore + accessScore;
  }

  // Clear all cache
  clearCache(): void {
    this.memoryCache.clear();
  }

  // Get cache statistics
  getCacheStats(): Record<string, any> {
    const stats = {
      cached_projects: this.memoryCache.size,
      total_cached_memories: 0,
      cache_size_limit: this.maxCacheSize
    };

    for (const memories of this.memoryCache.values()) {
      stats.total_cached_memories += memories.length;
    }

    return stats;
  }
}