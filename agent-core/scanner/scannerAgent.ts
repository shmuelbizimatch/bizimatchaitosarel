import { promises as fs } from 'fs';
import path from 'path';
import { ScanResult, Task } from '../../types';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
import { AIClient } from '../engines/AIClient';

export class ScannerAgent {
  private logger: Logger;
  private memoryManager: MemoryManager;
  private aiClient: AIClient;
  private excludePatterns: string[] = [
    'node_modules',
    '.git',
    'dist',
    'build',
    '.next',
    'coverage',
    '.nyc_output',
    '.cache',
    'logs',
    '*.log',
    '*.lock',
    '.DS_Store',
    'Thumbs.db'
  ];

  constructor(logger: Logger, memoryManager: MemoryManager, aiClient: AIClient) {
    this.logger = logger;
    this.memoryManager = memoryManager;
    this.aiClient = aiClient;
  }

  async execute(task: Task): Promise<ScanResult> {
    const startTime = Date.now();
    
    try {
      await this.logger.info('scanner', `Starting scan for task: ${task.id}`, {
        task_id: task.id,
        project_id: task.project_id,
        input_data: task.input_data
      });

      // Get project directory from input data
      const projectPath = task.input_data.project_path || process.cwd();
      const targetFiles = task.input_data.target_files || [];
      const maxFiles = task.input_data.max_files || 100;

      // Discover files to analyze
      const filesToAnalyze = await this.discoverFiles(projectPath, targetFiles, maxFiles);
      
      if (filesToAnalyze.length === 0) {
        throw new Error('No files found to analyze');
      }

      await this.logger.info('scanner', `Discovered ${filesToAnalyze.length} files to analyze`, {
        task_id: task.id,
        file_count: filesToAnalyze.length,
        project_path: projectPath
      });

      // Read and analyze file contents
      const fileContents = await this.readFileContents(filesToAnalyze);
      
      // Prepare context for AI analysis
      const projectContext = await this.buildProjectContext(projectPath, fileContents);
      
      // Get relevant memories for context
      const memories = await this.memoryManager.retrieveMemories(task.project_id, undefined, 20, 5);
      const memoryContext = this.buildMemoryContext(memories);

      // Create AI request for analysis
      const aiRequest = AIClient.getScannerPrompt(
        filesToAnalyze,
        `${projectContext}\n\n## Previous Learnings\n${memoryContext}`
      );

      // Execute AI analysis
      const aiResponse = await this.aiClient.generateResponse(aiRequest, task.metadata.ai_engine);
      
      // Parse and validate AI response
      let scanResult: ScanResult;
      try {
        scanResult = JSON.parse(aiResponse.content);
      } catch (parseError) {
        throw new Error(`Failed to parse AI analysis result: ${parseError}`);
      }

      // Enrich results with additional metadata
      scanResult = await this.enrichScanResult(scanResult, filesToAnalyze, fileContents);

      // Store insights in memory
      await this.storeAnalysisInsights(task.project_id, scanResult, projectPath);

      const duration = Date.now() - startTime;
      
      await this.logger.info('scanner', `Scan completed successfully`, {
        task_id: task.id,
        duration_ms: duration,
        files_analyzed: filesToAnalyze.length,
        issues_found: scanResult.issues.length,
        opportunities_found: scanResult.opportunities.length,
        tokens_used: aiResponse.tokens_used,
        cost_estimate: aiResponse.cost_estimate
      });

      return scanResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      await this.logger.error('scanner', 'Scan execution failed', {
        task_id: task.id,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);

      throw error;
    }
  }

  private async discoverFiles(
    projectPath: string,
    targetFiles: string[],
    maxFiles: number
  ): Promise<string[]> {
    const files: string[] = [];
    
    try {
      // If specific files are provided, use those
      if (targetFiles && targetFiles.length > 0) {
        for (const file of targetFiles) {
          const fullPath = path.resolve(projectPath, file);
          if (await this.fileExists(fullPath)) {
            files.push(fullPath);
          }
        }
        return files.slice(0, maxFiles);
      }

      // Otherwise, discover files automatically
      await this.walkDirectory(projectPath, files, maxFiles);
      
      return files.slice(0, maxFiles);
    } catch (error) {
      await this.logger.error('scanner', 'Failed to discover files', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async walkDirectory(
    dirPath: string,
    files: string[],
    maxFiles: number,
    depth: number = 0
  ): Promise<void> {
    if (files.length >= maxFiles || depth > 5) return; // Prevent infinite recursion

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        
        const fullPath = path.join(dirPath, entry.name);
        
        // Skip excluded patterns
        if (this.shouldExclude(entry.name, fullPath)) {
          continue;
        }

        if (entry.isDirectory()) {
          await this.walkDirectory(fullPath, files, maxFiles, depth + 1);
        } else if (entry.isFile() && this.isAnalyzableFile(entry.name)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      await this.logger.warn('scanner', `Failed to read directory: ${dirPath}`, {
        directory: dirPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private shouldExclude(name: string, fullPath: string): boolean {
    return this.excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(name);
      }
      return name.includes(pattern) || fullPath.includes(pattern);
    });
  }

  private isAnalyzableFile(filename: string): boolean {
    const analyzableExtensions = [
      '.ts', '.tsx', '.js', '.jsx',
      '.vue', '.svelte',
      '.py', '.rb', '.php',
      '.java', '.kt', '.scala',
      '.go', '.rs', '.cpp', '.c',
      '.css', '.scss', '.sass', '.less',
      '.html', '.htm',
      '.json', '.yaml', '.yml',
      '.md', '.mdx',
      '.sql'
    ];

    const ext = path.extname(filename).toLowerCase();
    return analyzableExtensions.includes(ext);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async readFileContents(filePaths: string[]): Promise<Map<string, string>> {
    const contents = new Map<string, string>();
    const maxFileSize = 1024 * 1024; // 1MB limit per file

    for (const filePath of filePaths) {
      try {
        const stats = await fs.stat(filePath);
        
        if (stats.size > maxFileSize) {
          await this.logger.warn('scanner', `File too large, skipping: ${filePath}`, {
            file_path: filePath,
            size_bytes: stats.size,
            max_size_bytes: maxFileSize
          });
          continue;
        }

        const content = await fs.readFile(filePath, 'utf-8');
        contents.set(filePath, content);
      } catch (error) {
        await this.logger.warn('scanner', `Failed to read file: ${filePath}`, {
          file_path: filePath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return contents;
  }

  private async buildProjectContext(
    projectPath: string,
    fileContents: Map<string, string>
  ): Promise<string> {
    let context = `## Project Analysis Context\n\n`;
    context += `**Project Path:** ${projectPath}\n`;
    context += `**Files Analyzed:** ${fileContents.size}\n\n`;

    // Analyze package.json if present
    const packageJsonPath = path.join(projectPath, 'package.json');
    if (await this.fileExists(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        context += `**Project Type:** ${packageJson.name || 'Unknown'}\n`;
        context += `**Dependencies:** ${Object.keys(packageJson.dependencies || {}).length}\n`;
        context += `**Dev Dependencies:** ${Object.keys(packageJson.devDependencies || {}).length}\n`;
        
        if (packageJson.scripts) {
          context += `**Scripts:** ${Object.keys(packageJson.scripts).join(', ')}\n`;
        }
        
        context += '\n';
      } catch (error) {
        await this.logger.warn('scanner', 'Failed to parse package.json', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Add file structure overview
    context += `### File Structure Overview\n`;
    const filesByExtension = new Map<string, number>();
    
    for (const filePath of fileContents.keys()) {
      const ext = path.extname(filePath);
      filesByExtension.set(ext, (filesByExtension.get(ext) || 0) + 1);
    }

    for (const [ext, count] of filesByExtension.entries()) {
      context += `- ${ext || 'no extension'}: ${count} files\n`;
    }

    // Add sample file contents (limited)
    context += `\n### Sample File Contents\n`;
    let samplesAdded = 0;
    const maxSamples = 5;
    const maxContentLength = 2000;

    for (const [filePath, content] of fileContents.entries()) {
      if (samplesAdded >= maxSamples) break;
      
      const relativePath = path.relative(projectPath, filePath);
      const truncatedContent = content.length > maxContentLength 
        ? content.substring(0, maxContentLength) + '...'
        : content;
      
      context += `\n**${relativePath}**\n\`\`\`\n${truncatedContent}\n\`\`\`\n`;
      samplesAdded++;
    }

    return context;
  }

  private buildMemoryContext(memories: any[]): string {
    if (memories.length === 0) {
      return 'No previous learnings available.';
    }

    let context = '';
    
    const insights = memories.filter(m => m.memory_type === 'insight');
    const patterns = memories.filter(m => m.memory_type === 'pattern');
    const errors = memories.filter(m => m.memory_type === 'error');

    if (insights.length > 0) {
      context += '**Previous Insights:**\n';
      insights.slice(0, 3).forEach(insight => {
        context += `- ${insight.content.insight}\n`;
      });
      context += '\n';
    }

    if (patterns.length > 0) {
      context += '**Known Patterns:**\n';
      patterns.slice(0, 3).forEach(pattern => {
        context += `- ${pattern.content.pattern}\n`;
      });
      context += '\n';
    }

    if (errors.length > 0) {
      context += '**Previous Issues:**\n';
      errors.slice(0, 2).forEach(error => {
        context += `- ${error.content.error}: ${error.content.solution}\n`;
      });
      context += '\n';
    }

    return context;
  }

  private async enrichScanResult(
    scanResult: ScanResult,
    filePaths: string[],
    fileContents: Map<string, string>
  ): Promise<ScanResult> {
    // Add more detailed metrics
    const totalLines = Array.from(fileContents.values())
      .reduce((sum, content) => sum + content.split('\n').length, 0);

    // Update metrics with calculated values
    scanResult.metrics = {
      ...scanResult.metrics,
      lines_of_code: totalLines
    };

    // Update structure analysis with file count
    scanResult.structure_analysis.file_count = filePaths.length;

    // Enhance issues with file-specific information
    scanResult.issues = scanResult.issues.map(issue => ({
      ...issue,
      file_path: issue.file_path || this.findRelevantFile(issue.description, filePaths)
    }));

    return scanResult;
  }

  private findRelevantFile(description: string, filePaths: string[]): string {
    // Simple heuristic to match issues with files
    const keywords = description.toLowerCase().split(' ');
    
    for (const filePath of filePaths) {
      const fileName = path.basename(filePath).toLowerCase();
      if (keywords.some(keyword => fileName.includes(keyword))) {
        return filePath;
      }
    }
    
    return filePaths[0] || 'unknown';
  }

  private async storeAnalysisInsights(
    projectId: string,
    scanResult: ScanResult,
    projectPath: string
  ): Promise<void> {
    try {
      // Store key insights
      if (scanResult.opportunities.length > 0) {
        const topOpportunity = scanResult.opportunities
          .sort((a, b) => {
            const impactScore = { low: 1, medium: 2, high: 3 };
            return impactScore[b.impact] - impactScore[a.impact];
          })[0];

        await this.memoryManager.storeInsight(
          projectId,
          `Found ${scanResult.opportunities.length} optimization opportunities, top priority: ${topOpportunity.description}`,
          {
            scan_date: new Date().toISOString(),
            project_path: projectPath,
            total_opportunities: scanResult.opportunities.length,
            top_opportunity: topOpportunity
          },
          7
        );
      }

      // Store patterns found
      const architecturePatterns = scanResult.structure_analysis.architecture_patterns;
      if (architecturePatterns.length > 0) {
        await this.memoryManager.storePattern(
          projectId,
          `Architecture patterns: ${architecturePatterns.join(', ')}`,
          architecturePatterns,
          1,
          6
        );
      }

      // Store critical issues as errors
      const criticalIssues = scanResult.issues.filter(issue => issue.severity === 'critical');
      for (const issue of criticalIssues.slice(0, 3)) { // Limit to top 3
        await this.memoryManager.storeError(
          projectId,
          issue.description,
          issue.suggestion,
          {
            file_path: issue.file_path,
            type: issue.type,
            scan_date: new Date().toISOString()
          },
          8
        );
      }

      // Store project context
      await this.memoryManager.storeContext(
        projectId,
        'project_structure',
        {
          file_count: scanResult.structure_analysis.file_count,
          component_count: scanResult.structure_analysis.component_count,
          complexity_score: scanResult.structure_analysis.complexity_score,
          dependencies: scanResult.structure_analysis.dependencies,
          metrics: scanResult.metrics
        },
        5
      );

    } catch (error) {
      await this.logger.warn('scanner', 'Failed to store analysis insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Utility method to validate scan results
  private validateScanResult(result: any): result is ScanResult {
    return (
      result &&
      typeof result === 'object' &&
      result.structure_analysis &&
      Array.isArray(result.issues) &&
      Array.isArray(result.opportunities) &&
      result.metrics
    );
  }

  // Method to get scanning capabilities and constraints
  getCapabilities(): Record<string, any> {
    return {
      supported_file_types: [
        'TypeScript/JavaScript (.ts, .tsx, .js, .jsx)',
        'Vue.js (.vue)',
        'Svelte (.svelte)',
        'Python (.py)',
        'Ruby (.rb)',
        'PHP (.php)',
        'Java (.java)',
        'Kotlin (.kt)',
        'Scala (.scala)',
        'Go (.go)',
        'Rust (.rs)',
        'C/C++ (.c, .cpp)',
        'CSS/SCSS (.css, .scss, .sass, .less)',
        'HTML (.html, .htm)',
        'JSON/YAML (.json, .yaml, .yml)',
        'Markdown (.md, .mdx)',
        'SQL (.sql)'
      ],
      max_files_per_scan: 100,
      max_file_size_mb: 1,
      max_directory_depth: 5,
      analysis_types: [
        'Structure Analysis',
        'Performance Issues',
        'Accessibility Problems',
        'Maintainability Concerns',
        'Security Vulnerabilities',
        'Code Quality Metrics',
        'Architecture Patterns',
        'Dependency Analysis'
      ],
      excluded_patterns: this.excludePatterns
    };
  }
}