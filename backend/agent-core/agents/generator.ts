import { promises as fs } from 'fs';
import path from 'path';
import { ModuleGenerationResult, Task, GeneratedModule, ScanResult, EnhancementResult } from '../../types';
import { AIClient } from '../engines/AIClient';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';

export class GeneratorAgent {
  private aiClient: AIClient;
  private logger: Logger;
  private memoryManager: MemoryManager;

  constructor(aiClient: AIClient, logger: Logger, memoryManager: MemoryManager) {
    this.aiClient = aiClient;
    this.logger = logger;
    this.memoryManager = memoryManager;
  }

  async generate(task: Task): Promise<ModuleGenerationResult> {
    await this.logger.info('generator', `Starting module generation for task: ${task.id}`);
    
    const moduleRequest = task.input_data.module_request;
    const scanResults = task.input_data.scan_results as ScanResult;
    const enhancementResults = task.input_data.enhancement_results as EnhancementResult;
    const projectPath = task.input_data.project_path || process.cwd();

    try {
      // 1. Validate generation request
      if (!moduleRequest) {
        throw new Error('No module generation request provided');
      }

      // 2. Analyze existing codebase patterns
      const existingPatterns = await this.analyzeExistingPatterns(scanResults, projectPath);
      
      // 3. Get project frameworks and preferences
      const projectContext = await this.gatherProjectContext(task.project_id, scanResults);
      
      // 4. Generate AI-powered modules
      const aiGeneration = await this.generateAIModules(
        moduleRequest,
        existingPatterns,
        projectContext.frameworks,
        projectContext
      );
      
      // 5. Enhance with local analysis
      const enhancedModules = await this.enhanceGeneratedModules(
        aiGeneration.generated_modules || [],
        existingPatterns,
        projectPath
      );
      
      // 6. Generate integration instructions
      const integrationInstructions = this.createIntegrationInstructions(
        enhancedModules,
        existingPatterns,
        projectPath
      );
      
      // 7. Generate testing suggestions
      const testingSuggestions = this.createTestingSuggestions(enhancedModules, existingPatterns);
      
      // 8. Store generation insights
      await this.storeGenerationInsights(task.project_id, enhancedModules, moduleRequest);

      const generationResult: ModuleGenerationResult = {
        generated_modules: enhancedModules,
        integration_instructions: integrationInstructions,
        testing_suggestions: testingSuggestions
      };

      await this.logger.info('generator', `Module generation completed successfully`, {
        modules_generated: enhancedModules.length,
        integration_steps: integrationInstructions.length,
        testing_suggestions: testingSuggestions.length
      });

      return generationResult;

    } catch (error) {
      await this.logger.error('generator', 'Module generation failed', {
        project_path: projectPath,
        module_request: moduleRequest,
        error: error instanceof Error ? error.message : String(error)
      }, error as Error);
      
      throw new Error(`Generator analysis failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async analyzeExistingPatterns(scanResults: ScanResult | undefined, projectPath: string): Promise<any> {
    const patterns = {
      frameworks: [] as string[],
      component_patterns: [] as string[],
      service_patterns: [] as string[],
      utility_patterns: [] as string[],
      styling_approach: 'unknown',
      state_management: 'unknown',
      testing_framework: 'unknown',
      naming_conventions: {} as Record<string, string[]>,
      folder_structure: {} as Record<string, string[]>
    };

    try {
      // Extract patterns from scan results
      if (scanResults) {
        patterns.frameworks = scanResults.structure_analysis.architecture_patterns || [];
        
        // Analyze file details for patterns
        const fileDetails = (scanResults as any).file_details || [];
        
        // Component patterns
        const componentFiles = fileDetails.filter((f: any) => f.type === 'component');
        if (componentFiles.length > 0) {
          patterns.component_patterns = this.extractComponentPatterns(componentFiles);
        }
        
        // Service patterns
        const serviceFiles = fileDetails.filter((f: any) => f.type === 'service');
        if (serviceFiles.length > 0) {
          patterns.service_patterns = this.extractServicePatterns(serviceFiles);
        }
        
        // Utility patterns
        const utilityFiles = fileDetails.filter((f: any) => f.type === 'utility');
        if (utilityFiles.length > 0) {
          patterns.utility_patterns = this.extractUtilityPatterns(utilityFiles);
        }
        
        // Analyze naming conventions
        patterns.naming_conventions = this.analyzeNamingConventions(fileDetails);
        
        // Analyze folder structure
        patterns.folder_structure = this.analyzeFolderStructure(fileDetails);
      }

      // Detect styling approach by checking for common files
      patterns.styling_approach = await this.detectStylingApproach(projectPath);
      
      // Detect state management approach
      patterns.state_management = await this.detectStateManagement(projectPath);
      
      // Detect testing framework
      patterns.testing_framework = await this.detectTestingFramework(projectPath);

      return patterns;
    } catch (error) {
      await this.logger.warn('generator', 'Failed to analyze existing patterns', {
        error: error instanceof Error ? error.message : String(error)
      });
      return patterns;
    }
  }

  private extractComponentPatterns(componentFiles: any[]): string[] {
    const patterns: string[] = [];
    
    // Analyze component file names and paths
    const hasHooks = componentFiles.some(f => f.path.includes('hook') || f.path.includes('use'));
    const hasPages = componentFiles.some(f => f.path.includes('page') || f.path.includes('screen'));
    const hasLayouts = componentFiles.some(f => f.path.includes('layout'));
    const hasCommon = componentFiles.some(f => f.path.includes('common') || f.path.includes('shared'));
    
    if (hasHooks) patterns.push('Custom Hooks');
    if (hasPages) patterns.push('Page Components');
    if (hasLayouts) patterns.push('Layout Components');
    if (hasCommon) patterns.push('Shared Components');
    
    // Check for functional vs class components
    const hasFunctionalPattern = componentFiles.some(f => f.functions_count > f.components_count);
    if (hasFunctionalPattern) patterns.push('Functional Components');
    
    return patterns;
  }

  private extractServicePatterns(serviceFiles: any[]): string[] {
    const patterns: string[] = [];
    
    const hasAPI = serviceFiles.some(f => f.path.includes('api') || f.path.includes('service'));
    const hasUtils = serviceFiles.some(f => f.path.includes('util') || f.path.includes('helper'));
    const hasConfig = serviceFiles.some(f => f.path.includes('config'));
    
    if (hasAPI) patterns.push('API Services');
    if (hasUtils) patterns.push('Utility Services');
    if (hasConfig) patterns.push('Configuration Services');
    
    return patterns;
  }

  private extractUtilityPatterns(utilityFiles: any[]): string[] {
    const patterns: string[] = [];
    
    const hasHelpers = utilityFiles.some(f => f.path.includes('helper'));
    const hasConstants = utilityFiles.some(f => f.path.includes('constant'));
    const hasTypes = utilityFiles.some(f => f.path.includes('type') || f.path.includes('interface'));
    
    if (hasHelpers) patterns.push('Helper Functions');
    if (hasConstants) patterns.push('Constants');
    if (hasTypes) patterns.push('Type Definitions');
    
    return patterns;
  }

  private analyzeNamingConventions(fileDetails: any[]): Record<string, string[]> {
    const conventions = {
      components: [] as string[],
      files: [] as string[],
      folders: [] as string[]
    };

    // Analyze component naming
    const componentFiles = fileDetails.filter((f: any) => f.type === 'component');
    const componentNames = componentFiles.map(f => path.basename(f.path, path.extname(f.path)));
    
    if (componentNames.some(name => /^[A-Z]/.test(name))) {
      conventions.components.push('PascalCase');
    }
    if (componentNames.some(name => name.includes('-'))) {
      conventions.components.push('kebab-case');
    }
    if (componentNames.some(name => name.includes('_'))) {
      conventions.components.push('snake_case');
    }

    // Analyze file naming
    const fileNames = fileDetails.map(f => path.basename(f.path, path.extname(f.path)));
    if (fileNames.some(name => /^[a-z]/.test(name) && name.includes('.'))){
      conventions.files.push('camelCase with dots');
    }
    if (fileNames.some(name => name.includes('-'))) {
      conventions.files.push('kebab-case');
    }

    return conventions;
  }

  private analyzeFolderStructure(fileDetails: any[]): Record<string, string[]> {
    const structure = {
      patterns: [] as string[],
      common_folders: [] as string[]
    };

    const folders = [...new Set(fileDetails.map(f => path.dirname(f.path)))];
    
    // Common folder patterns
    const commonFolders = ['components', 'pages', 'services', 'utils', 'hooks', 'types', 'styles', 'assets'];
    structure.common_folders = commonFolders.filter(folder =>
      folders.some(f => f.includes(folder))
    );

    // Structure patterns
    if (folders.some(f => f.includes('src'))) {
      structure.patterns.push('src/ based structure');
    }
    if (folders.some(f => f.includes('app'))) {
      structure.patterns.push('app/ based structure');
    }
    if (folders.some(f => f.includes('feature') || f.includes('module'))) {
      structure.patterns.push('Feature-based organization');
    }

    return structure;
  }

  private async detectStylingApproach(projectPath: string): Promise<string> {
    try {
      // Check for common styling files and configurations
      const packageJsonPath = path.join(projectPath, 'package.json');
      let packageJson;
      
      try {
        const content = await fs.readFile(packageJsonPath, 'utf-8');
        packageJson = JSON.parse(content);
      } catch {
        return 'unknown';
      }

      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (dependencies['styled-components']) return 'styled-components';
      if (dependencies['@emotion/react'] || dependencies['@emotion/styled']) return 'emotion';
      if (dependencies['tailwindcss']) return 'tailwind';
      if (dependencies['sass'] || dependencies['node-sass']) return 'sass';
      if (dependencies['less']) return 'less';
      
      // Check for CSS modules
      const hasModuleCSS = await this.checkForFiles(projectPath, '**/*.module.css');
      if (hasModuleCSS) return 'css-modules';
      
      return 'css';
    } catch {
      return 'unknown';
    }
  }

  private async detectStateManagement(projectPath: string): Promise<string> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (dependencies['redux'] || dependencies['@reduxjs/toolkit']) return 'redux';
      if (dependencies['zustand']) return 'zustand';
      if (dependencies['recoil']) return 'recoil';
      if (dependencies['mobx']) return 'mobx';
      if (dependencies['jotai']) return 'jotai';
      
      return 'react-state'; // Default to React built-in state
    } catch {
      return 'unknown';
    }
  }

  private async detectTestingFramework(projectPath: string): Promise<string> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      if (dependencies['jest']) return 'jest';
      if (dependencies['vitest']) return 'vitest';
      if (dependencies['mocha']) return 'mocha';
      if (dependencies['@testing-library/react']) return 'testing-library';
      
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async checkForFiles(projectPath: string, pattern: string): Promise<boolean> {
    try {
      const { glob } = await import('glob');
      const matches = await glob(pattern, { cwd: projectPath });
      return matches.length > 0;
    } catch {
      return false;
    }
  }

  private async gatherProjectContext(projectId: string, scanResults?: ScanResult): Promise<any> {
    try {
      // Get relevant memories and preferences
      const [patterns, preferences, successes] = await Promise.all([
        this.memoryManager.getPatterns(projectId, 5),
        this.memoryManager.getPreferences(projectId),
        this.memoryManager.getSuccesses(projectId, 3)
      ]);

      const context = {
        frameworks: scanResults?.structure_analysis.architecture_patterns || [],
        patterns: patterns.map(p => p.content),
        preferences: preferences.map(p => p.content),
        successes: successes.map(s => s.content),
        project_info: scanResults ? {
          file_count: scanResults.structure_analysis.file_count,
          component_count: scanResults.structure_analysis.component_count,
          complexity_score: scanResults.structure_analysis.complexity_score
        } : {}
      };

      return context;
    } catch (error) {
      await this.logger.warn('generator', 'Failed to gather project context', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { frameworks: [], patterns: [], preferences: [], successes: [], project_info: {} };
    }
  }

  private async generateAIModules(
    moduleRequest: string,
    existingPatterns: any,
    frameworks: string[],
    projectContext: any
  ): Promise<any> {
    try {
      // Get AI generation using the specialized generator prompt
      const aiRequest = AIClient.getGeneratorPrompt(moduleRequest, existingPatterns.component_patterns, frameworks);
      const aiResponse = await this.aiClient.generateResponse(aiRequest);
      
      // Parse the JSON response
      let generation;
      try {
        generation = JSON.parse(aiResponse.content);
      } catch (parseError) {
        await this.logger.warn('generator', 'Failed to parse AI response as JSON, using fallback', {
          response_content: aiResponse.content.substring(0, 500)
        });
        
        // Fallback generation
        generation = this.createFallbackGeneration(moduleRequest, existingPatterns);
      }

      return generation;
    } catch (error) {
      await this.logger.error('generator', 'AI module generation failed, using fallback', {
        error: error instanceof Error ? error.message : String(error)
      });
      
      return this.createFallbackGeneration(moduleRequest, existingPatterns);
    }
  }

  private createFallbackGeneration(moduleRequest: string, existingPatterns: any): any {
    const modules: GeneratedModule[] = [];
    
    // Parse request to determine module type
    const isComponent = moduleRequest.toLowerCase().includes('component') || 
                       moduleRequest.toLowerCase().includes('ui') ||
                       moduleRequest.toLowerCase().includes('button') ||
                       moduleRequest.toLowerCase().includes('form');
    
    const isService = moduleRequest.toLowerCase().includes('service') ||
                     moduleRequest.toLowerCase().includes('api') ||
                     moduleRequest.toLowerCase().includes('client');
    
    const isUtility = moduleRequest.toLowerCase().includes('utility') ||
                     moduleRequest.toLowerCase().includes('helper') ||
                     moduleRequest.toLowerCase().includes('utils');

    if (isComponent) {
      modules.push(this.generateBasicComponent(moduleRequest, existingPatterns));
    } else if (isService) {
      modules.push(this.generateBasicService(moduleRequest, existingPatterns));
    } else if (isUtility) {
      modules.push(this.generateBasicUtility(moduleRequest, existingPatterns));
    } else {
      // Default to component
      modules.push(this.generateBasicComponent(moduleRequest, existingPatterns));
    }

    return {
      generated_modules: modules,
      integration_instructions: [`Import and use the generated ${modules[0].type}`],
      testing_suggestions: [`Write unit tests for ${modules[0].name}`]
    };
  }

  private generateBasicComponent(request: string, patterns: any): GeneratedModule {
    const componentName = this.extractComponentName(request) || 'CustomComponent';
    const usesTypeScript = patterns.frameworks.includes('TypeScript');
    const extension = usesTypeScript ? 'tsx' : 'jsx';
    
    const code = `import React${usesTypeScript ? ', { FC }' : ''} from 'react';
${usesTypeScript ? `
interface ${componentName}Props {
  className?: string;
  children?: React.ReactNode;
}
` : ''}
${usesTypeScript ? `const ${componentName}: FC<${componentName}Props> = ({ className, children, ...props })` : `const ${componentName} = ({ className, children, ...props })`} => {
  return (
    <div className={\`${componentName.toLowerCase()}\${className ? \` \${className}\` : ''}\`} {...props}>
      {children || 'Generated ${componentName}'}
    </div>
  );
};

export default ${componentName};`;

    return {
      name: componentName,
      type: 'component',
      file_path: `src/components/${componentName}.${extension}`,
      code,
      dependencies: ['react'],
      props_interface: usesTypeScript ? `${componentName}Props` : undefined,
      usage_example: `<${componentName} className="custom-class">Content</${componentName}>`,
      tests: this.generateComponentTest(componentName, usesTypeScript)
    };
  }

  private generateBasicService(request: string, patterns: any): GeneratedModule {
    const serviceName = this.extractServiceName(request) || 'CustomService';
    const usesTypeScript = patterns.frameworks.includes('TypeScript');
    const extension = usesTypeScript ? 'ts' : 'js';
    
    const code = `${usesTypeScript ? `
interface ${serviceName}Config {
  baseUrl?: string;
  timeout?: number;
}

interface ${serviceName}Response<T = any> {
  data: T;
  status: number;
  message?: string;
}
` : ''}
class ${serviceName} {
  ${usesTypeScript ? 'private ' : ''}config${usesTypeScript ? ': ' + serviceName + 'Config' : ''};

  constructor(config${usesTypeScript ? ': ' + serviceName + 'Config' : ''} = {}) {
    this.config = {
      baseUrl: '/api',
      timeout: 5000,
      ...config
    };
  }

  async getData(endpoint${usesTypeScript ? ': string' : ''})${usesTypeScript ? ': Promise<' + serviceName + 'Response>' : ''} {
    try {
      const response = await fetch(\`\${this.config.baseUrl}\${endpoint}\`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(\`HTTP error! status: \${response.status}\`);
      }

      const data = await response.json();
      return {
        data,
        status: response.status,
        message: 'Success'
      };
    } catch (error) {
      throw new Error(\`${serviceName} error: \${error${usesTypeScript ? ' instanceof Error ? error.message : String(error)' : ''}}\`);
    }
  }
}

export default ${serviceName};
export { ${serviceName} };`;

    return {
      name: serviceName,
      type: 'service',
      file_path: `src/services/${serviceName}.${extension}`,
      code,
      dependencies: [],
      usage_example: `const service = new ${serviceName}();\nconst data = await service.getData('/endpoint');`,
      tests: this.generateServiceTest(serviceName, usesTypeScript)
    };
  }

  private generateBasicUtility(request: string, patterns: any): GeneratedModule {
    const utilityName = this.extractUtilityName(request) || 'customUtility';
    const usesTypeScript = patterns.frameworks.includes('TypeScript');
    const extension = usesTypeScript ? 'ts' : 'js';
    
    const code = `/**
 * ${utilityName} - Generated utility function
 * ${request}
 */

${usesTypeScript ? `
export interface ${utilityName}Options {
  [key: string]: any;
}
` : ''}
export const ${utilityName} = (input${usesTypeScript ? ': any' : ''}, options${usesTypeScript ? ': ' + utilityName + 'Options' : ''} = {})${usesTypeScript ? ': any' : ''} => {
  // TODO: Implement ${utilityName} logic based on requirements
  console.log('${utilityName} called with:', input, options);
  
  return input;
};

// Helper function
export const validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)} = (value${usesTypeScript ? ': any' : ''})${usesTypeScript ? ': boolean' : ''} => {
  // TODO: Add validation logic
  return value != null;
};

export default {
  ${utilityName},
  validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)}
};`;

    return {
      name: utilityName,
      type: 'utility',
      file_path: `src/utils/${utilityName}.${extension}`,
      code,
      dependencies: [],
      usage_example: `import { ${utilityName} } from './utils/${utilityName}';\nconst result = ${utilityName}(data, options);`,
      tests: this.generateUtilityTest(utilityName, usesTypeScript)
    };
  }

  private extractComponentName(request: string): string {
    // Extract component name from request
    const words = request.split(/\s+/);
    const componentWords = words.filter(word => 
      word.length > 2 && 
      !['create', 'generate', 'build', 'make', 'component', 'for', 'the', 'a', 'an'].includes(word.toLowerCase())
    );
    
    if (componentWords.length > 0) {
      return componentWords.map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join('');
    }
    
    return 'CustomComponent';
  }

  private extractServiceName(request: string): string {
    const words = request.split(/\s+/);
    const serviceWords = words.filter(word => 
      word.length > 2 && 
      !['create', 'generate', 'build', 'make', 'service', 'for', 'the', 'a', 'an'].includes(word.toLowerCase())
    );
    
    if (serviceWords.length > 0) {
      return serviceWords.map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join('') + 'Service';
    }
    
    return 'CustomService';
  }

  private extractUtilityName(request: string): string {
    const words = request.split(/\s+/);
    const utilityWords = words.filter(word => 
      word.length > 2 && 
      !['create', 'generate', 'build', 'make', 'utility', 'helper', 'for', 'the', 'a', 'an'].includes(word.toLowerCase())
    );
    
    if (utilityWords.length > 0) {
      const baseName = utilityWords.map((word, index) => 
        index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
      ).join('');
      return baseName;
    }
    
    return 'customUtility';
  }

  private generateComponentTest(componentName: string, usesTypeScript: boolean): string {
    const extension = usesTypeScript ? 'tsx' : 'jsx';
    
    return `import React from 'react';
import { render, screen } from '@testing-library/react';
import ${componentName} from './${componentName}';

describe('${componentName}', () => {
  it('renders without crashing', () => {
    render(<${componentName} />);
    expect(screen.getByText(/Generated ${componentName}/i)).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const customClass = 'test-class';
    render(<${componentName} className={customClass} />);
    const element = screen.getByText(/Generated ${componentName}/i);
    expect(element).toHaveClass(customClass);
  });

  it('renders children when provided', () => {
    const childText = 'Custom child content';
    render(<${componentName}>{childText}</${componentName}>);
    expect(screen.getByText(childText)).toBeInTheDocument();
  });
});`;
  }

  private generateServiceTest(serviceName: string, usesTypeScript: boolean): string {
    return `import ${serviceName} from './${serviceName}';

// Mock fetch
global.fetch = jest.fn();

describe('${serviceName}', () => {
  let service${usesTypeScript ? ': ' + serviceName : ''};

  beforeEach(() => {
    service = new ${serviceName}();
    (fetch as jest.MockedFunction<typeof fetch>).mockClear();
  });

  it('creates instance with default config', () => {
    expect(service).toBeInstanceOf(${serviceName});
  });

  it('fetches data successfully', async () => {
    const mockData = { id: 1, name: 'Test' };
    (fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockData,
    } as Response);

    const result = await service.getData('/test');
    
    expect(result.status).toBe(200);
    expect(result.data).toEqual(mockData);
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.any(Object));
  });

  it('handles fetch errors', async () => {
    (fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(new Error('Network error'));

    await expect(service.getData('/test')).rejects.toThrow('${serviceName} error');
  });
});`;
  }

  private generateUtilityTest(utilityName: string, usesTypeScript: boolean): string {
    return `import { ${utilityName}, validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)} } from './${utilityName}';

describe('${utilityName}', () => {
  it('processes input correctly', () => {
    const testInput = 'test data';
    const result = ${utilityName}(testInput);
    
    expect(result).toBe(testInput);
  });

  it('accepts options parameter', () => {
    const testInput = 'test data';
    const options = { flag: true };
    
    expect(() => ${utilityName}(testInput, options)).not.toThrow();
  });
});

describe('validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)}', () => {
  it('validates truthy values', () => {
    expect(validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)}('test')).toBe(true);
    expect(validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)}(123)).toBe(true);
  });

  it('invalidates falsy values', () => {
    expect(validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)}(null)).toBe(false);
    expect(validate${utilityName.charAt(0).toUpperCase() + utilityName.slice(1)}(undefined)).toBe(false);
  });
});`;
  }

  private async enhanceGeneratedModules(
    modules: GeneratedModule[],
    existingPatterns: any,
    projectPath: string
  ): Promise<GeneratedModule[]> {
    const enhanced: GeneratedModule[] = [];

    for (const module of modules) {
      try {
        const enhancedModule = { ...module };

        // Apply consistent naming conventions
        if (existingPatterns.naming_conventions.components?.includes('PascalCase') && module.type === 'component') {
          enhancedModule.name = this.toPascalCase(module.name);
        }

        // Apply consistent styling approach
        if (existingPatterns.styling_approach !== 'unknown') {
          enhancedModule.code = this.applyStylingPattern(module.code, existingPatterns.styling_approach);
        }

        // Add consistent imports based on project patterns
        enhancedModule.code = this.addConsistentImports(module.code, existingPatterns);

        // Ensure proper file path based on folder structure
        enhancedModule.file_path = this.adjustFilePath(module.file_path, existingPatterns.folder_structure);

        enhanced.push(enhancedModule);
      } catch (error) {
        await this.logger.warn('generator', `Failed to enhance module: ${module.name}`, {
          error: error instanceof Error ? error.message : String(error)
        });
        enhanced.push(module); // Use original if enhancement fails
      }
    }

    return enhanced;
  }

  private toPascalCase(str: string): string {
    return str.replace(/(?:^|[-_\s])(\w)/g, (match, letter) => letter.toUpperCase());
  }

  private applyStylingPattern(code: string, stylingApproach: string): string {
    switch (stylingApproach) {
      case 'styled-components':
        if (code.includes('className=')) {
          return code.replace(
            /className={\`([^`]+)\`}/g,
            'styled.div`\n  /* Add styles here */\n`'
          );
        }
        break;
      
      case 'tailwind':
        if (code.includes('className=')) {
          return code.replace(
            /className={\`([^`]+)\`}/g,
            'className="flex items-center justify-center p-4 bg-white rounded-lg shadow"'
          );
        }
        break;
        
      case 'css-modules':
        return code.replace(
          /className={\`([^`]+)\`}/g,
          'className={styles.$1}'
        );
    }
    
    return code;
  }

  private addConsistentImports(code: string, patterns: any): string {
    let enhancedCode = code;

    // Add consistent React imports based on patterns
    if (patterns.frameworks.includes('React') && !code.includes('import React')) {
      enhancedCode = `import React from 'react';\n${enhancedCode}`;
    }

    return enhancedCode;
  }

  private adjustFilePath(filePath: string, folderStructure: any): string {
    // Adjust file path based on existing folder structure
    if (folderStructure.patterns?.includes('src/ based structure')) {
      if (!filePath.startsWith('src/')) {
        return `src/${filePath}`;
      }
    }

    return filePath;
  }

  private createIntegrationInstructions(
    modules: GeneratedModule[],
    patterns: any,
    projectPath: string
  ): string[] {
    const instructions: string[] = [];

    instructions.push('## Integration Instructions');
    instructions.push('');

    for (const module of modules) {
      instructions.push(`### ${module.name} (${module.type})`);
      instructions.push(`1. Save the generated code to: \`${module.file_path}\``);
      
      if (module.dependencies.length > 0) {
        instructions.push(`2. Install dependencies: \`npm install ${module.dependencies.join(' ')}\``);
      }
      
      instructions.push(`3. Import and use:`);
      instructions.push(`   \`\`\`${module.file_path.endsWith('.tsx') ? 'tsx' : module.file_path.endsWith('.ts') ? 'ts' : 'js'}`);
      instructions.push(`   ${module.usage_example}`);
      instructions.push(`   \`\`\``);
      
      if (module.props_interface) {
        instructions.push(`4. TypeScript interface: \`${module.props_interface}\``);
      }
      
      instructions.push('');
    }

    // Add general integration notes
    instructions.push('## General Notes');
    instructions.push('- Ensure all imports are correctly resolved');
    instructions.push('- Run type checking if using TypeScript');
    instructions.push('- Add appropriate styling to match your design system');
    instructions.push('- Consider adding error boundaries for React components');

    if (patterns.testing_framework !== 'unknown') {
      instructions.push(`- Run tests using your ${patterns.testing_framework} setup`);
    }

    return instructions;
  }

  private createTestingSuggestions(modules: GeneratedModule[], patterns: any): string[] {
    const suggestions: string[] = [];

    suggestions.push('## Testing Suggestions');
    suggestions.push('');

    for (const module of modules) {
      suggestions.push(`### ${module.name}`);
      
      switch (module.type) {
        case 'component':
          suggestions.push('- Test rendering without props');
          suggestions.push('- Test with different prop combinations');
          suggestions.push('- Test user interactions (clicks, inputs, etc.)');
          suggestions.push('- Test accessibility features');
          suggestions.push('- Test responsive behavior');
          break;
          
        case 'service':
          suggestions.push('- Mock external dependencies');
          suggestions.push('- Test successful API calls');
          suggestions.push('- Test error handling scenarios');
          suggestions.push('- Test different input parameters');
          suggestions.push('- Test timeout and retry logic');
          break;
          
        case 'utility':
          suggestions.push('- Test with various input types');
          suggestions.push('- Test edge cases (null, undefined, empty)');
          suggestions.push('- Test error conditions');
          suggestions.push('- Test performance with large datasets');
          break;
      }
      
      if (module.tests) {
        suggestions.push(`- Generated test file: \`${module.file_path.replace(/\.(tsx?|jsx?)$/, '.test.$1')}\``);
      }
      
      suggestions.push('');
    }

    // Add framework-specific suggestions
    if (patterns.testing_framework === 'jest') {
      suggestions.push('## Jest-specific suggestions');
      suggestions.push('- Use `describe` blocks to group related tests');
      suggestions.push('- Use `beforeEach` and `afterEach` for setup/cleanup');
      suggestions.push('- Mock external dependencies with `jest.mock()`');
    }

    if (patterns.frameworks.includes('React')) {
      suggestions.push('## React Testing suggestions');
      suggestions.push('- Use React Testing Library for component tests');
      suggestions.push('- Test user behavior, not implementation details');
      suggestions.push('- Use `screen.getByRole()` for accessibility-friendly queries');
    }

    return suggestions;
  }

  private async storeGenerationInsights(
    projectId: string,
    modules: GeneratedModule[],
    moduleRequest: string
  ): Promise<void> {
    try {
      // Store generation insights
      await this.memoryManager.storeInsight(
        projectId,
        `Module generation completed: ${modules.length} modules created`,
        {
          module_count: modules.length,
          module_types: [...new Set(modules.map(m => m.type))],
          original_request: moduleRequest,
          generated_modules: modules.map(m => ({ name: m.name, type: m.type, file_path: m.file_path }))
        },
        6
      );

      // Store successful generation patterns
      for (const module of modules) {
        await this.memoryManager.storeSuccess(
          projectId,
          `Generated ${module.type}: ${module.name}`,
          `Successfully created ${module.type} module based on request`,
          {
            module_type: module.type as any,
            dependencies_count: module.dependencies.length,
            has_tests: !!module.tests ? 1 : 0
          },
          5
        );
      }

      await this.logger.debug('generator', 'Generation insights stored in memory', {
        project_id: projectId,
        insights_stored: 1 + modules.length
      });

    } catch (error) {
      await this.logger.warn('generator', 'Failed to store generation insights', {
        project_id: projectId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}