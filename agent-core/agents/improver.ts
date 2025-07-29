import { promises as fs } from 'fs';
import path from 'path';
import { EnhancementResult, Task, ScanResult, Enhancement, CodeChange, ImpactAssessment, ImplementationStep } from '../../types';
import { AIClient } from '../engines/AIClient';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';

export class ImproverAgent {
  private aiClient: AIClient;
  private logger: Logger;
  private memoryManager: MemoryManager;

  constructor(aiClient: AIClient, logger: Logger, memoryManager: MemoryManager) {
    this.aiClient = aiClient;
    this.logger = logger;
    this.memoryManager = memoryManager;
  }

  async improve(task: Task): Promise<EnhancementResult> {
    await this.logger.info('improver', `Starting improvement analysis for task: ${task.id}`);
    
    const scanResults = task.input_data.scan_results as ScanResult;
    const targetComponent = task.input_data.target_component;
    const projectPath = task.input_data.project_path || process.cwd();

    try {
      // 1. Analyze existing scan results
      if (!scanResults) {
        throw new Error('No scan results provided for improvement analysis');
      }

      // 2. Get previous insights and preferences from memory
      const projectInsights = await this.gatherProjectInsights(task.project_id);
      
      // 3. Analyze component files for UX patterns
      const componentAnalysis = await this.analyzeComponentsForUX(scanResults, projectPath);
      
      // 4. Generate AI-powered improvement suggestions
      const aiEnhancements = await this.generateAIEnhancements(scanResults, componentAnalysis, projectInsights, targetComponent);
      
      // 5. Enhance with local UX analysis
      const localEnhancements = await this.performLocalUXAnalysis(componentAnalysis, projectPath);
      
      // 6. Merge and prioritize enhancements
      const mergedEnhancements = this.mergeEnhancements(aiEnhancements.improvements || [], localEnhancements);
      
      // 7. Create implementation plan
      const implementationPlan = this.createImplementationPlan(mergedEnhancements);
      
      // 8. Calculate UX scores
      const uxScoreBefore = this.calculateUXScore(scanResults, componentAnalysis, 'before');
      const uxScoreAfter = this.calculateUXScore(scanResults, componentAnalysis, 'after', mergedEnhancements);
      
      // 9. Store improvement insights
      await this.storeImprovementInsights(task.project_id, mergedEnhancements, uxScoreBefore, uxScoreAfter);

      const enhancementResult: EnhancementResult = {
        improvements: mergedEnhancements,
        ux_score_before: uxScoreBefore,
        ux_score_after: uxScoreAfter,
        implementation_plan: implementationPlan
      };

      await this.logger.info('improver', `Improvement analysis completed successfully`, {
        improvements_found: mergedEnhancements.length,
        ux_score_improvement: uxScoreAfter - uxScoreBefore,
        implementation_steps: implementationPlan.length
      });

      return enhancementResult;

    } catch (error) {
      await this.logger.error('improver', 'Improvement analysis failed', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      }, error as Error);
      
      throw new Error(`Improver analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async gatherProjectInsights(projectId: string): Promise<any> {
    try {
      // Get relevant memories from previous analyses
      const [insights, patterns, successes, preferences] = await Promise.all([
        this.memoryManager.getInsights(projectId, 5),
        this.memoryManager.getPatterns(projectId, 5),
        this.memoryManager.getSuccesses(projectId, 3),
        this.memoryManager.getPreferences(projectId)
      ]);

      return {
        insights: insights.map(i => i.content),
        patterns: patterns.map(p => p.content),
        successes: successes.map(s => s.content),
        preferences: preferences.map(p => p.content)
      };
    } catch (error) {
      await this.logger.warn('improver', 'Failed to gather project insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { insights: [], patterns: [], successes: [], preferences: [] };
    }
  }

  private async analyzeComponentsForUX(scanResults: ScanResult, projectPath: string): Promise<any> {
    const componentAnalysis = {
      total_components: 0,
      accessibility_issues: [] as any[],
      performance_issues: [] as any[],
      ux_patterns: [] as string[],
      component_files: [] as any[]
    };

    try {
      // Filter component-related files from scan results
      const componentFiles = (scanResults as any).file_details?.filter((file: any) => 
        file.type === 'component' || 
        file.path.includes('component') ||
        file.language === 'tsx' ||
        file.language === 'jsx'
      ) || [];

      componentAnalysis.total_components = componentFiles.length;
      componentAnalysis.component_files = componentFiles;

      // Analyze each component file for UX patterns
      for (const fileDetail of componentFiles.slice(0, 10)) { // Limit to 10 files for performance
        try {
          const filePath = path.join(projectPath, fileDetail.path);
          const content = await fs.readFile(filePath, 'utf-8');
          
          const fileAnalysis = this.analyzeComponentFile(content, fileDetail.path);
          componentAnalysis.accessibility_issues.push(...fileAnalysis.accessibility_issues);
          componentAnalysis.performance_issues.push(...fileAnalysis.performance_issues);
          componentAnalysis.ux_patterns.push(...fileAnalysis.ux_patterns);
          
        } catch (error) {
          await this.logger.warn('improver', `Failed to analyze component file: ${fileDetail.path}`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Deduplicate patterns
      componentAnalysis.ux_patterns = [...new Set(componentAnalysis.ux_patterns)];

      return componentAnalysis;
    } catch (error) {
      await this.logger.error('improver', 'Component UX analysis failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return componentAnalysis;
    }
  }

  private analyzeComponentFile(content: string, filePath: string): any {
    const analysis = {
      accessibility_issues: [] as any[],
      performance_issues: [] as any[],
      ux_patterns: [] as string[]
    };

    // Check for accessibility issues
    if (!content.includes('alt=') && content.includes('<img')) {
      analysis.accessibility_issues.push({
        type: 'accessibility',
        severity: 'medium',
        file_path: filePath,
        description: 'Images without alt attributes',
        suggestion: 'Add descriptive alt attributes to all images'
      });
    }

    if (!content.includes('aria-') && (content.includes('button') || content.includes('onClick'))) {
      analysis.accessibility_issues.push({
        type: 'accessibility',
        severity: 'low',
        file_path: filePath,
        description: 'Interactive elements missing ARIA attributes',
        suggestion: 'Add appropriate ARIA labels and roles'
      });
    }

    // Check for performance issues
    if (content.includes('useEffect') && !content.includes('[]')) {
      analysis.performance_issues.push({
        type: 'performance',
        severity: 'medium',
        file_path: filePath,
        description: 'useEffect without dependency array may cause unnecessary re-renders',
        suggestion: 'Add dependency array to useEffect hooks'
      });
    }

    if (content.includes('.map(') && content.includes('key=')) {
      // Good - has keys
    } else if (content.includes('.map(')) {
      analysis.performance_issues.push({
        type: 'performance',
        severity: 'low',
        file_path: filePath,
        description: 'Map operations without proper keys',
        suggestion: 'Add unique keys to mapped elements'
      });
    }

    // Detect UX patterns
    if (content.includes('useState')) analysis.ux_patterns.push('State Management');
    if (content.includes('useEffect')) analysis.ux_patterns.push('Side Effects');
    if (content.includes('form') || content.includes('Form')) analysis.ux_patterns.push('Forms');
    if (content.includes('loading') || content.includes('Loading')) analysis.ux_patterns.push('Loading States');
    if (content.includes('error') || content.includes('Error')) analysis.ux_patterns.push('Error Handling');
    if (content.includes('modal') || content.includes('Modal')) analysis.ux_patterns.push('Modal Dialogs');
    if (content.includes('button') || content.includes('Button')) analysis.ux_patterns.push('Interactive Buttons');
    if (content.includes('nav') || content.includes('Nav')) analysis.ux_patterns.push('Navigation');

    return analysis;
  }

  private async generateAIEnhancements(
    scanResults: ScanResult,
    componentAnalysis: any,
    projectInsights: any,
    targetComponent?: string
  ): Promise<any> {
    try {
      // Prepare enhanced context for AI
      const enhancedScanResults = {
        ...scanResults,
        component_analysis: componentAnalysis,
        project_insights: projectInsights
      };

      // Get AI analysis using the specialized improver prompt
      const aiRequest = AIClient.getImproverPrompt(enhancedScanResults, targetComponent);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);
      
      // Parse the JSON response
      let enhancements;
      try {
        enhancements = JSON.parse(aiResponse.content);
      } catch (parseError) {
        await this.logger.warn('improver', 'Failed to parse AI response as JSON, using fallback', {
          response_content: aiResponse.content.substring(0, 500)
        });
        
        // Fallback enhancements
        enhancements = this.createFallbackEnhancements(scanResults, componentAnalysis);
      }

      return enhancements;
    } catch (error) {
      await this.logger.error('improver', 'AI enhancement generation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return this.createFallbackEnhancements(scanResults, componentAnalysis);
    }
  }

  private async performLocalUXAnalysis(componentAnalysis: any, projectPath: string): Promise<Enhancement[]> {
    const localEnhancements: Enhancement[] = [];

    try {
      // Generate enhancements based on local analysis
      if (componentAnalysis.accessibility_issues.length > 0) {
        localEnhancements.push({
          component_path: 'Global',
          enhancement_type: 'accessibility',
          description: `Fix ${componentAnalysis.accessibility_issues.length} accessibility issues`,
          code_changes: componentAnalysis.accessibility_issues.map((issue: any) => ({
            file_path: issue.file_path,
            change_type: 'modify' as const,
            new_code: this.generateAccessibilityFix(issue),
            line_number: undefined
          })),
          impact_assessment: {
            user_experience: 8,
            performance_impact: 0,
            maintainability: 7,
            implementation_effort: 4
          }
        });
      }

      if (componentAnalysis.performance_issues.length > 0) {
        localEnhancements.push({
          component_path: 'Global',
          enhancement_type: 'performance',
          description: `Optimize ${componentAnalysis.performance_issues.length} performance issues`,
          code_changes: componentAnalysis.performance_issues.map((issue: any) => ({
            file_path: issue.file_path,
            change_type: 'modify' as const,
            new_code: this.generatePerformanceFix(issue),
            line_number: undefined
          })),
          impact_assessment: {
            user_experience: 6,
            performance_impact: 3,
            maintainability: 6,
            implementation_effort: 5
          }
        });
      }

      // Suggest design system if many components
      if (componentAnalysis.total_components > 5) {
        localEnhancements.push({
          component_path: 'Global',
          enhancement_type: 'visual',
          description: 'Implement design system for consistent UI',
          code_changes: [{
            file_path: 'src/components/design-system/index.ts',
            change_type: 'add',
            new_code: this.generateDesignSystemCode(),
            line_number: undefined
          }],
          impact_assessment: {
            user_experience: 9,
            performance_impact: 1,
            maintainability: 9,
            implementation_effort: 8
          }
        });
      }

      return localEnhancements;
    } catch (error) {
      await this.logger.error('improver', 'Local UX analysis failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private generateAccessibilityFix(issue: any): string {
    switch (true) {
      case issue.description.includes('alt attributes'):
        return `// Add descriptive alt attributes to images
<img src="..." alt="Descriptive text for the image" />`;
      
      case issue.description.includes('ARIA attributes'):
        return `// Add ARIA attributes to interactive elements
<button aria-label="Close dialog" onClick={handleClick}>
  <span aria-hidden="true">&times;</span>
</button>`;
      
      default:
        return '// Add appropriate accessibility attributes';
    }
  }

  private generatePerformanceFix(issue: any): string {
    switch (true) {
      case issue.description.includes('useEffect'):
        return `// Add dependency array to prevent unnecessary re-renders
useEffect(() => {
  // Effect logic here
}, [dependency1, dependency2]); // Add dependencies`;
      
      case issue.description.includes('key'):
        return `// Add unique keys to mapped elements
{items.map((item) => (
  <div key={item.id}>{item.name}</div>
))}`;
      
      default:
        return '// Optimize component performance';
    }
  }

