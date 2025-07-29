import { AgentConfig, Task, ExecutionMode, AgentProgress, Project, AgentType } from '../types';
import { Logger } from './logger/logger';
import { MemoryManager } from './memory/memoryManager';
import { TaskManager } from './tasks/taskManager';
import { AIClient } from './engines/AIClient';
import { ScannerAgent } from './scanner/scannerAgent';
import { ImproverAgent } from './improver/improverAgent';
import { GeneratorAgent } from './generator/generatorAgent';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export class ClaudeAgentSystem {
  private logger: Logger;
  private memoryManager: MemoryManager;
  private taskManager: TaskManager;
  private aiClient: AIClient;
  private scannerAgent: ScannerAgent;
  private improverAgent: ImproverAgent;
  private generatorAgent: GeneratorAgent;
  private supabase: SupabaseClient;
  
  private currentProject: Project | null = null;
  private isRunning: boolean = false;
  private currentProgress: AgentProgress = {
    overall_progress: 0,
    current_stage: 'Initializing',
    stages_completed: [],
    estimated_completion: '',
    sub_agent_status: {
      orchestrator: 'pending',
      scanner: 'pending',
      improver: 'pending',
      generator: 'pending'
    }
  };

  constructor() {
    // Initialize core components
    this.logger = new Logger();
    this.memoryManager = new MemoryManager(this.logger);
    this.taskManager = new TaskManager(this.logger);
    this.aiClient = new AIClient(this.logger);
    
    // Initialize sub-agents
    this.scannerAgent = new ScannerAgent(this.logger, this.memoryManager, this.aiClient);
    this.improverAgent = new ImproverAgent(this.logger, this.memoryManager, this.aiClient);
    this.generatorAgent = new GeneratorAgent(this.logger, this.memoryManager, this.aiClient);

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async execute(config: AgentConfig): Promise<void> {
    if (this.isRunning) {
      throw new Error('Agent system is already running. Please wait for current execution to complete.');
    }

    this.isRunning = true;
    
    try {
      await this.logger.startSession(config.projectName);
      await this.logger.info('orchestrator', 'Starting Claude Agent System execution', {
        project_name: config.projectName,
        mode: config.mode,
        ai_engine: config.aiEngine,
        options: config.options
      });

      // Initialize or get project
      this.currentProject = await this.initializeProject(config.projectName);
      
      // Set logger context
      this.logger.setContext(this.currentProject.id);

      // Reset progress
      this.resetProgress();

      // Execute based on mode
      switch (config.mode) {
        case 'scan':
          await this.executeScanMode(config);
          break;
        case 'enhance':
          await this.executeEnhanceMode(config);
          break;
        case 'add_modules':
          await this.executeGenerateMode(config);
          break;
        case 'full':
          await this.executeFullMode(config);
          break;
        default:
          throw new Error(`Unknown execution mode: ${config.mode}`);
      }

      await this.logger.info('orchestrator', 'Claude Agent System execution completed successfully', {
        project_id: this.currentProject.id,
        mode: config.mode,
        final_progress: this.currentProgress
      });

      await this.logger.endSession('Execution completed successfully');

    } catch (error) {
      await this.logger.error('orchestrator', 'Claude Agent System execution failed', {
        project_name: config.projectName,
        mode: config.mode,
        error: error instanceof Error ? error.message : String(error),
        progress: this.currentProgress
      }, error instanceof Error ? error : undefined);

      await this.logger.endSession(`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      throw error;
    } finally {
      this.isRunning = false;
      this.currentProject = null;
    }
  }

  private async initializeProject(projectName: string): Promise<Project> {
    try {
      // Check if project already exists
      const { data: existingProject, error: fetchError } = await this.supabase
        .from('projects')
        .select('*')
        .eq('name', projectName)
        .single();

      if (existingProject && !fetchError) {
        await this.logger.info('orchestrator', `Using existing project: ${projectName}`, {
          project_id: existingProject.id,
          created_at: existingProject.created_at
        });
        return existingProject as Project;
      }

      // Create new project
      const newProject: Partial<Project> = {
        id: uuidv4(),
        name: projectName,
        created_at: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        settings: {
          default_ai_engine: 'claude',
          auto_enhance: false,
          max_file_size_mb: 10,
          excluded_patterns: ['node_modules', '.git', 'dist'],
          preferred_frameworks: ['react', 'typescript']
        },
        stats: {
          total_tasks: 0,
          successful_tasks: 0,
          total_files_processed: 0,
          total_tokens_used: 0,
          total_cost: 0,
          avg_completion_time_ms: 0
        }
      };

      const { data: createdProject, error: createError } = await this.supabase
        .from('projects')
        .insert([newProject])
        .select()
        .single();

      if (createError) {
        throw new Error(`Failed to create project: ${createError.message}`);
      }

      await this.logger.info('orchestrator', `Created new project: ${projectName}`, {
        project_id: createdProject.id
      });

      return createdProject as Project;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to initialize project', {
        project_name: projectName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private resetProgress(): void {
    this.currentProgress = {
      overall_progress: 0,
      current_stage: 'Initializing',
      stages_completed: [],
      estimated_completion: '',
      sub_agent_status: {
        orchestrator: 'in_progress',
        scanner: 'pending',
        improver: 'pending',
        generator: 'pending'
      }
    };
  }

  private updateProgress(stage: string, progress: number, completedStages?: string[]): void {
    this.currentProgress.current_stage = stage;
    this.currentProgress.overall_progress = Math.min(100, Math.max(0, progress));
    
    if (completedStages) {
      this.currentProgress.stages_completed.push(...completedStages);
    }

    // Estimate completion time
    if (progress > 0 && progress < 100) {
      const remainingProgress = 100 - progress;
      const estimatedMinutes = Math.ceil((remainingProgress / progress) * 5); // Rough estimate
      const estimatedCompletion = new Date(Date.now() + estimatedMinutes * 60000);
      this.currentProgress.estimated_completion = estimatedCompletion.toISOString();
    }
  }

  private updateAgentStatus(agentType: AgentType, status: 'pending' | 'in_progress' | 'completed' | 'failed'): void {
    this.currentProgress.sub_agent_status[agentType] = status;
  }

  private async executeScanMode(config: AgentConfig): Promise<void> {
    this.updateProgress('Starting Scan Analysis', 10);
    
    // Create scan task
    const scanTask = await this.taskManager.createTask(
      this.currentProject!.id,
      'scan',
      'scanner',
      {
        project_path: config.options?.projectPath || process.cwd(),
        max_files: config.options?.maxFiles || 100,
        target_files: config.options?.targetFiles || []
      },
      undefined,
      {
        ai_engine: config.aiEngine,
        priority: 10
      }
    );

    this.updateProgress('Executing Scan', 20);
    this.updateAgentStatus('scanner', 'in_progress');

    try {
      await this.taskManager.startTask(scanTask.id);
      
      const scanResult = await this.scannerAgent.execute(scanTask);
      
      await this.taskManager.completeTask(
        scanTask.id,
        { scan_result: scanResult },
        scanResult.structure_analysis.file_count * 10, // Rough token estimate
        0.01 // Rough cost estimate
      );

      this.updateAgentStatus('scanner', 'completed');
      this.updateProgress('Scan Completed', 100, ['Code Analysis']);

      await this.logger.info('orchestrator', 'Scan mode completed successfully', {
        task_id: scanTask.id,
        files_analyzed: scanResult.structure_analysis.file_count,
        issues_found: scanResult.issues.length,
        opportunities_found: scanResult.opportunities.length
      });

    } catch (error) {
      this.updateAgentStatus('scanner', 'failed');
      await this.taskManager.failTask(scanTask.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async executeEnhanceMode(config: AgentConfig): Promise<void> {
    this.updateProgress('Starting Enhancement Analysis', 5);

    // First, run scan if no scan results provided
    let scanTask: Task | null = null;
    let scanResult: any = null;

    if (!config.options?.scanResults) {
      this.updateProgress('Running prerequisite scan', 10);
      this.updateAgentStatus('scanner', 'in_progress');

      scanTask = await this.taskManager.createTask(
        this.currentProject!.id,
        'scan',
        'scanner',
        {
          project_path: config.options?.projectPath || process.cwd(),
          max_files: config.options?.maxFiles || 100
        },
        undefined,
        {
          ai_engine: config.aiEngine,
          priority: 9
        }
      );

      await this.taskManager.startTask(scanTask.id);
      scanResult = await this.scannerAgent.execute(scanTask);
      await this.taskManager.completeTask(scanTask.id, { scan_result: scanResult });
      
      this.updateAgentStatus('scanner', 'completed');
      this.updateProgress('Scan completed, starting enhancement', 40, ['Code Analysis']);
    } else {
      scanResult = config.options.scanResults;
      this.updateProgress('Using provided scan results', 20);
    }

    // Run enhancement
    this.updateAgentStatus('improver', 'in_progress');

    const enhanceTask = await this.taskManager.createTask(
      this.currentProject!.id,
      'enhance',
      'improver',
      {
        project_path: config.options?.projectPath || process.cwd(),
        scan_results: scanResult,
        target_component: config.options?.targetComponent,
        auto_apply: config.options?.autoApply || false
      },
      scanTask?.id,
      {
        ai_engine: config.aiEngine,
        priority: 8
      }
    );

    this.updateProgress('Analyzing UX improvements', 60);

    try {
      await this.taskManager.startTask(enhanceTask.id);
      
      const enhanceResult = await this.improverAgent.execute(enhanceTask);
      
      await this.taskManager.completeTask(
        enhanceTask.id,
        { enhancement_result: enhanceResult },
        enhanceResult.improvements.length * 50, // Rough token estimate
        0.05 // Rough cost estimate
      );

      this.updateAgentStatus('improver', 'completed');
      this.updateProgress('Enhancement Completed', 100, ['UX Analysis']);

      await this.logger.info('orchestrator', 'Enhance mode completed successfully', {
        task_id: enhanceTask.id,
        improvements_found: enhanceResult.improvements.length,
        ux_score_improvement: enhanceResult.ux_score_after - enhanceResult.ux_score_before
      });

    } catch (error) {
      this.updateAgentStatus('improver', 'failed');
      await this.taskManager.failTask(enhanceTask.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async executeGenerateMode(config: AgentConfig): Promise<void> {
    this.updateProgress('Starting Module Generation', 10);
    this.updateAgentStatus('generator', 'in_progress');

    const generateTask = await this.taskManager.createTask(
      this.currentProject!.id,
      'add_modules',
      'generator',
      {
        project_path: config.options?.projectPath || process.cwd(),
        module_request: config.options?.moduleRequest || config.options?.description,
        output_directory: config.options?.outputDirectory || 'generated',
        auto_generate: config.options?.autoGenerate || false,
        frameworks: config.options?.frameworks
      },
      undefined,
      {
        ai_engine: config.aiEngine,
        priority: 7
      }
    );

    this.updateProgress('Generating modules', 40);

    try {
      await this.taskManager.startTask(generateTask.id);
      
      const generateResult = await this.generatorAgent.execute(generateTask);
      
      await this.taskManager.completeTask(
        generateTask.id,
        { generation_result: generateResult },
        generateResult.generated_modules.length * 100, // Rough token estimate
        0.1 // Rough cost estimate
      );

      this.updateAgentStatus('generator', 'completed');
      this.updateProgress('Module Generation Completed', 100, ['Module Generation']);

      await this.logger.info('orchestrator', 'Generate mode completed successfully', {
        task_id: generateTask.id,
        modules_generated: generateResult.generated_modules.length,
        integration_steps: generateResult.integration_instructions.length
      });

    } catch (error) {
      this.updateAgentStatus('generator', 'failed');
      await this.taskManager.failTask(generateTask.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  private async executeFullMode(config: AgentConfig): Promise<void> {
    this.updateProgress('Starting Full Analysis Workflow', 5);

    const workflow = await this.taskManager.createWorkflow(
      this.currentProject!.id,
      'full',
      {
        project_path: config.options?.projectPath || process.cwd(),
        max_files: config.options?.maxFiles || 100,
        module_request: config.options?.moduleRequest,
        auto_apply: config.options?.autoApply || false,
        auto_generate: config.options?.autoGenerate || false
      }
    );

    await this.taskManager.startTask(workflow.id);

    try {
      // Step 1: Scan
      this.updateProgress('Phase 1: Code Analysis', 15);
      this.updateAgentStatus('scanner', 'in_progress');

      const subTasks = await this.taskManager.getTasksByParent(workflow.id);
      const scanTask = subTasks.find(t => t.agent_type === 'scanner');
      
      if (!scanTask) {
        throw new Error('Scan task not found in workflow');
      }

      await this.taskManager.startTask(scanTask.id);
      const scanResult = await this.scannerAgent.execute(scanTask);
      await this.taskManager.completeTask(scanTask.id, { scan_result: scanResult });
      
      this.updateAgentStatus('scanner', 'completed');
      this.updateProgress('Phase 1 Complete: Analysis finished', 35, ['Code Analysis']);

      // Step 2: Enhance
      this.updateProgress('Phase 2: UX Enhancement', 40);
      this.updateAgentStatus('improver', 'in_progress');

      const improveTask = subTasks.find(t => t.agent_type === 'improver');
      if (!improveTask) {
        throw new Error('Improve task not found in workflow');
      }

      // Update improve task with scan results
      improveTask.input_data.scan_results = scanResult;
      
      await this.taskManager.startTask(improveTask.id);
      const enhanceResult = await this.improverAgent.execute(improveTask);
      await this.taskManager.completeTask(improveTask.id, { enhancement_result: enhanceResult });
      
      this.updateAgentStatus('improver', 'completed');
      this.updateProgress('Phase 2 Complete: UX improvements identified', 65, ['UX Analysis']);

      // Step 3: Generate (if module request provided)
      if (config.options?.moduleRequest) {
        this.updateProgress('Phase 3: Module Generation', 70);
        this.updateAgentStatus('generator', 'in_progress');

        const generateTask = subTasks.find(t => t.agent_type === 'generator');
        if (!generateTask) {
          throw new Error('Generate task not found in workflow');
        }

        await this.taskManager.startTask(generateTask.id);
        const generateResult = await this.generatorAgent.execute(generateTask);
        await this.taskManager.completeTask(generateTask.id, { generation_result: generateResult });
        
        this.updateAgentStatus('generator', 'completed');
        this.updateProgress('Phase 3 Complete: Modules generated', 90, ['Module Generation']);
      }

      // Complete workflow
      await this.taskManager.completeTask(
        workflow.id,
        {
          scan_result: scanResult,
          enhancement_result: enhanceResult,
          workflow_completed: true
        }
      );

      this.updateProgress('Full Analysis Complete', 100, ['Complete Workflow']);

      await this.logger.info('orchestrator', 'Full mode completed successfully', {
        workflow_id: workflow.id,
        phases_completed: this.currentProgress.stages_completed.length,
        sub_tasks_completed: subTasks.length
      });

    } catch (error) {
      await this.taskManager.failTask(workflow.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  // Public methods for external access
  getCurrentProgress(): AgentProgress {
    return { ...this.currentProgress };
  }

  getCurrentProject(): Project | null {
    return this.currentProject;
  }

  isSystemRunning(): boolean {
    return this.isRunning;
  }

  async getSystemCapabilities(): Promise<Record<string, any>> {
    return {
      version: '1.0.0',
      ai_engines: ['claude'],
      execution_modes: ['scan', 'enhance', 'add_modules', 'full'],
      scanner_capabilities: this.scannerAgent.getCapabilities(),
      improver_capabilities: this.improverAgent.getCapabilities(),
      generator_capabilities: this.generatorAgent.getCapabilities(),
      max_concurrent_tasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '5'),
      supported_file_types: [
        'TypeScript/JavaScript',
        'React/Vue/Svelte',
        'CSS/SCSS',
        'HTML',
        'JSON/YAML',
        'Markdown'
      ],
      features: [
        'Code Analysis',
        'UX Enhancement',
        'Module Generation',
        'Memory System',
        'Task Orchestration',
        'Progress Tracking',
        'Cost Optimization',
        'Dual Logging'
      ]
    };
  }

  async getProjectStats(projectId?: string): Promise<Record<string, any>> {
    const targetProjectId = projectId || this.currentProject?.id;
    
    if (!targetProjectId) {
      throw new Error('No project specified and no current project active');
    }

    const [taskStats, memoryStats, usageStats] = await Promise.all([
      this.taskManager.getTaskStatistics(targetProjectId),
      this.memoryManager.getMemoryStatistics(targetProjectId),
      this.aiClient.getUsageStats()
    ]);

    return {
      project_id: targetProjectId,
      task_statistics: taskStats,
      memory_statistics: memoryStats,
      ai_usage: usageStats,
      last_updated: new Date().toISOString()
    };
  }

  async getRecentLogs(limit: number = 50): Promise<any[]> {
    const projectId = this.currentProject?.id;
    return this.logger.getRecentLogs(limit, projectId);
  }

  async getLearningsSummary(projectId?: string): Promise<Record<string, any>> {
    const targetProjectId = projectId || this.currentProject?.id;
    
    if (!targetProjectId) {
      throw new Error('No project specified and no current project active');
    }

    return this.memoryManager.getLearningsSummary(targetProjectId);
  }

  // Maintenance methods
  async performMaintenance(): Promise<void> {
    await this.logger.info('orchestrator', 'Starting system maintenance');

    try {
      const retentionDays = parseInt(process.env.MEMORY_RETENTION_DAYS || '30');
      
      // Cleanup old logs
      await this.logger.cleanupOldLogs(retentionDays);
      
      // Cleanup old tasks
      await this.taskManager.cleanupCompletedTasks(7);
      
      // Cleanup old memories for current project
      if (this.currentProject) {
        await this.memoryManager.cleanupOldMemories(this.currentProject.id, retentionDays);
      }

      await this.logger.info('orchestrator', 'System maintenance completed');
    } catch (error) {
      await this.logger.error('orchestrator', 'System maintenance failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    await this.logger.info('orchestrator', 'Shutting down Claude Agent System');
    
    if (this.isRunning) {
      await this.logger.warn('orchestrator', 'Forced shutdown while system was running');
    }

    // Perform final maintenance
    await this.performMaintenance();
    
    await this.logger.endSession('System shutdown');
  }
}

// Export a default instance for convenience
export const agentSystem = new ClaudeAgentSystem();

// Export configuration helpers
export function createAgentConfig(
  projectName: string,
  mode: ExecutionMode,
  options?: Partial<AgentConfig['options']>
): AgentConfig {
  return {
    projectName,
    mode,
    aiEngine: 'claude',
    options: {
      projectPath: process.cwd(),
      maxFiles: 100,
      autoApply: false,
      autoGenerate: false,
      ...options
    }
  };
}

// CLI runner function
export async function runAgent(
  projectName: string,
  mode: ExecutionMode,
  options?: Record<string, any>
): Promise<void> {
  const config = createAgentConfig(projectName, mode, options);
  
  try {
    await agentSystem.execute(config);
    console.log('\n✅ Claude Agent System execution completed successfully!');
    
    // Show progress summary
    const progress = agentSystem.getCurrentProgress();
    console.log(`📊 Final Progress: ${progress.overall_progress}%`);
    console.log(`🎯 Stages Completed: ${progress.stages_completed.join(', ')}`);
    
  } catch (error) {
    console.error('\n❌ Claude Agent System execution failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Handle CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log(`
Usage: ts-node agent-core/agent.ts <project-name> <mode> [options]

Modes:
  scan       - Analyze code structure and identify issues
  enhance    - Improve UX based on analysis results  
  add_modules - Generate new modules and components
  full       - Complete workflow (scan + enhance + generate)

Examples:
  ts-node agent-core/agent.ts "My Project" scan
  ts-node agent-core/agent.ts "My Project" enhance --auto-apply
  ts-node agent-core/agent.ts "My Project" add_modules --module-request "Create a login form component"
  ts-node agent-core/agent.ts "My Project" full --module-request "Authentication system"
    `);
    process.exit(1);
  }

  const [projectName, mode] = args;
  const options: Record<string, any> = {};

  // Parse additional options
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    if (key && value) {
      options[key] = value === 'true' ? true : value === 'false' ? false : value;
    }
  }

  runAgent(projectName, mode as ExecutionMode, options);
}