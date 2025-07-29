import { promises as fs } from 'fs';
import path from 'path';
import { glob } from 'glob';
import { ScanResult, FileAnalysis, Task, CodeIssue, Opportunity } from '../../types';
import { AIClient } from '../engines/AIClient';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';

export class ScannerAgent {
  private aiClient: AIClient;
  private logger: Logger;
  private memoryManager: MemoryManager;

  constructor(aiClient: AIClient, logger: Logger, memoryManager: MemoryManager) {
    this.aiClient = aiClient;
    this.logger = logger;
    this.memoryManager = memoryManager;
  }

  async scan(task: Task): Promise<ScanResult> {
    await this.logger.info('scanner', `Starting scan for task: ${task.id}`);
    
    const projectPath = task.input_data.project_path || process.cwd();
    const targetFiles = task.input_data.target_files;
    const excludePatterns = task.input_data.exclude_patterns || [
      'node_modules/**',
      '.git/**',
      'dist/**',
      'build/**',
      '**/*.min.js',
      '**/*.d.ts'
    ];

    try {
      // 1. Discover and analyze files
      const files = await this.discoverFiles(projectPath, targetFiles, excludePatterns);
      await this.logger.info('scanner', `Discovered ${files.length} files for analysis`);

      // 2. Analyze file structure
      const fileAnalyses = await this.analyzeFiles(files, projectPath);
      
      // 3. Generate AI-powered analysis
      const aiAnalysis = await this.performAIAnalysis(fileAnalyses, projectPath);

      // 4. Store insights in memory
      await this.storeAnalysisInsights(task.project_id, aiAnalysis, fileAnalyses);

      // 5. Compile final results
      const scanResult: ScanResult = {
        structure_analysis: aiAnalysis.structure_analysis,
        issues: aiAnalysis.issues,
        opportunities: aiAnalysis.opportunities,
        metrics: aiAnalysis.metrics
      };

      await this.logger.info('scanner', `Scan completed successfully`, {
        files_analyzed: files.length,
        issues_found: aiAnalysis.issues.length,
        opportunities_identified: aiAnalysis.opportunities.length
      });

      return scanResult;

    } catch (error) {
      await this.logger.error('scanner', 'Scan failed', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      }, error as Error);
      
      throw new Error(`Scanner analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async discoverFiles(
    projectPath: string,
    targetFiles?: string[],
    excludePatterns: string[] = []
  ): Promise<string[]> {
    try {
      let files: string[];

      if (targetFiles && targetFiles.length > 0) {
        // Use specific target files
        files = targetFiles.map(file => path.resolve(projectPath, file));
      } else {
        // Auto-discover files
        const patterns = [
          '**/*.ts',
          '**/*.tsx',
          '**/*.js',
          '**/*.jsx',
          '**/*.vue',
          '**/*.svelte',
          '**/*.json',
          '**/*.css',
          '**/*.scss',
          '**/*.less'
        ];

        files = [];
        for (const pattern of patterns) {
          const matches = await glob(pattern, {
            cwd: projectPath,
            ignore: excludePatterns,
            absolute: true
          });
          files.push(...matches);
        }
      }

      // Filter out files that are too large
      const maxFileSize = parseInt(process.env.MAX_FILE_SIZE_BYTES || '1048576'); // 1MB default
      const validFiles: string[] = [];

      for (const file of files) {
        try {
          const stats = await fs.stat(file);
          if (stats.size <= maxFileSize) {
            validFiles.push(file);
          } else {
            await this.logger.warn('scanner', `Skipping large file: ${file}`, {
              file_size: stats.size,
              max_size: maxFileSize
            });
          }
        } catch (error) {
          await this.logger.warn('scanner', `Could not stat file: ${file}`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return validFiles;
    } catch (error) {
      await this.logger.error('scanner', 'File discovery failed', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async analyzeFiles(files: string[], projectPath: string): Promise<FileAnalysis[]> {
    const analyses: FileAnalysis[] = [];

    for (const file of files) {
      try {
        const analysis = await this.analyzeFile(file, projectPath);
        if (analysis) {
          analyses.push(analysis);
        }
      } catch (error) {
        await this.logger.warn('scanner', `Failed to analyze file: ${file}`, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return analyses;
  }

  private async analyzeFile(filePath: string, projectPath: string): Promise<FileAnalysis | null> {
    try {
      const relativePath = path.relative(projectPath, filePath);
      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf-8');
      
      const analysis: FileAnalysis = {
        path: relativePath,
        type: this.determineFileType(relativePath, content),
        language: this.determineLanguage(filePath),
        size_bytes: stats.size,
        lines_of_code: this.countLinesOfCode(content),
        imports: this.extractImports(content),
        exports: this.extractExports(content),
        functions: this.extractFunctions(content),
        components: this.extractComponents(content),
        complexity_score: this.calculateComplexity(content)
      };

      return analysis;
    } catch (error) {
      await this.logger.warn('scanner', `Error analyzing file: ${filePath}`, {
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private determineFileType(filePath: string, content: string): FileAnalysis['type'] {
    if (filePath.includes('.test.') || filePath.includes('.spec.')) {
      return 'test';
    }
    
    if (filePath.includes('config') || filePath.endsWith('.config.js') || filePath.endsWith('.config.ts')) {
      return 'config';
    }

    if (content.includes('export default') && (content.includes('function') || content.includes('const'))) {
      if (content.includes('React') || content.includes('jsx') || content.includes('tsx')) {
        return 'component';
      }
      return 'utility';
    }

    if (content.includes('class') || content.includes('service') || content.includes('api')) {
      return 'service';
    }

    return 'other';
  }

  private determineLanguage(filePath: string): FileAnalysis['language'] {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.ts': return 'typescript';
      case '.tsx': return 'tsx';
      case '.js': return 'javascript';
      case '.jsx': return 'jsx';
      case '.json': return 'json';
      case '.css': return 'css';
      case '.html': return 'html';
      default: return 'other';
    }
  }

  private countLinesOfCode(content: string): number {
    const lines = content.split('\n');
    return lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('/*');
    }).length;
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+.*?\s+from\s+['"`]([^'"`]+)['"`]/g;
    const requireRegex = /require\(['"`]([^'"`]+)['"`]\)/g;
    
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    
    while ((match = requireRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    
    return [...new Set(imports)]; // Remove duplicates
  }

  private extractExports(content: string): string[] {
    const exports: string[] = [];
    const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+(\w+)/g;
    const namedExportRegex = /export\s+\{\s*([^}]+)\s*\}/g;
    
    let match;
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
    
    while ((match = namedExportRegex.exec(content)) !== null) {
      const namedExports = match[1].split(',').map(name => name.trim().split(' as ')[0]);
      exports.push(...namedExports);
    }
    
    return [...new Set(exports)];
  }

  private extractFunctions(content: string): FileAnalysis['functions'] {
    const functions: FileAnalysis['functions'] = [];
    const functionRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=.*?(?:function|\(.*?\)\s*=>))/g;
    
    let match;
    let lineNumber = 1;
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      functionRegex.lastIndex = 0;
      
      if ((match = functionRegex.exec(line)) !== null) {
        const functionName = match[1] || match[2];
        if (functionName) {
          functions.push({
            name: functionName,
            line_number: i + 1,
            parameters: this.extractParameters(line),
            complexity: this.calculateFunctionComplexity(line)
          });
        }
      }
    }
    
    return functions;
  }

  private extractComponents(content: string): FileAnalysis['components'] {
    if (!content.includes('React') && !content.includes('jsx') && !content.includes('tsx')) {
      return [];
    }

    const components: FileAnalysis['components'] = [];
    const componentRegex = /(?:function\s+(\w+)|const\s+(\w+)\s*=.*?(?:\(.*?\)\s*=>|\(.*?\)\s*{))/g;
    
    let match;
    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      componentRegex.lastIndex = 0;
      
      if ((match = componentRegex.exec(line)) !== null) {
        const componentName = match[1] || match[2];
        if (componentName && /^[A-Z]/.test(componentName)) { // Component names start with capital
          components.push({
            name: componentName,
            line_number: i + 1,
            props: this.extractProps(line),
            hooks_used: this.extractHooks(content)
          });
        }
      }
    }
    
    return components;
  }

  private extractParameters(line: string): string[] {
    const paramMatch = line.match(/\(([^)]*)\)/);
    if (!paramMatch) return [];
    
    return paramMatch[1]
      .split(',')
      .map(param => param.trim().split(':')[0].trim())
      .filter(param => param.length > 0);
  }

  private extractProps(line: string): string[] {
    const propsMatch = line.match(/\(\s*\{\s*([^}]+)\s*\}/);
    if (!propsMatch) return [];
    
    return propsMatch[1]
      .split(',')
      .map(prop => prop.trim().split(':')[0].trim())
      .filter(prop => prop.length > 0);
  }

  private extractHooks(content: string): string[] {
    const hooks: string[] = [];
    const hookRegex = /use[A-Z]\w+/g;
    
    let match;
    while ((match = hookRegex.exec(content)) !== null) {
      hooks.push(match[0]);
    }
    
    return [...new Set(hooks)];
  }

  private calculateComplexity(content: string): number {
    let complexity = 1; // Base complexity
    
    // Count control flow statements
    const controlFlowPatterns = [
      /\bif\b/g,
      /\belse\b/g,
      /\bwhile\b/g,
      /\bfor\b/g,
      /\bswitch\b/g,
      /\bcase\b/g,
      /\btry\b/g,
      /\bcatch\b/g,
      /\b&&\b/g,
      /\b\|\|\b/g,
      /\?\s*.*?:/g // Ternary operators
    ];
    
    for (const pattern of controlFlowPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return Math.min(complexity, 20); // Cap at 20
  }

  private calculateFunctionComplexity(line: string): number {
    let complexity = 1;
    
    if (line.includes('if') || line.includes('else')) complexity++;
    if (line.includes('for') || line.includes('while')) complexity++;
    if (line.includes('switch') || line.includes('case')) complexity++;
    if (line.includes('&&') || line.includes('||')) complexity++;
    if (line.includes('?') && line.includes(':')) complexity++;
    
    return complexity;
  }

  private async performAIAnalysis(fileAnalyses: FileAnalysis[], projectPath: string): Promise<any> {
    try {
      // Prepare context for AI analysis
      const filePaths = fileAnalyses.map(f => f.path);
      const projectContext = this.buildProjectContext(fileAnalyses);
      
      // Get AI analysis using the specialized scanner prompt
      const aiRequest = AIClient.getScannerPrompt(filePaths, projectContext);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);
      
      // Parse the JSON response
      let analysis;
      try {
        analysis = JSON.parse(aiResponse.content);
      } catch (parseError) {
        await this.logger.warn('scanner', 'Failed to parse AI response as JSON, using fallback', {
          response_content: aiResponse.content.substring(0, 500)
        });
        
        // Fallback analysis
        analysis = this.createFallbackAnalysis(fileAnalyses);
      }

      // Enhance with local analysis
      analysis = this.enhanceWithLocalAnalysis(analysis, fileAnalyses);
      
      return analysis;
    } catch (error) {
      await this.logger.error('scanner', 'AI analysis failed, using fallback', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return this.createFallbackAnalysis(fileAnalyses);
    }
  }

  private buildProjectContext(fileAnalyses: FileAnalysis[]): string {
    const context = {
      total_files: fileAnalyses.length,
      file_types: this.summarizeFileTypes(fileAnalyses),
      languages: this.summarizeLanguages(fileAnalyses),
      total_lines: fileAnalyses.reduce((sum, f) => sum + f.lines_of_code, 0),
      components: fileAnalyses.filter(f => f.type === 'component').length,
      services: fileAnalyses.filter(f => f.type === 'service').length,
      utilities: fileAnalyses.filter(f => f.type === 'utility').length,
      avg_complexity: fileAnalyses.reduce((sum, f) => sum + f.complexity_score, 0) / fileAnalyses.length
    };

    return JSON.stringify(context, null, 2);
  }

  private summarizeFileTypes(fileAnalyses: FileAnalysis[]): Record<string, number> {
    const types: Record<string, number> = {};
    for (const analysis of fileAnalyses) {
      types[analysis.type] = (types[analysis.type] || 0) + 1;
    }
    return types;
  }

  private summarizeLanguages(fileAnalyses: FileAnalysis[]): Record<string, number> {
    const languages: Record<string, number> = {};
    for (const analysis of fileAnalyses) {
      languages[analysis.language] = (languages[analysis.language] || 0) + 1;
    }
    return languages;
  }

  private createFallbackAnalysis(fileAnalyses: FileAnalysis[]): any {
    const totalLines = fileAnalyses.reduce((sum, f) => sum + f.lines_of_code, 0);
    const avgComplexity = fileAnalyses.reduce((sum, f) => sum + f.complexity_score, 0) / fileAnalyses.length;
    
    return {
      structure_analysis: {
        file_count: fileAnalyses.length,
        component_count: fileAnalyses.filter(f => f.type === 'component').length,
        complexity_score: Math.round(avgComplexity),
        architecture_patterns: this.detectArchitecturePatterns(fileAnalyses),
        dependencies: this.extractDependencies(fileAnalyses)
      },
      issues: this.detectLocalIssues(fileAnalyses),
      opportunities: this.identifyOpportunities(fileAnalyses),
      metrics: {
        lines_of_code: totalLines,
        cyclomatic_complexity: Math.round(avgComplexity),
        maintainability_index: this.calculateMaintainabilityIndex(fileAnalyses)
      }
    };
  }

  private enhanceWithLocalAnalysis(analysis: any, fileAnalyses: FileAnalysis[]): any {
    // Add detailed file information
    analysis.file_details = fileAnalyses.map(f => ({
      path: f.path,
      type: f.type,
      language: f.language,
      lines_of_code: f.lines_of_code,
      complexity_score: f.complexity_score,
      functions_count: f.functions.length,
      components_count: f.components?.length || 0
    }));

    return analysis;
  }

  private detectArchitecturePatterns(fileAnalyses: FileAnalysis[]): string[] {
    const patterns: string[] = [];
    
    const hasComponents = fileAnalyses.some(f => f.type === 'component');
    const hasServices = fileAnalyses.some(f => f.type === 'service');
    const hasUtilities = fileAnalyses.some(f => f.type === 'utility');
    
    if (hasComponents) patterns.push('Component-based');
    if (hasServices) patterns.push('Service layer');
    if (hasUtilities) patterns.push('Utility modules');
    
    // Check for specific frameworks
    const allImports = fileAnalyses.flatMap(f => f.imports);
    if (allImports.some(imp => imp.includes('react'))) patterns.push('React');
    if (allImports.some(imp => imp.includes('vue'))) patterns.push('Vue');
    if (allImports.some(imp => imp.includes('angular'))) patterns.push('Angular');
    
    return patterns;
  }

  private extractDependencies(fileAnalyses: FileAnalysis[]): any[] {
    const dependencies: Record<string, { count: number, type: 'production' | 'development' }> = {};
    
    for (const analysis of fileAnalyses) {
      for (const imp of analysis.imports) {
        if (!imp.startsWith('.') && !imp.startsWith('/')) {
          const packageName = imp.split('/')[0];
          if (!dependencies[packageName]) {
            dependencies[packageName] = { count: 0, type: 'production' };
          }
          dependencies[packageName].count++;
        }
      }
    }
    
    return Object.entries(dependencies).map(([name, info]) => ({
      name,
      version: 'unknown',
      type: info.type
    }));
  }

  private detectLocalIssues(fileAnalyses: FileAnalysis[]): CodeIssue[] {
    const issues: CodeIssue[] = [];
    
    for (const analysis of fileAnalyses) {
      // High complexity warning
      if (analysis.complexity_score > 10) {
        issues.push({
          type: 'maintainability',
          severity: 'medium',
          file_path: analysis.path,
          description: `High complexity score: ${analysis.complexity_score}`,
          suggestion: 'Consider breaking down complex logic into smaller functions'
        });
      }
      
      // Large file warning
      if (analysis.lines_of_code > 500) {
        issues.push({
          type: 'maintainability',
          severity: 'low',
          file_path: analysis.path,
          description: `Large file with ${analysis.lines_of_code} lines`,
          suggestion: 'Consider splitting into smaller modules'
        });
      }
      
      // No exports (dead code potential)
      if (analysis.exports.length === 0 && analysis.type !== 'config') {
        issues.push({
          type: 'maintainability',
          severity: 'low',
          file_path: analysis.path,
          description: 'File has no exports, might be unused',
          suggestion: 'Review if this file is necessary or add proper exports'
        });
      }
    }
    
    return issues;
  }

  private identifyOpportunities(fileAnalyses: FileAnalysis[]): Opportunity[] {
    const opportunities: Opportunity[] = [];
    
    const componentFiles = fileAnalyses.filter(f => f.type === 'component');
    if (componentFiles.length > 5) {
      opportunities.push({
        type: 'ux_improvement',
        impact: 'medium',
        effort: 'low',
        description: 'Multiple components detected - opportunity for design system',
        implementation_suggestion: 'Create a shared component library or design system'
      });
    }
    
    const utilityFiles = fileAnalyses.filter(f => f.type === 'utility');
    if (utilityFiles.length > 3) {
      opportunities.push({
        type: 'performance_optimization',
        impact: 'low',
        effort: 'low',
        description: 'Multiple utility files - opportunity for tree shaking optimization',
        implementation_suggestion: 'Implement barrel exports and tree shaking'
      });
    }
    
    return opportunities;
  }

  private calculateMaintainabilityIndex(fileAnalyses: FileAnalysis[]): number {
    const avgComplexity = fileAnalyses.reduce((sum, f) => sum + f.complexity_score, 0) / fileAnalyses.length;
    const avgFileSize = fileAnalyses.reduce((sum, f) => sum + f.lines_of_code, 0) / fileAnalyses.length;
    
    // Simple heuristic: lower complexity and reasonable file sizes = higher maintainability
    let index = 100;
    index -= avgComplexity * 2; // Penalize complexity
    index -= Math.max(0, (avgFileSize - 200) / 10); // Penalize very large files
    
    return Math.max(0, Math.min(100, Math.round(index)));
  }

  private async storeAnalysisInsights(
    projectId: string,
    analysis: any,
    fileAnalyses: FileAnalysis[]
  ): Promise<void> {
    try {
      // Store high-level insights
      if (analysis.structure_analysis) {
        await this.memoryManager.storeInsight(
          projectId,
          'Project structure analysis completed',
          {
            file_count: analysis.structure_analysis.file_count,
            complexity_score: analysis.structure_analysis.complexity_score,
            architecture_patterns: analysis.structure_analysis.architecture_patterns
          },
          6
        );
      }

      // Store detected patterns
      if (analysis.structure_analysis?.architecture_patterns?.length > 0) {
        await this.memoryManager.storePattern(
          projectId,
          'Architecture patterns detected',
          analysis.structure_analysis.architecture_patterns,
          1,
          5
        );
      }

      // Store critical issues as errors for future reference
      const criticalIssues = analysis.issues?.filter((issue: any) => issue.severity === 'critical') || [];
      for (const issue of criticalIssues) {
        await this.memoryManager.storeError(
          projectId,
          issue.description,
          issue.suggestion,
          { file_path: issue.file_path, type: issue.type },
          8
        );
      }

      await this.logger.debug('scanner', 'Analysis insights stored in memory', {
        project_id: projectId,
        insights_stored: 1 + (analysis.structure_analysis?.architecture_patterns?.length || 0) + criticalIssues.length
      });

    } catch (error) {
      await this.logger.warn('scanner', 'Failed to store analysis insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}