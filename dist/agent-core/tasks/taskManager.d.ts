import { Task, TaskStatus, AgentType, ExecutionMode, TaskMetadata } from '../../types';
import { Logger } from '../logger/logger';
export declare class TaskManager {
    private supabase;
    private logger;
    private activeTasks;
    private taskTimeouts;
    constructor(logger: Logger);
    createTask(projectId: string, taskType: ExecutionMode, agentType: AgentType, inputData: Record<string, any>, parentTaskId?: string, metadata?: Partial<TaskMetadata>): Promise<Task>;
    startTask(taskId: string): Promise<void>;
    completeTask(taskId: string, outputData: Record<string, any>, tokensUsed?: number, costEstimate?: number): Promise<void>;
    failTask(taskId: string, errorMessage: string, errorStack?: string): Promise<void>;
    cancelTask(taskId: string, reason?: string): Promise<void>;
    private timeoutTask;
    private retryTask;
    getTask(taskId: string): Promise<Task | null>;
    getProjectTasks(projectId: string, status?: TaskStatus, limit?: number): Promise<Task[]>;
    getActiveTasks(): Promise<Task[]>;
    getTasksByParent(parentTaskId: string): Promise<Task[]>;
    createWorkflow(projectId: string, mode: ExecutionMode, inputData: Record<string, any>): Promise<Task>;
    private createSubTasks;
    private updateProjectStats;
    cleanupCompletedTasks(retentionDays?: number): Promise<void>;
    getTaskStatistics(projectId?: string): Promise<Record<string, any>>;
}
//# sourceMappingURL=taskManager.d.ts.map