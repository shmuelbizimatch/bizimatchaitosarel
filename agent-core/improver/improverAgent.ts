import { promises as fs } from 'fs';
import path from 'path';
import { EnhancementResult, Task, ScanResult } from '../../types';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
import { AIClient } from '../engines/AIClient';

export class ImproverAgent {
  private logger: Logger;
  private memoryManager: MemoryManager;
  private aiClient: AIClient;

  constructor(logger: Logger, memoryManager: MemoryManager, aiClient: AIClient) {
    this.logger = logger;
    this.memoryManager = memoryManager;
    this.aiClient = aiClient;
  }

  async execute(task: Task): Promise<EnhancementResult> {
    const startTime = Date.now();
    
    try {
      await this.logger.info('improver', `Starting enhancement for task: ${task.id}`, {
        task_id: task.id,
        project_id: task.project_id,
        input_data: task.input_data
      });

      // Get scan results from input data or retrieve from previous task
      let scanResults: ScanResult;
      if (task.input_data.scan_results) {
        scanResults = task.input_data.scan_results;
      } else if (task.input_data.scan_task_id) {
        scanResults = await this.retrieveScanResults(task.input_data.scan_task_id);
      } else {
        throw new Error('No scan results provided for enhancement analysis');
      }

      // Get project context
      const projectPath = task.input_data.project_path || process.cwd();
      const targetComponent = task.input_data.target_component;

      // Retrieve relevant memories for context
      const memories = await this.memoryManager.retrieveMemories(task.project_id, undefined, 30, 4);
      const uxPatterns = await this.memoryManager.getPatterns(task.project_id, 10);
      const successfulEnhancements = await this.memoryManager.getSuccesses(task.project_id, 10);

      // Build enhancement context
      const enhancementContext = await this.buildEnhancementContext(
        projectPath,
        scanResults,
        memories,
        uxPatterns,
        successfulEnhancements
      );

      // Create AI request for enhancement analysis
      const aiRequest = AIClient.getImproverPrompt(
        {
          ...scanResults,
          enhancement_context: enhancementContext
        },
        targetComponent
      );

      // Execute AI enhancement analysis
      const aiResponse = await this.aiClient.generateResponse(aiRequest, task.metadata.ai_engine);
      
      // Parse and validate AI response
      let enhancementResult: EnhancementResult;
      try {
        enhancementResult = JSON.parse(aiResponse.content);
      } catch (parseError) {
        throw new Error(`Failed to parse AI enhancement result: ${parseError}`);
      }

      // Validate and enrich the enhancement result
      enhancementResult = await this.validateAndEnrichResult(enhancementResult, scanResults, projectPath);

      // Apply automatic enhancements if requested
      if (task.input_data.auto_apply && enhancementResult.improvements.length > 0) {
        await this.applyEnhancements(enhancementResult, projectPath);
      }

      // Store enhancement insights
      await this.storeEnhancementInsights(task.project_id, enhancementResult, scanResults);

      const duration = Date.now() - startTime;
      
      await this.logger.info('improver', `Enhancement analysis completed successfully`, {
        task_id: task.id,
        duration_ms: duration,
        improvements_found: enhancementResult.improvements.length,
        ux_score_improvement: enhancementResult.ux_score_after - enhancementResult.ux_score_before,
        implementation_steps: enhancementResult.implementation_plan.length,
        tokens_used: aiResponse.tokens_used,
        cost_estimate: aiResponse.cost_estimate
      });

      return enhancementResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      await this.logger.error('improver', 'Enhancement execution failed', {
        task_id: task.id,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);

      throw error;
    }
  }

  private async retrieveScanResults(scanTaskId: string): Promise<ScanResult> {
    // This would typically retrieve from the task manager
    // For now, we'll throw an error to indicate this needs to be implemented
    throw new Error('Scan result retrieval from task ID not yet implemented. Please provide scan_results directly.');
  }

  private async buildEnhancementContext(
    projectPath: string,
    scanResults: ScanResult,
    memories: any[],
    uxPatterns: any[],
    successfulEnhancements: any[]
  ): Promise<string> {
    let context = `## Enhancement Context\n\n`;

    // Project information
    context += `**Project Path:** ${projectPath}\n`;
    context += `**Current UX Issues:** ${scanResults.issues.filter(i => i.type === 'accessibility' || i.type === 'performance').length}\n`;
    context += `**Enhancement Opportunities:** ${scanResults.opportunities.filter(o => o.type === 'ux_improvement').length}\n\n`;

    // UX-specific insights from memory
    const uxInsights = memories.filter(m => 
      m.memory_type === 'insight' && 
      (m.content.insight.toLowerCase().includes('ux') || 
       m.content.insight.toLowerCase().includes('user') ||
       m.content.insight.toLowerCase().includes('interface'))
    );

    if (uxInsights.length > 0) {
      context += `### Previous UX Insights\n`;
      uxInsights.slice(0, 3).forEach(insight => {
        context += `- ${insight.content.insight}\n`;
      });
      context += '\n';
    }

    // Known UX patterns
    if (uxPatterns.length > 0) {
      context += `### Established UX Patterns\n`;
      uxPatterns.slice(0, 5).forEach(pattern => {
        context += `- ${pattern.content.pattern} (used ${pattern.content.frequency} times)\n`;
      });
      context += '\n';
    }

    // Successful enhancements
    if (successfulEnhancements.length > 0) {
      context += `### Previous Successful Enhancements\n`;
      successfulEnhancements.slice(0, 3).forEach(success => {
        context += `- **Action:** ${success.content.action}\n`;
        context += `  **Outcome:** ${success.content.outcome}\n`;
        if (success.content.metrics) {
          const metrics = Object.entries(success.content.metrics)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
          context += `  **Metrics:** ${metrics}\n`;
        }
        context += '\n';
      });
    }

    // Framework-specific guidelines
    const frameworkGuidelines = await this.getFrameworkGuidelines(projectPath);
    if (frameworkGuidelines) {
      context += `### Framework Guidelines\n${frameworkGuidelines}\n\n`;
    }

    // Accessibility considerations
    context += `### Accessibility Considerations\n`;
    context += `- WCAG 2.1 compliance (AA level minimum)\n`;
    context += `- Keyboard navigation support\n`;
    context += `- Screen reader compatibility\n`;
    context += `- Color contrast ratios (4.5:1 for normal text)\n`;
    context += `- Focus management and indicators\n`;
    context += `- Semantic HTML structure\n\n`;

    // Performance considerations
    context += `### Performance Considerations\n`;
    context += `- Core Web Vitals optimization\n`;
    context += `- Lazy loading for images and components\n`;
    context += `- Bundle size optimization\n`;
    context += `- CSS-in-JS performance implications\n`;
    context += `- Component memoization strategies\n\n`;

    return context;
  }

  private async getFrameworkGuidelines(projectPath: string): Promise<string | null> {
    try {
      // Check package.json to determine framework
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

      if (dependencies.react) {
        return this.getReactGuidelines();
      } else if (dependencies.vue) {
        return this.getVueGuidelines();
      } else if (dependencies.svelte) {
        return this.getSvelteGuidelines();
      } else if (dependencies.angular) {
        return this.getAngularGuidelines();
      }

      return null;
    } catch (error) {
      await this.logger.warn('improver', 'Failed to determine framework for guidelines', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private getReactGuidelines(): string {
    return `**React Best Practices:**
- Use functional components with hooks
- Implement proper error boundaries
- Optimize with React.memo, useMemo, useCallback
- Follow component composition patterns
- Use proper key props for lists
- Implement proper form handling with controlled components
- Use Context sparingly, prefer component composition
- Implement proper loading and error states`;
  }

  private getVueGuidelines(): string {
    return `**Vue.js Best Practices:**
- Use Composition API for complex logic
- Implement proper reactive patterns
- Use v-model correctly for two-way binding
- Optimize with v-once and v-memo directives
- Implement proper component communication
- Use slots for flexible component design
- Follow Vue 3 migration guidelines
- Implement proper Suspense boundaries`;
  }

  private getSvelteGuidelines(): string {
    return `**Svelte Best Practices:**
- Use reactive statements ($:) appropriately
- Implement proper component lifecycle
- Use stores for global state management
- Optimize with proper component splitting
- Use actions for DOM manipulation
- Implement proper transition animations
- Follow Svelte accessibility guidelines
- Use proper module context`;
  }

  private getAngularGuidelines(): string {
    return `**Angular Best Practices:**
- Use OnPush change detection strategy
- Implement proper dependency injection
- Use RxJS operators efficiently
- Follow Angular coding style guide
- Implement proper form validation
- Use lazy loading for routes
- Implement proper error handling
- Use track by functions for ngFor`;
  }

  private async validateAndEnrichResult(
    result: EnhancementResult,
    scanResults: ScanResult,
    projectPath: string
  ): Promise<EnhancementResult> {
    // Validate that UX scores are reasonable
    if (result.ux_score_before < 1 || result.ux_score_before > 10) {
      result.ux_score_before = this.calculateBaselineUXScore(scanResults);
    }

    if (result.ux_score_after < result.ux_score_before) {
      result.ux_score_after = result.ux_score_before + 1;
    }

    if (result.ux_score_after > 10) {
      result.ux_score_after = 10;
    }

    // Enrich improvements with additional metadata
    result.improvements = result.improvements.map(improvement => ({
      ...improvement,
      component_path: this.resolveComponentPath(improvement.component_path, projectPath),
      code_changes: improvement.code_changes.map(change => ({
        ...change,
        file_path: this.resolveFilePath(change.file_path, projectPath)
      }))
    }));

    // Sort implementation plan by dependencies and priority
    result.implementation_plan = this.optimizeImplementationPlan(result.implementation_plan);

    // Add estimated effort and impact scores
    result.improvements = result.improvements.map(improvement => {
      if (!improvement.impact_assessment) {
        improvement.impact_assessment = this.estimateImpactAssessment(improvement);
      }
      return improvement;
    });

    return result;
  }

  private calculateBaselineUXScore(scanResults: ScanResult): number {
    let score = 5; // Start with baseline

    // Deduct for issues
    const uxIssues = scanResults.issues.filter(i => 
      i.type === 'accessibility' || i.type === 'performance'
    );
    
    const criticalIssues = uxIssues.filter(i => i.severity === 'critical').length;
    const highIssues = uxIssues.filter(i => i.severity === 'high').length;
    const mediumIssues = uxIssues.filter(i => i.severity === 'medium').length;

    score -= (criticalIssues * 2) + (highIssues * 1) + (mediumIssues * 0.5);

    // Add for opportunities
    const uxOpportunities = scanResults.opportunities.filter(o => 
      o.type === 'ux_improvement'
    ).length;
    
    if (uxOpportunities === 0) score += 1; // No obvious UX issues

    return Math.max(1, Math.min(10, Math.round(score)));
  }

  private resolveComponentPath(componentPath: string, projectPath: string): string {
    if (path.isAbsolute(componentPath)) {
      return componentPath;
    }
    return path.resolve(projectPath, componentPath);
  }

  private resolveFilePath(filePath: string, projectPath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(projectPath, filePath);
  }

  private optimizeImplementationPlan(plan: any[]): any[] {
    // Sort by dependencies first, then by estimated time
    const sorted = [...plan].sort((a, b) => {
      // Items with no dependencies come first
      if (a.dependencies.length === 0 && b.dependencies.length > 0) return -1;
      if (a.dependencies.length > 0 && b.dependencies.length === 0) return 1;
      
      // Then sort by estimated time (shorter tasks first)
      return a.estimated_time_minutes - b.estimated_time_minutes;
    });

    // Re-assign order numbers
    return sorted.map((step, index) => ({
      ...step,
      order: index + 1
    }));
  }

  private estimateImpactAssessment(improvement: any): any {
    // Simple heuristic-based impact assessment
    const assessment = {
      user_experience: 5,
      performance_impact: 0,
      maintainability: 5,
      implementation_effort: 5
    };

    // Adjust based on enhancement type
    switch (improvement.enhancement_type) {
      case 'accessibility':
        assessment.user_experience = 8;
        assessment.implementation_effort = 4;
        break;
      case 'performance':
        assessment.performance_impact = 3;
        assessment.user_experience = 7;
        assessment.implementation_effort = 6;
        break;
      case 'visual':
        assessment.user_experience = 6;
        assessment.implementation_effort = 3;
        break;
      case 'interactive':
        assessment.user_experience = 7;
        assessment.implementation_effort = 5;
        break;
    }

    // Adjust based on number of code changes
    const changeCount = improvement.code_changes?.length || 1;
    if (changeCount > 5) {
      assessment.implementation_effort += 2;
      assessment.maintainability -= 1;
    }

    // Ensure values are within bounds
    Object.keys(assessment).forEach(key => {
      if (key === 'performance_impact') {
        assessment[key] = Math.max(-5, Math.min(5, assessment[key]));
      } else {
        assessment[key] = Math.max(1, Math.min(10, assessment[key]));
      }
    });

    return assessment;
  }

  private async applyEnhancements(
    enhancementResult: EnhancementResult,
    projectPath: string
  ): Promise<void> {
    try {
      await this.logger.info('improver', 'Starting automatic enhancement application', {
        improvement_count: enhancementResult.improvements.length,
        project_path: projectPath
      });

      for (const improvement of enhancementResult.improvements) {
        // Only apply low-risk improvements automatically
        if (improvement.impact_assessment.implementation_effort <= 3 &&
            improvement.impact_assessment.maintainability >= 7) {
          
          await this.applyImprovement(improvement, projectPath);
        } else {
          await this.logger.info('improver', `Skipping high-risk improvement: ${improvement.description}`, {
            component: improvement.component_path,
            effort: improvement.impact_assessment.implementation_effort,
            maintainability: improvement.impact_assessment.maintainability
          });
        }
      }

    } catch (error) {
      await this.logger.error('improver', 'Failed to apply enhancements', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async applyImprovement(improvement: any, projectPath: string): Promise<void> {
    try {
      for (const change of improvement.code_changes) {
        if (change.change_type === 'modify') {
          await this.modifyFile(change.file_path, change.original_code, change.new_code);
        } else if (change.change_type === 'add') {
          await this.addToFile(change.file_path, change.new_code, change.line_number);
        }
        // Skip 'delete' operations for safety
      }

      await this.logger.info('improver', `Applied improvement: ${improvement.description}`, {
        component: improvement.component_path,
        changes_applied: improvement.code_changes.length
      });

    } catch (error) {
      await this.logger.error('improver', `Failed to apply improvement: ${improvement.description}`, {
        component: improvement.component_path,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async modifyFile(filePath: string, originalCode: string, newCode: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const updatedContent = content.replace(originalCode, newCode);
      
      if (updatedContent === content) {
        throw new Error('Original code not found in file');
      }
      
      await fs.writeFile(filePath, updatedContent, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to modify file ${filePath}: ${error}`);
    }
  }

  private async addToFile(filePath: string, codeToAdd: string, lineNumber?: number): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      
      if (lineNumber && lineNumber > 0 && lineNumber <= lines.length) {
        lines.splice(lineNumber - 1, 0, codeToAdd);
      } else {
        lines.push(codeToAdd);
      }
      
      await fs.writeFile(filePath, lines.join('\n'), 'utf-8');
    } catch (error) {
      throw new Error(`Failed to add to file ${filePath}: ${error}`);
    }
  }

  private async storeEnhancementInsights(
    projectId: string,
    enhancementResult: EnhancementResult,
    scanResults: ScanResult
  ): Promise<void> {
    try {
      // Store successful enhancement as a success memory
      if (enhancementResult.improvements.length > 0) {
        const totalEffort = enhancementResult.implementation_plan
          .reduce((sum, step) => sum + step.estimated_time_minutes, 0);
        
        const avgUXImpact = enhancementResult.improvements
          .reduce((sum, imp) => sum + imp.impact_assessment.user_experience, 0) / 
          enhancementResult.improvements.length;

        await this.memoryManager.storeSuccess(
          projectId,
          `UX Enhancement Analysis`,
          `Identified ${enhancementResult.improvements.length} improvements with ${(enhancementResult.ux_score_after - enhancementResult.ux_score_before).toFixed(1)} point UX score increase`,
          {
            improvements_count: enhancementResult.improvements.length,
            ux_score_before: enhancementResult.ux_score_before,
            ux_score_after: enhancementResult.ux_score_after,
            total_effort_minutes: totalEffort,
            avg_ux_impact: avgUXImpact
          },
          7
        );
      }

      // Store enhancement patterns
      const enhancementTypes = enhancementResult.improvements.map(imp => imp.enhancement_type);
      const uniqueTypes = [...new Set(enhancementTypes)];
      
      for (const type of uniqueTypes) {
        const typeCount = enhancementTypes.filter(t => t === type).length;
        const examples = enhancementResult.improvements
          .filter(imp => imp.enhancement_type === type)
          .slice(0, 3)
          .map(imp => imp.description);

        await this.memoryManager.storePattern(
          projectId,
          `${type} enhancements`,
          examples,
          typeCount,
          6
        );
      }

      // Store insights about implementation complexity
      const highEffortImprovements = enhancementResult.improvements
        .filter(imp => imp.impact_assessment.implementation_effort >= 7);
      
      if (highEffortImprovements.length > 0) {
        await this.memoryManager.storeInsight(
          projectId,
          `${highEffortImprovements.length} high-effort improvements identified requiring careful planning`,
          {
            high_effort_count: highEffortImprovements.length,
            total_improvements: enhancementResult.improvements.length,
            avg_effort: enhancementResult.improvements
              .reduce((sum, imp) => sum + imp.impact_assessment.implementation_effort, 0) / 
              enhancementResult.improvements.length,
            complexity_areas: highEffortImprovements.map(imp => imp.enhancement_type)
          },
          6
        );
      }

    } catch (error) {
      await this.logger.warn('improver', 'Failed to store enhancement insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Get enhancement capabilities
  getCapabilities(): Record<string, any> {
    return {
      enhancement_types: [
        'Visual Design Improvements',
        'Interactive UX Enhancements',
        'Accessibility Compliance',
        'Performance Optimizations',
        'Responsive Design',
        'Form UX Improvements',
        'Navigation Enhancements',
        'Loading State Optimizations',
        'Error Handling UX',
        'Micro-interactions'
      ],
      supported_frameworks: [
        'React',
        'Vue.js',
        'Svelte',
        'Angular',
        'Vanilla JavaScript',
        'TypeScript'
      ],
      accessibility_standards: [
        'WCAG 2.1 AA',
        'Section 508',
        'ARIA Guidelines',
        'Keyboard Navigation',
        'Screen Reader Support'
      ],
      performance_metrics: [
        'Core Web Vitals',
        'First Contentful Paint',
        'Largest Contentful Paint',
        'First Input Delay',
        'Cumulative Layout Shift',
        'Time to Interactive'
      ],
      auto_apply_criteria: {
        max_implementation_effort: 3,
        min_maintainability: 7,
        supported_change_types: ['modify', 'add']
      }
    };
  }
}