"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskManager = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const uuid_1 = require("uuid");
class TaskManager {
    constructor(logger) {
        this.activeTasks = new Map();
        this.taskTimeouts = new Map();
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
        }
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
        this.logger = logger;
    }
    async createTask(projectId, taskType, agentType, inputData, parentTaskId, metadata) {
        const task = {
            id: (0, uuid_1.v4)(),
            project_id: projectId,
            task_type: taskType,
            status: 'pending',
            agent_type: agentType,
            input_data: inputData,
            parent_task_id: parentTaskId,
            metadata: {
                priority: metadata?.priority || 1,
                retry_count: 0,
                ai_engine: metadata?.ai_engine || process.env.DEFAULT_AI_ENGINE || 'claude',
                estimated_duration_ms: metadata?.estimated_duration_ms,
                ...metadata
            }
        };
        try {
            const { data, error } = await this.supabase
                .from('tasks')
                .insert([task])
                .select()
                .single();
            if (error) {
                throw new Error(`Failed to create task: ${error.message}`);
            }
            const createdTask = data;
            this.activeTasks.set(createdTask.id, createdTask);
            await this.logger.info('orchestrator', `Task created: ${createdTask.id}`, {
                task_id: createdTask.id,
                task_type: createdTask.task_type,
                agent_type: createdTask.agent_type,
                project_id: projectId,
                parent_task_id: parentTaskId
            });
            return createdTask;
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to create task', {
                error: error instanceof Error ? error.message : String(error),
                task_type: taskType,
                agent_type: agentType
            });
            throw error;
        }
    }
    async startTask(taskId) {
        try {
            const now = new Date().toISOString();
            const { error } = await this.supabase
                .from('tasks')
                .update({
                status: 'in_progress',
                started_at: now
            })
                .eq('id', taskId);
            if (error) {
                throw new Error(`Failed to start task: ${error.message}`);
            }
            // Update local cache
            const task = this.activeTasks.get(taskId);
            if (task) {
                task.status = 'in_progress';
                task.started_at = now;
            }
            // Set timeout for task
            const timeoutMs = parseInt(process.env.TASK_TIMEOUT_MS || '300000'); // 5 minutes default
            const timeout = setTimeout(() => {
                this.timeoutTask(taskId);
            }, timeoutMs);
            this.taskTimeouts.set(taskId, timeout);
            await this.logger.info('orchestrator', `Task started: ${taskId}`, {
                task_id: taskId,
                started_at: now,
                timeout_ms: timeoutMs
            });
            // Set logger context
            this.logger.setContext(task?.project_id, taskId);
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to start task', {
                task_id: taskId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async completeTask(taskId, outputData, tokensUsed, costEstimate) {
        try {
            const now = new Date().toISOString();
            const task = this.activeTasks.get(taskId);
            if (!task) {
                throw new Error(`Task ${taskId} not found in active tasks`);
            }
            // Calculate duration
            const startTime = task.started_at ? new Date(task.started_at).getTime() : Date.now();
            const actualDuration = Date.now() - startTime;
            // Update metadata with performance data
            const updatedMetadata = {
                ...task.metadata,
                actual_duration_ms: actualDuration,
                tokens_used: tokensUsed,
                cost_estimate: costEstimate
            };
            const { error } = await this.supabase
                .from('tasks')
                .update({
                status: 'completed',
                completed_at: now,
                output_data: outputData,
                metadata: updatedMetadata
            })
                .eq('id', taskId);
            if (error) {
                throw new Error(`Failed to complete task: ${error.message}`);
            }
            // Clear timeout
            const timeout = this.taskTimeouts.get(taskId);
            if (timeout) {
                clearTimeout(timeout);
                this.taskTimeouts.delete(taskId);
            }
            // Remove from active tasks
            this.activeTasks.delete(taskId);
            await this.logger.info('orchestrator', `Task completed: ${taskId}`, {
                task_id: taskId,
                completed_at: now,
                duration_ms: actualDuration,
                tokens_used: tokensUsed,
                cost_estimate: costEstimate
            });
            // Update project stats
            await this.updateProjectStats(task.project_id, tokensUsed || 0, costEstimate || 0);
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to complete task', {
                task_id: taskId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async failTask(taskId, errorMessage, errorStack) {
        try {
            const now = new Date().toISOString();
            const task = this.activeTasks.get(taskId);
            if (!task) {
                throw new Error(`Task ${taskId} not found in active tasks`);
            }
            // Increment retry count
            const updatedMetadata = {
                ...task.metadata,
                retry_count: task.metadata.retry_count + 1
            };
            const { error } = await this.supabase
                .from('tasks')
                .update({
                status: 'failed',
                completed_at: now,
                error_message: errorMessage,
                metadata: updatedMetadata
            })
                .eq('id', taskId);
            if (error) {
                throw new Error(`Failed to mark task as failed: ${error.message}`);
            }
            // Clear timeout
            const timeout = this.taskTimeouts.get(taskId);
            if (timeout) {
                clearTimeout(timeout);
                this.taskTimeouts.delete(taskId);
            }
            // Remove from active tasks
            this.activeTasks.delete(taskId);
            await this.logger.error('orchestrator', `Task failed: ${taskId}`, {
                task_id: taskId,
                error_message: errorMessage,
                retry_count: updatedMetadata.retry_count
            }, new Error(errorStack || errorMessage));
            // Check if we should retry
            const maxRetries = parseInt(process.env.MAX_RETRY_ATTEMPTS || '2');
            if (updatedMetadata.retry_count < maxRetries) {
                await this.logger.info('orchestrator', `Scheduling retry for task: ${taskId}`, {
                    task_id: taskId,
                    retry_count: updatedMetadata.retry_count,
                    max_retries: maxRetries
                });
                // Create a new retry task after a delay
                setTimeout(() => {
                    this.retryTask(task);
                }, 5000); // 5 second delay
            }
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to mark task as failed', {
                task_id: taskId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async cancelTask(taskId, reason) {
        try {
            const now = new Date().toISOString();
            const { error } = await this.supabase
                .from('tasks')
                .update({
                status: 'cancelled',
                completed_at: now,
                error_message: reason || 'Task cancelled'
            })
                .eq('id', taskId);
            if (error) {
                throw new Error(`Failed to cancel task: ${error.message}`);
            }
            // Clear timeout
            const timeout = this.taskTimeouts.get(taskId);
            if (timeout) {
                clearTimeout(timeout);
                this.taskTimeouts.delete(taskId);
            }
            // Remove from active tasks
            this.activeTasks.delete(taskId);
            await this.logger.warn('orchestrator', `Task cancelled: ${taskId}`, {
                task_id: taskId,
                reason: reason || 'No reason provided'
            });
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to cancel task', {
                task_id: taskId,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async timeoutTask(taskId) {
        await this.failTask(taskId, 'Task timed out');
    }
    async retryTask(originalTask) {
        try {
            // Create new task with incremented retry count
            const retryTask = await this.createTask(originalTask.project_id, originalTask.task_type, originalTask.agent_type, originalTask.input_data, originalTask.parent_task_id, {
                ...originalTask.metadata,
                retry_count: originalTask.metadata.retry_count + 1
            });
            await this.logger.info('orchestrator', `Retry task created: ${retryTask.id}`, {
                original_task_id: originalTask.id,
                retry_task_id: retryTask.id,
                retry_count: retryTask.metadata.retry_count
            });
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to create retry task', {
                original_task_id: originalTask.id,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    async getTask(taskId) {
        // Check local cache first
        const cachedTask = this.activeTasks.get(taskId);
        if (cachedTask) {
            return cachedTask;
        }
        try {
            const { data, error } = await this.supabase
                .from('tasks')
                .select('*')
                .eq('id', taskId)
                .single();
            if (error || !data) {
                return null;
            }
            return data;
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to retrieve task', {
                task_id: taskId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    async getProjectTasks(projectId, status, limit = 50) {
        try {
            let query = this.supabase
                .from('tasks')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (status) {
                query = query.eq('status', status);
            }
            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to retrieve project tasks: ${error.message}`);
            }
            return (data || []);
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to retrieve project tasks', {
                project_id: projectId,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
    async getActiveTasks() {
        return Array.from(this.activeTasks.values());
    }
    async getTasksByParent(parentTaskId) {
        try {
            const { data, error } = await this.supabase
                .from('tasks')
                .select('*')
                .eq('parent_task_id', parentTaskId)
                .order('created_at', { ascending: true });
            if (error) {
                throw new Error(`Failed to retrieve child tasks: ${error.message}`);
            }
            return (data || []);
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to retrieve child tasks', {
                parent_task_id: parentTaskId,
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
    // Create orchestrated workflow for full mode
    async createWorkflow(projectId, mode, inputData) {
        const orchestratorTask = await this.createTask(projectId, mode, 'orchestrator', inputData, undefined, { priority: 10 });
        await this.logger.info('orchestrator', `Workflow created for mode: ${mode}`, {
            workflow_id: orchestratorTask.id,
            project_id: projectId,
            mode
        });
        // Create sub-tasks based on mode
        const subTasks = await this.createSubTasks(orchestratorTask, mode, inputData);
        // Update orchestrator task with sub-task references
        const updatedInputData = {
            ...inputData,
            sub_task_ids: subTasks.map(t => t.id)
        };
        await this.supabase
            .from('tasks')
            .update({ input_data: updatedInputData })
            .eq('id', orchestratorTask.id);
        return orchestratorTask;
    }
    async createSubTasks(parentTask, mode, inputData) {
        const subTasks = [];
        switch (mode) {
            case 'scan':
                subTasks.push(await this.createTask(parentTask.project_id, 'scan', 'scanner', inputData, parentTask.id, { priority: 5 }));
                break;
            case 'enhance':
                // First scan, then improve
                subTasks.push(await this.createTask(parentTask.project_id, 'scan', 'scanner', inputData, parentTask.id, { priority: 7 }), await this.createTask(parentTask.project_id, 'enhance', 'improver', inputData, parentTask.id, { priority: 6 }));
                break;
            case 'add_modules':
                subTasks.push(await this.createTask(parentTask.project_id, 'add_modules', 'generator', inputData, parentTask.id, { priority: 5 }));
                break;
            case 'full':
                // Complete workflow: scan -> improve -> generate
                subTasks.push(await this.createTask(parentTask.project_id, 'scan', 'scanner', inputData, parentTask.id, { priority: 9 }), await this.createTask(parentTask.project_id, 'enhance', 'improver', inputData, parentTask.id, { priority: 8 }), await this.createTask(parentTask.project_id, 'add_modules', 'generator', inputData, parentTask.id, { priority: 7 }));
                break;
        }
        return subTasks;
    }
    async updateProjectStats(projectId, tokensUsed, costEstimate) {
        try {
            // Get current stats
            const { data: project, error: fetchError } = await this.supabase
                .from('projects')
                .select('stats')
                .eq('id', projectId)
                .single();
            if (fetchError) {
                await this.logger.warn('orchestrator', 'Failed to fetch project for stats update', {
                    project_id: projectId,
                    error: fetchError.message
                });
                return;
            }
            const currentStats = project.stats || {
                total_tasks: 0,
                successful_tasks: 0,
                total_files_processed: 0,
                total_tokens_used: 0,
                total_cost: 0,
                avg_completion_time_ms: 0
            };
            // Update stats
            const updatedStats = {
                ...currentStats,
                total_tokens_used: (currentStats.total_tokens_used || 0) + tokensUsed,
                total_cost: (currentStats.total_cost || 0) + costEstimate
            };
            const { error: updateError } = await this.supabase
                .from('projects')
                .update({ stats: updatedStats })
                .eq('id', projectId);
            if (updateError) {
                await this.logger.warn('orchestrator', 'Failed to update project stats', {
                    project_id: projectId,
                    error: updateError.message
                });
            }
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Error updating project stats', {
                project_id: projectId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    // Cleanup completed tasks (retention management)
    async cleanupCompletedTasks(retentionDays = 7) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const { error } = await this.supabase
                .from('tasks')
                .delete()
                .in('status', ['completed', 'failed', 'cancelled'])
                .lt('completed_at', cutoffDate.toISOString());
            if (error) {
                await this.logger.error('orchestrator', 'Failed to cleanup old tasks', {
                    error: error.message
                });
            }
            else {
                await this.logger.info('orchestrator', `Cleaned up tasks older than ${retentionDays} days`, {
                    cutoff_date: cutoffDate.toISOString(),
                    retention_days: retentionDays
                });
            }
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Error during task cleanup', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
    // Get task statistics
    async getTaskStatistics(projectId) {
        try {
            let query = this.supabase
                .from('task_summary')
                .select('*');
            if (projectId) {
                query = query.eq('project_id', projectId);
            }
            const { data, error } = await query;
            if (error) {
                throw new Error(`Failed to retrieve task statistics: ${error.message}`);
            }
            const stats = {
                total_tasks: data?.length || 0,
                by_status: {},
                by_agent: {},
                total_tokens: 0,
                total_cost: 0,
                avg_duration: 0
            };
            data?.forEach((task) => {
                // Count by status
                stats.by_status[task.status] = (stats.by_status[task.status] || 0) + 1;
                // Count by agent
                stats.by_agent[task.agent_type] = (stats.by_agent[task.agent_type] || 0) + 1;
                // Sum tokens and cost
                stats.total_tokens += task.tokens_used || 0;
                stats.total_cost += parseFloat(task.cost_estimate || '0');
                // Calculate average duration
                if (task.duration_ms) {
                    stats.avg_duration += task.duration_ms;
                }
            });
            if (data?.length > 0) {
                stats.avg_duration = stats.avg_duration / data.length;
            }
            return stats;
        }
        catch (error) {
            await this.logger.error('orchestrator', 'Failed to retrieve task statistics', {
                project_id: projectId,
                error: error instanceof Error ? error.message : String(error)
            });
            return {};
        }
    }
}
exports.TaskManager = TaskManager;
//# sourceMappingURL=taskManager.js.map