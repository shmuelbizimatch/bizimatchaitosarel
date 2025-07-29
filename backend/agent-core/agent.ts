import dotenv from 'dotenv';
import { AgentConfig, Task, ScanResult, EnhancementResult, ModuleGenerationResult, ExecutionMode, AgentType } from '../types';
import { Logger } from './logger/logger';
import { TaskManager } from './tasks/taskManager';
import { MemoryManager } from './memory/memoryManager';
import { AIClient } from './engines/AIClient';
import { ScannerAgent } from './agents/scanner';
import { ImproverAgent } from './agents/improver';
import { GeneratorAgent } from './agents/generator';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

export class ClaudeAgentSystem {
  private logger: Logger;
  private taskManager: TaskManager;
  private memoryManager: MemoryManager;
  private aiClient: AIClient;
  private scannerAgent: ScannerAgent;
  private improverAgent: ImproverAgent;
  private generatorAgent: GeneratorAgent;
  private supabase: any;
  private isRunning: boolean = false;
  private currentProject?: { id: string; name: string };

  constructor() {
    // Initialize core components
    this.logger = new Logger();
    this.taskManager = new TaskManager(this.logger);
    this.memoryManager = new MemoryManager(this.logger);
    this.aiClient = new AIClient(this.logger);

    // Initialize sub-agents
    this.scannerAgent = new ScannerAgent(this.aiClient, this.logger, this.memoryManager);
    this.improverAgent = new ImproverAgent(this.aiClient, this.logger, this.memoryManager);
    this.generatorAgent = new GeneratorAgent(this.aiClient, this.logger, this.memoryManager);

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);

