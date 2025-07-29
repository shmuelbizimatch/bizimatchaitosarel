// Core Agent System Types
export interface AgentConfig {
  projectName: string;
  mode: ExecutionMode;
  aiEngine: AIEngine;
  options?: AgentOptions;
}

export type ExecutionMode = 'scan' | 'enhance' | 'add_modules' | 'full';
export type AIEngine = 'claude' | 'gpt-4' | 'gemini';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type AgentType = 'scanner' | 'improver' | 'generator' | 'orchestrator';

export interface AgentOptions {
  maxConcurrentTasks?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  verboseLogging?: boolean;
  targetFiles?: string[];
  excludePatterns?: string[];
}

// Task Management
export interface Task {
  id: string;
  project_id: string;
  task_type: ExecutionMode;
  status: TaskStatus;
  agent_type: AgentType;
  input_data: Record<string, any>;
  output_data?: Record<string, any>;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  parent_task_id?: string;
  metadata: TaskMetadata;
  created_at?: string;
}

export interface TaskMetadata {
  priority: number;
  estimated_duration_ms?: number;
  actual_duration_ms?: number;
  tokens_used?: number;
  cost_estimate?: number;
  retry_count: number;
  ai_engine: AIEngine;
}

// Memory System
export interface ProjectMemory {
  id: string;
  project_id: string;
  memory_type: MemoryType;
  content: Record<string, any>;
  embedding?: number[];
  importance_score: number;
  created_at: string;
  last_accessed: string;
  access_count: number;
}

export type MemoryType = 'insight' | 'pattern' | 'error' | 'success' | 'preference' | 'context';

// Logging System
export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  agent_type: AgentType;
  task_id?: string;
  project_id?: string;
  message: string;
  data?: Record<string, any>;
  error_stack?: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

// AI Engine Integration
export interface AIRequest {
  prompt: string;
  context?: string;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
  response_format?: 'text' | 'json';
}

export interface AIResponse {
  content: string;
  tokens_used: number;
  model: string;
  cost_estimate: number;
  response_time_ms: number;
  confidence_score?: number;
}

// Agent Results
export interface ScanResult {
  structure_analysis: StructureAnalysis;
  issues: CodeIssue[];
  opportunities: Opportunity[];
  metrics: CodeMetrics;
}

export interface StructureAnalysis {
  file_count: number;
  component_count: number;
  complexity_score: number;
  architecture_patterns: string[];
  dependencies: Dependency[];
}

export interface CodeIssue {
  type: 'performance' | 'accessibility' | 'maintainability' | 'security';
  severity: 'low' | 'medium' | 'high' | 'critical';
  file_path: string;
  line_number?: number;
  description: string;
  suggestion: string;
}

export interface Opportunity {
  type: 'ux_improvement' | 'performance_optimization' | 'feature_addition';
  impact: 'low' | 'medium' | 'high';
  effort: 'low' | 'medium' | 'high';
  description: string;
  implementation_suggestion: string;
}

export interface CodeMetrics {
  lines_of_code: number;
  cyclomatic_complexity: number;
  maintainability_index: number;
  test_coverage?: number;
  performance_score?: number;
}

export interface Dependency {
  name: string;
  version: string;
  type: 'production' | 'development';
  security_issues?: SecurityIssue[];
}

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  recommendation: string;
}

// Enhancement Results
export interface EnhancementResult {
  improvements: Enhancement[];
  ux_score_before: number;
  ux_score_after: number;
  implementation_plan: ImplementationStep[];
}

export interface Enhancement {
  component_path: string;
  enhancement_type: 'visual' | 'interactive' | 'accessibility' | 'performance';
  description: string;
  code_changes: CodeChange[];
  impact_assessment: ImpactAssessment;
}

export interface CodeChange {
  file_path: string;
  change_type: 'modify' | 'add' | 'delete';
  original_code?: string;
  new_code: string;
  line_number?: number;
}

export interface ImpactAssessment {
  user_experience: number; // 1-10
  performance_impact: number; // -5 to +5
  maintainability: number; // 1-10
  implementation_effort: number; // 1-10
}

export interface ImplementationStep {
  order: number;
  description: string;
  estimated_time_minutes: number;
  dependencies: string[];
}

// Module Generation
export interface ModuleGenerationResult {
  generated_modules: GeneratedModule[];
  integration_instructions: string[];
  testing_suggestions: string[];
}

export interface GeneratedModule {
  name: string;
  type: 'component' | 'service' | 'utility' | 'hook';
  file_path: string;
  code: string;
  dependencies: string[];
  props_interface?: string;
  usage_example: string;
  tests?: string;
}

// Frontend Panel Types
export interface AgentPanelState {
  project: string;
  mode: ExecutionMode;
  aiEngine: AIEngine;
  isRunning: boolean;
  currentTask?: Task;
  logs: LogEntry[];
  progress: AgentProgress;
}

export interface AgentProgress {
  overall_progress: number; // 0-100
  current_stage: string;
  stages_completed: string[];
  estimated_completion: string;
  sub_agent_status: Record<AgentType, TaskStatus>;
}

// Supabase Table Interfaces
export interface DatabaseTables {
  tasks: Task;
  logs: LogEntry;
  memory: ProjectMemory;
  projects: Project;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  last_activity: string;
  settings: ProjectSettings;
  stats: ProjectStats;
}

export interface ProjectSettings {
  default_ai_engine: AIEngine;
  auto_enhance: boolean;
  max_file_size_mb: number;
  excluded_patterns: string[];
  preferred_frameworks: string[];
}

export interface ProjectStats {
  total_tasks: number;
  successful_tasks: number;
  total_files_processed: number;
  total_tokens_used: number;
  total_cost: number;
  avg_completion_time_ms: number;
}

// File Analysis Types
export interface FileAnalysis {
  path: string;
  type: 'component' | 'service' | 'utility' | 'config' | 'test' | 'other';
  language: 'typescript' | 'javascript' | 'tsx' | 'jsx' | 'json' | 'css' | 'html' | 'other';
  size_bytes: number;
  lines_of_code: number;
  imports: string[];
  exports: string[];
  functions: FunctionInfo[];
  components?: ComponentInfo[];
  complexity_score: number;
}

export interface FunctionInfo {
  name: string;
  line_number: number;
  parameters: string[];
  return_type?: string;
  complexity: number;
}

export interface ComponentInfo {
  name: string;
  line_number: number;
  props?: string[];
  hooks_used: string[];
  lifecycle_methods?: string[];
}

// API Response Types
export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface AgentStatus {
  agent_type: AgentType;
  status: TaskStatus;
  current_task?: string;
  progress?: number;
  last_activity: string;
}

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'error';
  uptime: number;
  memory_usage: number;
  active_tasks: number;
  database_connected: boolean;
  ai_service_connected: boolean;
  last_check: string;
}

// Event Types for Real-time Updates
export interface AgentEvent {
  type: 'task_started' | 'task_completed' | 'task_failed' | 'log_entry' | 'progress_update';
  timestamp: string;
  data: Record<string, any>;
}

// Utility Types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<T, Exclude<keyof T, Keys>> & {
  [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
}[Keys];