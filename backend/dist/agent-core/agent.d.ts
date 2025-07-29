import { AgentConfig, Task } from '../types';
export declare class ClaudeAgentSystem {
    private logger;
    private taskManager;
    private memoryManager;
    private aiClient;
    private scannerAgent;
    private improverAgent;
    private generatorAgent;
    private supabase;
    private isRunning;
    private currentProject?;
    constructor();
    /**
     * Main execution entry point for the agent system
     */
    execute(config: AgentConfig): Promise<any>;
    /**
     * Initialize or retrieve project from database
     */
    private initializeProject;
    /**
     * Create workflow based on execution mode
     */
    private createWorkflow;
    /**
     * Execute workflow based on mode
     */
    private executeWorkflow;
    /**
     * Execute scan-only workflow
     */
    private executeScanWorkflow;
    /**
     * Execute enhance workflow (scan + improve)
     */
    private executeEnhanceWorkflow;
    /**
     * Execute module generation workflow
     */
    private executeGenerateWorkflow;
    /**
     * Execute full workflow (scan + enhance + generate)
     */
    private executeFullWorkflow;
    /**
     * Create a sub-task for workflow execution
     */
    private createSubTask;
    /**
     * Execute a sub-task with proper error handling and logging
     */
    private executeSubTask;
    /**
     * Generate module request based on scan and enhancement results
     */
    private generateModuleRequestFromResults;
    /**
     * Get task priority based on type
     */
    private getTaskPriority;
    /**
     * Calculate tokens used from result (simple heuristic)
     */
    private calculateTokensUsed;
    /**
     * Calculate cost estimate from result
     */
    private calculateCostEstimate;
    /**
     * End session and perform cleanup
     */
    private endSession;
    /**
     * Generate session summary from results
     */
    private generateSessionSummary;
    /**
     * Get current system status
     */
    getStatus(): any;
    /**
     * Get active tasks
     */
    getActiveTasks(): Promise<Task[]>;
    /**
     * Get recent logs
     */
    getRecentLogs(limit?: number): Promise<any[]>;
    /**
     * Cancel running workflow
     */
    cancelWorkflow(reason?: string): Promise<void>;
    /**
     * Get project statistics
     */
    getProjectStats(projectId?: string): Promise<any>;
}
export default ClaudeAgentSystem;
//# sourceMappingURL=agent.d.ts.map