  private generateDesignSystemCode(): string {
    return `// Design System Components
export { Button } from './Button';
export { Input } from './Input';
export { Card } from './Card';
export { Typography } from './Typography';
export { Spacing } from './Spacing';
export { Colors } from './Colors';

// Design tokens
export const theme = {
  colors: {
    primary: '#007bff',
    secondary: '#6c757d',
    success: '#28a745',
    danger: '#dc3545',
    warning: '#ffc107',
    info: '#17a2b8'
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '3rem'
  },
  typography: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
    fontSize: {
      small: '0.875rem',
      medium: '1rem',
      large: '1.25rem',
      xlarge: '1.5rem'
    }
  }
};`;
  }

  private createFallbackEnhancements(scanResults: ScanResult, componentAnalysis: any): any {
    const fallbackImprovements: Enhancement[] = [];

    // Create basic enhancements based on scan results
    if (scanResults.issues.length > 0) {
      const criticalIssues = scanResults.issues.filter(issue => issue.severity === 'critical' || issue.severity === 'high');
      
      if (criticalIssues.length > 0) {
        fallbackImprovements.push({
          component_path: 'Multiple files',
          enhancement_type: 'performance',
          description: `Address ${criticalIssues.length} critical issues`,
          code_changes: criticalIssues.map(issue => ({
            file_path: issue.file_path,
            change_type: 'modify' as const,
            new_code: issue.suggestion,
            line_number: issue.line_number
          })),
          impact_assessment: {
            user_experience: 7,
            performance_impact: 2,
            maintainability: 8,
            implementation_effort: 6
          }
        });
      }
    }

    // Add basic UX improvements
    if (componentAnalysis.total_components > 0) {
      fallbackImprovements.push({
        component_path: 'Components',
        enhancement_type: 'visual',
        description: 'Improve component consistency and styling',
        code_changes: [{
          file_path: 'Global styling improvements',
          change_type: 'modify',
          new_code: 'Apply consistent styling patterns across components',
          line_number: undefined
        }],
        impact_assessment: {
          user_experience: 6,
          performance_impact: 0,
          maintainability: 5,
          implementation_effort: 4
        }
      });
    }

    return {
      improvements: fallbackImprovements,
      ux_score_before: 6,
      ux_score_after: 7.5,
      implementation_plan: this.createImplementationPlan(fallbackImprovements)
    };
  }

