import { promises as fs } from 'fs';
import path from 'path';
import { EnhancementResult, Enhancement, CodeChange, ImpactAssessment, ImplementationStep, Task, ScanResult } from '../../types';
import { Logger } from '../logger/logger';
import { AIClient } from '../engines/AIClient';
import { MemoryManager } from '../memory/memoryManager';
import { TaskManager } from '../tasks/taskManager';

export class ImproverAgent {
  private logger: Logger;
  private aiClient: AIClient;
  private memoryManager: MemoryManager;
  private taskManager: TaskManager;

  constructor(
    logger: Logger,
    aiClient: AIClient,
    memoryManager: MemoryManager,
    taskManager: TaskManager
  ) {
    this.logger = logger;
    this.aiClient = aiClient;
    this.memoryManager = memoryManager;
    this.taskManager = taskManager;
  }

  async executeTask(task: Task): Promise<EnhancementResult> {
    await this.logger.info('improver', 'Starting enhancement task', {
      task_id: task.id,
      project_id: task.project_id
    });

    try {
      // Extract enhancement parameters from task input
      const { scanResults, targetComponents, focusAreas } = task.input_data;
      
      // Set context for logging
      this.logger.setContext(task.project_id, task.id);

      // Start the task
      await this.taskManager.startTask(task.id);

      // Step 1: Analyze scan results and retrieve relevant memories
      const analysisContext = await this.buildAnalysisContext(task.project_id, scanResults);

      // Step 2: Get UX preferences and patterns from memory
      const uxPreferences = await this.getUXPreferences(task.project_id);
      const successPatterns = await this.getSuccessfulPatterns(task.project_id);

      // Step 3: Generate improvement suggestions using Claude
      const improvements = await this.generateImprovements(
        scanResults,
        analysisContext,
        uxPreferences,
        successPatterns,
        targetComponents,
        focusAreas
      );

      // Step 4: Create implementation plan
      const implementationPlan = await this.createImplementationPlan(improvements);

      // Step 5: Calculate UX scores
      const uxScores = this.calculateUXScores(scanResults, improvements);

      // Step 6: Compile enhancement results
      const enhancementResult: EnhancementResult = {
        improvements,
        ux_score_before: uxScores.before,
        ux_score_after: uxScores.after,
        implementation_plan: implementationPlan
      };

      // Store improvement insights in memory
      await this.storeImprovementInsights(task.project_id, enhancementResult);

      // Complete the task
      await this.taskManager.completeTask(
        task.id,
        { enhancement_result: enhancementResult },
        improvements.reduce((sum, imp) => sum + (imp.tokensUsed || 0), 0),
        improvements.reduce((sum, imp) => sum + (imp.costEstimate || 0), 0)
      );

      await this.logger.info('improver', 'Enhancement task completed successfully', {
        task_id: task.id,
        improvements_count: improvements.length,
        ux_score_improvement: uxScores.after - uxScores.before,
        implementation_steps: implementationPlan.length
      });

      return enhancementResult;

    } catch (error) {
      await this.logger.error('improver', 'Enhancement task failed', {
        task_id: task.id,
        error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);

      await this.taskManager.failTask(
        task.id,
        error instanceof Error ? error.message : String(error),
        error instanceof Error ? error.stack : undefined
      );

      throw error;
    }
  }

  private async buildAnalysisContext(projectId: string, scanResults: ScanResult): Promise<string> {
    let context = `UX Enhancement Analysis Context:\n\n`;

    // Add scan results summary
    context += `Project Structure:\n`;
    context += `- File Count: ${scanResults.structure_analysis.file_count}\n`;
    context += `- Component Count: ${scanResults.structure_analysis.component_count}\n`;
    context += `- Complexity Score: ${scanResults.structure_analysis.complexity_score}/10\n`;
    context += `- Architecture: ${scanResults.structure_analysis.architecture_patterns.join(', ')}\n\n`;

    // Add key issues that affect UX
    const uxRelevantIssues = scanResults.issues.filter(issue => 
      issue.type === 'accessibility' || 
      issue.type === 'performance' ||
      issue.severity === 'high' ||
      issue.severity === 'critical'
    );

    if (uxRelevantIssues.length > 0) {
      context += `UX-Critical Issues:\n`;
      uxRelevantIssues.forEach(issue => {
        context += `- ${issue.type} (${issue.severity}): ${issue.description}\n`;
      });
      context += '\n';
    }

    // Add opportunities
    if (scanResults.opportunities.length > 0) {
      context += `Improvement Opportunities:\n`;
      scanResults.opportunities.forEach(opp => {
        context += `- ${opp.type} (${opp.impact} impact, ${opp.effort} effort): ${opp.description}\n`;
      });
      context += '\n';
    }

    // Add project metrics
    context += `Code Quality Metrics:\n`;
    context += `- Lines of Code: ${scanResults.metrics.lines_of_code}\n`;
    context += `- Cyclomatic Complexity: ${scanResults.metrics.cyclomatic_complexity}\n`;
    context += `- Maintainability Index: ${scanResults.metrics.maintainability_index}/100\n\n`;

    return context;
  }

  private async getUXPreferences(projectId: string): Promise<any[]> {
    try {
      const preferences = await this.memoryManager.getPreferences(projectId);
      return preferences.filter(pref => 
        pref.content.preference?.includes('ux') ||
        pref.content.preference?.includes('ui') ||
        pref.content.preference?.includes('design') ||
        pref.content.preference?.includes('user')
      );
    } catch (error) {
      await this.logger.warn('improver', 'Failed to retrieve UX preferences', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async getSuccessfulPatterns(projectId: string): Promise<any[]> {
    try {
      const successes = await this.memoryManager.getSuccesses(projectId);
      return successes.filter(success =>
        success.content.action?.includes('improvement') ||
        success.content.action?.includes('enhancement') ||
        success.content.action?.includes('ux') ||
        success.content.action?.includes('performance')
      );
    } catch (error) {
      await this.logger.warn('improver', 'Failed to retrieve successful patterns', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async generateImprovements(
    scanResults: ScanResult,
    analysisContext: string,
    uxPreferences: any[],
    successPatterns: any[],
    targetComponents?: string[],
    focusAreas?: string[]
  ): Promise<(Enhancement & { tokensUsed?: number; costEstimate?: number })[]> {
    try {
      // Build enhanced context with preferences and patterns
      let enhancedContext = analysisContext;

      if (uxPreferences.length > 0) {
        enhancedContext += `\nUX Preferences:\n`;
        uxPreferences.forEach(pref => {
          enhancedContext += `- ${pref.content.preference}: ${pref.content.value} (${pref.content.reasoning})\n`;
        });
        enhancedContext += '\n';
      }

      if (successPatterns.length > 0) {
        enhancedContext += `\nSuccessful Past Improvements:\n`;
        successPatterns.forEach(pattern => {
          enhancedContext += `- ${pattern.content.action}: ${pattern.content.outcome}\n`;
        });
        enhancedContext += '\n';
      }

      if (targetComponents && targetComponents.length > 0) {
        enhancedContext += `\nTarget Components: ${targetComponents.join(', ')}\n`;
      }

      if (focusAreas && focusAreas.length > 0) {
        enhancedContext += `\nFocus Areas: ${focusAreas.join(', ')}\n`;
      }

      // Get Claude's improvement suggestions
      const aiRequest = AIClient.getImproverPrompt(scanResults, enhancedContext);
      const response = await this.aiClient.generateResponse(aiRequest);

      // Parse Claude's response
      let improvementData;
      try {
        improvementData = JSON.parse(response.content);
      } catch (parseError) {
        await this.logger.error('improver', 'Failed to parse Claude improvement response', {
          response_content: response.content.slice(0, 500)
        });
        throw new Error('Invalid response format from Claude');
      }

      // Transform Claude's suggestions into our format
      const improvements: (Enhancement & { tokensUsed?: number; costEstimate?: number })[] = 
        (improvementData.improvements || []).map((imp: any) => ({
          component_path: imp.component_path || '',
          enhancement_type: imp.enhancement_type || 'visual',
          description: imp.description || '',
          code_changes: (imp.code_changes || []).map((change: any) => ({
            file_path: change.file_path || '',
            change_type: change.change_type || 'modify',
            original_code: change.original_code || '',
            new_code: change.new_code || '',
            line_number: change.line_number
          })),
          impact_assessment: {
            user_experience: imp.impact_assessment?.user_experience || 5,
            performance_impact: imp.impact_assessment?.performance_impact || 0,
            maintainability: imp.impact_assessment?.maintainability || 5,
            implementation_effort: imp.impact_assessment?.implementation_effort || 5
          },
          tokensUsed: Math.round(response.tokens_used / (improvementData.improvements?.length || 1)),
          costEstimate: response.cost_estimate / (improvementData.improvements?.length || 1)
        }));

      // Validate and enhance improvements
      const validatedImprovements = await this.validateAndEnhanceImprovements(improvements);

      return validatedImprovements;

    } catch (error) {
      await this.logger.error('improver', 'Failed to generate improvements', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async validateAndEnhanceImprovements(
    improvements: (Enhancement & { tokensUsed?: number; costEstimate?: number })[]
  ): Promise<(Enhancement & { tokensUsed?: number; costEstimate?: number })[]> {
    const validated: (Enhancement & { tokensUsed?: number; costEstimate?: number })[] = [];

    for (const improvement of improvements) {
      try {
        // Validate that target files exist
        const validCodeChanges: CodeChange[] = [];
        
        for (const change of improvement.code_changes) {
          if (change.file_path) {
            try {
              await fs.access(change.file_path);
              validCodeChanges.push(change);
            } catch (error) {
              await this.logger.warn('improver', `Target file does not exist: ${change.file_path}`);
            }
          }
        }

        // Only include improvements with valid code changes
        if (validCodeChanges.length > 0) {
          validated.push({
            ...improvement,
            code_changes: validCodeChanges
          });
        }

      } catch (error) {
        await this.logger.warn('improver', 'Failed to validate improvement', {
          component: improvement.component_path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return validated;
  }

  private async createImplementationPlan(
    improvements: Enhancement[]
  ): Promise<ImplementationStep[]> {
    const steps: ImplementationStep[] = [];
    let stepOrder = 1;

    // Group improvements by type and priority
    const groupedImprovements = this.groupImprovementsByPriority(improvements);

    // Create steps for each group
    for (const [priority, group] of Object.entries(groupedImprovements)) {
      for (const improvement of group) {
        // Estimate implementation time based on effort and change complexity
        const effortMultiplier = {
          low: 1,
          medium: 2,
          high: 4
        };

        const baseTime = improvement.code_changes.length * 15; // 15 minutes per code change
        const effort = improvement.impact_assessment.implementation_effort;
        const estimatedTime = baseTime * (effort / 5); // Scale by effort (1-10 scale)

        steps.push({
          order: stepOrder++,
          description: `${improvement.enhancement_type}: ${improvement.description}`,
          estimated_time_minutes: Math.round(estimatedTime),
          dependencies: this.findDependencies(improvement, improvements)
        });
      }
    }

    // Sort by dependencies and impact
    return this.optimizeImplementationOrder(steps);
  }

  private groupImprovementsByPriority(improvements: Enhancement[]): Record<string, Enhancement[]> {
    const groups: Record<string, Enhancement[]> = {
      critical: [],
      high: [],
      medium: [],
      low: []
    };

    improvements.forEach(improvement => {
      const uxScore = improvement.impact_assessment.user_experience;
      const effort = improvement.impact_assessment.implementation_effort;
      
      // Calculate priority based on UX impact vs effort
      const priority = uxScore / effort;

      if (priority > 1.5) {
        groups.critical.push(improvement);
      } else if (priority > 1.0) {
        groups.high.push(improvement);
      } else if (priority > 0.5) {
        groups.medium.push(improvement);
      } else {
        groups.low.push(improvement);
      }
    });

    return groups;
  }

  private findDependencies(improvement: Enhancement, allImprovements: Enhancement[]): string[] {
    const dependencies: string[] = [];

    // Check if this improvement depends on others
    for (const other of allImprovements) {
      if (other === improvement) continue;

      // Check file dependencies
      const hasFileDependency = improvement.code_changes.some(change =>
        other.code_changes.some(otherChange =>
          change.file_path === otherChange.file_path &&
          (change.line_number || 0) > (otherChange.line_number || 0)
        )
      );

      // Check component dependencies
      const hasComponentDependency = 
        improvement.component_path.includes(other.component_path) ||
        other.component_path.includes(improvement.component_path);

      if (hasFileDependency || hasComponentDependency) {
        dependencies.push(other.description);
      }
    }

    return dependencies;
  }

  private optimizeImplementationOrder(steps: ImplementationStep[]): ImplementationStep[] {
    // Simple topological sort based on dependencies
    const optimized: ImplementationStep[] = [];
    const remaining = [...steps];

    while (remaining.length > 0) {
      const independent = remaining.filter(step =>
        step.dependencies.every(dep =>
          optimized.some(completed => completed.description.includes(dep))
        )
      );

      if (independent.length === 0) {
        // Circular dependency or no clear order - just take the first one
        optimized.push(remaining.shift()!);
      } else {
        // Sort independent steps by estimated time (quick wins first)
        independent.sort((a, b) => a.estimated_time_minutes - b.estimated_time_minutes);
        optimized.push(independent[0]);
        const index = remaining.indexOf(independent[0]);
        remaining.splice(index, 1);
      }
    }

    // Update order numbers
    optimized.forEach((step, index) => {
      step.order = index + 1;
    });

    return optimized;
  }

  private calculateUXScores(scanResults: ScanResult, improvements: Enhancement[]): { before: number; after: number } {
    // Calculate current UX score based on scan results
    let beforeScore = 5; // Base score

    // Adjust based on issues
    const criticalIssues = scanResults.issues.filter(issue => issue.severity === 'critical').length;
    const highIssues = scanResults.issues.filter(issue => issue.severity === 'high').length;
    const accessibilityIssues = scanResults.issues.filter(issue => issue.type === 'accessibility').length;
    const performanceIssues = scanResults.issues.filter(issue => issue.type === 'performance').length;

    beforeScore -= criticalIssues * 1.5;
    beforeScore -= highIssues * 1.0;
    beforeScore -= accessibilityIssues * 0.8;
    beforeScore -= performanceIssues * 0.6;

    // Adjust based on complexity and maintainability
    if (scanResults.structure_analysis.complexity_score > 7) {
      beforeScore -= 1;
    }
    
    if (scanResults.metrics.maintainability_index < 50) {
      beforeScore -= 1;
    }

    // Calculate after score based on improvements
    let afterScore = beforeScore;

    improvements.forEach(improvement => {
      const uxImpact = improvement.impact_assessment.user_experience;
      const performanceImpact = improvement.impact_assessment.performance_impact;
      
      // Add UX improvement (scaled down to prevent over-optimistic scores)
      afterScore += (uxImpact - 5) * 0.3; // UX impact relative to baseline (5)
      afterScore += performanceImpact * 0.2; // Performance impact
    });

    // Clamp scores between 1 and 10
    beforeScore = Math.max(1, Math.min(10, beforeScore));
    afterScore = Math.max(1, Math.min(10, afterScore));

    return {
      before: Math.round(beforeScore * 10) / 10,
      after: Math.round(afterScore * 10) / 10
    };
  }

  private async storeImprovementInsights(projectId: string, enhancementResult: EnhancementResult): Promise<void> {
    try {
      // Store overall improvement insight
      await this.memoryManager.storeInsight(
        projectId,
        `UX enhancement analysis completed with ${enhancementResult.improvements.length} improvements`,
        {
          improvements_count: enhancementResult.improvements.length,
          ux_score_before: enhancementResult.ux_score_before,
          ux_score_after: enhancementResult.ux_score_after,
          score_improvement: enhancementResult.ux_score_after - enhancementResult.ux_score_before,
          implementation_steps: enhancementResult.implementation_plan.length
        },
        8 // High importance
      );

      // Store successful improvement patterns
      const highImpactImprovements = enhancementResult.improvements.filter(
        imp => imp.impact_assessment.user_experience >= 7
      );

      for (const improvement of highImpactImprovements) {
        await this.memoryManager.storeSuccess(
          projectId,
          `UX improvement: ${improvement.enhancement_type}`,
          improvement.description,
          {
            user_experience_score: improvement.impact_assessment.user_experience,
            performance_impact: improvement.impact_assessment.performance_impact,
            maintainability: improvement.impact_assessment.maintainability,
            implementation_effort: improvement.impact_assessment.implementation_effort
          },
          7
        );
      }

      // Store preferences based on improvement focus
      const improvementTypes = enhancementResult.improvements.map(imp => imp.enhancement_type);
      const typeFrequency: Record<string, number> = {};

      improvementTypes.forEach(type => {
        typeFrequency[type] = (typeFrequency[type] || 0) + 1;
      });

      for (const [type, frequency] of Object.entries(typeFrequency)) {
        if (frequency >= 2) { // Store as preference if it appears multiple times
          await this.memoryManager.storePreference(
            projectId,
            `preferred_improvement_type`,
            type,
            `This improvement type was suggested ${frequency} times in recent analysis`,
            5
          );
        }
      }

      // Store implementation patterns
      const avgEffort = enhancementResult.improvements.reduce(
        (sum, imp) => sum + imp.impact_assessment.implementation_effort, 0
      ) / enhancementResult.improvements.length;

      await this.memoryManager.storePattern(
        projectId,
        `Implementation effort pattern`,
        [`Average effort: ${avgEffort.toFixed(1)}/10`, `Total improvements: ${enhancementResult.improvements.length}`],
        1,
        6
      );

    } catch (error) {
      await this.logger.warn('improver', 'Failed to store improvement insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Utility method to apply improvements (for future use)
  async applyImprovement(improvement: Enhancement, dryRun: boolean = true): Promise<boolean> {
    try {
      await this.logger.info('improver', `${dryRun ? 'Simulating' : 'Applying'} improvement`, {
        component: improvement.component_path,
        type: improvement.enhancement_type,
        changes: improvement.code_changes.length
      });

      for (const change of improvement.code_changes) {
        if (!dryRun) {
          // In a real implementation, this would apply the code changes
          // For now, we just log what would be done
          await this.logger.info('improver', `Would apply change to ${change.file_path}`, {
            change_type: change.change_type,
            line_number: change.line_number
          });
        }
      }

      return true;

    } catch (error) {
      await this.logger.error('improver', 'Failed to apply improvement', {
        component: improvement.component_path,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}