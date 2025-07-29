"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIClient = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
class AIClient {
    constructor(logger) {
        this.requestCount = 0;
        this.totalTokensUsed = 0;
        this.totalCost = 0;
        // Claude pricing (as of 2024) - tokens per $1
        this.CLAUDE_PRICING = {
            'claude-3-5-sonnet-20241022': {
                input: 1000000 / 3.00, // $3 per million input tokens
                output: 1000000 / 15.00 // $15 per million output tokens
            },
            'claude-3-haiku-20240307': {
                input: 1000000 / 0.25, // $0.25 per million input tokens
                output: 1000000 / 1.25 // $1.25 per million output tokens
            }
        };
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY environment variable is required');
        }
        this.anthropic = new sdk_1.default({
            apiKey: apiKey,
        });
        this.logger = logger;
    }
    async generateResponse(request, aiEngine = 'claude') {
        const startTime = Date.now();
        this.requestCount++;
        try {
            // For now, we only support Claude. Future engines can be added here
            if (aiEngine !== 'claude') {
                throw new Error(`AI Engine ${aiEngine} is not yet supported. Currently only 'claude' is available.`);
            }
            const response = await this.callClaude(request);
            this.totalTokensUsed += response.tokens_used;
            this.totalCost += response.cost_estimate;
            await this.logger.log('info', 'orchestrator', {
                message: `AI request completed successfully`,
                data: {
                    model: response.model,
                    tokens_used: response.tokens_used,
                    cost_estimate: response.cost_estimate,
                    response_time_ms: response.response_time_ms,
                    total_requests: this.requestCount,
                    total_tokens: this.totalTokensUsed,
                    total_cost: this.totalCost
                }
            });
            return response;
        }
        catch (error) {
            const responseTime = Date.now() - startTime;
            await this.logger.log('error', 'orchestrator', {
                message: `AI request failed`,
                data: {
                    ai_engine: aiEngine,
                    error: error instanceof Error ? error.message : String(error),
                    response_time_ms: responseTime
                },
                error_stack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }
    async callClaude(request) {
        const startTime = Date.now();
        // Choose model based on request complexity
        const model = this.selectClaudeModel(request);
        try {
            const systemPrompt = request.system_prompt || this.getDefaultSystemPrompt();
            const response = await this.anthropic.messages.create({
                model: model,
                max_tokens: request.max_tokens || 4000,
                temperature: request.temperature || 0.1,
                system: systemPrompt,
                messages: [
                    {
                        role: 'user',
                        content: this.buildClaudePrompt(request)
                    }
                ]
            });
            const responseTime = Date.now() - startTime;
            const inputTokens = response.usage.input_tokens;
            const outputTokens = response.usage.output_tokens;
            const totalTokens = inputTokens + outputTokens;
            // Calculate cost
            const pricing = this.CLAUDE_PRICING[model];
            const inputCost = inputTokens / pricing.input;
            const outputCost = outputTokens / pricing.output;
            const totalCost = inputCost + outputCost;
            // Extract content
            const content = response.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('\n');
            return {
                content,
                tokens_used: totalTokens,
                model,
                cost_estimate: totalCost,
                response_time_ms: responseTime,
                confidence_score: this.calculateConfidenceScore(content, request)
            };
        }
        catch (error) {
            const responseTime = Date.now() - startTime;
            if (error instanceof sdk_1.default.APIError) {
                // Handle specific Claude API errors
                if (error.status === 429) {
                    throw new Error(`Claude API rate limit exceeded. Please wait before retrying.`);
                }
                else if (error.status === 401) {
                    throw new Error(`Claude API authentication failed. Please check your API key.`);
                }
                else if (error.status === 400) {
                    throw new Error(`Claude API request invalid: ${error.message}`);
                }
            }
            throw new Error(`Claude API error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    selectClaudeModel(request) {
        // Use Haiku for simple requests, Sonnet for complex analysis
        const promptLength = (request.prompt + (request.context || '')).length;
        const hasComplexContext = request.context && request.context.length > 5000;
        const needsJsonResponse = request.response_format === 'json';
        if (promptLength > 10000 || hasComplexContext || needsJsonResponse) {
            return 'claude-3-5-sonnet-20241022'; // Most capable for complex tasks
        }
        else {
            return 'claude-3-haiku-20240307'; // Faster and cheaper for simple tasks
        }
    }
    buildClaudePrompt(request) {
        let prompt = '';
        if (request.context) {
            prompt += `## Context\n${request.context}\n\n`;
        }
        prompt += `## Task\n${request.prompt}`;
        if (request.response_format === 'json') {
            prompt += '\n\nPlease respond with valid JSON only. Do not include any explanatory text before or after the JSON.';
        }
        return prompt;
    }
    getDefaultSystemPrompt() {
        return `You are an autonomous AI agent specialized in code analysis, UX improvement, and module generation. You are part of a larger agent system that helps developers optimize their projects.

Key capabilities:
- Structural code analysis and architectural review
- UX/UI enhancement suggestions with modern design patterns
- Component and module generation with best practices
- Performance optimization recommendations
- Accessibility improvements

Guidelines:
- Provide specific, actionable suggestions
- Focus on modern web development best practices
- Consider performance, maintainability, and user experience
- Use TypeScript and React patterns when applicable
- Be concise but thorough in your analysis
- When generating code, ensure it's production-ready and well-documented

When asked to analyze code:
1. Understand the structure and purpose
2. Identify potential improvements
3. Suggest specific changes with reasoning
4. Consider impact on overall system architecture

When generating modules:
1. Follow established patterns in the codebase
2. Include proper TypeScript types
3. Add comprehensive documentation
4. Consider testing requirements
5. Ensure accessibility compliance`;
    }
    calculateConfidenceScore(content, request) {
        // Simple heuristic-based confidence scoring
        let score = 0.7; // Base confidence
        // Increase confidence for structured responses
        if (request.response_format === 'json') {
            try {
                JSON.parse(content);
                score += 0.2; // Valid JSON increases confidence
            }
            catch {
                score -= 0.3; // Invalid JSON decreases confidence significantly
            }
        }
        // Increase confidence for detailed responses
        if (content.length > 500) {
            score += 0.1;
        }
        // Decrease confidence for very short responses (might be incomplete)
        if (content.length < 100) {
            score -= 0.2;
        }
        // Ensure score stays within bounds
        return Math.max(0, Math.min(1, score));
    }
    // System optimization prompts for different agent types
    static getScannerPrompt(filePaths, projectContext) {
        return {
            prompt: `Analyze the following codebase structure and provide a comprehensive assessment:

Files to analyze: ${filePaths.join(', ')}

Please provide a JSON response with the following structure:
{
  "structure_analysis": {
    "file_count": number,
    "component_count": number,
    "complexity_score": number (1-10),
    "architecture_patterns": string[],
    "dependencies": [{"name": string, "version": string, "type": "production|development"}]
  },
  "issues": [
    {
      "type": "performance|accessibility|maintainability|security",
      "severity": "low|medium|high|critical",
      "file_path": string,
      "line_number": number,
      "description": string,
      "suggestion": string
    }
  ],
  "opportunities": [
    {
      "type": "ux_improvement|performance_optimization|feature_addition",
      "impact": "low|medium|high",
      "effort": "low|medium|high",
      "description": string,
      "implementation_suggestion": string
    }
  ],
  "metrics": {
    "lines_of_code": number,
    "cyclomatic_complexity": number,
    "maintainability_index": number
  }
}`,
            context: projectContext,
            system_prompt: `You are a senior software architect performing a comprehensive code analysis. Focus on identifying structural issues, optimization opportunities, and architectural improvements.`,
            response_format: 'json',
            max_tokens: 6000
        };
    }
    static getImproverPrompt(scanResults, targetComponent) {
        return {
            prompt: `Based on the following analysis results, suggest specific UX improvements:

${JSON.stringify(scanResults, null, 2)}

${targetComponent ? `Focus specifically on improving: ${targetComponent}` : ''}

Please provide a JSON response with the following structure:
{
  "improvements": [
    {
      "component_path": string,
      "enhancement_type": "visual|interactive|accessibility|performance",
      "description": string,
      "code_changes": [
        {
          "file_path": string,
          "change_type": "modify|add|delete",
          "original_code": string,
          "new_code": string,
          "line_number": number
        }
      ],
      "impact_assessment": {
        "user_experience": number (1-10),
        "performance_impact": number (-5 to +5),
        "maintainability": number (1-10),
        "implementation_effort": number (1-10)
      }
    }
  ],
  "ux_score_before": number (1-10),
  "ux_score_after": number (1-10),
  "implementation_plan": [
    {
      "order": number,
      "description": string,
      "estimated_time_minutes": number,
      "dependencies": string[]
    }
  ]
}`,
            system_prompt: `You are a UX specialist focused on improving user interfaces and interactions. Consider modern design patterns, accessibility standards, and performance optimizations.`,
            response_format: 'json',
            max_tokens: 8000
        };
    }
    static getGeneratorPrompt(moduleRequest, existingPatterns, frameworks) {
        return {
            prompt: `Generate new modules based on the following request:

Request: ${moduleRequest}

${existingPatterns ? `Existing patterns to follow: ${existingPatterns.join(', ')}` : ''}
${frameworks ? `Preferred frameworks: ${frameworks.join(', ')}` : ''}

Please provide a JSON response with the following structure:
{
  "generated_modules": [
    {
      "name": string,
      "type": "component|service|utility|hook",
      "file_path": string,
      "code": string,
      "dependencies": string[],
      "props_interface": string,
      "usage_example": string,
      "tests": string
    }
  ],
  "integration_instructions": string[],
  "testing_suggestions": string[]
}`,
            system_prompt: `You are a code generation specialist creating high-quality, production-ready modules. Follow modern development practices, include proper TypeScript types, and ensure accessibility compliance.`,
            response_format: 'json',
            max_tokens: 10000
        };
    }
    // Usage statistics
    getUsageStats() {
        return {
            requestCount: this.requestCount,
            totalTokensUsed: this.totalTokensUsed,
            totalCost: this.totalCost,
            averageTokensPerRequest: this.requestCount > 0 ? this.totalTokensUsed / this.requestCount : 0,
            averageCostPerRequest: this.requestCount > 0 ? this.totalCost / this.requestCount : 0
        };
    }
    // Reset statistics (useful for testing or new sessions)
    resetStats() {
        this.requestCount = 0;
        this.totalTokensUsed = 0;
        this.totalCost = 0;
    }
}
exports.AIClient = AIClient;
//# sourceMappingURL=AIClient.js.map