  private mergeEnhancements(aiEnhancements: Enhancement[], localEnhancements: Enhancement[]): Enhancement[] {
    const merged = [...aiEnhancements, ...localEnhancements];
    
    // Remove duplicates based on description similarity
    const unique = merged.filter((enhancement, index, self) => 
      index === self.findIndex(e => 
        e.description.toLowerCase().includes(enhancement.description.toLowerCase().substring(0, 20))
      )
    );

    // Sort by impact (user experience * performance impact - implementation effort)
    return unique.sort((a, b) => {
      const scoreA = (a.impact_assessment.user_experience * (a.impact_assessment.performance_impact + 5)) - a.impact_assessment.implementation_effort;
      const scoreB = (b.impact_assessment.user_experience * (b.impact_assessment.performance_impact + 5)) - b.impact_assessment.implementation_effort;
      return scoreB - scoreA;
    });
  }

  private createImplementationPlan(enhancements: Enhancement[]): ImplementationStep[] {
    const steps: ImplementationStep[] = [];
    
    // Group enhancements by effort and dependencies
    const criticalSteps = enhancements.filter(e => e.impact_assessment.user_experience >= 8);
    const mediumSteps = enhancements.filter(e => e.impact_assessment.user_experience >= 6 && e.impact_assessment.user_experience < 8);
    const lowSteps = enhancements.filter(e => e.impact_assessment.user_experience < 6);

    let order = 1;

    // Critical steps first
    for (const enhancement of criticalSteps) {
      steps.push({
        order: order++,
        description: `Implement: ${enhancement.description}`,
        estimated_time_minutes: enhancement.impact_assessment.implementation_effort * 30,
        dependencies: this.extractDependencies(enhancement)
      });
    }

    // Medium priority steps
    for (const enhancement of mediumSteps) {
      steps.push({
        order: order++,
        description: `Implement: ${enhancement.description}`,
        estimated_time_minutes: enhancement.impact_assessment.implementation_effort * 25,
        dependencies: this.extractDependencies(enhancement)
      });
    }

    // Low priority steps
    for (const enhancement of lowSteps) {
      steps.push({
        order: order++,
        description: `Implement: ${enhancement.description}`,
        estimated_time_minutes: enhancement.impact_assessment.implementation_effort * 20,
        dependencies: this.extractDependencies(enhancement)
      });
    }

    return steps;
  }

