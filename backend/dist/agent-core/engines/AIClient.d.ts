import { AIRequest, AIResponse, AIEngine } from '../../types';
import { Logger } from '../logger/logger';
export declare class AIClient {
    private anthropic;
    private logger;
    private requestCount;
    private totalTokensUsed;
    private totalCost;
    private readonly CLAUDE_PRICING;
    constructor(logger: Logger);
    generateResponse(request: AIRequest, aiEngine?: AIEngine): Promise<AIResponse>;
    private callClaude;
    private selectClaudeModel;
    private buildClaudePrompt;
    private getDefaultSystemPrompt;
    private calculateConfidenceScore;
    static getScannerPrompt(filePaths: string[], projectContext?: string): AIRequest;
    static getImproverPrompt(scanResults: any, targetComponent?: string): AIRequest;
    static getGeneratorPrompt(moduleRequest: string, existingPatterns?: string[], frameworks?: string[]): AIRequest;
    getUsageStats(): {
        requestCount: number;
        totalTokensUsed: number;
        totalCost: number;
        averageTokensPerRequest: number;
        averageCostPerRequest: number;
    };
    resetStats(): void;
}
//# sourceMappingURL=AIClient.d.ts.map