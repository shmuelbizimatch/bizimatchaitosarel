import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AgentConfig, Task, Project, ScanResult, EnhancementResult, ModuleGenerationResult } from '../types';
import { Logger } from './logger/logger';
import { AIClient } from './engines/AIClient';
import { TaskManager } from './tasks/taskManager';
import { MemoryManager } from './memory/memoryManager';
import { ScannerAgent } from './agents/scanner';
import { ImproverAgent } from './agents/improver';
import { GeneratorAgent } from './agents/generator';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class ClaudeAgentSystem {
  private logger: Logger;
  private aiClient: AIClient;
  private taskManager: TaskManager;
  private memoryManager: MemoryManager;
  private scannerAgent: ScannerAgent;
  private improverAgent: ImproverAgent;
  private generatorAgent: GeneratorAgent;
  private supabase: SupabaseClient;

  constructor() {
    // Initialize core systems
    this.logger = new Logger();
    this.aiClient = new AIClient(this.logger);
    this.taskManager = new TaskManager(this.logger);
    this.memoryManager = new MemoryManager(this.logger);

    // Initialize sub-agents
    this.scannerAgent = new ScannerAgent(this.logger, this.aiClient, this.memoryManager, this.taskManager);
    this.improverAgent = new ImproverAgent(this.logger, this.aiClient, this.memoryManager, this.taskManager);
    this.generatorAgent = new GeneratorAgent(this.logger, this.aiClient, this.memoryManager, this.taskManager);

    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async executeAgent(config: AgentConfig): Promise<any> {
    await this.logger.startSession(config.projectName);
    
    try {
      await this.logger.info('orchestrator', 'Starting agent execution', {
        project_name: config.projectName,
        mode: config.mode,
        ai_engine: config.aiEngine
      });

      // Step 1: Get or create project
      const project = await this.getOrCreateProject(config.projectName);
      
      // Step 2: Set logging context
      this.logger.setContext(project.id);

      // Step 3: Create workflow based on execution mode
      const workflow = await this.taskManager.createWorkflow(
        project.id,
        config.mode,
        {
          projectName: config.projectName,
          projectPath: process.cwd(),
          mode: config.mode,
          aiEngine: config.aiEngine,
          options: config.options || {}
        }
      );

      await this.logger.info('orchestrator', `Created workflow: ${workflow.id}`, {
        workflow_id: workflow.id,
        mode: config.mode,
        sub_tasks: workflow.input_data.sub_task_ids?.length || 0
      });

      // Step 4: Execute workflow
      const results = await this.executeWorkflow(workflow, project);

      // Step 5: Generate final report
      const report = await this.generateExecutionReport(project, workflow, results);

      await this.logger.info('orchestrator', 'Agent execution completed successfully', {
        project_id: project.id,
        workflow_id: workflow.id,
        execution_time: Date.now() - new Date(workflow.started_at || Date.now()).getTime(),
        results_summary: this.summarizeResults(results)
      });

      await this.logger.endSession(`Completed ${config.mode} execution for ${config.projectName}`);

      return {
        project,
        workflow,
        results,
        report
      };

    } catch (error) {
      await this.logger.error('orchestrator', 'Agent execution failed', {
        project_name: config.projectName,
        mode: config.mode,
        error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);

      await this.logger.endSession(`Failed ${config.mode} execution: ${error instanceof Error ? error.message : String(error)}`);

      throw error;
    }
  }

  private async getOrCreateProject(projectName: string): Promise<Project> {
    try {
      // Check if project already exists
      const { data: existingProject, error: searchError } = await this.supabase
        .from('projects')
        .select('*')
        .eq('name', projectName)
        .single();

      if (existingProject && !searchError) {
        await this.logger.info('orchestrator', `Using existing project: ${projectName}`, {
          project_id: existingProject.id,
          created_at: existingProject.created_at
        });
        return existingProject as Project;
      }

      // Create new project
      const newProject: Omit<Project, 'id' | 'created_at' | 'last_activity'> = {
        name: projectName,
        settings: {
          default_ai_engine: 'claude',
          auto_enhance: false,
          max_file_size_mb: 10,
          excluded_patterns: ['node_modules', '.git', 'dist', 'build'],
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
      await this.logger.error('orchestrator', 'Failed to get or create project', {
        project_name: projectName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async executeWorkflow(workflow: Task, project: Project): Promise<any> {
    const mode = workflow.task_type;
    const subTaskIds = workflow.input_data.sub_task_ids || [];
    
    await this.logger.info('orchestrator', `Executing workflow for mode: ${mode}`, {
      workflow_id: workflow.id,
      sub_tasks: subTaskIds.length
    });

    const results: any = {
      mode,
      scan_result: null,
      enhancement_result: null,
      generation_result: null,
      sub_task_results: []
    };

    try {
      // Start workflow task
      await this.taskManager.startTask(workflow.id);

      // Execute sub-tasks in sequence based on mode
      for (const subTaskId of subTaskIds) {
        const subTask = await this.taskManager.getTask(subTaskId);
        if (!subTask) {
          await this.logger.warn('orchestrator', `Sub-task not found: ${subTaskId}`);
          continue;
        }

        await this.logger.info('orchestrator', `Executing sub-task: ${subTask.agent_type}`, {
          sub_task_id: subTaskId,
          agent_type: subTask.agent_type,
          task_type: subTask.task_type
        });

        let subTaskResult;

        switch (subTask.agent_type) {
          case 'scanner':
            subTaskResult = await this.scannerAgent.executeTask(subTask);
            results.scan_result = subTaskResult;
            
            // Pass scan results to subsequent tasks
            if (mode === 'enhance' || mode === 'full') {
              await this.updateSubsequentTasks(subTaskIds, subTaskId, { scanResults: subTaskResult });
            }
            break;

          case 'improver':
            // Ensure scan results are available
            const scanResultsForImprover = results.scan_result || subTask.input_data.scanResults;
            if (!scanResultsForImprover) {
              throw new Error('Scan results required for improvement task');
            }
            
            const improverInputData = {
              ...subTask.input_data,
              scanResults: scanResultsForImprover
            };
            
            const improverTask = { ...subTask, input_data: improverInputData };
            subTaskResult = await this.improverAgent.executeTask(improverTask);
            results.enhancement_result = subTaskResult;
            break;

          case 'generator':
            subTaskResult = await this.generatorAgent.executeTask(subTask);
            results.generation_result = subTaskResult;
            break;

          default:
            await this.logger.warn('orchestrator', `Unknown agent type: ${subTask.agent_type}`);
            continue;
        }

        results.sub_task_results.push({
          task_id: subTaskId,
          agent_type: subTask.agent_type,
          result: subTaskResult
        });

        await this.logger.info('orchestrator', `Sub-task completed: ${subTask.agent_type}`, {
          sub_task_id: subTaskId,
          agent_type: subTask.agent_type
        });
      }

      // Complete the workflow
      await this.taskManager.completeTask(
        workflow.id,
        { workflow_results: results },
        this.calculateTotalTokens(results),
        this.calculateTotalCost(results)
      );

      // Store workflow insights
      await this.storeWorkflowInsights(project.id, workflow, results);

      return results;

    } catch (error) {
      await this.logger.error('orchestrator', 'Workflow execution failed', {
        workflow_id: workflow.id,
        mode,
        error: error instanceof Error ? error.message : String(error)
      });

      await this.taskManager.failTask(
        workflow.id,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );

      throw error;
    }
  }

  private async updateSubsequentTasks(
    subTaskIds: string[],
    completedTaskId: string,
    additionalData: any
  ): Promise<void> {
    try {
      const completedIndex = subTaskIds.indexOf(completedTaskId);
      if (completedIndex === -1) return;

      // Update all subsequent tasks with additional data
      for (let i = completedIndex + 1; i < subTaskIds.length; i++) {
        const taskId = subTaskIds[i];
        const task = await this.taskManager.getTask(taskId);
        
        if (task) {
          const updatedInputData = {
            ...task.input_data,
            ...additionalData
          };

          await this.supabase
            .from('tasks')
            .update({ input_data: updatedInputData })
            .eq('id', taskId);

          await this.logger.debug('orchestrator', `Updated sub-task input data: ${taskId}`, {
            task_id: taskId,
            additional_data_keys: Object.keys(additionalData)
          });
        }
      }
    } catch (error) {
      await this.logger.warn('orchestrator', 'Failed to update subsequent tasks', {
        completed_task_id: completedTaskId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private calculateTotalTokens(results: any): number {
    let total = 0;
    
    if (results.scan_result?.tokensUsed) {
      total += results.scan_result.tokensUsed;
    }
    
    if (results.enhancement_result?.improvements) {
      total += results.enhancement_result.improvements.reduce(
        (sum: number, imp: any) => sum + (imp.tokensUsed || 0), 0
      );
    }
    
    if (results.generation_result?.generated_modules) {
      total += results.generation_result.generated_modules.reduce(
        (sum: number, mod: any) => sum + (mod.tokensUsed || 0), 0
      );
    }
    
    return total;
  }

  private calculateTotalCost(results: any): number {
    let total = 0;
    
    if (results.scan_result?.costEstimate) {
      total += results.scan_result.costEstimate;
    }
    
    if (results.enhancement_result?.improvements) {
      total += results.enhancement_result.improvements.reduce(
        (sum: number, imp: any) => sum + (imp.costEstimate || 0), 0
      );
    }
    
    if (results.generation_result?.generated_modules) {
      total += results.generation_result.generated_modules.reduce(
        (sum: number, mod: any) => sum + (mod.costEstimate || 0), 0
      );
    }
    
    return total;
  }

  private summarizeResults(results: any): any {
    const summary: any = {
      mode: results.mode,
      sub_tasks_executed: results.sub_task_results.length
    };

    if (results.scan_result) {
      summary.scan = {
        files_analyzed: results.scan_result.structure_analysis.file_count,
        issues_found: results.scan_result.issues.length,
        opportunities_found: results.scan_result.opportunities.length,
        complexity_score: results.scan_result.structure_analysis.complexity_score
      };
    }

    if (results.enhancement_result) {
      summary.enhancement = {
        improvements_suggested: results.enhancement_result.improvements.length,
        ux_score_improvement: results.enhancement_result.ux_score_after - results.enhancement_result.ux_score_before,
        implementation_steps: results.enhancement_result.implementation_plan.length
      };
    }

    if (results.generation_result) {
      summary.generation = {
        modules_generated: results.generation_result.generated_modules.length,
        module_types: results.generation_result.generated_modules.map((m: any) => m.type),
        integration_steps: results.generation_result.integration_instructions.length
      };
    }

    return summary;
  }

  private async storeWorkflowInsights(
    projectId: string,
    workflow: Task,
    results: any
  ): Promise<void> {
    try {
      // Store overall workflow insight
      await this.memoryManager.storeInsight(
        projectId,
        `Workflow completed: ${workflow.task_type} mode execution`,
        {
          workflow_id: workflow.id,
          mode: workflow.task_type,
          sub_tasks_executed: results.sub_task_results.length,
          total_tokens: this.calculateTotalTokens(results),
          total_cost: this.calculateTotalCost(results),
          results_summary: this.summarizeResults(results)
        },
        9 // Very high importance
      );

      // Store mode-specific insights
      if (results.scan_result) {
        await this.memoryManager.storeSuccess(
          projectId,
          `Successful scan execution`,
          `Analyzed ${results.scan_result.structure_analysis.file_count} files, found ${results.scan_result.issues.length} issues`,
          {
            files_analyzed: results.scan_result.structure_analysis.file_count,
            issues_found: results.scan_result.issues.length,
            complexity_score: results.scan_result.structure_analysis.complexity_score
          },
          8
        );
      }

      if (results.enhancement_result) {
        await this.memoryManager.storeSuccess(
          projectId,
          `Successful enhancement execution`,
          `Generated ${results.enhancement_result.improvements.length} improvements`,
          {
            improvements_count: results.enhancement_result.improvements.length,
            ux_improvement: results.enhancement_result.ux_score_after - results.enhancement_result.ux_score_before
          },
          8
        );
      }

      if (results.generation_result) {
        await this.memoryManager.storeSuccess(
          projectId,
          `Successful generation execution`,
          `Generated ${results.generation_result.generated_modules.length} modules`,
          {
            modules_count: results.generation_result.generated_modules.length,
            module_types: results.generation_result.generated_modules.map((m: any) => m.type)
          },
          8
        );
      }

      // Store execution pattern
      await this.memoryManager.storePattern(
        projectId,
        `Workflow execution pattern: ${workflow.task_type}`,
        [`Sub-tasks: ${results.sub_task_results.length}`, `Total tokens: ${this.calculateTotalTokens(results)}`],
        1,
        7
      );

    } catch (error) {
      await this.logger.warn('orchestrator', 'Failed to store workflow insights', {
        project_id: projectId,
        workflow_id: workflow.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async generateExecutionReport(
    project: Project,
    workflow: Task,
    results: any
  ): Promise<string> {
    const startTime = new Date(workflow.started_at || Date.now());
    const endTime = new Date(workflow.completed_at || Date.now());
    const duration = endTime.getTime() - startTime.getTime();

    let report = `# Claude Agent System - Execution Report\n\n`;
    report += `**Project:** ${project.name}\n`;
    report += `**Mode:** ${workflow.task_type}\n`;
    report += `**Executed:** ${endTime.toLocaleString()}\n`;
    report += `**Duration:** ${Math.round(duration / 1000)} seconds\n`;
    report += `**Workflow ID:** ${workflow.id}\n\n`;

    // Add summary
    const summary = this.summarizeResults(results);
    report += `## Summary\n\n`;
    report += `- Sub-tasks executed: ${summary.sub_tasks_executed}\n`;
    report += `- Total tokens used: ${this.calculateTotalTokens(results)}\n`;
    report += `- Total cost: $${this.calculateTotalCost(results).toFixed(4)}\n\n`;

    // Add scan results
    if (results.scan_result) {
      report += `## Code Analysis Results\n\n`;
      report += `- Files analyzed: ${results.scan_result.structure_analysis.file_count}\n`;
      report += `- Components found: ${results.scan_result.structure_analysis.component_count}\n`;
      report += `- Complexity score: ${results.scan_result.structure_analysis.complexity_score}/10\n`;
      report += `- Architecture patterns: ${results.scan_result.structure_analysis.architecture_patterns.join(', ')}\n`;
      report += `- Issues found: ${results.scan_result.issues.length}\n`;
      report += `- Opportunities identified: ${results.scan_result.opportunities.length}\n\n`;

      if (results.scan_result.issues.length > 0) {
        report += `### Critical Issues\n\n`;
        const criticalIssues = results.scan_result.issues.filter((issue: any) => issue.severity === 'critical');
        criticalIssues.forEach((issue: any) => {
          report += `- **${issue.type}** in ${issue.file_path}: ${issue.description}\n`;
        });
        report += '\n';
      }
    }

    // Add enhancement results
    if (results.enhancement_result) {
      report += `## UX Enhancement Results\n\n`;
      report += `- Improvements suggested: ${results.enhancement_result.improvements.length}\n`;
      report += `- UX score before: ${results.enhancement_result.ux_score_before}/10\n`;
      report += `- UX score after: ${results.enhancement_result.ux_score_after}/10\n`;
      report += `- Score improvement: +${(results.enhancement_result.ux_score_after - results.enhancement_result.ux_score_before).toFixed(1)}\n`;
      report += `- Implementation steps: ${results.enhancement_result.implementation_plan.length}\n\n`;
    }

    // Add generation results
    if (results.generation_result) {
      report += `## Module Generation Results\n\n`;
      report += `- Modules generated: ${results.generation_result.generated_modules.length}\n`;
      
      const moduleTypes = results.generation_result.generated_modules.reduce((types: any, mod: any) => {
        types[mod.type] = (types[mod.type] || 0) + 1;
        return types;
      }, {});
      
      report += `- Module types:\n`;
      Object.entries(moduleTypes).forEach(([type, count]) => {
        report += `  - ${type}: ${count}\n`;
      });
      report += `- Integration instructions: ${results.generation_result.integration_instructions.length}\n`;
      report += `- Testing suggestions: ${results.generation_result.testing_suggestions.length}\n\n`;
    }

    // Add recommendations
    report += `## Recommendations\n\n`;
    report += this.generateRecommendations(results);

    return report;
  }

  private generateRecommendations(results: any): string {
    let recommendations = '';

    if (results.scan_result) {
      const criticalIssues = results.scan_result.issues.filter((issue: any) => issue.severity === 'critical');
      if (criticalIssues.length > 0) {
        recommendations += `### Immediate Actions Required\n\n`;
        criticalIssues.forEach((issue: any) => {
          recommendations += `- Fix ${issue.type} issue in ${issue.file_path}: ${issue.suggestion}\n`;
        });
        recommendations += '\n';
      }

      const highImpactOpportunities = results.scan_result.opportunities.filter((opp: any) => opp.impact === 'high');
      if (highImpactOpportunities.length > 0) {
        recommendations += `### High-Impact Improvements\n\n`;
        highImpactOpportunities.forEach((opp: any) => {
          recommendations += `- ${opp.description}: ${opp.implementation_suggestion}\n`;
        });
        recommendations += '\n';
      }
    }

    if (results.enhancement_result) {
      const quickWins = results.enhancement_result.improvements.filter((imp: any) => 
        imp.impact_assessment.implementation_effort <= 3 && imp.impact_assessment.user_experience >= 7
      );
      
      if (quickWins.length > 0) {
        recommendations += `### Quick UX Wins\n\n`;
        quickWins.forEach((imp: any) => {
          recommendations += `- ${imp.description} (Effort: ${imp.impact_assessment.implementation_effort}/10, UX Impact: ${imp.impact_assessment.user_experience}/10)\n`;
        });
        recommendations += '\n';
      }
    }

    if (results.generation_result) {
      recommendations += `### Module Integration\n\n`;
      recommendations += `- Follow the provided integration instructions for ${results.generation_result.generated_modules.length} generated modules\n`;
      recommendations += `- Implement the suggested testing strategies\n`;
      recommendations += `- Consider the generated modules as starting points and customize them for your specific needs\n\n`;
    }

    if (!recommendations) {
      recommendations = 'No specific recommendations at this time. The analysis completed successfully.\n\n';
    }

    return recommendations;
  }

  // Public utility methods
  async getProjectStatus(projectId: string): Promise<any> {
    try {
      const [project, recentTasks, recentLogs, memories] = await Promise.all([
        this.supabase.from('projects').select('*').eq('id', projectId).single(),
        this.taskManager.getProjectTasks(projectId, undefined, 10),
        this.logger.getRecentLogs(10, projectId),
        this.memoryManager.getLearningsSummary(projectId)
      ]);

      return {
        project: project.data,
        recent_tasks: recentTasks,
        recent_logs: recentLogs,
        learning_summary: memories
      };
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to get project status', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getSystemStats(): Promise<any> {
    try {
      const stats = {
        ai_usage: this.aiClient.getUsageStats(),
        active_tasks: (await this.taskManager.getActiveTasks()).length,
        system_uptime: process.uptime(),
        memory_usage: process.memoryUsage()
      };

      return stats;
    } catch (error) {
      await this.logger.error('orchestrator', 'Failed to get system stats', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.logger.info('orchestrator', 'Starting system cleanup');

      // Cleanup old logs and tasks based on retention settings
      const retentionDays = parseInt(process.env.MEMORY_RETENTION_DAYS || '30');
      
      await Promise.all([
        this.logger.cleanupOldLogs(retentionDays),
        this.taskManager.cleanupCompletedTasks(7), // Keep completed tasks for 7 days
        this.memoryManager.cleanupOldMemories(retentionDays)
      ]);

      await this.logger.info('orchestrator', 'System cleanup completed');
    } catch (error) {
      await this.logger.error('orchestrator', 'System cleanup failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

// Export a singleton instance
export const agentSystem = new ClaudeAgentSystem();