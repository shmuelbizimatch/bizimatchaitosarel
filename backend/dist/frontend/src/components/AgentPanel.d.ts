import React from 'react';
import { ExecutionMode, LogEntry, AgentProgress } from '../types';
interface AgentPanelProps {
    onExecute?: (projectName: string, mode: ExecutionMode, options: Record<string, any>) => Promise<void>;
    onGetProgress?: () => Promise<AgentProgress>;
    onGetLogs?: (limit?: number) => Promise<LogEntry[]>;
    onGetCapabilities?: () => Promise<Record<string, any>>;
    onGetStats?: () => Promise<Record<string, any>>;
}
export declare const AgentPanel: React.FC<AgentPanelProps>;
export default AgentPanel;
//# sourceMappingURL=AgentPanel.d.ts.map