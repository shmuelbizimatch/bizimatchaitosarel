import { promises as fs } from 'fs';
import path from 'path';
import { ScanResult, StructureAnalysis, CodeIssue, Opportunity, CodeMetrics, Dependency } from '../../types';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
import { AIClient } from '../engines/AIClient';

export class Scanner {
  private logger: Logger;
  private memory: MemoryManager;
  private aiClient: AIClient;

  constructor(logger: Logger, memory: MemoryManager, aiClient: AIClient) {
    this.logger = logger;
    this.memory = memory;
    this.aiClient = aiClient;
  }

  async scanProject(
    projectPath: string,
    projectId: string,
    options: {
      includePatterns?: string[];
      excludePatterns?: string[];
      maxFileSize?: number;
    } = {}
  ): Promise<ScanResult> {
    await this.logger.info('scanner', `Starting project scan: ${projectPath}`, {
      project_path: projectPath,
      project_id: projectId
    });

    try {
      // Get file structure
      const filePaths = await this.getProjectFiles(projectPath, options);
      
      // Analyze project structure
      const structureAnalysis = await this.analyzeStructure(filePaths, projectPath);
      
      // Get relevant memories for context
      const relevantMemories = await this.memory.getRelevantMemories(
        projectId,
        `project scan ${path.basename(projectPath)}`,
        'scan',
        5
      );

      // Prepare context for AI analysis
      const projectContext = await this.buildProjectContext(filePaths, projectPath, relevantMemories);

      // Use AI to analyze the codebase
      const aiRequest = AIClient.getScannerPrompt(filePaths, projectContext);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);

      let scanResults: ScanResult;
      try {
        scanResults = JSON.parse(aiResponse.content);
      } catch (error) {
        await this.logger.error('scanner', 'Failed to parse AI scan results', {
          ai_content: aiResponse.content.substring(0, 500),
          error: error instanceof Error ? error.message : String(error)
        });
        throw new Error('Invalid AI response format');
      }

      // Enhance results with our own analysis
      scanResults.structure_analysis = {
        ...scanResults.structure_analysis,
        ...structureAnalysis
      };

      // Store insights in memory
      await this.storeAnalysisInsights(projectId, scanResults, filePaths);

      await this.logger.info('scanner', 'Project scan completed', {
        project_id: projectId,
        files_analyzed: filePaths.length,
        issues_found: scanResults.issues?.length || 0,
        opportunities_found: scanResults.opportunities?.length || 0,
        tokens_used: aiResponse.tokens_used,
        cost: aiResponse.cost_estimate
      });

      return scanResults;

    } catch (error) {
      await this.logger.error('scanner', 'Project scan failed', {
        project_path: projectPath,
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async getProjectFiles(
    projectPath: string,
    options: {
      includePatterns?: string[];
      excludePatterns?: string[];
      maxFileSize?: number;
    }
  ): Promise<string[]> {
    const defaultExcludePatterns = [
      'node_modules',
      '.git',
      'dist',
      'build',
      '.next',
      'coverage',
      '.nyc_output',
      '*.log',
      '.DS_Store',
      'Thumbs.db'
    ];

    const excludePatterns = [...defaultExcludePatterns, ...(options.excludePatterns || [])];
    const includePatterns = options.includePatterns || [
      '*.ts', '*.tsx', '*.js', '*.jsx', '*.vue', '*.svelte',
      '*.css', '*.scss', '*.sass', '*.less',
      '*.json', '*.md', '*.html', '*.xml'
    ];
    const maxFileSize = (options.maxFileSize || 10) * 1024 * 1024; // Convert MB to bytes

    const files: string[] = [];

    async function walkDir(dirPath: string): Promise<void> {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const relativePath = path.relative(projectPath, fullPath);

          // Check exclude patterns
          if (excludePatterns.some(pattern => 
            relativePath.includes(pattern) || entry.name.includes(pattern)
          )) {
            continue;
          }

          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else if (entry.isFile()) {
            // Check include patterns
            const matchesInclude = includePatterns.some(pattern => {
              if (pattern.startsWith('*.')) {
                return entry.name.endsWith(pattern.substring(1));
              }
              return entry.name.includes(pattern);
            });

            if (matchesInclude) {
              // Check file size
              const stats = await fs.stat(fullPath);
              if (stats.size <= maxFileSize) {
                files.push(relativePath);
              }
            }
          }
        }
      } catch (error) {
        // Skip directories we can't read
        await this.logger.debug('scanner', `Skipped unreadable directory: ${dirPath}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await walkDir(projectPath);
    return files;
  }

  private async analyzeStructure(filePaths: string[], projectPath: string): Promise<StructureAnalysis> {
    const analysis: StructureAnalysis = {
      file_count: filePaths.length,
      component_count: 0,
      complexity_score: 0,
      architecture_patterns: [],
      dependencies: []
    };

    // Count components (rough heuristic)
    const componentFiles = filePaths.filter(file => 
      /\.(tsx?|jsx?|vue|svelte)$/.test(file) && 
      !file.includes('.test.') && 
      !file.includes('.spec.')
    );
    analysis.component_count = componentFiles.length;

    // Detect architecture patterns
    if (filePaths.some(f => f.includes('components'))) {
      analysis.architecture_patterns.push('Component-based');
    }
    if (filePaths.some(f => f.includes('pages') || f.includes('routes'))) {
      analysis.architecture_patterns.push('Route-based');
    }
    if (filePaths.some(f => f.includes('store') || f.includes('redux'))) {
      analysis.architecture_patterns.push('State management');
    }
    if (filePaths.some(f => f.includes('api') || f.includes('services'))) {
      analysis.architecture_patterns.push('Service layer');
    }
    if (filePaths.some(f => f.includes('hooks'))) {
      analysis.architecture_patterns.push('Custom hooks');
    }

    // Analyze package.json for dependencies
    const packageJsonPath = path.join(projectPath, 'package.json');
    try {
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      if (packageJson.dependencies) {
        Object.entries(packageJson.dependencies).forEach(([name, version]) => {
          analysis.dependencies.push({
            name,
            version: version as string,
            type: 'production'
          });
        });
      }
      
      if (packageJson.devDependencies) {
        Object.entries(packageJson.devDependencies).forEach(([name, version]) => {
          analysis.dependencies.push({
            name,
            version: version as string,
            type: 'development'
          });
        });
      }
    } catch (error) {
      await this.logger.debug('scanner', 'Could not read package.json', {
        path: packageJsonPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Calculate complexity score (1-10)
    let complexityFactors = 0;
    
    if (analysis.file_count > 100) complexityFactors += 2;
    else if (analysis.file_count > 50) complexityFactors += 1;
    
    if (analysis.component_count > 50) complexityFactors += 2;
    else if (analysis.component_count > 20) complexityFactors += 1;
    
    if (analysis.dependencies.length > 50) complexityFactors += 2;
    else if (analysis.dependencies.length > 20) complexityFactors += 1;
    
    if (analysis.architecture_patterns.length > 3) complexityFactors += 1;
    
    analysis.complexity_score = Math.min(10, Math.max(1, complexityFactors + 1));

    return analysis;
  }

  private async buildProjectContext(
    filePaths: string[],
    projectPath: string,
    relevantMemories: any[]
  ): Promise<string> {
    let context = `Project Analysis Context:\n\n`;
    
    // Basic project info
    context += `Project Path: ${projectPath}\n`;
    context += `Total Files: ${filePaths.length}\n\n`;

    // File structure overview
    context += `File Structure:\n`;
    const directories = new Set();
    filePaths.forEach(file => {
      const dir = path.dirname(file);
      if (dir !== '.') {
        directories.add(dir);
      }
    });
    
    directories.forEach(dir => {
      const fileCount = filePaths.filter(f => f.startsWith(dir)).length;
      context += `- ${dir}/ (${fileCount} files)\n`;
    });

    // Key files
    const keyFiles = filePaths.filter(file => 
      ['package.json', 'tsconfig.json', 'next.config.js', 'vite.config.ts', 'webpack.config.js', 'README.md']
        .some(key => file.includes(key))
    );
    
    if (keyFiles.length > 0) {
      context += `\nKey Configuration Files:\n`;
      keyFiles.forEach(file => context += `- ${file}\n`);
    }

    // Sample of actual file contents for key files
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageContent);
      
      context += `\nPackage.json overview:\n`;
      context += `- Name: ${packageJson.name || 'Unknown'}\n`;
      context += `- Version: ${packageJson.version || 'Unknown'}\n`;
      context += `- Scripts: ${Object.keys(packageJson.scripts || {}).join(', ')}\n`;
      
      const mainDeps = Object.keys(packageJson.dependencies || {}).slice(0, 10);
      if (mainDeps.length > 0) {
        context += `- Main Dependencies: ${mainDeps.join(', ')}\n`;
      }
    } catch (error) {
      // Continue without package.json context
    }

    // Relevant memories
    if (relevantMemories.length > 0) {
      context += `\nRelevant Past Analysis:\n`;
      relevantMemories.forEach(memory => {
        context += `- ${memory.memory_type}: ${JSON.stringify(memory.content).substring(0, 200)}...\n`;
      });
    }

    return context;
  }

  private async storeAnalysisInsights(
    projectId: string,
    scanResults: ScanResult,
    filePaths: string[]
  ): Promise<void> {
    try {
      // Store overall analysis insight
      await this.memory.storeInsight(
        projectId,
        `Project structure analysis completed`,
        {
          file_count: filePaths.length,
          complexity_score: scanResults.structure_analysis.complexity_score,
          architecture_patterns: scanResults.structure_analysis.architecture_patterns,
          issues_count: scanResults.issues?.length || 0,
          opportunities_count: scanResults.opportunities?.length || 0,
          analysis_date: new Date().toISOString()
        },
        7
      );

      // Store patterns found
      if (scanResults.structure_analysis.architecture_patterns.length > 0) {
        await this.memory.storePattern(
          projectId,
          `Architecture patterns: ${scanResults.structure_analysis.architecture_patterns.join(', ')}`,
          scanResults.structure_analysis.architecture_patterns,
          1,
          6
        );
      }

      // Store critical issues
      const criticalIssues = scanResults.issues?.filter(issue => issue.severity === 'critical' || issue.severity === 'high') || [];
      for (const issue of criticalIssues) {
        await this.memory.storeError(
          projectId,
          `${issue.type}: ${issue.description}`,
          issue.suggestion,
          {
            file_path: issue.file_path,
            line_number: issue.line_number,
            severity: issue.severity
          },
          issue.severity === 'critical' ? 9 : 7
        );
      }

      // Store high-impact opportunities
      const highImpactOpportunities = scanResults.opportunities?.filter(opp => opp.impact === 'high') || [];
      for (const opportunity of highImpactOpportunities) {
        await this.memory.storeSuccess(
          projectId,
          `Optimization opportunity: ${opportunity.type}`,
          opportunity.description,
          {
            impact: opportunity.impact,
            effort: opportunity.effort
          },
          8
        );
      }

    } catch (error) {
      await this.logger.warn('scanner', 'Failed to store analysis insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async scanSpecificFiles(
    projectPath: string,
    projectId: string,
    targetFiles: string[]
  ): Promise<ScanResult> {
    await this.logger.info('scanner', `Scanning specific files`, {
      project_id: projectId,
      file_count: targetFiles.length,
      files: targetFiles
    });

    try {
      // Read file contents for detailed analysis
      const fileContents: Record<string, string> = {};
      for (const filePath of targetFiles) {
        try {
          const fullPath = path.join(projectPath, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          fileContents[filePath] = content;
        } catch (error) {
          await this.logger.warn('scanner', `Could not read file: ${filePath}`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Build detailed context with file contents
      let context = `Detailed File Analysis:\n\n`;
      Object.entries(fileContents).forEach(([filePath, content]) => {
        context += `=== ${filePath} ===\n`;
        context += content.substring(0, 2000); // Limit content to avoid token limits
        if (content.length > 2000) {
          context += '\n... (content truncated)';
        }
        context += '\n\n';
      });

      // Get AI analysis
      const aiRequest = AIClient.getScannerPrompt(targetFiles, context);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);

      const scanResults: ScanResult = JSON.parse(aiResponse.content);

      await this.logger.info('scanner', 'Specific file scan completed', {
        project_id: projectId,
        files_analyzed: targetFiles.length,
        issues_found: scanResults.issues?.length || 0,
        opportunities_found: scanResults.opportunities?.length || 0
      });

      return scanResults;

    } catch (error) {
      await this.logger.error('scanner', 'Specific file scan failed', {
        project_id: projectId,
        target_files: targetFiles,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}