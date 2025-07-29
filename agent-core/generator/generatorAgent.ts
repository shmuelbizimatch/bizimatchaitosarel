import { promises as fs } from 'fs';
import path from 'path';
import { ModuleGenerationResult, Task, GeneratedModule } from '../../types';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
import { AIClient } from '../engines/AIClient';

export class GeneratorAgent {
  private logger: Logger;
  private memoryManager: MemoryManager;
  private aiClient: AIClient;

  // Module templates and patterns
  private moduleTemplates: Record<string, any> = {};
  private componentPatterns: string[] = [];

  constructor(logger: Logger, memoryManager: MemoryManager, aiClient: AIClient) {
    this.logger = logger;
    this.memoryManager = memoryManager;
    this.aiClient = aiClient;
    this.initializeTemplates();
  }

  async execute(task: Task): Promise<ModuleGenerationResult> {
    const startTime = Date.now();
    
    try {
      await this.logger.info('generator', `Starting module generation for task: ${task.id}`, {
        task_id: task.id,
        project_id: task.project_id,
        input_data: task.input_data
      });

      // Extract generation requirements
      const moduleRequest = task.input_data.module_request || task.input_data.description;
      const projectPath = task.input_data.project_path || process.cwd();
      const outputDirectory = task.input_data.output_directory || 'generated';
      const frameworks = task.input_data.frameworks || await this.detectProjectFrameworks(projectPath);

      if (!moduleRequest) {
        throw new Error('No module request provided for generation');
      }

      // Analyze project context and patterns
      const projectContext = await this.analyzeProjectContext(projectPath);
      const existingPatterns = await this.extractExistingPatterns(projectPath);
      
      // Retrieve relevant memories and patterns
      const memories = await this.memoryManager.retrieveMemories(task.project_id, undefined, 20, 5);
      const codePatterns = await this.memoryManager.getPatterns(task.project_id, 15);
      const successfulGenerations = await this.memoryManager.getSuccesses(task.project_id, 10);

      // Build generation context
      const generationContext = await this.buildGenerationContext(
        projectPath,
        projectContext,
        existingPatterns,
        memories,
        codePatterns,
        successfulGenerations,
        frameworks
      );

      // Create AI request for module generation
      const aiRequest = AIClient.getGeneratorPrompt(
        moduleRequest,
        existingPatterns,
        frameworks
      );

      // Add context to the prompt
      aiRequest.context = generationContext;

      // Execute AI module generation
      const aiResponse = await this.aiClient.generateResponse(aiRequest, task.metadata.ai_engine);
      
      // Parse and validate AI response
      let generationResult: ModuleGenerationResult;
      try {
        generationResult = JSON.parse(aiResponse.content);
      } catch (parseError) {
        throw new Error(`Failed to parse AI generation result: ${parseError}`);
      }

      // Validate and enrich the generation result
      generationResult = await this.validateAndEnrichResult(
        generationResult, 
        projectPath, 
        frameworks,
        existingPatterns
      );

      // Generate files if requested
      if (task.input_data.auto_generate && generationResult.generated_modules.length > 0) {
        await this.generateModuleFiles(generationResult, projectPath, outputDirectory);
      }

      // Store generation insights
      await this.storeGenerationInsights(task.project_id, generationResult, moduleRequest);

      const duration = Date.now() - startTime;
      
      await this.logger.info('generator', `Module generation completed successfully`, {
        task_id: task.id,
        duration_ms: duration,
        modules_generated: generationResult.generated_modules.length,
        integration_steps: generationResult.integration_instructions.length,
        testing_suggestions: generationResult.testing_suggestions.length,
        tokens_used: aiResponse.tokens_used,
        cost_estimate: aiResponse.cost_estimate
      });

      return generationResult;

    } catch (error) {
      const duration = Date.now() - startTime;
      
      await this.logger.error('generator', 'Module generation failed', {
        task_id: task.id,
        duration_ms: duration,
        error: error instanceof Error ? error.message : String(error)
      }, error instanceof Error ? error : undefined);

      throw error;
    }
  }

