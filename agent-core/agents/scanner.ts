import { promises as fs } from 'fs';
import path from 'path';
import { ScanResult, StructureAnalysis, CodeIssue, Opportunity, CodeMetrics, Task } from '../../types';
import { Logger } from '../logger/logger';
import { AIClient } from '../engines/AIClient';
import { MemoryManager } from '../memory/memoryManager';
import { TaskManager } from '../tasks/taskManager';

export class ScannerAgent {
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

  async executeTask(task: Task): Promise<ScanResult> {
    await this.logger.info('scanner', 'Starting scan task', {
      task_id: task.id,
      project_id: task.project_id
    });

    try {
      // Extract scan parameters from task input
      const { projectPath, filePatterns, excludePatterns } = task.input_data;
      
      // Set context for logging
      this.logger.setContext(task.project_id, task.id);

      // Start the task
      await this.taskManager.startTask(task.id);

      // Step 1: Discover project structure
      const projectFiles = await this.discoverProjectStructure(
        projectPath || process.cwd(),
        filePatterns || ['**/*.{ts,tsx,js,jsx,css,scss,json}'],
        excludePatterns || ['node_modules/**', 'dist/**', '.git/**']
      );

      await this.logger.info('scanner', `Discovered ${projectFiles.length} files`, {
        file_count: projectFiles.length,
        patterns: filePatterns
      });

      // Step 2: Analyze project structure
      const structureAnalysis = await this.analyzeProjectStructure(projectFiles, projectPath);

      // Step 3: Perform detailed code analysis using Claude
      const codeAnalysis = await this.performCodeAnalysis(projectFiles, structureAnalysis);

      // Step 4: Generate metrics
      const metrics = await this.calculateMetrics(projectFiles);

      // Step 5: Compile scan results
      const scanResult: ScanResult = {
        structure_analysis: structureAnalysis,
        issues: codeAnalysis.issues,
        opportunities: codeAnalysis.opportunities,
        metrics
      };

      // Store insights in memory
      await this.storeAnalysisInsights(task.project_id, scanResult);

      // Complete the task
      await this.taskManager.completeTask(
        task.id,
        { scan_result: scanResult },
        codeAnalysis.tokensUsed,
        codeAnalysis.costEstimate
      );

      await this.logger.info('scanner', 'Scan task completed successfully', {
        task_id: task.id,
        issues_found: scanResult.issues.length,
        opportunities_found: scanResult.opportunities.length,
        complexity_score: scanResult.structure_analysis.complexity_score
      });

      return scanResult;

    } catch (error) {
      await this.logger.error('scanner', 'Scan task failed', {
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

  private async discoverProjectStructure(
    projectPath: string,
    includePatterns: string[],
    excludePatterns: string[]
  ): Promise<string[]> {
    const files: string[] = [];
    
    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(projectPath, entry.name);
        const relativePath = path.relative(process.cwd(), fullPath);
        
        // Check exclude patterns
        if (this.shouldExclude(relativePath, excludePatterns)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subFiles = await this.discoverProjectStructure(
            fullPath,
            includePatterns,
            excludePatterns
          );
          files.push(...subFiles);
        } else if (entry.isFile()) {
          // Check include patterns
          if (this.shouldInclude(relativePath, includePatterns)) {
            files.push(relativePath);
          }
        }
      }
      
      return files;
    } catch (error) {
      await this.logger.error('scanner', 'Failed to discover project structure', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private shouldInclude(filePath: string, patterns: string[]): boolean {
    // Simple glob-like pattern matching
    return patterns.some(pattern => {
      const regex = new RegExp(
        pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\./g, '\\.')
      );
      return regex.test(filePath);
    });
  }

  private shouldExclude(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern => {
      const regex = new RegExp(
        pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\./g, '\\.')
      );
      return regex.test(filePath);
    });
  }

  private async analyzeProjectStructure(files: string[], projectPath?: string): Promise<StructureAnalysis> {
    try {
      const analysis: StructureAnalysis = {
        file_count: files.length,
        component_count: 0,
        complexity_score: 0,
        architecture_patterns: [],
        dependencies: []
      };

      // Count components (React/Vue/Angular files)
      analysis.component_count = files.filter(file => 
        /\.(tsx|jsx|vue)$/.test(file) || 
        file.includes('component') || 
        file.includes('Component')
      ).length;

      // Analyze package.json for dependencies
      const packageJsonPath = path.join(projectPath || process.cwd(), 'package.json');
      try {
        const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageJsonContent);
        
        // Extract dependencies
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        analysis.dependencies = Object.entries(deps).map(([name, version]) => ({
          name,
          version: version as string,
          type: packageJson.dependencies?.[name] ? 'production' : 'development'
        }));

        // Detect architecture patterns
        if (deps.react) analysis.architecture_patterns.push('React');
        if (deps.vue) analysis.architecture_patterns.push('Vue');
        if (deps['@angular/core']) analysis.architecture_patterns.push('Angular');
        if (deps.typescript) analysis.architecture_patterns.push('TypeScript');
        if (deps.tailwindcss) analysis.architecture_patterns.push('Tailwind CSS');
        if (deps.express) analysis.architecture_patterns.push('Express.js');
        if (deps.next) analysis.architecture_patterns.push('Next.js');
        if (deps.vite) analysis.architecture_patterns.push('Vite');

      } catch (error) {
        await this.logger.warn('scanner', 'Could not read package.json', {
          package_json_path: packageJsonPath
        });
      }

      // Calculate basic complexity score
      analysis.complexity_score = this.calculateComplexityScore(files, analysis);

      return analysis;
    } catch (error) {
      await this.logger.error('scanner', 'Failed to analyze project structure', {
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private calculateComplexityScore(files: string[], analysis: StructureAnalysis): number {
    let score = 0;
    
    // Base score from file count
    score += Math.min(files.length / 100, 5); // Up to 5 points for file count
    
    // Component complexity
    score += Math.min(analysis.component_count / 20, 3); // Up to 3 points for components
    
    // Dependency complexity
    score += Math.min(analysis.dependencies.length / 50, 2); // Up to 2 points for dependencies
    
    // Clamp between 1-10
    return Math.max(1, Math.min(10, Math.round(score)));
  }

  private async performCodeAnalysis(
    files: string[],
    structure: StructureAnalysis
  ): Promise<{ issues: CodeIssue[]; opportunities: Opportunity[]; tokensUsed: number; costEstimate: number }> {
    try {
      // Sample some files for analysis (to manage token usage)
      const sampleFiles = this.selectFilesForAnalysis(files);
      
      // Read file contents
      const fileContents = await Promise.all(
        sampleFiles.map(async (filePath) => {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            return { path: filePath, content: content.slice(0, 5000) }; // Limit content size
          } catch (error) {
            await this.logger.warn('scanner', `Could not read file: ${filePath}`);
            return null;
          }
        })
      );

      const validFiles = fileContents.filter(Boolean) as Array<{ path: string; content: string }>;

      // Create context for Claude
      const projectContext = this.buildProjectContext(structure, validFiles);
      
      // Get Claude analysis
      const aiRequest = AIClient.getScannerPrompt(sampleFiles, projectContext);
      const response = await this.aiClient.generateResponse(aiRequest);

      // Parse Claude's response
      let analysisResult;
      try {
        analysisResult = JSON.parse(response.content);
      } catch (parseError) {
        await this.logger.error('scanner', 'Failed to parse Claude response', {
          response_content: response.content.slice(0, 500)
        });
        throw new Error('Invalid response format from Claude');
      }

      // Transform Claude's analysis into our format
      const issues: CodeIssue[] = (analysisResult.issues || []).map((issue: any) => ({
        type: issue.type || 'maintainability',
        severity: issue.severity || 'medium',
        file_path: issue.file_path || '',
        line_number: issue.line_number,
        description: issue.description || '',
        suggestion: issue.suggestion || ''
      }));

      const opportunities: Opportunity[] = (analysisResult.opportunities || []).map((opp: any) => ({
        type: opp.type || 'ux_improvement',
        impact: opp.impact || 'medium',
        effort: opp.effort || 'medium',
        description: opp.description || '',
        implementation_suggestion: opp.implementation_suggestion || ''
      }));

      return {
        issues,
        opportunities,
        tokensUsed: response.tokens_used,
        costEstimate: response.cost_estimate
      };

    } catch (error) {
      await this.logger.error('scanner', 'Code analysis failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return empty results on failure
      return {
        issues: [],
        opportunities: [],
        tokensUsed: 0,
        costEstimate: 0
      };
    }
  }

  private selectFilesForAnalysis(files: string[]): string[] {
    // Prioritize important file types and limit to manage tokens
    const prioritizedFiles = files
      .filter(file => {
        // High priority files
        if (file.includes('App.') || file.includes('main.') || file.includes('index.')) return true;
        if (file.endsWith('.tsx') || file.endsWith('.jsx')) return true;
        if (file.endsWith('.ts') && !file.endsWith('.d.ts')) return true;
        return false;
      })
      .slice(0, 10); // Limit to 10 files

    // Add some regular files if we have space
    const remainingFiles = files
      .filter(file => !prioritizedFiles.includes(file))
      .slice(0, Math.max(0, 15 - prioritizedFiles.length));

    return [...prioritizedFiles, ...remainingFiles];
  }

  private buildProjectContext(structure: StructureAnalysis, files: Array<{ path: string; content: string }>): string {
    let context = `Project Analysis Context:\n\n`;
    
    context += `Structure Overview:\n`;
    context += `- Total Files: ${structure.file_count}\n`;
    context += `- Components: ${structure.component_count}\n`;
    context += `- Architecture: ${structure.architecture_patterns.join(', ')}\n`;
    context += `- Dependencies: ${structure.dependencies.length}\n\n`;

    context += `Key Dependencies:\n`;
    structure.dependencies.slice(0, 10).forEach(dep => {
      context += `- ${dep.name}@${dep.version} (${dep.type})\n`;
    });

    context += `\nFile Samples:\n`;
    files.forEach(file => {
      context += `\n--- ${file.path} ---\n`;
      context += file.content.slice(0, 1000) + (file.content.length > 1000 ? '\n...' : '');
    });

    return context;
  }

  private async calculateMetrics(files: string[]): Promise<CodeMetrics> {
    try {
      let totalLoc = 0;
      let totalComplexity = 0;
      
      // Sample files for metrics calculation
      const sampleFiles = files.slice(0, 20);
      
      for (const filePath of sampleFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split('\n').filter(line => line.trim().length > 0);
          totalLoc += lines.length;
          
          // Simple complexity calculation based on control structures
          const complexityIndicators = (content.match(/\b(if|for|while|switch|catch|function|=>)\b/g) || []).length;
          totalComplexity += complexityIndicators;
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

      const avgComplexity = sampleFiles.length > 0 ? totalComplexity / sampleFiles.length : 0;
      
      // Extrapolate to full project
      const estimatedTotalLoc = Math.round(totalLoc * (files.length / sampleFiles.length));
      
      // Calculate maintainability index (simplified version)
      const maintainabilityIndex = Math.max(0, Math.min(100, 
        171 - 5.2 * Math.log(Math.max(1, estimatedTotalLoc)) - 0.23 * avgComplexity
      ));

      return {
        lines_of_code: estimatedTotalLoc,
        cyclomatic_complexity: Math.round(avgComplexity),
        maintainability_index: Math.round(maintainabilityIndex)
      };
    } catch (error) {
      await this.logger.error('scanner', 'Failed to calculate metrics', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return {
        lines_of_code: 0,
        cyclomatic_complexity: 0,
        maintainability_index: 0
      };
    }
  }

  private async storeAnalysisInsights(projectId: string, scanResult: ScanResult): Promise<void> {
    try {
      // Store key insights
      await this.memoryManager.storeInsight(
        projectId,
        `Project scan completed with ${scanResult.issues.length} issues and ${scanResult.opportunities.length} opportunities`,
        {
          complexity_score: scanResult.structure_analysis.complexity_score,
          file_count: scanResult.structure_analysis.file_count,
          component_count: scanResult.structure_analysis.component_count,
          maintainability_index: scanResult.metrics.maintainability_index
        },
        8 // High importance
      );

      // Store patterns found in architecture
      if (scanResult.structure_analysis.architecture_patterns.length > 0) {
        await this.memoryManager.storePattern(
          projectId,
          `Architecture patterns: ${scanResult.structure_analysis.architecture_patterns.join(', ')}`,
          scanResult.structure_analysis.architecture_patterns,
          1,
          6
        );
      }

      // Store critical issues as errors
      const criticalIssues = scanResult.issues.filter(issue => issue.severity === 'critical');
      for (const issue of criticalIssues) {
        await this.memoryManager.storeError(
          projectId,
          issue.description,
          issue.suggestion,
          { file_path: issue.file_path, type: issue.type },
          9
        );
      }

      // Store high-impact opportunities
      const highImpactOpportunities = scanResult.opportunities.filter(opp => opp.impact === 'high');
      for (const opportunity of highImpactOpportunities) {
        await this.memoryManager.storeContext(
          projectId,
          'improvement_opportunity',
          {
            type: opportunity.type,
            description: opportunity.description,
            implementation_suggestion: opportunity.implementation_suggestion,
            impact: opportunity.impact,
            effort: opportunity.effort
          },
          7
        );
      }

    } catch (error) {
      await this.logger.warn('scanner', 'Failed to store analysis insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}