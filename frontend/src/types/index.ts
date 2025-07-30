export interface Task {
  id: string;
  name: string;
}

export type AgentType = 'PRODUCT' | 'DB' | 'BACKEND' | 'FRONTEND';
export type ExecutionMode = 'AUTO' | 'MANUAL' | 'scan' | 'enhance' | 'add_modules' | 'full';
export type AIEngine = 'claude' | 'gpt-4' | 'gemini';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export interface Progress {
  stages_completed: string[];
  status: string;
}

export interface Log {
  id: string;
  message: string;
  timestamp?: string;
}

export interface AgentPanelState {
  project: string;
  mode: ExecutionMode;
  aiEngine: AIEngine;
  progress: AgentProgress;
  logs: LogEntry[];
  isRunning: boolean;
}

export interface AgentProgress {
  overall_progress: number;
  current_stage: string;
  stages_completed: string[];
  estimated_completion: string;
  sub_agent_status: Record<string, TaskStatus>;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  agent_type: string;
  task_id?: string;
  project_id?: string;
  message: string;
  data?: Record<string, any>;
  error_stack?: string;
}