  private initializeTemplates(): void {
    // Initialize common module templates
    this.moduleTemplates = {
      react_component: {
        template: `import React from 'react';

interface {{ComponentName}}Props {
  // Define props here
}

export const {{ComponentName}}: React.FC<{{ComponentName}}Props> = (props) => {
  return (
    <div>
      {/* Component implementation */}
    </div>
  );
};

export default {{ComponentName}};`,
        dependencies: ['react'],
        test_template: `import { render, screen } from '@testing-library/react';
import {{ComponentName}} from './{{ComponentName}}';

describe('{{ComponentName}}', () => {
  it('renders correctly', () => {
    render(<{{ComponentName}} />);
    // Add assertions here
  });
});`
      },
      react_hook: {
        template: `import { useState, useEffect } from 'react';

export interface Use{{HookName}}Options {
  // Define options here
}

export interface Use{{HookName}}Return {
  // Define return values here
}

export const use{{HookName}} = (options?: Use{{HookName}}Options): Use{{HookName}}Return => {
  // Hook implementation
  
  return {
    // Return values
  };
};`,
        dependencies: ['react'],
        test_template: `import { renderHook } from '@testing-library/react';
import { use{{HookName}} } from './use{{HookName}}';

describe('use{{HookName}}', () => {
  it('should work correctly', () => {
    const { result } = renderHook(() => use{{HookName}}());
    // Add assertions here
  });
});`
      },
      utility_function: {
        template: `/**
 * {{FunctionDescription}}
 */
export const {{functionName}} = (/* parameters */): /* return type */ => {
  // Implementation
};

export default {{functionName}};`,
        dependencies: [],
        test_template: `import { {{functionName}} } from './{{functionName}}';

describe('{{functionName}}', () => {
  it('should work correctly', () => {
    // Add test cases
  });
});`
      }
    };

    this.componentPatterns = [
      'Functional Components',
      'Custom Hooks',
      'Context Providers',
      'Higher-Order Components',
      'Render Props',
      'Compound Components',
      'State Machines',
      'Error Boundaries'
    ];
  }

  private async detectProjectFrameworks(projectPath: string): Promise<string[]> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      const frameworks: string[] = [];
      
      if (allDeps.react) frameworks.push('react');
      if (allDeps.vue) frameworks.push('vue');
      if (allDeps.svelte) frameworks.push('svelte');
      if (allDeps.angular || allDeps['@angular/core']) frameworks.push('angular');
      if (allDeps.typescript) frameworks.push('typescript');
      if (allDeps.next) frameworks.push('nextjs');
      if (allDeps.nuxt) frameworks.push('nuxtjs');
      if (allDeps.gatsby) frameworks.push('gatsby');
      