  private extractDependencies(enhancement: Enhancement): string[] {
    const dependencies: string[] = [];
    
    // Analyze enhancement for dependencies
    if (enhancement.enhancement_type === 'visual' && enhancement.description.includes('design system')) {
      dependencies.push('Setup design system structure');
    }
    
    if (enhancement.enhancement_type === 'accessibility') {
      dependencies.push('Review accessibility guidelines');
    }
    
    if (enhancement.enhancement_type === 'performance') {
      dependencies.push('Performance testing setup');
    }
    
    return dependencies;
  }

  private calculateUXScore(
    scanResults: ScanResult,
    componentAnalysis: any,
    phase: 'before' | 'after',
    enhancements?: Enhancement[]
  ): number {
    let score = 5; // Base score

    // Factor in complexity
    const complexityPenalty = Math.min(scanResults.structure_analysis.complexity_score / 10, 2);
    score -= complexityPenalty;

    // Factor in issues
    const criticalIssues = scanResults.issues.filter(issue => issue.severity === 'critical').length;
    const highIssues = scanResults.issues.filter(issue => issue.severity === 'high').length;
    score -= (criticalIssues * 1.5) + (highIssues * 1);

    // Factor in accessibility
    const accessibilityIssues = componentAnalysis.accessibility_issues?.length || 0;
    score -= accessibilityIssues * 0.5;

    // Factor in performance issues
    const performanceIssues = componentAnalysis.performance_issues?.length || 0;
    score -= performanceIssues * 0.3;

    // If calculating "after" score, add enhancement benefits
    if (phase === 'after' && enhancements) {
      const totalUXImprovement = enhancements.reduce((sum, enhancement) => 
        sum + (enhancement.impact_assessment.user_experience / 10), 0
      );
      score += totalUXImprovement;
    }

    // Clamp between 1-10
    return Math.max(1, Math.min(10, score));
  }

  private async storeImprovementInsights(
    projectId: string,
    enhancements: Enhancement[],
    uxScoreBefore: number,
    uxScoreAfter: number
  ): Promise<void> {
    try {
      // Store improvement insights
      await this.memoryManager.storeInsight(
        projectId,
        `UX improvement analysis completed with ${enhancements.length} enhancements`,
        {
          enhancement_count: enhancements.length,
          ux_score_before: uxScoreBefore,
          ux_score_after: uxScoreAfter,
          improvement: uxScoreAfter - uxScoreBefore,
          enhancement_types: [...new Set(enhancements.map(e => e.enhancement_type))]
        },
        7
      );

      // Store successful enhancement patterns
      const highImpactEnhancements = enhancements.filter(e => e.impact_assessment.user_experience >= 8);
      for (const enhancement of highImpactEnhancements) {
        await this.memoryManager.storePattern(
          projectId,
          `High-impact enhancement: ${enhancement.enhancement_type}`,
          [enhancement.description],
          1,
          6
        );
      }

      await this.logger.debug('improver', 'Improvement insights stored in memory', {
        project_id: projectId,
        insights_stored: 1 + highImpactEnhancements.length
      });

    } catch (error) {
      await this.logger.warn('improver', 'Failed to store improvement insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}