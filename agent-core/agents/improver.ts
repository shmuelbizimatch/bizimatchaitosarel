import { promises as fs } from 'fs';
import path from 'path';
import { EnhancementResult, Enhancement, CodeChange, ScanResult, ImpactAssessment, ImplementationStep } from '../../types';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
import { AIClient } from '../engines/AIClient';

export class Improver {
  private logger: Logger;
  private memory: MemoryManager;
  private aiClient: AIClient;

  constructor(logger: Logger, memory: MemoryManager, aiClient: AIClient) {
    this.logger = logger;
    this.memory = memory;
    this.aiClient = aiClient;
  }

  async enhanceProject(
    projectPath: string,
    projectId: string,
    scanResults: ScanResult,
    options: {
      focusAreas?: string[];
      priorityLevel?: 'low' | 'medium' | 'high';
      maxChanges?: number;
    } = {}
  ): Promise<EnhancementResult> {
    await this.logger.info('improver', `Starting project enhancement`, {
      project_id: projectId,
      focus_areas: options.focusAreas,
      priority_level: options.priorityLevel || 'medium'
    });

    try {
      // Get relevant enhancement memories
      const relevantMemories = await this.memory.getRelevantMemories(
        projectId,
        'UX enhancement improvements',
        'enhance',
        10
      );

      // Get user preferences for this project
      const preferences = await this.memory.getPreferences(projectId);
      
      // Build enhancement context
      const enhancementContext = await this.buildEnhancementContext(
        projectPath,
        scanResults,
        relevantMemories,
        preferences,
        options
      );

      // Get AI enhancement suggestions
      const aiRequest = AIClient.getImproverPrompt(scanResults, enhancementContext);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);

      let enhancementResult: EnhancementResult;
      try {
        enhancementResult = JSON.parse(aiResponse.content);
      } catch (error) {
        await this.logger.error('improver', 'Failed to parse AI enhancement results', {
          ai_content: aiResponse.content.substring(0, 500),
          error: error instanceof Error ? error.message : String(error)
        });
        throw new Error('Invalid AI response format');
      }

      // Filter and prioritize enhancements
      enhancementResult = await this.filterAndPrioritizeEnhancements(
        enhancementResult,
        options
      );

      // Validate proposed changes
      enhancementResult = await this.validateEnhancements(
        projectPath,
        enhancementResult
      );

      // Store enhancement insights
      await this.storeEnhancementInsights(projectId, enhancementResult, scanResults);

      await this.logger.info('improver', 'Project enhancement completed', {
        project_id: projectId,
        improvements_count: enhancementResult.improvements?.length || 0,
        ux_score_improvement: (enhancementResult.ux_score_after || 0) - (enhancementResult.ux_score_before || 0),
        tokens_used: aiResponse.tokens_used,
        cost: aiResponse.cost_estimate
      });

      return enhancementResult;

    } catch (error) {
      await this.logger.error('improver', 'Project enhancement failed', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async buildEnhancementContext(
    projectPath: string,
    scanResults: ScanResult,
    relevantMemories: any[],
    preferences: any[],
    options: any
  ): Promise<string> {
    let context = `Enhancement Context:\n\n`;

    // Project overview
    context += `Project Analysis Summary:\n`;
    context += `- Files: ${scanResults.structure_analysis.file_count}\n`;
    context += `- Components: ${scanResults.structure_analysis.component_count}\n`;
    context += `- Complexity Score: ${scanResults.structure_analysis.complexity_score}/10\n`;
    context += `- Architecture: ${scanResults.structure_analysis.architecture_patterns.join(', ')}\n\n`;

    // Issues to address
    if (scanResults.issues && scanResults.issues.length > 0) {
      context += `Current Issues:\n`;
      scanResults.issues.forEach(issue => {
        context += `- ${issue.severity.toUpperCase()}: ${issue.description} (${issue.file_path})\n`;
      });
      context += '\n';
    }

    // Opportunities to leverage
    if (scanResults.opportunities && scanResults.opportunities.length > 0) {
      context += `Improvement Opportunities:\n`;
      scanResults.opportunities.forEach(opp => {
        context += `- ${opp.type} (${opp.impact} impact, ${opp.effort} effort): ${opp.description}\n`;
      });
      context += '\n';
    }

    // Focus areas
    if (options.focusAreas && options.focusAreas.length > 0) {
      context += `Focus Areas: ${options.focusAreas.join(', ')}\n\n`;
    }

    // User preferences
    if (preferences.length > 0) {
      context += `User Preferences:\n`;
      preferences.forEach(pref => {
        context += `- ${pref.content.preference}: ${pref.content.value} (${pref.content.reasoning})\n`;
      });
      context += '\n';
    }

    // Relevant past enhancements
    if (relevantMemories.length > 0) {
      context += `Relevant Past Enhancements:\n`;
      relevantMemories.forEach(memory => {
        if (memory.memory_type === 'success') {
          context += `- Success: ${memory.content.action} → ${memory.content.outcome}\n`;
        } else if (memory.memory_type === 'insight') {
          context += `- Insight: ${memory.content.insight}\n`;
        }
      });
      context += '\n';
    }

    // Sample component analysis
    const componentFiles = await this.getComponentSamples(projectPath);
    if (componentFiles.length > 0) {
      context += `Sample Components for Reference:\n`;
      for (const { filePath, content } of componentFiles.slice(0, 3)) {
        context += `\n=== ${filePath} ===\n`;
        context += content.substring(0, 1500);
        if (content.length > 1500) {
          context += '\n... (truncated)';
        }
        context += '\n';
      }
    }

    return context;
  }

  private async getComponentSamples(projectPath: string): Promise<Array<{filePath: string, content: string}>> {
    const samples: Array<{filePath: string, content: string}> = [];
    
    try {
      // Look for common component patterns
      const componentPatterns = [
        'components/**/*.{tsx,jsx,ts,js}',
        'src/components/**/*.{tsx,jsx,ts,js}',
        'app/components/**/*.{tsx,jsx,ts,js}'
      ];

      for (const pattern of componentPatterns) {
        try {
          const glob = await import('glob');
          const files = glob.sync(pattern, { cwd: projectPath, absolute: false });
          
          for (const file of files.slice(0, 5)) { // Limit to 5 files per pattern
            try {
              const fullPath = path.join(projectPath, file);
              const content = await fs.readFile(fullPath, 'utf-8');
              
              // Skip very large files
              if (content.length < 10000) {
                samples.push({ filePath: file, content });
              }
            } catch (error) {
              // Skip unreadable files
              continue;
            }
          }
        } catch (error) {
          // Pattern not found, continue
          continue;
        }
      }
    } catch (error) {
      await this.logger.debug('improver', 'Could not sample components', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return samples;
  }

  private async filterAndPrioritizeEnhancements(
    result: EnhancementResult,
    options: {
      priorityLevel?: 'low' | 'medium' | 'high';
      maxChanges?: number;
      focusAreas?: string[];
    }
  ): Promise<EnhancementResult> {
    const maxChanges = options.maxChanges || 10;
    const priorityLevel = options.priorityLevel || 'medium';
    const focusAreas = options.focusAreas || [];

    let filteredImprovements = result.improvements || [];

    // Filter by focus areas if specified
    if (focusAreas.length > 0) {
      filteredImprovements = filteredImprovements.filter(improvement =>
        focusAreas.some(area => 
          improvement.enhancement_type.includes(area) ||
          improvement.description.toLowerCase().includes(area.toLowerCase())
        )
      );
    }

    // Filter by priority level
    const minImpact = priorityLevel === 'high' ? 8 : priorityLevel === 'medium' ? 5 : 1;
    const maxEffort = priorityLevel === 'high' ? 5 : priorityLevel === 'medium' ? 7 : 10;

    filteredImprovements = filteredImprovements.filter(improvement => {
      const impact = improvement.impact_assessment.user_experience;
      const effort = improvement.impact_assessment.implementation_effort;
      return impact >= minImpact && effort <= maxEffort;
    });

    // Sort by value score (impact/effort ratio)
    filteredImprovements.sort((a, b) => {
      const scoreA = a.impact_assessment.user_experience / a.impact_assessment.implementation_effort;
      const scoreB = b.impact_assessment.user_experience / b.impact_assessment.implementation_effort;
      return scoreB - scoreA;
    });

    // Limit to max changes
    filteredImprovements = filteredImprovements.slice(0, maxChanges);

    // Update implementation plan
    const updatedPlan = this.generateImplementationPlan(filteredImprovements);

    return {
      ...result,
      improvements: filteredImprovements,
      implementation_plan: updatedPlan
    };
  }

  private generateImplementationPlan(improvements: Enhancement[]): ImplementationStep[] {
    const steps: ImplementationStep[] = [];
    let currentOrder = 1;

    // Group by type for logical ordering
    const groups = {
      accessibility: improvements.filter(i => i.enhancement_type === 'accessibility'),
      performance: improvements.filter(i => i.enhancement_type === 'performance'),
      visual: improvements.filter(i => i.enhancement_type === 'visual'),
      interactive: improvements.filter(i => i.enhancement_type === 'interactive')
    };

    // Add steps in logical order
    for (const [groupName, groupImprovements] of Object.entries(groups)) {
      if (groupImprovements.length > 0) {
        steps.push({
          order: currentOrder++,
          description: `Implement ${groupName} improvements`,
          estimated_time_minutes: groupImprovements.reduce(
            (sum, imp) => sum + (imp.impact_assessment.implementation_effort * 10), 
            0
          ),
          dependencies: currentOrder > 1 ? [`Step ${currentOrder - 2}`] : []
        });
      }
    }

    // Add testing step
    if (improvements.length > 0) {
      steps.push({
        order: currentOrder++,
        description: 'Test all enhancements and verify functionality',
        estimated_time_minutes: improvements.length * 15,
        dependencies: steps.slice(0, -1).map(s => `Step ${s.order}`)
      });
    }

    return steps;
  }

  private async validateEnhancements(
    projectPath: string,
    result: EnhancementResult
  ): Promise<EnhancementResult> {
    const validatedImprovements: Enhancement[] = [];

    for (const improvement of result.improvements || []) {
      let isValid = true;
      const validatedChanges: CodeChange[] = [];

      for (const change of improvement.code_changes) {
        // Check if file exists
        const filePath = path.join(projectPath, change.file_path);
        try {
          await fs.access(filePath);
          
          // Read current content for modification validation
          const currentContent = await fs.readFile(filePath, 'utf-8');
          
          // Validate change can be applied
          if (change.change_type === 'modify' && change.original_code) {
            if (currentContent.includes(change.original_code)) {
              validatedChanges.push(change);
            } else {
              await this.logger.warn('improver', 'Original code not found for modification', {
                file_path: change.file_path,
                original_code: change.original_code.substring(0, 100)
              });
              isValid = false;
            }
          } else {
            validatedChanges.push(change);
          }
        } catch (error) {
          await this.logger.warn('improver', 'File not found for enhancement', {
            file_path: change.file_path,
            change_type: change.change_type
          });
          isValid = false;
        }
      }

      if (isValid && validatedChanges.length > 0) {
        validatedImprovements.push({
          ...improvement,
          code_changes: validatedChanges
        });
      }
    }

    return {
      ...result,
      improvements: validatedImprovements
    };
  }

  private async storeEnhancementInsights(
    projectId: string,
    enhancementResult: EnhancementResult,
    scanResults: ScanResult
  ): Promise<void> {
    try {
      // Store overall enhancement success
      const uxImprovement = (enhancementResult.ux_score_after || 0) - (enhancementResult.ux_score_before || 0);
      await this.memory.storeSuccess(
        projectId,
        `UX enhancement completed`,
        `Generated ${enhancementResult.improvements?.length || 0} improvements with ${uxImprovement} point UX score increase`,
        {
          improvements_count: enhancementResult.improvements?.length || 0,
          ux_score_before: enhancementResult.ux_score_before,
          ux_score_after: enhancementResult.ux_score_after,
          ux_improvement: uxImprovement,
          enhancement_date: new Date().toISOString()
        },
        8
      );

      // Store successful enhancement patterns
      const highImpactImprovements = enhancementResult.improvements?.filter(
        imp => imp.impact_assessment.user_experience >= 7
      ) || [];

      for (const improvement of highImpactImprovements) {
        await this.memory.storePattern(
          projectId,
          `Successful ${improvement.enhancement_type} enhancement`,
          [improvement.description],
          1,
          7
        );
      }

      // Store preferences based on enhancement choices
      const enhancementTypes = enhancementResult.improvements?.map(i => i.enhancement_type) || [];
      const typeCount = enhancementTypes.reduce((count, type) => {
        count[type] = (count[type] || 0) + 1;
        return count;
      }, {} as Record<string, number>);

      for (const [type, count] of Object.entries(typeCount)) {
        if (count >= 2) { // If multiple improvements of same type, consider it a preference
          await this.memory.storePreference(
            projectId,
            `enhancement_focus`,
            type,
            `User frequently chooses ${type} improvements (${count} times in this session)`,
            6
          );
        }
      }

    } catch (error) {
      await this.logger.warn('improver', 'Failed to store enhancement insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async enhanceSpecificComponent(
    projectPath: string,
    projectId: string,
    componentPath: string,
    focusAreas: string[]
  ): Promise<EnhancementResult> {
    await this.logger.info('improver', `Enhancing specific component: ${componentPath}`, {
      project_id: projectId,
      component_path: componentPath,
      focus_areas: focusAreas
    });

    try {
      // Read component file
      const fullPath = path.join(projectPath, componentPath);
      const componentContent = await fs.readFile(fullPath, 'utf-8');

      // Build component-specific context
      let context = `Component Enhancement Context:\n\n`;
      context += `Component: ${componentPath}\n`;
      context += `Focus Areas: ${focusAreas.join(', ')}\n\n`;
      context += `Current Code:\n${componentContent}\n\n`;

      // Get component-specific memories
      const relevantMemories = await this.memory.searchMemories(
        projectId,
        `component ${path.basename(componentPath, path.extname(componentPath))}`,
        undefined,
        5
      );

      if (relevantMemories.length > 0) {
        context += `Relevant Past Insights:\n`;
        relevantMemories.forEach(memory => {
          context += `- ${memory.memory_type}: ${JSON.stringify(memory.content).substring(0, 200)}...\n`;
        });
      }

      // Create mock scan results for this component
      const componentScanResults = {
        structure_analysis: {
          file_count: 1,
          component_count: 1,
          complexity_score: this.calculateComponentComplexity(componentContent),
          architecture_patterns: [],
          dependencies: []
        },
        issues: [],
        opportunities: focusAreas.map(area => ({
          type: area as any,
          impact: 'medium' as const,
          effort: 'medium' as const,
          description: `Improve ${area} in this component`,
          implementation_suggestion: `Focus on ${area} enhancements`
        })),
        metrics: {
          lines_of_code: componentContent.split('\n').length,
          cyclomatic_complexity: 1,
          maintainability_index: 5
        }
      };

      // Get AI enhancement for specific component
      const aiRequest = AIClient.getImproverPrompt(componentScanResults, context);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);

      const enhancementResult: EnhancementResult = JSON.parse(aiResponse.content);

      // Validate that all changes are for the target component
      const validatedResult = {
        ...enhancementResult,
        improvements: enhancementResult.improvements?.map(improvement => ({
          ...improvement,
          code_changes: improvement.code_changes.filter(change => 
            change.file_path === componentPath || change.file_path === `./${componentPath}`
          )
        })).filter(improvement => improvement.code_changes.length > 0) || []
      };

      await this.logger.info('improver', 'Component enhancement completed', {
        project_id: projectId,
        component_path: componentPath,
        improvements_count: validatedResult.improvements?.length || 0
      });

      return validatedResult;

    } catch (error) {
      await this.logger.error('improver', 'Component enhancement failed', {
        project_id: projectId,
        component_path: componentPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private calculateComponentComplexity(content: string): number {
    let complexity = 1; // Base complexity
    
    // Count conditions, loops, and other complexity indicators
    const conditions = (content.match(/\b(if|else if|switch|case|\?|&&|\|\|)\b/g) || []).length;
    const loops = (content.match(/\b(for|while|forEach|map|filter|reduce)\b/g) || []).length;
    const functions = (content.match(/\b(function|const\s+\w+\s*=|=>\s*{|\w+\s*\()/g) || []).length;
    const hooks = (content.match(/\buse[A-Z]\w*/g) || []).length;
    
    complexity += Math.min(conditions * 0.5, 3);
    complexity += Math.min(loops * 0.3, 2);
    complexity += Math.min(functions * 0.2, 2);
    complexity += Math.min(hooks * 0.1, 1);
    
    return Math.min(10, Math.max(1, Math.round(complexity)));
  }

  async applyEnhancements(
    projectPath: string,
    projectId: string,
    enhancementResult: EnhancementResult,
    options: {
      dryRun?: boolean;
      backupOriginals?: boolean;
    } = {}
  ): Promise<{ applied: number; failed: number; details: any[] }> {
    await this.logger.info('improver', 'Applying enhancements', {
      project_id: projectId,
      improvements_count: enhancementResult.improvements?.length || 0,
      dry_run: options.dryRun || false
    });

    const results = {
      applied: 0,
      failed: 0,
      details: [] as any[]
    };

    if (!enhancementResult.improvements) {
      return results;
    }

    for (const improvement of enhancementResult.improvements) {
      for (const change of improvement.code_changes) {
        try {
          const filePath = path.join(projectPath, change.file_path);
          
          if (options.dryRun) {
            // Just validate the change
            await this.validateSingleChange(filePath, change);
            results.applied++;
            results.details.push({
              success: true,
              file: change.file_path,
              type: change.change_type,
              message: 'Validation successful (dry run)'
            });
          } else {
            // Create backup if requested
            if (options.backupOriginals) {
              await this.createBackup(filePath);
            }

            // Apply the change
            await this.applySingleChange(filePath, change);
            results.applied++;
            results.details.push({
              success: true,
              file: change.file_path,
              type: change.change_type,
              message: 'Applied successfully'
            });
          }
        } catch (error) {
          results.failed++;
          results.details.push({
            success: false,
            file: change.file_path,
            type: change.change_type,
            error: error instanceof Error ? error.message : String(error)
          });

          await this.logger.warn('improver', 'Failed to apply enhancement', {
            file_path: change.file_path,
            change_type: change.change_type,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    await this.logger.info('improver', 'Enhancement application completed', {
      project_id: projectId,
      applied: results.applied,
      failed: results.failed,
      dry_run: options.dryRun || false
    });

    return results;
  }

  private async validateSingleChange(filePath: string, change: CodeChange): Promise<void> {
    await fs.access(filePath); // Check file exists
    
    if (change.change_type === 'modify' && change.original_code) {
      const content = await fs.readFile(filePath, 'utf-8');
      if (!content.includes(change.original_code)) {
        throw new Error('Original code not found in file');
      }
    }
  }

  private async applySingleChange(filePath: string, change: CodeChange): Promise<void> {
    switch (change.change_type) {
      case 'modify':
        if (!change.original_code) {
          throw new Error('Original code required for modification');
        }
        const content = await fs.readFile(filePath, 'utf-8');
        const updatedContent = content.replace(change.original_code, change.new_code);
        await fs.writeFile(filePath, updatedContent, 'utf-8');
        break;

      case 'add':
        // For add operations, append to file or insert at specific line
        let existingContent = await fs.readFile(filePath, 'utf-8');
        if (change.line_number) {
          const lines = existingContent.split('\n');
          lines.splice(change.line_number - 1, 0, change.new_code);
          existingContent = lines.join('\n');
        } else {
          existingContent += '\n' + change.new_code;
        }
        await fs.writeFile(filePath, existingContent, 'utf-8');
        break;

      case 'delete':
        if (!change.original_code) {
          throw new Error('Original code required for deletion');
        }
        const deleteContent = await fs.readFile(filePath, 'utf-8');
        const deletedContent = deleteContent.replace(change.original_code, '');
        await fs.writeFile(filePath, deletedContent, 'utf-8');
        break;

      default:
        throw new Error(`Unsupported change type: ${change.change_type}`);
    }
  }

  private async createBackup(filePath: string): Promise<void> {
    const backupPath = `${filePath}.backup.${Date.now()}`;
    await fs.copyFile(filePath, backupPath);
  }
}