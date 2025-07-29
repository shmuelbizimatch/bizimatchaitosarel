import { ScanResult, Task } from '../../types';
import { AIClient } from '../engines/AIClient';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
export declare class ScannerAgent {
    private aiClient;
    private logger;
    private memoryManager;
    constructor(aiClient: AIClient, logger: Logger, memoryManager: MemoryManager);
    scan(task: Task): Promise<ScanResult>;
    private discoverFiles;
    private analyzeFiles;
    private analyzeFile;
    private determineFileType;
    private determineLanguage;
    private countLinesOfCode;
    private extractImports;
    private extractExports;
    private extractFunctions;
    private extractComponents;
    private extractParameters;
    private extractProps;
    private extractHooks;
    private calculateComplexity;
    private calculateFunctionComplexity;
    private performAIAnalysis;
    private buildProjectContext;
    private summarizeFileTypes;
    private summarizeLanguages;
    private createFallbackAnalysis;
    private enhanceWithLocalAnalysis;
    private detectArchitecturePatterns;
    private extractDependencies;
    private detectLocalIssues;
    private identifyOpportunities;
    private calculateMaintainabilityIndex;
    private storeAnalysisInsights;
}
//# sourceMappingURL=scanner.d.ts.map