      return frameworks;
    } catch (error) {
      await this.logger.warn('generator', 'Failed to detect project frameworks', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return ['javascript'];
    }
  }

  private async analyzeProjectContext(projectPath: string): Promise<Record<string, any>> {
    const context: Record<string, any> = {
      structure: {},
      conventions: {},
      patterns: []
    };

    try {
      // Analyze directory structure
      context.structure = await this.analyzeDirectoryStructure(projectPath);
      
      // Analyze naming conventions
      context.conventions = await this.analyzeNamingConventions(projectPath);
      
      // Analyze code patterns
      context.patterns = await this.analyzeCodePatterns(projectPath);
      
      return context;
    } catch (error) {
      await this.logger.warn('generator', 'Failed to analyze project context', {
        project_path: projectPath,
        error: error instanceof Error ? error.message : String(error)
      });
      return context;
    }
  }

  private async analyzeDirectoryStructure(projectPath: string): Promise<Record<string, any>> {
    const structure: Record<string, any> = {
      has_src: false,
      has_components: false,
      has_hooks: false,
      has_utils: false,
      has_services: false,
      has_tests: false,
      component_dirs: [],
      test_patterns: []
    };

    try {
      const entries = await fs.readdir(projectPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirName = entry.name.toLowerCase();
          
          if (dirName === 'src') structure.has_src = true;
          if (dirName.includes('component')) {
            structure.has_components = true;
            structure.component_dirs.push(entry.name);
          }
          if (dirName.includes('hook')) structure.has_hooks = true;
          if (dirName.includes('util') || dirName.includes('helper')) structure.has_utils = true;
          if (dirName.includes('service') || dirName.includes('api')) structure.has_services = true;
          if (dirName.includes('test') || dirName.includes('spec')) {
            structure.has_tests = true;
            structure.test_patterns.push(entry.name);
          }
        }
      }

      // Check for nested structure in src
      if (structure.has_src) {
        const srcPath = path.join(projectPath, 'src');
        const srcEntries = await fs.readdir(srcPath, { withFileTypes: true });
        
        for (const entry of srcEntries) {
          if (entry.isDirectory()) {
            const dirName = entry.name.toLowerCase();
            if (dirName.includes('component')) {
              structure.component_dirs.push(`src/${entry.name}`);
            }
          }
        }
      }

    } catch (error) {
      // Ignore errors, return partial structure
    }

    return structure;
  }

  private async analyzeNamingConventions(projectPath: string): Promise<Record<string, any>> {
    const conventions: Record<string, any> = {
      component_case: 'PascalCase', // Default
      file_case: 'camelCase',
      constant_case: 'UPPER_CASE',
      uses_index_files: false,
      file_extensions: []
    };

    try {
      // Sample some files to determine conventions
      const sampleFiles = await this.getSampleFiles(projectPath, 20);
      
      // Analyze component naming
      const componentFiles = sampleFiles.filter(f => 
        /\.(tsx?|jsx?)$/.test(f) && 
        /[A-Z]/.test(path.basename(f, path.extname(f)))
      );
      
      if (componentFiles.length > 0) {
        const pascalCaseCount = componentFiles.filter(f => 
          /^[A-Z][a-zA-Z]*$/.test(path.basename(f, path.extname(f)))
        ).length;
        
        if (pascalCaseCount / componentFiles.length > 0.5) {
          conventions.component_case = 'PascalCase';
        }
      }

      // Check for index files
      const indexFiles = sampleFiles.filter(f => 
        path.basename(f, path.extname(f)) === 'index'
      );
      conventions.uses_index_files = indexFiles.length > 0;

      // Collect file extensions
      const extensions = [...new Set(sampleFiles.map(f => path.extname(f)))];
      conventions.file_extensions = extensions;

    } catch (error) {
      // Use defaults
    }

    return conventions;
  }

  private async analyzeCodePatterns(projectPath: string): Promise<string[]> {
    const patterns: string[] = [];

    try {
      const sampleFiles = await this.getSampleFiles(projectPath, 10);
      
      for (const filePath of sampleFiles) {
        if (/\.(tsx?|jsx?)$/.test(filePath)) {
          const content = await fs.readFile(filePath, 'utf-8');
          
          // Check for common patterns
          if (content.includes('useState') || content.includes('useEffect')) {
            patterns.push('React Hooks');
          }
          if (content.includes('createContext') || content.includes('useContext')) {
            patterns.push('Context API');
          }
          if (content.includes('interface ') || content.includes('type ')) {
            patterns.push('TypeScript Types');
          }
          if (content.includes('styled-components') || content.includes('emotion')) {
            patterns.push('CSS-in-JS');
          }
          if (content.includes('test(') || content.includes('describe(')) {
            patterns.push('Unit Testing');
          }
        }
      }

      return [...new Set(patterns)];
    } catch (error) {
      return [];
    }
  }

  private async getSampleFiles(projectPath: string, maxFiles: number): Promise<string[]> {
    const files: string[] = [];
    
    try {
      await this.collectFiles(projectPath, files, maxFiles, 0);
      return files.slice(0, maxFiles);
    } catch (error) {
      return [];
    }
  }

  private async collectFiles(
    dirPath: string,
    files: string[],
    maxFiles: number,
    depth: number
  ): Promise<void> {
    if (files.length >= maxFiles || depth > 3) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (files.length >= maxFiles) break;
        
        const fullPath = path.join(dirPath, entry.name);
        
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          await this.collectFiles(fullPath, files, maxFiles, depth + 1);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Ignore and continue
    }
  }

  private async extractExistingPatterns(projectPath: string): Promise<string[]> {
    const patterns: string[] = [];
    
    try {
      // Check common pattern files
      const patternFiles = [
        'src/patterns.ts',
        'src/components/patterns.ts',
        'docs/patterns.md',
        'PATTERNS.md'
      ];

      for (const file of patternFiles) {
        const filePath = path.join(projectPath, file);
        if (await this.fileExists(filePath)) {
          const content = await fs.readFile(filePath, 'utf-8');
          // Extract patterns from documentation
          const patternMatches = content.match(/^#{1,3}\s+(.+)$/gm);
          if (patternMatches) {
            patterns.push(...patternMatches.map(m => m.replace(/^#{1,3}\s+/, '')));
          }
        }
      }

      return [...new Set(patterns)];
    } catch (error) {
      return this.componentPatterns; // Fallback to default patterns
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async buildGenerationContext(
    projectPath: string,
    projectContext: Record<string, any>,
    existingPatterns: string[],
    memories: any[],
    codePatterns: any[],
    successfulGenerations: any[],
    frameworks: string[]
  ): Promise<string> {
    let context = `## Module Generation Context\n\n`;

    // Project information
    context += `**Project Path:** ${projectPath}\n`;
    context += `**Frameworks:** ${frameworks.join(', ')}\n`;
    context += `**Existing Patterns:** ${existingPatterns.length} identified\n\n`;

    // Project structure
    context += `### Project Structure\n`;
    if (projectContext.structure.has_src) context += `- Uses src/ directory\n`;
    if (projectContext.structure.has_components) {
      context += `- Component directories: ${projectContext.structure.component_dirs.join(', ')}\n`;
    }
    if (projectContext.structure.has_hooks) context += `- Has custom hooks\n`;
    if (projectContext.structure.has_utils) context += `- Has utility functions\n`;
    if (projectContext.structure.has_services) context += `- Has service layer\n`;
    context += '\n';

    // Naming conventions
    context += `### Naming Conventions\n`;
    context += `- Component case: ${projectContext.conventions.component_case}\n`;
    context += `- File case: ${projectContext.conventions.file_case}\n`;
    context += `- Uses index files: ${projectContext.conventions.uses_index_files}\n`;
    context += `- File extensions: ${projectContext.conventions.file_extensions.join(', ')}\n\n`;

    // Code patterns from memory
    if (codePatterns.length > 0) {
      context += `### Established Code Patterns\n`;
      codePatterns.slice(0, 5).forEach(pattern => {
        context += `- ${pattern.content.pattern} (frequency: ${pattern.content.frequency})\n`;
        if (pattern.content.examples && pattern.content.examples.length > 0) {
          context += `  Examples: ${pattern.content.examples.slice(0, 2).join(', ')}\n`;
        }
      });
      context += '\n';
    }

    // Previous successful generations
    if (successfulGenerations.length > 0) {
      context += `### Previous Successful Generations\n`;
      successfulGenerations.slice(0, 3).forEach(success => {
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
    context += `### Framework Guidelines\n`;
    frameworks.forEach(framework => {
      context += this.getFrameworkGuidelines(framework);
    });

    // Quality standards
    context += `\n### Quality Standards\n`;
    context += `- TypeScript interfaces for all props and return types\n`;
    context += `- Comprehensive JSDoc comments\n`;
    context += `- Error handling and edge cases\n`;
    context += `- Accessibility considerations\n`;
    context += `- Performance optimizations\n`;
    context += `- Unit test templates\n`;
    context += `- Usage examples and documentation\n\n`;

    return context;
  }

  private getFrameworkGuidelines(framework: string): string {
    switch (framework.toLowerCase()) {
      case 'react':
        return `**React Guidelines:**
- Use functional components with hooks
- Implement proper prop types with TypeScript
- Use React.memo for performance optimization
- Follow React best practices for state management
- Implement proper error boundaries where needed
- Use proper key props for lists
- Handle loading and error states appropriately

`;
      case 'vue':
        return `**Vue.js Guidelines:**
- Use Composition API for new components
- Implement proper reactive patterns
- Use v-model correctly for two-way binding
- Follow Vue 3 best practices
- Implement proper component communication
- Use slots for flexible component design

`;
      case 'svelte':
        return `**Svelte Guidelines:**
- Use reactive statements appropriately
- Implement proper component lifecycle
- Use stores for state management
- Follow Svelte accessibility guidelines
- Implement proper transitions and animations

`;
      case 'typescript':
        return `**TypeScript Guidelines:**
- Define comprehensive interfaces
- Use proper type annotations
- Implement generic types where appropriate
- Follow TypeScript best practices
- Use utility types effectively

`;
      default:
        return '';
    }
  }

  private async validateAndEnrichResult(
    result: ModuleGenerationResult,
    projectPath: string,
    frameworks: string[],
    existingPatterns: string[]
  ): Promise<ModuleGenerationResult> {
    // Validate and enrich generated modules
    result.generated_modules = await Promise.all(
      result.generated_modules.map(async (module) => {
        // Validate file path
        module.file_path = this.resolveModulePath(module.file_path, projectPath);
        
        // Ensure proper naming conventions
        module.name = this.applyNamingConventions(module.name, module.type);
        
        // Add missing dependencies
        module.dependencies = this.enrichDependencies(module.dependencies, module.code, frameworks);
        
        // Generate props interface if missing
        if (module.type === 'component' && !module.props_interface) {
          module.props_interface = this.generatePropsInterface(module.name, module.code);
        }
        
        // Generate tests if missing
        if (!module.tests) {
          module.tests = this.generateTestTemplate(module);
        }
        
        // Enhance usage example
        module.usage_example = this.enhanceUsageExample(module.usage_example, module);
        
        return module;
      })
    );

    // Enhance integration instructions
    result.integration_instructions = this.enhanceIntegrationInstructions(
      result.integration_instructions,
      result.generated_modules,
      projectPath
    );

    // Enhance testing suggestions
    result.testing_suggestions = this.enhanceTestingSuggestions(
      result.testing_suggestions,
      result.generated_modules,
      frameworks
    );

    return result;
  }

  private resolveModulePath(modulePath: string, projectPath: string): string {
    if (path.isAbsolute(modulePath)) {
      return modulePath;
    }
    
    // Default to src directory if it exists
    const srcPath = path.join(projectPath, 'src');
    if (this.fileExists(srcPath)) {
      return path.join(srcPath, modulePath);
    }
    
    return path.join(projectPath, modulePath);
  }

  private applyNamingConventions(name: string, type: string): string {
    switch (type) {
      case 'component':
        // Ensure PascalCase for components
        return name.charAt(0).toUpperCase() + name.slice(1);
      case 'hook':
        // Ensure camelCase and 'use' prefix for hooks
        if (!name.startsWith('use')) {
          name = 'use' + name.charAt(0).toUpperCase() + name.slice(1);
        }
        return name;
      case 'utility':
        // Ensure camelCase for utilities
        return name.charAt(0).toLowerCase() + name.slice(1);
      default:
        return name;
    }
  }

  private enrichDependencies(
    dependencies: string[],
    code: string,
    frameworks: string[]
  ): string[] {
    const enriched = [...dependencies];
    
    // Add React if JSX is detected
    if (code.includes('<') && code.includes('>') && !enriched.includes('react')) {
      enriched.push('react');
    }
    
    // Add common dependencies based on code analysis
    if (code.includes('useState') || code.includes('useEffect')) {
      if (!enriched.includes('react')) enriched.push('react');
    }
    
    if (code.includes('styled-components') && !enriched.includes('styled-components')) {
      enriched.push('styled-components');
    }
    
    return enriched;
  }

  private generatePropsInterface(name: string, code: string): string {
    // Simple props interface generation
    const interfaceName = `${name}Props`;
    
    // Extract prop usage from code
    const propMatches = code.match(/props\.(\w+)/g);
    const propNames = propMatches 
      ? [...new Set(propMatches.map(m => m.replace('props.', '')))]
      : [];
    
    if (propNames.length === 0) {
      return `interface ${interfaceName} {
  // Add props here
}`;
    }
    
    const propDefinitions = propNames.map(prop => `  ${prop}?: any; // TODO: Define proper type`).join('\n');
    
    return `interface ${interfaceName} {
${propDefinitions}
}`;
  }

  private generateTestTemplate(module: GeneratedModule): string {
    const testName = module.name;
    const fileName = module.file_path.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || module.name;
    
    switch (module.type) {
      case 'component':
        return `import { render, screen } from '@testing-library/react';
import ${testName} from './${fileName}';

describe('${testName}', () => {
  it('renders correctly', () => {
    render(<${testName} />);
    // Add specific assertions here
  });

  it('handles props correctly', () => {
    // Add prop testing here
  });
});`;

      case 'hook':
        return `import { renderHook } from '@testing-library/react';
import { ${testName} } from './${fileName}';

describe('${testName}', () => {
  it('returns expected values', () => {
    const { result } = renderHook(() => ${testName}());
    // Add assertions here
  });
});`;

      case 'utility':
        return `import { ${testName} } from './${fileName}';

describe('${testName}', () => {
  it('works correctly', () => {
    // Add test cases here
  });

  it('handles edge cases', () => {
    // Add edge case testing here
  });
});`;

      default:
        return `// Add tests for ${testName}`;
    }
  }

  private enhanceUsageExample(example: string, module: GeneratedModule): string {
    if (example && example.trim().length > 0) {
      return example;
    }
    
    // Generate basic usage example
    switch (module.type) {
      case 'component':
        return `import ${module.name} from './${module.name}';

function App() {
  return (
    <div>
      <${module.name} />
    </div>
  );
}`;

      case 'hook':
        return `import { ${module.name} } from './${module.name}';

function MyComponent() {
  const result = ${module.name}();
  
  return <div>{/* Use hook result */}</div>;
}`;

      case 'utility':
        return `import { ${module.name} } from './${module.name}';

// Usage example
const result = ${module.name}(/* parameters */);`;

      default:
        return `// Example usage of ${module.name}`;
    }
  }

  private enhanceIntegrationInstructions(
    instructions: string[],
    modules: GeneratedModule[],
    projectPath: string
  ): string[] {
    const enhanced = [...instructions];
    
    // Add module-specific instructions
    modules.forEach(module => {
      if (module.dependencies.length > 0) {
        enhanced.push(`Install dependencies for ${module.name}: ${module.dependencies.join(', ')}`);
      }
      
      enhanced.push(`Place ${module.name} in ${module.file_path}`);
      
      if (module.type === 'component') {
        enhanced.push(`Export ${module.name} from your main components index`);
      }
    });
    
    // Add general integration steps
    enhanced.push('Update your main application to import and use the new modules');
    enhanced.push('Run tests to ensure everything works correctly');
    enhanced.push('Update documentation to include the new modules');
    
    return enhanced;
  }

  private enhanceTestingSuggestions(
    suggestions: string[],
    modules: GeneratedModule[],
    frameworks: string[]
  ): string[] {
    const enhanced = [...suggestions];
    
    // Add framework-specific testing suggestions
    if (frameworks.includes('react')) {
      enhanced.push('Use React Testing Library for component tests');
      enhanced.push('Test component props and state changes');
      enhanced.push('Test user interactions with fireEvent or userEvent');
    }
    
    // Add module-specific suggestions
    modules.forEach(module => {
      switch (module.type) {
        case 'component':
          enhanced.push(`Test ${module.name} rendering with different props`);
          enhanced.push(`Test ${module.name} accessibility with screen readers`);
          break;
        case 'hook':
          enhanced.push(`Test ${module.name} with different input values`);
          enhanced.push(`Test ${module.name} cleanup and effects`);
          break;
        case 'utility':
          enhanced.push(`Test ${module.name} with edge cases and error conditions`);
          enhanced.push(`Test ${module.name} performance with large inputs`);
          break;
      }
    });
    
    enhanced.push('Add integration tests for module interactions');
    enhanced.push('Set up continuous integration for automated testing');
    
    return enhanced;
  }

  private async generateModuleFiles(
    result: ModuleGenerationResult,
    projectPath: string,
    outputDirectory: string
  ): Promise<void> {
    try {
      await this.logger.info('generator', 'Starting automatic file generation', {
        module_count: result.generated_modules.length,
        output_directory: outputDirectory
      });

      for (const module of result.generated_modules) {
        await this.generateModuleFile(module, outputDirectory);
      }

      // Generate index file if multiple modules
      if (result.generated_modules.length > 1) {
        await this.generateIndexFile(result.generated_modules, outputDirectory);
      }

    } catch (error) {
      await this.logger.error('generator', 'Failed to generate module files', {
        output_directory: outputDirectory,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async generateModuleFile(module: GeneratedModule, outputDirectory: string): Promise<void> {
    try {
      const fileName = `${module.name}.${module.file_path.endsWith('.tsx') ? 'tsx' : 'ts'}`;
      const filePath = path.join(outputDirectory, fileName);
      
      // Ensure output directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      
      // Write module file
      await fs.writeFile(filePath, module.code, 'utf-8');
      
      // Write test file if provided
      if (module.tests) {
        const testFileName = `${module.name}.test.${fileName.split('.').pop()}`;
        const testFilePath = path.join(outputDirectory, testFileName);
        await fs.writeFile(testFilePath, module.tests, 'utf-8');
      }

      await this.logger.info('generator', `Generated module file: ${fileName}`, {
        module_name: module.name,
        file_path: filePath,
        has_tests: !!module.tests
      });

    } catch (error) {
      await this.logger.error('generator', `Failed to generate file for module: ${module.name}`, {
        module_name: module.name,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async generateIndexFile(modules: GeneratedModule[], outputDirectory: string): Promise<void> {
    try {
      const exports = modules.map(module => {
        const fileName = module.name;
        return `export { default as ${module.name} } from './${fileName}';`;
      }).join('\n');

      const indexContent = `// Auto-generated index file
${exports}
`;

      const indexPath = path.join(outputDirectory, 'index.ts');
      await fs.writeFile(indexPath, indexContent, 'utf-8');

      await this.logger.info('generator', 'Generated index file', {
        file_path: indexPath,
        exports_count: modules.length
      });

    } catch (error) {
      await this.logger.error('generator', 'Failed to generate index file', {
        output_directory: outputDirectory,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async storeGenerationInsights(
    projectId: string,
    result: ModuleGenerationResult,
    moduleRequest: string
  ): Promise<void> {
    try {
      // Store successful generation
      if (result.generated_modules.length > 0) {
        await this.memoryManager.storeSuccess(
          projectId,
          'Module Generation',
          `Generated ${result.generated_modules.length} modules from request: ${moduleRequest}`,
          {
            modules_count: result.generated_modules.length,
            module_types: result.generated_modules.map(m => m.type),
            request: moduleRequest,
            integration_steps: result.integration_instructions.length
          },
          7
        );
      }

      // Store patterns found in generated code
      const moduleTypes = [...new Set(result.generated_modules.map(m => m.type))];
      for (const type of moduleTypes) {
        const modulesOfType = result.generated_modules.filter(m => m.type === type);
        const examples = modulesOfType.slice(0, 3).map(m => m.name);
        
        await this.memoryManager.storePattern(
          projectId,
          `${type} generation pattern`,
          examples,
          modulesOfType.length,
          6
        );
      }

      // Store insights about generated module complexity
      const avgDependencies = result.generated_modules
        .reduce((sum, m) => sum + m.dependencies.length, 0) / result.generated_modules.length;

      await this.memoryManager.storeInsight(
        projectId,
        `Generated modules with average ${avgDependencies.toFixed(1)} dependencies each`,
        {
          total_modules: result.generated_modules.length,
          avg_dependencies: avgDependencies,
          total_integration_steps: result.integration_instructions.length,
          module_types: moduleTypes
        },
        6
      );

    } catch (error) {
      await this.logger.warn('generator', 'Failed to store generation insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Get generator capabilities
  getCapabilities(): Record<string, any> {
    return {
      supported_module_types: [
        'React Components',
        'React Hooks',
        'Utility Functions',
        'Service Classes',
        'Type Definitions',
        'Constants',
        'Contexts',
        'Higher-Order Components'
      ],
      supported_frameworks: [
        'React',
        'Vue.js',
        'Svelte',
        'Angular',
        'TypeScript',
        'JavaScript'
      ],
      generated_files: [
        'Component/Hook/Utility files',
        'TypeScript interfaces',
        'Unit test files',
        'Usage documentation',
        'Index files for exports'
      ],
      code_features: [
        'TypeScript support',
        'JSDoc comments',
        'Error handling',
        'Performance optimizations',
        'Accessibility features',
        'Test templates',
        'Usage examples'
      ],
      quality_checks: [
        'Naming convention compliance',
        'Dependency optimization',
        'Code pattern consistency',
        'Documentation completeness',
        'Test coverage templates'
      ]
    };
  }
}