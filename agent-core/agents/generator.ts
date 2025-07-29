import { promises as fs } from 'fs';
import path from 'path';
import { ModuleGenerationResult, GeneratedModule, Task } from '../../types';
import { Logger } from '../logger/logger';
import { AIClient } from '../engines/AIClient';
import { MemoryManager } from '../memory/memoryManager';
import { TaskManager } from '../tasks/taskManager';

export class GeneratorAgent {
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

  async executeTask(task: Task): Promise<ModuleGenerationResult> {
    await this.logger.info('generator', 'Starting module generation task', {
      task_id: task.id,
      project_id: task.project_id
    });

    try {
      // Extract generation parameters from task input
      const { moduleRequest, existingPatterns, frameworks, targetDirectory } = task.input_data;
      
      // Set context for logging
      this.logger.setContext(task.project_id, task.id);

      // Start the task
      await this.taskManager.startTask(task.id);

      // Step 1: Analyze project context and existing patterns
      const projectContext = await this.buildProjectContext(task.project_id, targetDirectory);

      // Step 2: Get existing code patterns from memory
      const codePatterns = await this.getCodePatterns(task.project_id);
      
      // Step 3: Analyze existing project structure
      const projectStructure = await this.analyzeProjectStructure(targetDirectory || process.cwd());

      // Step 4: Generate modules using Claude
      const generatedModules = await this.generateModules(
        moduleRequest,
        projectContext,
        codePatterns,
        projectStructure,
        existingPatterns,
        frameworks
      );

      // Step 5: Validate and enhance generated modules
      const validatedModules = await this.validateAndEnhanceModules(generatedModules, targetDirectory);

      // Step 6: Create integration instructions
      const integrationInstructions = await this.createIntegrationInstructions(validatedModules, projectStructure);

      // Step 7: Generate testing suggestions
      const testingSuggestions = await this.createTestingSuggestions(validatedModules);

      // Step 8: Compile generation results
      const generationResult: ModuleGenerationResult = {
        generated_modules: validatedModules,
        integration_instructions: integrationInstructions,
        testing_suggestions: testingSuggestions
      };

      // Store generation insights in memory
      await this.storeGenerationInsights(task.project_id, generationResult, moduleRequest);

      // Complete the task
      await this.taskManager.completeTask(
        task.id,
        { generation_result: generationResult },
        generatedModules.reduce((sum, mod) => sum + (mod.tokensUsed || 0), 0),
        generatedModules.reduce((sum, mod) => sum + (mod.costEstimate || 0), 0)
      );

      await this.logger.info('generator', 'Module generation task completed successfully', {
        task_id: task.id,
        modules_generated: validatedModules.length,
        integration_steps: integrationInstructions.length,
        testing_suggestions: testingSuggestions.length
      });

      return generationResult;

    } catch (error) {
      await this.logger.error('generator', 'Module generation task failed', {
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

  private async buildProjectContext(projectId: string, targetDirectory?: string): Promise<string> {
    let context = `Module Generation Context:\n\n`;

    try {
      // Get project insights from memory
      const insights = await this.memoryManager.getInsights(projectId, 5);
      if (insights.length > 0) {
        context += `Project Insights:\n`;
        insights.forEach(insight => {
          context += `- ${insight.content.insight}\n`;
        });
        context += '\n';
      }

      // Get successful patterns from memory
      const successPatterns = await this.memoryManager.getSuccesses(projectId, 5);
      if (successPatterns.length > 0) {
        context += `Successful Patterns:\n`;
        successPatterns.forEach(pattern => {
          context += `- ${pattern.content.action}: ${pattern.content.outcome}\n`;
        });
        context += '\n';
      }

      // Get preferences from memory
      const preferences = await this.memoryManager.getPreferences(projectId);
      if (preferences.length > 0) {
        context += `Project Preferences:\n`;
        preferences.forEach(pref => {
          context += `- ${pref.content.preference}: ${pref.content.value}\n`;
        });
        context += '\n';
      }

    } catch (error) {
      await this.logger.warn('generator', 'Failed to build project context from memory', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return context;
  }

  private async getCodePatterns(projectId: string): Promise<any[]> {
    try {
      const patterns = await this.memoryManager.getPatterns(projectId, 10);
      return patterns.filter(pattern =>
        pattern.content.pattern?.includes('component') ||
        pattern.content.pattern?.includes('service') ||
        pattern.content.pattern?.includes('utility') ||
        pattern.content.pattern?.includes('hook')
      );
    } catch (error) {
      await this.logger.warn('generator', 'Failed to retrieve code patterns', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private async analyzeProjectStructure(targetDirectory: string): Promise<any> {
    try {
      const structure = {
        directories: [] as string[],
        filePatterns: [] as string[],
        frameworks: [] as string[],
        conventions: [] as string[]
      };

      // Read directory structure
      const entries = await fs.readdir(targetDirectory, { withFileTypes: true });
      
      structure.directories = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => !['node_modules', '.git', 'dist', 'build'].includes(name));

      // Check for common patterns
      if (structure.directories.includes('components')) {
        structure.conventions.push('components directory');
      }
      if (structure.directories.includes('hooks')) {
        structure.conventions.push('custom hooks directory');
      }
      if (structure.directories.includes('utils') || structure.directories.includes('utilities')) {
        structure.conventions.push('utilities directory');
      }
      if (structure.directories.includes('services')) {
        structure.conventions.push('services directory');
      }

      // Check package.json for frameworks
      try {
        const packageJsonPath = path.join(targetDirectory, 'package.json');
        const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(packageContent);
        
        const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
        
        if (deps.react) structure.frameworks.push('React');
        if (deps.vue) structure.frameworks.push('Vue');
        if (deps['@angular/core']) structure.frameworks.push('Angular');
        if (deps.typescript) structure.frameworks.push('TypeScript');
        if (deps['styled-components']) structure.frameworks.push('Styled Components');
        if (deps['@emotion/react']) structure.frameworks.push('Emotion');
        if (deps.tailwindcss) structure.frameworks.push('Tailwind CSS');

      } catch (error) {
        await this.logger.debug('generator', 'Could not read package.json for framework detection');
      }

      // Sample existing files for patterns
      const sampleFiles = await this.sampleExistingFiles(targetDirectory);
      structure.filePatterns = this.extractFilePatterns(sampleFiles);

      return structure;

    } catch (error) {
      await this.logger.error('generator', 'Failed to analyze project structure', {
        target_directory: targetDirectory,
        error: error instanceof Error ? error.message : String(error)
      });
      return { directories: [], filePatterns: [], frameworks: [], conventions: [] };
    }
  }

  private async sampleExistingFiles(targetDirectory: string): Promise<Array<{ path: string; content: string }>> {
    const samples: Array<{ path: string; content: string }> = [];

    try {
      const findFiles = async (dir: string, depth: number = 0): Promise<string[]> => {
        if (depth > 2) return []; // Limit depth to avoid deep recursion

        const files: string[] = [];
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(targetDirectory, fullPath);

          if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
            const subFiles = await findFiles(fullPath, depth + 1);
            files.push(...subFiles);
          } else if (entry.isFile() && /\.(tsx?|jsx?|vue|svelte)$/.test(entry.name)) {
            files.push(relativePath);
          }
        }

        return files;
      };

      const files = await findFiles(targetDirectory);
      
      // Sample up to 10 files
      const samplePaths = files.slice(0, 10);

      for (const filePath of samplePaths) {
        try {
          const fullPath = path.join(targetDirectory, filePath);
          const content = await fs.readFile(fullPath, 'utf-8');
          
          // Limit content size
          const limitedContent = content.length > 3000 ? content.slice(0, 3000) + '\n...' : content;
          
          samples.push({ path: filePath, content: limitedContent });
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

    } catch (error) {
      await this.logger.warn('generator', 'Failed to sample existing files', {
        target_directory: targetDirectory,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return samples;
  }

  private extractFilePatterns(files: Array<{ path: string; content: string }>): string[] {
    const patterns: string[] = [];

    files.forEach(file => {
      const content = file.content;

      // React patterns
      if (content.includes('import React') || content.includes('from \'react\'')) {
        patterns.push('React imports');
      }
      if (content.includes('export default function') || content.includes('export const')) {
        patterns.push('Named exports');
      }
      if (content.includes('interface ') && content.includes('Props')) {
        patterns.push('Props interfaces');
      }
      if (content.includes('useState') || content.includes('useEffect')) {
        patterns.push('React hooks');
      }
      if (content.includes('styled-components') || content.includes('styled.')) {
        patterns.push('Styled components');
      }
      if (content.includes('className=')) {
        patterns.push('CSS classes');
      }

      // TypeScript patterns
      if (content.includes(': React.FC') || content.includes(': FC')) {
        patterns.push('Functional component typing');
      }
      if (content.includes('type ') || content.includes('interface ')) {
        patterns.push('TypeScript types');
      }

      // Testing patterns
      if (content.includes('test(') || content.includes('it(') || content.includes('describe(')) {
        patterns.push('Testing structure');
      }
    });

    // Remove duplicates
    return [...new Set(patterns)];
  }

  private async generateModules(
    moduleRequest: string,
    projectContext: string,
    codePatterns: any[],
    projectStructure: any,
    existingPatterns?: string[],
    frameworks?: string[]
  ): Promise<(GeneratedModule & { tokensUsed?: number; costEstimate?: number })[]> {
    try {
      // Build comprehensive context for Claude
      let enhancedContext = projectContext;

      enhancedContext += `\nProject Structure:\n`;
      enhancedContext += `- Directories: ${projectStructure.directories.join(', ')}\n`;
      enhancedContext += `- Frameworks: ${projectStructure.frameworks.join(', ')}\n`;
      enhancedContext += `- Conventions: ${projectStructure.conventions.join(', ')}\n`;
      enhancedContext += `- File Patterns: ${projectStructure.filePatterns.join(', ')}\n\n`;

      if (codePatterns.length > 0) {
        enhancedContext += `\nExisting Code Patterns:\n`;
        codePatterns.forEach(pattern => {
          enhancedContext += `- ${pattern.content.pattern}\n`;
        });
        enhancedContext += '\n';
      }

      if (existingPatterns && existingPatterns.length > 0) {
        enhancedContext += `\nSpecified Patterns to Follow: ${existingPatterns.join(', ')}\n`;
      }

      if (frameworks && frameworks.length > 0) {
        enhancedContext += `\nPreferred Frameworks: ${frameworks.join(', ')}\n`;
      }

      // Get Claude's module generation
      const aiRequest = AIClient.getGeneratorPrompt(moduleRequest, existingPatterns, frameworks);
      aiRequest.context = enhancedContext;
      
      const response = await this.aiClient.generateResponse(aiRequest);

      // Parse Claude's response
      let generationData;
      try {
        generationData = JSON.parse(response.content);
      } catch (parseError) {
        await this.logger.error('generator', 'Failed to parse Claude generation response', {
          response_content: response.content.slice(0, 500)
        });
        throw new Error('Invalid response format from Claude');
      }

      // Transform Claude's modules into our format
      const modules: (GeneratedModule & { tokensUsed?: number; costEstimate?: number })[] = 
        (generationData.generated_modules || []).map((mod: any) => ({
          name: mod.name || 'UnnamedModule',
          type: mod.type || 'component',
          file_path: mod.file_path || this.generateFilePath(mod.name, mod.type, projectStructure),
          code: mod.code || '// Generated code placeholder',
          dependencies: mod.dependencies || [],
          props_interface: mod.props_interface || '',
          usage_example: mod.usage_example || '',
          tests: mod.tests || '',
          tokensUsed: Math.round(response.tokens_used / (generationData.generated_modules?.length || 1)),
          costEstimate: response.cost_estimate / (generationData.generated_modules?.length || 1)
        }));

      return modules;

    } catch (error) {
      await this.logger.error('generator', 'Failed to generate modules', {
        module_request: moduleRequest,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  private generateFilePath(moduleName: string, moduleType: string, projectStructure: any): string {
    const name = moduleName.replace(/\s+/g, '');
    
    switch (moduleType) {
      case 'component':
        if (projectStructure.directories.includes('components')) {
          return `components/${name}.tsx`;
        } else if (projectStructure.directories.includes('src')) {
          return `src/components/${name}.tsx`;
        }
        return `${name}.tsx`;

      case 'service':
        if (projectStructure.directories.includes('services')) {
          return `services/${name}.ts`;
        } else if (projectStructure.directories.includes('src')) {
          return `src/services/${name}.ts`;
        }
        return `${name}.ts`;

      case 'utility':
        if (projectStructure.directories.includes('utils')) {
          return `utils/${name}.ts`;
        } else if (projectStructure.directories.includes('utilities')) {
          return `utilities/${name}.ts`;
        } else if (projectStructure.directories.includes('src')) {
          return `src/utils/${name}.ts`;
        }
        return `utils/${name}.ts`;

      case 'hook':
        if (projectStructure.directories.includes('hooks')) {
          return `hooks/use${name}.ts`;
        } else if (projectStructure.directories.includes('src')) {
          return `src/hooks/use${name}.ts`;
        }
        return `hooks/use${name}.ts`;

      default:
        return `${name}.ts`;
    }
  }

  private async validateAndEnhanceModules(
    modules: (GeneratedModule & { tokensUsed?: number; costEstimate?: number })[],
    targetDirectory?: string
  ): Promise<(GeneratedModule & { tokensUsed?: number; costEstimate?: number })[]> {
    const validated: (GeneratedModule & { tokensUsed?: number; costEstimate?: number })[] = [];

    for (const module of modules) {
      try {
        // Validate and enhance the module
        const enhancedModule = await this.enhanceModule(module, targetDirectory);
        
        // Check for syntax errors (basic validation)
        if (this.validateModuleSyntax(enhancedModule)) {
          validated.push(enhancedModule);
        } else {
          await this.logger.warn('generator', `Module failed syntax validation: ${module.name}`);
        }

      } catch (error) {
        await this.logger.warn('generator', 'Failed to validate module', {
          module_name: module.name,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return validated;
  }

  private async enhanceModule(
    module: GeneratedModule & { tokensUsed?: number; costEstimate?: number },
    targetDirectory?: string
  ): Promise<GeneratedModule & { tokensUsed?: number; costEstimate?: number }> {
    let enhancedCode = module.code;

    // Add imports if missing
    if (module.type === 'component' && !enhancedCode.includes('import React')) {
      enhancedCode = `import React from 'react';\n\n${enhancedCode}`;
    }

    // Add TypeScript types if missing
    if (module.props_interface && !enhancedCode.includes('interface')) {
      enhancedCode = `${module.props_interface}\n\n${enhancedCode}`;
    }

    // Ensure proper exports
    if (!enhancedCode.includes('export')) {
      if (module.type === 'component') {
        enhancedCode += `\n\nexport default ${module.name};`;
      } else {
        enhancedCode += `\n\nexport { ${module.name} };`;
      }
    }

    // Add JSDoc comments
    const jsdocComment = this.generateJSDocComment(module);
    if (jsdocComment && !enhancedCode.includes('/**')) {
      enhancedCode = `${jsdocComment}\n${enhancedCode}`;
    }

    return {
      ...module,
      code: enhancedCode
    };
  }

  private generateJSDocComment(module: GeneratedModule): string {
    return `/**
 * ${module.name}
 * 
 * Generated module of type: ${module.type}
 * 
 * @description Auto-generated by Claude Agent System
 */`;
  }

  private validateModuleSyntax(module: GeneratedModule): boolean {
    const code = module.code;

    // Basic syntax checks
    const openBraces = (code.match(/{/g) || []).length;
    const closeBraces = (code.match(/}/g) || []).length;
    
    if (openBraces !== closeBraces) {
      return false;
    }

    // Check for required elements based on type
    switch (module.type) {
      case 'component':
        return code.includes('return') || code.includes('=>');
      case 'service':
        return code.includes('function') || code.includes('=>') || code.includes('class');
      case 'utility':
        return code.includes('function') || code.includes('=>') || code.includes('export');
      case 'hook':
        return code.includes('use') && (code.includes('function') || code.includes('=>'));
      default:
        return true;
    }
  }

  private async createIntegrationInstructions(
    modules: GeneratedModule[],
    projectStructure: any
  ): Promise<string[]> {
    const instructions: string[] = [];

    // General setup instructions
    instructions.push('Integration Instructions:');
    instructions.push('');

    // File creation instructions
    instructions.push('1. File Creation:');
    modules.forEach(module => {
      instructions.push(`   - Create ${module.file_path} with the provided code`);
    });
    instructions.push('');

    // Dependency instructions
    const allDependencies = [...new Set(modules.flatMap(m => m.dependencies))];
    if (allDependencies.length > 0) {
      instructions.push('2. Install Dependencies:');
      instructions.push(`   npm install ${allDependencies.join(' ')}`);
      instructions.push('');
    }

    // Import instructions
    instructions.push('3. Usage Examples:');
    modules.forEach(module => {
      if (module.usage_example) {
        instructions.push(`   ${module.name}:`);
        instructions.push(`   ${module.usage_example}`);
        instructions.push('');
      }
    });

    // Framework-specific instructions
    if (projectStructure.frameworks.includes('React')) {
      instructions.push('4. React Integration:');
      instructions.push('   - Import components into your App.js or routing configuration');
      instructions.push('   - For hooks, import and use within functional components');
      instructions.push('');
    }

    // TypeScript instructions
    if (projectStructure.frameworks.includes('TypeScript')) {
      instructions.push('5. TypeScript Setup:');
      instructions.push('   - Ensure all generated interfaces are exported');
      instructions.push('   - Update your tsconfig.json if new paths are added');
      instructions.push('');
    }

    return instructions;
  }

  private async createTestingSuggestions(modules: GeneratedModule[]): Promise<string[]> {
    const suggestions: string[] = [];

    suggestions.push('Testing Suggestions:');
    suggestions.push('');

    modules.forEach(module => {
      suggestions.push(`${module.name} (${module.type}):`);
      
      switch (module.type) {
        case 'component':
          suggestions.push('  - Test rendering with different props');
          suggestions.push('  - Test user interactions (clicks, input changes)');
          suggestions.push('  - Test accessibility with screen readers');
          suggestions.push('  - Snapshot testing for visual regression');
          break;

        case 'service':
          suggestions.push('  - Test all public methods');
          suggestions.push('  - Mock external dependencies');
          suggestions.push('  - Test error handling scenarios');
          suggestions.push('  - Test async operations');
          break;

        case 'utility':
          suggestions.push('  - Test with various input types');
          suggestions.push('  - Test edge cases and boundary conditions');
          suggestions.push('  - Test error cases with invalid inputs');
          suggestions.push('  - Performance testing for complex operations');
          break;

        case 'hook':
          suggestions.push('  - Test hook behavior with different inputs');
          suggestions.push('  - Test state changes and side effects');
          suggestions.push('  - Test cleanup and unmounting');
          suggestions.push('  - Test with React Testing Library');
          break;
      }

      if (module.tests) {
        suggestions.push('  Generated test template:');
        suggestions.push(`  ${module.tests}`);
      }

      suggestions.push('');
    });

    return suggestions;
  }

  private async storeGenerationInsights(
    projectId: string,
    generationResult: ModuleGenerationResult,
    moduleRequest: string
  ): Promise<void> {
    try {
      // Store overall generation insight
      await this.memoryManager.storeInsight(
        projectId,
        `Module generation completed: ${generationResult.generated_modules.length} modules created`,
        {
          modules_count: generationResult.generated_modules.length,
          request: moduleRequest,
          module_types: generationResult.generated_modules.map(m => m.type),
          integration_steps: generationResult.integration_instructions.length
        },
        8 // High importance
      );

      // Store successful generation patterns
      const moduleTypes = generationResult.generated_modules.map(m => m.type);
      const typeFrequency: Record<string, number> = {};

      moduleTypes.forEach(type => {
        typeFrequency[type] = (typeFrequency[type] || 0) + 1;
      });

      for (const [type, count] of Object.entries(typeFrequency)) {
        await this.memoryManager.storePattern(
          projectId,
          `Generated ${type} modules`,
          [`Count: ${count}`, `Request: ${moduleRequest}`],
          count,
          6
        );
      }

      // Store successful generation as success memory
      await this.memoryManager.storeSuccess(
        projectId,
        `Module generation: ${moduleRequest}`,
        `Successfully generated ${generationResult.generated_modules.length} modules`,
        {
          modules_count: generationResult.generated_modules.length,
          types_generated: moduleTypes,
          has_tests: generationResult.generated_modules.some(m => m.tests),
          has_interfaces: generationResult.generated_modules.some(m => m.props_interface)
        },
        7
      );

      // Store preferences based on generated modules
      const hasTypeScript = generationResult.generated_modules.some(m => 
        m.code.includes('interface') || m.code.includes('type ')
      );
      
      if (hasTypeScript) {
        await this.memoryManager.storePreference(
          projectId,
          'uses_typescript',
          true,
          'Generated modules use TypeScript types and interfaces',
          6
        );
      }

      const hasTests = generationResult.generated_modules.some(m => m.tests);
      if (hasTests) {
        await this.memoryManager.storePreference(
          projectId,
          'includes_tests',
          true,
          'Generated modules include test templates',
          5
        );
      }

    } catch (error) {
      await this.logger.warn('generator', 'Failed to store generation insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Utility method to actually create the files (for future use)
  async createModuleFiles(
    modules: GeneratedModule[],
    targetDirectory: string,
    options: { dryRun?: boolean; overwrite?: boolean } = {}
  ): Promise<{ created: number; skipped: number; errors: string[] }> {
    const result = {
      created: 0,
      skipped: 0,
      errors: [] as string[]
    };

    for (const module of modules) {
      try {
        const fullPath = path.join(targetDirectory, module.file_path);
        const dir = path.dirname(fullPath);

        if (!options.dryRun) {
          // Ensure directory exists
          await fs.mkdir(dir, { recursive: true });

          // Check if file already exists
          try {
            await fs.access(fullPath);
            if (!options.overwrite) {
              result.skipped++;
              await this.logger.info('generator', `Skipped existing file: ${module.file_path}`);
              continue;
            }
          } catch {
            // File doesn't exist, proceed with creation
          }

          // Write the file
          await fs.writeFile(fullPath, module.code, 'utf-8');
          result.created++;
          
          await this.logger.info('generator', `Created module file: ${module.file_path}`, {
            module_name: module.name,
            module_type: module.type
          });
        } else {
          // Dry run - just validate the path
          result.created++;
          await this.logger.info('generator', `Would create: ${module.file_path} (dry run)`);
        }

      } catch (error) {
        const errorMsg = `Failed to create ${module.file_path}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        
        await this.logger.error('generator', 'Failed to create module file', {
          module_name: module.name,
          file_path: module.file_path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return result;
  }
}