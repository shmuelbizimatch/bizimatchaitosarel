import { LogEntry, LogLevel, AgentType } from '../../types';
export declare class Logger {
    private supabase;
    private logbookPath;
    private projectId;
    private taskId;
    constructor();
    private initializeLogDirectory;
    setContext(projectId?: string, taskId?: string): void;
    log(level: LogLevel, agentType: AgentType, data: {
        message: string;
        data?: Record<string, any>;
        error_stack?: string;
    }): Promise<void>;
    private logToConsole;
    private logToFile;
    private logToSupabase;
    private getAgentColor;
    private getLevelColor;
    debug(agentType: AgentType, message: string, data?: Record<string, any>): Promise<void>;
    info(agentType: AgentType, message: string, data?: Record<string, any>): Promise<void>;
    warn(agentType: AgentType, message: string, data?: Record<string, any>): Promise<void>;
    error(agentType: AgentType, message: string, data?: Record<string, any>, error?: Error): Promise<void>;
    critical(agentType: AgentType, message: string, data?: Record<string, any>, error?: Error): Promise<void>;
    startSession(projectName: string): Promise<void>;
    endSession(summary?: string): Promise<void>;
    getRecentLogs(limit?: number, projectId?: string): Promise<LogEntry[]>;
    getLogsByTask(taskId: string): Promise<LogEntry[]>;
    getLogsByLevel(level: LogLevel, projectId?: string, limit?: number): Promise<LogEntry[]>;
    logPerformanceMetric(metricType: string, value: number, unit?: string, context?: Record<string, any>): Promise<void>;
    cleanupOldLogs(retentionDays?: number): Promise<void>;
}
//# sourceMappingURL=logger.d.ts.map