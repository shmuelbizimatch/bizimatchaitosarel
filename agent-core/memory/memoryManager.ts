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
        last_updated: new Date().toISOString()
      };

      return summary;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to generate learning summary', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  // Cache management methods
  private addToCache(projectId: string, memory: ProjectMemory): void {
    const cached = this.memoryCache.get(projectId) || [];
    cached.unshift(memory); // Add to beginning
    
    // Limit cache size
    if (cached.length > this.maxCacheSize) {
      cached.splice(this.maxCacheSize);
    }
    
    this.memoryCache.set(projectId, cached);
  }

  private updateInCache(memory: ProjectMemory): void {
    const cached = this.memoryCache.get(memory.project_id);
    if (cached) {
      const index = cached.findIndex(m => m.id === memory.id);
      if (index !== -1) {
        cached[index] = memory;
      }
    }
  }

  private removeFromCache(memoryId: string): void {
    for (const [projectId, memories] of this.memoryCache.entries()) {
      const index = memories.findIndex(m => m.id === memoryId);
      if (index !== -1) {
        memories.splice(index, 1);
        this.memoryCache.set(projectId, memories);
        break;
      }
    }
  }

  private async updateAccessCounts(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    try {
      // Update access count and last_accessed timestamp
      const now = new Date().toISOString();
      
      for (const memoryId of memoryIds) {
        await this.supabase
          .from('memory')
          .update({ 
            last_accessed: now,
            access_count: this.supabase.raw('access_count + 1')
          })
          .eq('id', memoryId);
      }
    } catch (error) {
      await this.logger.warn('orchestrator', 'Failed to update memory access counts', {
        memory_ids: memoryIds,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Cleanup old memories (retention management)
  async cleanupOldMemories(retentionDays: number = 90): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Only cleanup low importance, rarely accessed memories
      const { error } = await this.supabase
        .from('memory')
        .delete()
        .lt('last_accessed', cutoffDate.toISOString())
        .lt('importance_score', 4)
        .lt('access_count', 3);

      if (error) {
        await this.logger.error('orchestrator', 'Failed to cleanup old memories', {
          error: error.message
        });
      } else {
        await this.logger.info('orchestrator', `Cleaned up old memories older than ${retentionDays} days`, {
          cutoff_date: cutoffDate.toISOString(),
          retention_days: retentionDays
        });
      }
    } catch (error) {
      await this.logger.error('orchestrator', 'Error during memory cleanup', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Export/Import for backup and migration
  async exportProjectMemories(projectId: string): Promise<ProjectMemory[]> {
    try {
      const { data, error } = await this.supabase
        .from('memory')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Failed to export memories: ${error.message}`);
      }

      await this.logger.info('orchestrator', `Exported ${data?.length || 0} memories`, {
        project_id: projectId,
        count: data?.length || 0
      });

      return (data || []) as ProjectMemory[];
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to export project memories', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async importProjectMemories(memories: ProjectMemory[]): Promise<number> {
    try {
      const { data, error } = await this.supabase
        .from('memory')
        .insert(memories)
        .select();

      if (error) {
        throw new Error(`Failed to import memories: ${error.message}`);
      }

      const importedCount = data?.length || 0;
      
      await this.logger.info('orchestrator', `Imported ${importedCount} memories`, {
        imported_count: importedCount
      });

      return importedCount;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to import project memories', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }
}