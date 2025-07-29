import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import { LogEntry, LogLevel, AgentType } from '../../types';
import { v4 as uuidv4 } from 'uuid';

export class Logger {
  private supabase: SupabaseClient;
  private logbookPath: string;
  private projectId: string | null = null;
  private taskId: string | null = null;

  constructor() {
    // Initialize Supabase client
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.logbookPath = path.join(process.cwd(), 'agent-core', 'logger', 'logs', 'logbook.md');
    
    // Ensure logs directory exists
    this.initializeLogDirectory();
  }

  private async initializeLogDirectory(): Promise<void> {
    try {
      const logsDir = path.dirname(this.logbookPath);
      await fs.mkdir(logsDir, { recursive: true });
      
      // Initialize logbook.md if it doesn't exist
      try {
        await fs.access(this.logbookPath);
      } catch {
        const initialContent = `# Claude Agent System - Logbook

## Overview
This logbook tracks all activities of the autonomous agent system. Each session and task is recorded with detailed information about operations, decisions, and outcomes.

---

## Session Log

`;
        await fs.writeFile(this.logbookPath, initialContent);
      }
    } catch (error) {
      console.error('Failed to initialize log directory:', error);
    }
  }

  setContext(projectId?: string, taskId?: string): void {
    this.projectId = projectId || null;
    this.taskId = taskId || null;
  }

  async log(
    level: LogLevel,
    agentType: AgentType,
    data: {
      message: string;
      data?: Record<string, any>;
      error_stack?: string;
    }
  ): Promise<void> {
    const logEntry: LogEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      agent_type: agentType,
      task_id: this.taskId,
      project_id: this.projectId,
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

  private logToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const agentColor = this.getAgentColor(entry.agent_type);
    const levelColor = this.getLevelColor(entry.level);
    
    const prefix = `${chalk.gray(timestamp)} ${agentColor(`[${entry.agent_type.toUpperCase()}]`)} ${levelColor(entry.level.toUpperCase())}`;
    
    console.log(`${prefix} ${entry.message}`);
    
    if (entry.data && Object.keys(entry.data).length > 0) {
      console.log(chalk.gray('  Data:'), JSON.stringify(entry.data, null, 2));
    }
    
    if (entry.error_stack) {
      console.log(chalk.red('  Stack:'), entry.error_stack);
    }
  }

  private async logToFile(entry: LogEntry): Promise<void> {
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
      
      await fs.appendFile(this.logbookPath, logLine);
    } catch (error) {
      console.error('Failed to write to logbook:', error);
    }
  }

  private async logToSupabase(entry: LogEntry): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('logs')
        .insert([entry]);

      if (error) {
        console.error('Failed to log to Supabase:', error);
        // Continue execution - don't fail completely if logging fails
      }
    } catch (error) {
      console.error('Supabase logging error:', error);
    }
  }

  private getAgentColor(agentType: AgentType): (text: string) => string {
    switch (agentType) {
      case 'orchestrator': return chalk.blue;
      case 'scanner': return chalk.green;
      case 'improver': return chalk.yellow;
      case 'generator': return chalk.magenta;
      default: return chalk.white;
    }
  }

  private getLevelColor(level: LogLevel): (text: string) => string {
    switch (level) {
      case 'debug': return chalk.gray;
      case 'info': return chalk.cyan;
      case 'warn': return chalk.yellow;
      case 'error': return chalk.red;
      case 'critical': return chalk.bgRed.white;
      default: return chalk.white;
    }
  }

  // Utility methods for different log levels
  async debug(agentType: AgentType, message: string, data?: Record<string, any>): Promise<void> {
    await this.log('debug', agentType, { message, data });
  }

  async info(agentType: AgentType, message: string, data?: Record<string, any>): Promise<void> {
    await this.log('info', agentType, { message, data });
  }

  async warn(agentType: AgentType, message: string, data?: Record<string, any>): Promise<void> {
    await this.log('warn', agentType, { message, data });
  }

  async error(agentType: AgentType, message: string, data?: Record<string, any>, error?: Error): Promise<void> {
    await this.log('error', agentType, { 
      message, 
      data, 
      error_stack: error?.stack 
    });
  }

  async critical(agentType: AgentType, message: string, data?: Record<string, any>, error?: Error): Promise<void> {
    await this.log('critical', agentType, { 
      message, 
      data, 
      error_stack: error?.stack 
    });
  }

  // Session management
  async startSession(projectName: string): Promise<void> {
    const sessionHeader = `\n\n## New Session Started - ${new Date().toLocaleString()}\n**Project:** ${projectName}\n**Session ID:** ${uuidv4()}\n\n`;
    
    try {
      await fs.appendFile(this.logbookPath, sessionHeader);
      await this.info('orchestrator', `Started new session for project: ${projectName}`, { 
        project_name: projectName,
        session_start: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to start session logging:', error);
    }
  }

  async endSession(summary?: string): Promise<void> {
    const sessionFooter = `\n**Session Summary:** ${summary || 'Session completed'}\n**Ended:** ${new Date().toLocaleString()}\n\n`;
    
    try {
      await fs.appendFile(this.logbookPath, sessionFooter);
      await this.info('orchestrator', 'Session ended', { 
        session_end: new Date().toISOString(),
        summary
      });
    } catch (error) {
      console.error('Failed to end session logging:', error);
    }
  }

  // Query methods for retrieving logs
  async getRecentLogs(limit: number = 50, projectId?: string): Promise<LogEntry[]> {
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
    } catch (error) {
      console.error('Error retrieving logs:', error);
      return [];
    }
  }

  async getLogsByTask(taskId: string): Promise<LogEntry[]> {
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
    } catch (error) {
      console.error('Error retrieving task logs:', error);
      return [];
    }
  }

  async getLogsByLevel(level: LogLevel, projectId?: string, limit: number = 100): Promise<LogEntry[]> {
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
    } catch (error) {
      console.error('Error retrieving level logs:', error);
      return [];
    }
  }

  // Performance logging
  async logPerformanceMetric(
    metricType: string,
    value: number,
    unit?: string,
    context?: Record<string, any>
  ): Promise<void> {
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
    } catch (error) {
      console.error('Error logging performance metric:', error);
    }
  }

  // Cleanup old logs (retention management)
  async cleanupOldLogs(retentionDays: number = 30): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const { error } = await this.supabase
        .from('logs')
        .delete()
        .lt('timestamp', cutoffDate.toISOString());

      if (error) {
        console.error('Failed to cleanup old logs:', error);
      } else {
        await this.info('orchestrator', `Cleaned up logs older than ${retentionDays} days`, {
          cutoff_date: cutoffDate.toISOString(),
          retention_days: retentionDays
        });
      }
    } catch (error) {
      console.error('Error during log cleanup:', error);
    }
  }
}