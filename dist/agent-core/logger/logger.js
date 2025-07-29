"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const chalk_1 = __importDefault(require("chalk"));
const uuid_1 = require("uuid");
class Logger {
    constructor() {
        this.projectId = null;
        this.taskId = null;
        // Initialize Supabase client
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!supabaseUrl || !supabaseKey) {
            throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
        }
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
        this.logbookPath = path_1.default.join(process.cwd(), 'agent-core', 'logger', 'logs', 'logbook.md');
        // Ensure logs directory exists
        this.initializeLogDirectory();
    }
    async initializeLogDirectory() {
        try {
            const logsDir = path_1.default.dirname(this.logbookPath);
            await fs_1.promises.mkdir(logsDir, { recursive: true });
            // Initialize logbook.md if it doesn't exist
            try {
                await fs_1.promises.access(this.logbookPath);
            }
            catch {
                const initialContent = `# Claude Agent System - Logbook

## Overview
This logbook tracks all activities of the autonomous agent system. Each session and task is recorded with detailed information about operations, decisions, and outcomes.

---

## Session Log

`;
                await fs_1.promises.writeFile(this.logbookPath, initialContent);
            }
        }
        catch (error) {
            console.error('Failed to initialize log directory:', error);
        }
    }
    setContext(projectId, taskId) {
        this.projectId = projectId || null;
        this.taskId = taskId || null;
    }
    async log(level, agentType, data) {
        const logEntry = {
            id: (0, uuid_1.v4)(),
            timestamp: new Date().toISOString(),
            level,
            agent_type: agentType,
            task_id: this.taskId || undefined,
            project_id: this.projectId || undefined,
            message: data.message,
            data: data.data,
            error_stack: data.error_stack
        };
        // Log to console with colors
        this.logToConsole(logEntry);
        // Log to local markdown file
        await this.logToFile(logEntry);
        // Log to Supabase
        await this.logToSupabase(logEntry);
    }
    logToConsole(entry) {
        const timestamp = new Date(entry.timestamp).toLocaleTimeString();
        const agentColor = this.getAgentColor(entry.agent_type);
        const levelColor = this.getLevelColor(entry.level);
        const prefix = `${chalk_1.default.gray(timestamp)} ${agentColor(`[${entry.agent_type.toUpperCase()}]`)} ${levelColor(entry.level.toUpperCase())}`;
        console.log(`${prefix} ${entry.message}`);
        if (entry.data && Object.keys(entry.data).length > 0) {
            console.log(chalk_1.default.gray('  Data:'), JSON.stringify(entry.data, null, 2));
        }
        if (entry.error_stack) {
            console.log(chalk_1.default.red('  Stack:'), entry.error_stack);
        }
    }
    async logToFile(entry) {
        try {
            const timestamp = new Date(entry.timestamp).toLocaleString();
            const taskInfo = entry.task_id ? ` (Task: ${entry.task_id.slice(0, 8)})` : '';
            const projectInfo = entry.project_id ? ` (Project: ${entry.project_id.slice(0, 8)})` : '';
            let logLine = `### ${timestamp} - ${entry.level.toUpperCase()} - ${entry.agent_type.toUpperCase()}${taskInfo}${projectInfo}\n\n`;
            logLine += `**Message:** ${entry.message}\n\n`;
            if (entry.data && Object.keys(entry.data).length > 0) {
                logLine += `**Data:**\n\`\`\`json\n${JSON.stringify(entry.data, null, 2)}\n\`\`\`\n\n`;
            }
            if (entry.error_stack) {
                logLine += `**Error Stack:**\n\`\`\`\n${entry.error_stack}\n\`\`\`\n\n`;
            }
            logLine += '---\n\n';
            await fs_1.promises.appendFile(this.logbookPath, logLine);
        }
        catch (error) {
            console.error('Failed to write to logbook:', error);
        }
    }
    async logToSupabase(entry) {
        try {
            const { error } = await this.supabase
                .from('logs')
                .insert([entry]);
            if (error) {
                console.error('Failed to log to Supabase:', error);
                // Continue execution - don't fail completely if logging fails
            }
        }
        catch (error) {
            console.error('Supabase logging error:', error);
        }
    }
    getAgentColor(agentType) {
        switch (agentType) {
            case 'orchestrator': return chalk_1.default.blue;
            case 'scanner': return chalk_1.default.green;
            case 'improver': return chalk_1.default.yellow;
            case 'generator': return chalk_1.default.magenta;
            default: return chalk_1.default.white;
        }
    }
    getLevelColor(level) {
        switch (level) {
            case 'debug': return chalk_1.default.gray;
            case 'info': return chalk_1.default.cyan;
            case 'warn': return chalk_1.default.yellow;
            case 'error': return chalk_1.default.red;
            case 'critical': return chalk_1.default.bgRed.white;
            default: return chalk_1.default.white;
        }
    }
    // Utility methods for different log levels
    async debug(agentType, message, data) {
        await this.log('debug', agentType, { message, data });
    }
    async info(agentType, message, data) {
        await this.log('info', agentType, { message, data });
    }
    async warn(agentType, message, data) {
        await this.log('warn', agentType, { message, data });
    }
    async error(agentType, message, data, error) {
        await this.log('error', agentType, {
            message,
            data,
            error_stack: error?.stack
        });
    }
    async critical(agentType, message, data, error) {
        await this.log('critical', agentType, {
            message,
            data,
            error_stack: error?.stack
        });
    }
    // Session management
    async startSession(projectName) {
        const sessionHeader = `\n\n## New Session Started - ${new Date().toLocaleString()}\n**Project:** ${projectName}\n**Session ID:** ${(0, uuid_1.v4)()}\n\n`;
        try {
            await fs_1.promises.appendFile(this.logbookPath, sessionHeader);
            await this.info('orchestrator', `Started new session for project: ${projectName}`, {
                project_name: projectName,
                session_start: new Date().toISOString()
            });
        }
        catch (error) {
            console.error('Failed to start session logging:', error);
        }
    }
    async endSession(summary) {
        const sessionFooter = `\n**Session Summary:** ${summary || 'Session completed'}\n**Ended:** ${new Date().toLocaleString()}\n\n`;
        try {
            await fs_1.promises.appendFile(this.logbookPath, sessionFooter);
            await this.info('orchestrator', 'Session ended', {
                session_end: new Date().toISOString(),
                summary
            });
        }
        catch (error) {
            console.error('Failed to end session logging:', error);
        }
    }
    // Query methods for retrieving logs
    async getRecentLogs(limit = 50, projectId) {
        try {
            let query = this.supabase
                .from('logs')
                .select('*')
                .order('timestamp', { ascending: false })
                .limit(limit);
            if (projectId) {
                query = query.eq('project_id', projectId);
            }
            const { data, error } = await query;
            if (error) {
                console.error('Failed to retrieve logs from Supabase:', error);
                return [];
            }
            return data || [];
        }
        catch (error) {
            console.error('Error retrieving logs:', error);
            return [];
        }
    }
    async getLogsByTask(taskId) {
        try {
            const { data, error } = await this.supabase
                .from('logs')
                .select('*')
                .eq('task_id', taskId)
                .order('timestamp', { ascending: true });
            if (error) {
                console.error('Failed to retrieve task logs from Supabase:', error);
                return [];
            }
            return data || [];
        }
        catch (error) {
            console.error('Error retrieving task logs:', error);
            return [];
        }
    }
    async getLogsByLevel(level, projectId, limit = 100) {
        try {
            let query = this.supabase
                .from('logs')
                .select('*')
                .eq('level', level)
                .order('timestamp', { ascending: false })
                .limit(limit);
            if (projectId) {
                query = query.eq('project_id', projectId);
            }
            const { data, error } = await query;
            if (error) {
                console.error('Failed to retrieve level logs from Supabase:', error);
                return [];
            }
            return data || [];
        }
        catch (error) {
            console.error('Error retrieving level logs:', error);
            return [];
        }
    }
    // Performance logging
    async logPerformanceMetric(metricType, value, unit, context) {
        if (!this.projectId) {
            console.warn('Cannot log performance metric without project context');
            return;
        }
        try {
            const { error } = await this.supabase
                .from('performance_metrics')
                .insert([{
                    project_id: this.projectId,
                    metric_type: metricType,
                    value,
                    unit,
                    context: context || {}
                }]);
            if (error) {
                console.error('Failed to log performance metric:', error);
            }
            await this.debug('orchestrator', `Performance metric logged: ${metricType}`, {
                metric_type: metricType,
                value,
                unit,
                context
            });
        }
        catch (error) {
            console.error('Error logging performance metric:', error);
        }
    }
    // Cleanup old logs (retention management)
    async cleanupOldLogs(retentionDays = 30) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const { error } = await this.supabase
                .from('logs')
                .delete()
                .lt('timestamp', cutoffDate.toISOString());
            if (error) {
                console.error('Failed to cleanup old logs:', error);
            }
            else {
                await this.info('orchestrator', `Cleaned up logs older than ${retentionDays} days`, {
                    cutoff_date: cutoffDate.toISOString(),
                    retention_days: retentionDays
                });
            }
        }
        catch (error) {
            console.error('Error during log cleanup:', error);
        }
    }
}
exports.Logger = Logger;
//# sourceMappingURL=logger.js.map