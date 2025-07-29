import { EnhancementResult, Task } from '../../types';
import { AIClient } from '../engines/AIClient';
import { Logger } from '../logger/logger';
import { MemoryManager } from '../memory/memoryManager';
export declare class ImproverAgent {
    private aiClient;
    private logger;
    private memoryManager;
    constructor(aiClient: AIClient, logger: Logger, memoryManager: MemoryManager);
    improve(task: Task): Promise<EnhancementResult>;
    private gatherProjectInsights;
    private analyzeComponentsForUX;
    private analyzeComponentFile;
    private generateAIEnhancements;
    private performLocalUXAnalysis;
    private generateAccessibilityFix;
    private generatePerformanceFix;
    private generateDesignSystemCode;
    private createFallbackEnhancements;
    private mergeEnhancements;
    private createImplementationPlan;
    private extractDependencies;
    private calculateUXScore;
    private storeImprovementInsights;
}
//# sourceMappingURL=improver.d.ts.map