    this.logger.info('orchestrator', 'Claude Agent System initialized successfully');
  }

  /**
   * Main execution entry point for the agent system
   */
  async execute(config: AgentConfig): Promise<any> {
    await this.logger.info('orchestrator', `Starting agent execution`, {
      project_name: config.projectName,
      mode: config.mode,
      ai_engine: config.aiEngine
    });

    try {
      this.isRunning = true;

      // 1. Initialize or get project
      const project = await this.initializeProject(config.projectName);
      this.currentProject = project;

      // 2. Start session logging
      await this.logger.startSession(config.projectName);
      this.logger.setContext(project.id);

      // 3. Create and execute workflow based on mode
      const workflow = await this.createWorkflow(project.id, config);
      const result = await this.executeWorkflow(workflow, config);

      // 4. End session and cleanup
      await this.endSession(result);

      return result;

    } catch (error) {
      await this.logger.error('orchestrator', 'Agent execution failed', {
        project_name: config.projectName,
        error: error instanceof Error ? error.message : String(error)
      }, error as Error);

      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Initialize or retrieve project from database
   */
  private async initializeProject(projectName: string): Promise<{ id: string; name: string }> {
    try {
      // Check if project exists
      const { data: existingProject, error: fetchError } = await this.supabase
        .from('projects')
        .select('id, name')
        .eq('name', projectName)
        .single();

      if (existingProject && !fetchError) {
        await this.logger.info('orchestrator', `Using existing project: ${projectName}`, {
          project_id: existingProject.id
        });
        return existingProject;
      }

      // Create new project
      const { data: newProject, error: createError } = await this.supabase
        .from('projects')
        .insert([{
          name: projectName,
          settings: {
            default_ai_engine: 'claude',
            auto_enhance: false,
            max_file_size_mb: 10,
            excluded_patterns: ['node_modules', '.git', 'dist'],
            preferred_frameworks: ['react', 'typescript']
          }
        }])
        .select('id, name')
        .single();

      if (createError) {
        throw new Error(`Failed to create project: ${createError.message}`);
      }

      await this.logger.info('orchestrator', `Created new project: ${projectName}`, {
        project_id: newProject.id
      });

      return newProject;

    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to initialize project', {
        project_name: projectName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Create workflow based on execution mode
   */
  private async createWorkflow(projectId: string, config: AgentConfig): Promise<Task> {
    const inputData = {
      project_path: process.cwd(),
      project_name: config.projectName,
      mode: config.mode,
      ai_engine: config.aiEngine,
      target_files: config.options?.targetFiles,
      exclude_patterns: config.options?.excludePatterns,
      max_concurrent_tasks: config.options?.maxConcurrentTasks || parseInt(process.env.MAX_CONCURRENT_TASKS || '3'),
      timeout_ms: config.options?.timeoutMs || parseInt(process.env.TASK_TIMEOUT_MS || '300000')
    };

    return await this.taskManager.createWorkflow(projectId, config.mode, inputData);
  }

  /**
   * Execute workflow based on mode
   */
  private async executeWorkflow(workflow: Task, config: AgentConfig): Promise<any> {
    await this.logger.info('orchestrator', `Executing ${config.mode} workflow`, {
      workflow_id: workflow.id,
      mode: config.mode
    });

    try {
      await this.taskManager.startTask(workflow.id);

      let result: any;

      switch (config.mode) {
        case 'scan':
          result = await this.executeScanWorkflow(workflow, config);
          break;
        case 'enhance':
          result = await this.executeEnhanceWorkflow(workflow, config);
          break;
        case 'add_modules':
          result = await this.executeGenerateWorkflow(workflow, config);
          break;
        case 'full':
          result = await this.executeFullWorkflow(workflow, config);
          break;
        default:
          throw new Error(`Unknown execution mode: ${config.mode}`);
      }

      await this.taskManager.completeTask(
        workflow.id,
        { workflow_result: result },
        result.tokens_used || 0,
        result.cost_estimate || 0
      );

      return result;

    } catch (error) {
      await this.taskManager.failTask(
        workflow.id,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );
      throw error;
    }
  }

  /**
   * Execute scan-only workflow
   */
  private async executeScanWorkflow(workflow: Task, config: AgentConfig): Promise<ScanResult> {
    await this.logger.info('orchestrator', 'Executing scan workflow');

    const scanTask = await this.createSubTask(workflow, 'scan', 'scanner', workflow.input_data);
    
    try {
      await this.taskManager.startTask(scanTask.id);
      this.logger.setContext(workflow.project_id, scanTask.id);

      const scanResult = await this.scannerAgent.scan(scanTask);

      await this.taskManager.completeTask(
        scanTask.id,
        { scan_result: scanResult },
        this.calculateTokensUsed(scanResult),
        this.calculateCostEstimate(scanResult)
      );

      await this.logger.info('orchestrator', 'Scan workflow completed successfully', {
        files_analyzed: scanResult.structure_analysis.file_count,
        issues_found: scanResult.issues.length,
        opportunities_identified: scanResult.opportunities.length
      });

      return {
        ...scanResult,
        tokens_used: this.calculateTokensUsed(scanResult),
        cost_estimate: this.calculateCostEstimate(scanResult)
      } as any;

    } catch (error) {
      await this.taskManager.failTask(
        scanTask.id,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );
      throw error;
    }
  }

  /**
   * Execute enhance workflow (scan + improve)
   */
  private async executeEnhanceWorkflow(workflow: Task, config: AgentConfig): Promise<{ scanResult: ScanResult; enhancementResult: EnhancementResult }> {
    await this.logger.info('orchestrator', 'Executing enhance workflow');

    // Step 1: Scan
    const scanTask = await this.createSubTask(workflow, 'scan', 'scanner', workflow.input_data);
    const scanResult = await this.executeSubTask(scanTask, async (task) => {
      return await this.scannerAgent.scan(task);
    });

    // Step 2: Improve based on scan results
    const improveTask = await this.createSubTask(workflow, 'enhance', 'improver', {
      ...workflow.input_data,
      scan_results: scanResult
    });
    const enhancementResult = await this.executeSubTask(improveTask, async (task) => {
      return await this.improverAgent.improve(task);
    });

    await this.logger.info('orchestrator', 'Enhance workflow completed successfully', {
      scan_issues: scanResult.issues.length,
      improvements_suggested: enhancementResult.improvements.length,
      ux_score_improvement: enhancementResult.ux_score_after - enhancementResult.ux_score_before
    });

    return {
      scanResult,
      enhancementResult,
      tokens_used: this.calculateTokensUsed(scanResult) + this.calculateTokensUsed(enhancementResult),
      cost_estimate: this.calculateCostEstimate(scanResult) + this.calculateCostEstimate(enhancementResult)
    } as any;
  }

  /**
   * Execute module generation workflow
   */
  private async executeGenerateWorkflow(workflow: Task, config: AgentConfig): Promise<ModuleGenerationResult> {
    await this.logger.info('orchestrator', 'Executing module generation workflow');

    const moduleRequest = (config.options as any)?.moduleRequest || 'Generate utility components';
    
    const generateTask = await this.createSubTask(workflow, 'add_modules', 'generator', {
      ...workflow.input_data,
      module_request: moduleRequest
    });

    const generationResult = await this.executeSubTask(generateTask, async (task) => {
      return await this.generatorAgent.generate(task);
    });

    await this.logger.info('orchestrator', 'Module generation workflow completed successfully', {
      modules_generated: generationResult.generated_modules.length,
      integration_steps: generationResult.integration_instructions.length
    });

    return {
      ...generationResult,
      tokens_used: this.calculateTokensUsed(generationResult),
      cost_estimate: this.calculateCostEstimate(generationResult)
    } as any;
  }

  /**
   * Execute full workflow (scan + enhance + generate)
   */
  private async executeFullWorkflow(workflow: Task, config: AgentConfig): Promise<{
    scanResult: ScanResult;
    enhancementResult: EnhancementResult;
    generationResult: ModuleGenerationResult;
  }> {
    await this.logger.info('orchestrator', 'Executing full workflow');

    // Step 1: Scan
    const scanTask = await this.createSubTask(workflow, 'scan', 'scanner', workflow.input_data);
    const scanResult = await this.executeSubTask(scanTask, async (task) => {
      return await this.scannerAgent.scan(task);
    });

    // Step 2: Improve based on scan results
    const improveTask = await this.createSubTask(workflow, 'enhance', 'improver', {
      ...workflow.input_data,
      scan_results: scanResult
    });
    const enhancementResult = await this.executeSubTask(improveTask, async (task) => {
      return await this.improverAgent.improve(task);
    });

    // Step 3: Generate modules based on scan and enhancement results
    const moduleRequest = this.generateModuleRequestFromResults(scanResult, enhancementResult);
    const generateTask = await this.createSubTask(workflow, 'add_modules', 'generator', {
      ...workflow.input_data,
      scan_results: scanResult,
      enhancement_results: enhancementResult,
      module_request: moduleRequest
    });
    const generationResult = await this.executeSubTask(generateTask, async (task) => {
      return await this.generatorAgent.generate(task);
    });

    await this.logger.info('orchestrator', 'Full workflow completed successfully', {
      scan_issues: scanResult.issues.length,
      improvements_suggested: enhancementResult.improvements.length,
      modules_generated: generationResult.generated_modules.length,
      total_ux_improvement: enhancementResult.ux_score_after - enhancementResult.ux_score_before
    });

    return {
      scanResult,
      enhancementResult,
      generationResult,
      tokens_used: this.calculateTokensUsed(scanResult) + this.calculateTokensUsed(enhancementResult) + this.calculateTokensUsed(generationResult),
      cost_estimate: this.calculateCostEstimate(scanResult) + this.calculateCostEstimate(enhancementResult) + this.calculateCostEstimate(generationResult)
    } as any;
  }

  /**
   * Create a sub-task for workflow execution
   */
  private async createSubTask(
    parentTask: Task,
    taskType: ExecutionMode,
    agentType: AgentType,
    inputData: Record<string, any>
  ): Promise<Task> {
    return await this.taskManager.createTask(
      parentTask.project_id,
      taskType,
      agentType,
      inputData,
      parentTask.id,
      {
        priority: this.getTaskPriority(taskType),
        ai_engine: 'claude'
      }
    );
  }

  /**
   * Execute a sub-task with proper error handling and logging
   */
  private async executeSubTask<T>(task: Task, executor: (task: Task) => Promise<T>): Promise<T> {
    try {
      await this.taskManager.startTask(task.id);
      this.logger.setContext(task.project_id, task.id);

      const result = await executor(task);

      await this.taskManager.completeTask(
        task.id,
        { result },
        this.calculateTokensUsed(result),
        this.calculateCostEstimate(result)
      );

      return result;

    } catch (error) {
      await this.taskManager.failTask(
        task.id,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );
      throw error;
    }
  }

  /**
   * Generate module request based on scan and enhancement results
   */
  private generateModuleRequestFromResults(scanResult: ScanResult, enhancementResult: EnhancementResult): string {
    const requests: string[] = [];

    // Based on scan opportunities
    const uxOpportunities = scanResult.opportunities.filter(opp => opp.type === 'ux_improvement');
    if (uxOpportunities.length > 0) {
      requests.push('Create UX improvement components');
    }

    const performanceOpportunities = scanResult.opportunities.filter(opp => opp.type === 'performance_optimization');
    if (performanceOpportunities.length > 0) {
      requests.push('Generate performance optimization utilities');
    }

    // Based on enhancement results
    const visualEnhancements = enhancementResult.improvements.filter(imp => imp.enhancement_type === 'visual');
    if (visualEnhancements.length > 0) {
      requests.push('Create design system components');
    }

    const accessibilityEnhancements = enhancementResult.improvements.filter(imp => imp.enhancement_type === 'accessibility');
    if (accessibilityEnhancements.length > 0) {
      requests.push('Generate accessibility helper components');
    }

    // Default request if nothing specific found
    if (requests.length === 0) {
      requests.push('Create utility components and helper functions');
    }

    return requests.join(', ');
  }

  /**
   * Get task priority based on type
   */
  private getTaskPriority(taskType: ExecutionMode): number {
    switch (taskType) {
      case 'scan': return 9;
      case 'enhance': return 8;
      case 'add_modules': return 7;
      case 'full': return 10;
      default: return 5;
    }
  }

  /**
   * Calculate tokens used from result (simple heuristic)
   */
  private calculateTokensUsed(result: any): number {
    if (!result) return 0;
    
    // Simple heuristic based on result complexity
    const resultJson = JSON.stringify(result);
    return Math.floor(resultJson.length / 4); // Rough token approximation
  }

  /**
   * Calculate cost estimate from result
   */
  private calculateCostEstimate(result: any): number {
    const tokens = this.calculateTokensUsed(result);
    // Claude 3.5 Sonnet pricing: ~$3 per million input tokens, ~$15 per million output tokens
    // Rough estimate assuming 70% input, 30% output
    const inputCost = (tokens * 0.7) * (3 / 1000000);
    const outputCost = (tokens * 0.3) * (15 / 1000000);
    return inputCost + outputCost;
  }

  /**
   * End session and perform cleanup
   */
  private async endSession(result: any): Promise<void> {
    try {
      const summary = this.generateSessionSummary(result);
      await this.logger.endSession(summary);

      // Store session insights
      if (this.currentProject) {
        await this.memoryManager.storeInsight(
          this.currentProject.id,
          'Agent session completed',
          {
            session_end: new Date().toISOString(),
            result_summary: summary,
            tokens_used: result.tokens_used || 0,
            cost_estimate: result.cost_estimate || 0
          },
          7
        );
      }

      // Cleanup old logs and memories if configured
      const retentionDays = parseInt(process.env.MEMORY_RETENTION_DAYS || '30');
      await this.logger.cleanupOldLogs(retentionDays);
      await this.memoryManager.cleanupOldMemories(retentionDays);

    } catch (error) {
      await this.logger.warn('orchestrator', 'Session cleanup failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Generate session summary from results
   */
  private generateSessionSummary(result: any): string {
    if (result.scanResult && result.enhancementResult && result.generationResult) {
      return `Full workflow completed: analyzed ${result.scanResult.structure_analysis.file_count} files, ` +
             `found ${result.scanResult.issues.length} issues, suggested ${result.enhancementResult.improvements.length} improvements, ` +
             `generated ${result.generationResult.generated_modules.length} modules`;
    } else if (result.scanResult && result.enhancementResult) {
      return `Enhancement workflow completed: analyzed ${result.scanResult.structure_analysis.file_count} files, ` +
             `suggested ${result.enhancementResult.improvements.length} improvements`;
    } else if (result.structure_analysis) {
      return `Scan completed: analyzed ${result.structure_analysis.file_count} files, ` +
             `found ${result.issues.length} issues, identified ${result.opportunities.length} opportunities`;
    } else if (result.generated_modules) {
      return `Module generation completed: created ${result.generated_modules.length} modules`;
    }
    
    return 'Agent session completed successfully';
  }

  /**
   * Get current system status
   */
  public getStatus(): any {
    return {
      isRunning: this.isRunning,
      currentProject: this.currentProject,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      aiStats: this.aiClient.getUsageStats()
    };
  }

  /**
   * Get active tasks
   */
  public async getActiveTasks(): Promise<Task[]> {
    return await this.taskManager.getActiveTasks();
  }

  /**
   * Get recent logs
   */
  public async getRecentLogs(limit: number = 50): Promise<any[]> {
    return await this.logger.getRecentLogs(limit, this.currentProject?.id);
  }

  /**
   * Cancel running workflow
   */
  public async cancelWorkflow(reason?: string): Promise<void> {
    if (!this.isRunning) {
      throw new Error('No workflow is currently running');
    }

    const activeTasks = await this.getActiveTasks();
    
    for (const task of activeTasks) {
      await this.taskManager.cancelTask(task.id, reason || 'User requested cancellation');
    }

    this.isRunning = false;
    
    await this.logger.warn('orchestrator', 'Workflow cancelled', {
      reason: reason || 'User requested cancellation',
      cancelled_tasks: activeTasks.length
    });
  }

  /**
   * Get project statistics
   */
  public async getProjectStats(projectId?: string): Promise<any> {
    const targetProjectId = projectId || this.currentProject?.id;
    
    if (!targetProjectId) {
      throw new Error('No project specified and no current project');
    }

    const [taskStats, memoryStats] = await Promise.all([
      this.taskManager.getTaskStatistics(targetProjectId),
      this.memoryManager.getLearningsSummary(targetProjectId)
    ]);

    return {
      project_id: targetProjectId,
      task_statistics: taskStats,
      memory_statistics: memoryStats,
      ai_usage: this.aiClient.getUsageStats()
    };
  }
}

// CLI interface
async function runCLI() {
  if (require.main === module) {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log(`
Claude Agent System CLI

Usage:
  npm run dev -- <project-name> <mode> [options]

Modes:
  scan         - Analyze project structure and identify issues
  enhance      - Scan and provide UX improvements  
  add_modules  - Generate new modules/components
  full         - Complete analysis, enhancement, and generation

Examples:
  npm run dev -- "My Project" scan
  npm run dev -- "My Project" enhance
  npm run dev -- "My Project" full
      `);
      process.exit(0);
    }

    const projectName = args[0];
    const mode = args[1] as ExecutionMode;
    
    if (!['scan', 'enhance', 'add_modules', 'full'].includes(mode)) {
      console.error('Invalid mode. Use: scan, enhance, add_modules, or full');
      process.exit(1);
    }

    const config: AgentConfig = {
      projectName,
      mode,
      aiEngine: 'claude',
      options: {
        verboseLogging: true
      }
    };

    try {
      const agent = new ClaudeAgentSystem();
      const result = await agent.execute(config);
      
      console.log('\n🎉 Agent execution completed successfully!');
      console.log('\n📊 Results Summary:');
      console.log(JSON.stringify(result, null, 2));
      
    } catch (error) {
      console.error('\n❌ Agent execution failed:', error);
      process.exit(1);
    }
  }
}

// Export for programmatic use
export default ClaudeAgentSystem;

// Run CLI if executed directly
runCLI();