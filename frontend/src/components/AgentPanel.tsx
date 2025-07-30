import React, { useState, useEffect, useCallback } from 'react';
import { 
  AgentPanelState, 
  ExecutionMode, 
  AIEngine, 
  LogEntry, 
  AgentProgress
} from '../types';

interface AgentPanelProps {
  className?: string;
  onExecute?: (projectName: string, mode: ExecutionMode, options: Record<string, any>) => Promise<void>;
  onGetProgress?: () => Promise<AgentProgress>;
  onGetLogs?: (limit?: number) => Promise<LogEntry[]>;
  onGetCapabilities?: () => Promise<Record<string, any>>;
  onGetStats?: () => Promise<Record<string, any>>;
}

export const AgentPanel: React.FC<AgentPanelProps> = ({
  className = '',
  onExecute,
  onGetProgress,
  onGetLogs,
  onGetCapabilities,
  onGetStats
}) => {
  const [state, setState] = useState<AgentPanelState>({
    project: '',
    mode: 'scan',
    aiEngine: 'claude',
    isRunning: false,
    logs: [],
    progress: {
      overall_progress: 0,
      current_stage: 'Ready',
      stages_completed: [],
      estimated_completion: '',
      sub_agent_status: {
        orchestrator: 'pending',
        scanner: 'pending',
        improver: 'pending',
        generator: 'pending'
      }
    }
  });

  const [options, setOptions] = useState({
    projectPath: '',
    maxFiles: 100,
    autoApply: false,
    autoGenerate: false,
    moduleRequest: '',
    targetComponent: '',
    outputDirectory: 'generated'
  });

  const [capabilities, setCapabilities] = useState<Record<string, any> | null>(null);
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    options: false,
    logs: true,
    progress: true,
    stats: false,
    capabilities: false
  });

  // Fetch initial data
  useEffect(() => {
    loadCapabilities();
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh progress and logs when running
  useEffect(() => {
    if (state.isRunning) {
      const interval = setInterval(() => {
        refreshProgress();
        refreshLogs();
      }, 2000); // Update every 2 seconds

      return () => clearInterval(interval);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRunning]);

  const loadCapabilities = useCallback(async () => {
    if (onGetCapabilities) {
      try {
        const caps = await onGetCapabilities();
        setCapabilities(caps);
      } catch (error) {
        console.error('Failed to load capabilities:', error);
      }
    }
  }, [onGetCapabilities]);

  const loadStats = useCallback(async () => {
    if (onGetStats) {
      try {
        const projectStats = await onGetStats();
        setStats(projectStats);
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    }
  }, [onGetStats]);

  const refreshProgress = useCallback(async () => {
    if (onGetProgress) {
      try {
        const progress = await onGetProgress();
        setState((prev: AgentPanelState) => ({ ...prev, progress }));
      } catch (error) {
        console.error('Failed to refresh progress:', error);
      }
    }
  }, [onGetProgress]);

  const refreshLogs = useCallback(async () => {
    if (onGetLogs) {
      try {
        const logs = await onGetLogs(50);
        setState((prev: AgentPanelState) => ({ ...prev, logs }));
      } catch (error) {
        console.error('Failed to refresh logs:', error);
      }
    }
  }, [onGetLogs]);

  const handleExecute = async () => {
    if (!state.project.trim()) {
      alert('Please enter a project name');
      return;
    }

    if (state.isRunning) {
      alert('Agent is already running. Please wait for completion.');
      return;
    }

    setState((prev: AgentPanelState) => ({ ...prev, isRunning: true }));

    try {
      const executeOptions = {
        ...options,
        projectPath: options.projectPath || process.cwd()
      };

      if (onExecute) {
        await onExecute(state.project, state.mode, executeOptions);
      }

      // Refresh final data
      await refreshProgress();
      await refreshLogs();
      await loadStats();

    } catch (error) {
      console.error('Execution failed:', error);
      alert(`Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setState((prev: AgentPanelState) => ({ ...prev, isRunning: false }));
    }
  };

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const getAgentStatusColor = (status: string): string => {
    switch (status) {
      case 'pending': return '#6b7280';
      case 'in_progress': return '#3b82f6';
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  const getLogLevelColor = (level: string): string => {
    switch (level) {
      case 'debug': return '#6b7280';
      case 'info': return '#3b82f6';
      case 'warn': return '#f59e0b';
      case 'error': return '#ef4444';
      case 'critical': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <div 
      className={className}
      style={{ 
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '20px',
        backgroundColor: '#f8fafc'
    }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <h1 style={{
          margin: '0 0 8px 0',
          fontSize: '24px',
          fontWeight: '600',
          color: '#1f2937'
        }}>
          🧠 Claude Agent System
        </h1>
        <p style={{
          margin: '0',
          color: '#6b7280',
          fontSize: '14px'
        }}>
          Autonomous AI agent system optimized for Claude with Supabase backend
        </p>
      </div>

      {/* Control Panel */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '20px'
        }}>
          {/* Project Input */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '4px'
            }}>
              Project Name
            </label>
            <input
              type="text"
              value={state.project}
              onChange={(e) => setState((prev: AgentPanelState) => ({ ...prev, project: e.target.value }))}
              placeholder="Enter project name"
              disabled={state.isRunning}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: state.isRunning ? '#f3f4f6' : 'white'
              }}
            />
          </div>

          {/* Mode Selection */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '4px'
            }}>
              Execution Mode
            </label>
            <select
              value={state.mode}
              onChange={(e) => setState((prev: AgentPanelState) => ({ ...prev, mode: e.target.value as ExecutionMode }))}
              disabled={state.isRunning}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: state.isRunning ? '#f3f4f6' : 'white'
              }}
            >
              <option value="scan">🔍 Analyze Structure</option>
              <option value="enhance">✨ Improve UX</option>
              <option value="add_modules">🔧 Generate Modules</option>
              <option value="full">🚀 Complete Optimization</option>
            </select>
          </div>

          {/* AI Engine */}
          <div>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '4px'
            }}>
              AI Engine
            </label>
            <select
              value={state.aiEngine}
              onChange={(e) => setState((prev: AgentPanelState) => ({ ...prev, aiEngine: e.target.value as AIEngine }))}
              disabled={state.isRunning}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px',
                backgroundColor: state.isRunning ? '#f3f4f6' : 'white'
              }}
            >
              <option value="claude">🧠 Claude 3.5 Sonnet (Recommended)</option>
              <option value="gpt-4" disabled>🤖 GPT-4 (Future)</option>
              <option value="gemini" disabled>💎 Gemini Pro (Future)</option>
            </select>
          </div>
        </div>

        {/* Advanced Options */}
        <div style={{ marginBottom: '20px' }}>
          <button
            onClick={() => toggleSection('options')}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: '#3b82f6',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {expandedSections.options ? '▼' : '▶'} Advanced Options
          </button>
          
          {expandedSections.options && (
            <div style={{
              marginTop: '12px',
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '12px'
            }}>
              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Project Path
                </label>
                <input
                  type="text"
                  value={options.projectPath}
                  onChange={(e) => setOptions(prev => ({ ...prev, projectPath: e.target.value }))}
                  placeholder="Default: current directory"
                  disabled={state.isRunning}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                  Max Files
                </label>
                <input
                  type="number"
                  value={options.maxFiles}
                  onChange={(e) => setOptions(prev => ({ ...prev, maxFiles: parseInt(e.target.value) || 100 }))}
                  disabled={state.isRunning}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                />
              </div>

              {(state.mode === 'enhance' || state.mode === 'full') && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={options.autoApply}
                      onChange={(e) => setOptions(prev => ({ ...prev, autoApply: e.target.checked }))}
                      disabled={state.isRunning}
                      id="autoApply"
                    />
                    <label htmlFor="autoApply" style={{ fontSize: '12px', color: '#6b7280' }}>
                      Auto-apply safe changes
                    </label>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                      Target Component (optional)
                    </label>
                    <input
                      type="text"
                      value={options.targetComponent}
                      onChange={(e) => setOptions(prev => ({ ...prev, targetComponent: e.target.value }))}
                      placeholder="e.g., Header, Button"
                      disabled={state.isRunning}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                </>
              )}

              {(state.mode === 'add_modules' || state.mode === 'full') && (
                <>
                  <div>
                    <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                      Module Request
                    </label>
                    <input
                      type="text"
                      value={options.moduleRequest}
                      onChange={(e) => setOptions(prev => ({ ...prev, moduleRequest: e.target.value }))}
                      placeholder="e.g., Create a login form component"
                      disabled={state.isRunning}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <input
                      type="checkbox"
                      checked={options.autoGenerate}
                      onChange={(e) => setOptions(prev => ({ ...prev, autoGenerate: e.target.checked }))}
                      disabled={state.isRunning}
                      id="autoGenerate"
                    />
                    <label htmlFor="autoGenerate" style={{ fontSize: '12px', color: '#6b7280' }}>
                      Auto-generate files
                    </label>
                  </div>

                  <div>
                    <label style={{ fontSize: '12px', color: '#6b7280', display: 'block', marginBottom: '4px' }}>
                      Output Directory
                    </label>
                    <input
                      type="text"
                      value={options.outputDirectory}
                      onChange={(e) => setOptions(prev => ({ ...prev, outputDirectory: e.target.value }))}
                      disabled={state.isRunning}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '12px'
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Launch Button */}
        <button
          onClick={handleExecute}
          disabled={state.isRunning || !state.project.trim()}
          style={{
            backgroundColor: state.isRunning ? '#9ca3af' : '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            padding: '12px 24px',
            fontSize: '16px',
            fontWeight: '500',
            cursor: state.isRunning ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {state.isRunning ? '⏳' : '🚀'} {state.isRunning ? 'Running...' : 'Run Agent'}
        </button>
      </div>

      {/* Progress Panel */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <button
          onClick={() => toggleSection('progress')}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '16px',
            fontWeight: '600',
            color: '#1f2937',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px'
          }}
        >
          {expandedSections.progress ? '▼' : '▶'} 📊 Progress Monitor
        </button>

        {expandedSections.progress && (
          <div>
            {/* Overall Progress Bar */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '8px'
              }}>
                <span style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>
                  Overall Progress
                </span>
                <span style={{ fontSize: '14px', color: '#6b7280' }}>
                  {state.progress.overall_progress}%
                </span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                backgroundColor: '#e5e7eb',
                borderRadius: '4px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${state.progress.overall_progress}%`,
                  height: '100%',
                  backgroundColor: '#3b82f6',
                  transition: 'width 0.3s ease'
                }} />
              </div>
            </div>

            {/* Current Stage */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Current Stage:</div>
              <div style={{ fontSize: '16px', fontWeight: '500', color: '#1f2937' }}>
                {state.progress.current_stage}
              </div>
            </div>

            {/* Sub-Agent Status */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: '12px',
              marginBottom: '16px'
            }}>
              {Object.entries(state.progress.sub_agent_status).map(([agent, status]: [string, any]) => {
                const statusStr = status as string;
                return (
                  <div
                    key={agent}
                    style={{
                      padding: '8px 12px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px',
                      textAlign: 'center',
                      border: `2px solid ${getAgentStatusColor(statusStr)}`
                    }}
                  >
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '2px' }}>
                      {agent.charAt(0).toUpperCase() + agent.slice(1)}
                    </div>
                    <div style={{
                      fontSize: '12px',
                      fontWeight: '500',
                      color: getAgentStatusColor(statusStr)
                    }}>
                      {statusStr.replace('_', ' ').toUpperCase()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Completed Stages */}
            {state.progress.stages_completed.length > 0 && (
              <div>
                <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>
                  Completed Stages:
                </div>
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '6px'
                }}>
                  {state.progress.stages_completed.map((stage: string, index: number) => (
                    <span
                      key={index}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: '#d1fae5',
                        color: '#065f46',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500'
                      }}
                    >
                      ✓ {stage}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Live Logs */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '20px',
        marginBottom: '20px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}>
        <button
          onClick={() => toggleSection('logs')}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '16px',
            fontWeight: '600',
            color: '#1f2937',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '16px'
          }}
        >
          {expandedSections.logs ? '▼' : '▶'} 📋 Live Logs
          {state.logs.length > 0 && (
            <span style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              borderRadius: '10px',
              padding: '2px 6px',
              fontSize: '12px',
              fontWeight: '500'
            }}>
              {state.logs.length}
            </span>
          )}
        </button>

        {expandedSections.logs && (
          <div style={{
            maxHeight: '400px',
            overflowY: 'auto',
            backgroundColor: '#f8fafc',
            borderRadius: '6px',
            padding: '12px'
          }}>
            {state.logs.length === 0 ? (
              <div style={{
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '14px',
                padding: '20px'
              }}>
                No logs available. Start the agent to see live activity.
              </div>
            ) : (
              <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                {state.logs.slice().reverse().map((log: LogEntry, index: number) => (
                  <div
                    key={log.id || index}
                    style={{
                      marginBottom: '8px',
                      padding: '8px',
                      backgroundColor: 'white',
                      borderRadius: '4px',
                      borderLeft: `3px solid ${getLogLevelColor(log.level)}`
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '4px'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}>
                        <span style={{
                          color: getLogLevelColor(log.level),
                          fontWeight: '600'
                        }}>
                          {log.level.toUpperCase()}
                        </span>
                        <span style={{
                          backgroundColor: '#e5e7eb',
                          color: '#374151',
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '10px'
                        }}>
                          {log.agent_type}
                        </span>
                      </div>
                      <span style={{ color: '#6b7280', fontSize: '10px' }}>
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>
                    <div style={{ color: '#1f2937' }}>
                      {log.message}
                    </div>
                    {log.data && Object.keys(log.data).length > 0 && (
                      <details style={{ marginTop: '4px' }}>
                        <summary style={{
                          color: '#6b7280',
                          cursor: 'pointer',
                          fontSize: '10px'
                        }}>
                          View Data
                        </summary>
                        <pre style={{
                          backgroundColor: '#f3f4f6',
                          padding: '8px',
                          borderRadius: '3px',
                          marginTop: '4px',
                          fontSize: '10px',
                          overflow: 'auto'
                        }}>
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Statistics Panel */}
      {stats && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '20px',
          marginBottom: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <button
            onClick={() => toggleSection('stats')}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16px',
              fontWeight: '600',
              color: '#1f2937',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px'
            }}
          >
            {expandedSections.stats ? '▼' : '▶'} 📈 Statistics
          </button>

          {expandedSections.stats && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '16px'
            }}>
              {/* Task Statistics */}
              {stats.task_statistics && (
                <div style={{
                  backgroundColor: '#f9fafb',
                  padding: '16px',
                  borderRadius: '6px'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#374151' }}>Tasks</h4>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    <div>Total: {stats.task_statistics.total_tasks || 0}</div>
                    <div>Completed: {stats.task_statistics.by_status?.completed || 0}</div>
                    <div>Failed: {stats.task_statistics.by_status?.failed || 0}</div>
                  </div>
                </div>
              )}

              {/* Memory Statistics */}
              {stats.memory_statistics && (
                <div style={{
                  backgroundColor: '#f9fafb',
                  padding: '16px',
                  borderRadius: '6px'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#374151' }}>Memory</h4>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    <div>Total Memories: {stats.memory_statistics.total_memories || 0}</div>
                    <div>Avg Importance: {stats.memory_statistics.avg_importance?.toFixed(1) || 'N/A'}</div>
                  </div>
                </div>
              )}

              {/* AI Usage */}
              {stats.ai_usage && (
                <div style={{
                  backgroundColor: '#f9fafb',
                  padding: '16px',
                  borderRadius: '6px'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', color: '#374151' }}>AI Usage</h4>
                  <div style={{ fontSize: '14px', color: '#6b7280' }}>
                    <div>Requests: {stats.ai_usage.requestCount || 0}</div>
                    <div>Tokens: {stats.ai_usage.totalTokensUsed || 0}</div>
                    <div>Cost: ${(stats.ai_usage.totalCost || 0).toFixed(4)}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* System Capabilities */}
      {capabilities && (
        <div style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <button
            onClick={() => toggleSection('capabilities')}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '16px',
              fontWeight: '600',
              color: '#1f2937',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px'
            }}
          >
            {expandedSections.capabilities ? '▼' : '▶'} ⚙️ System Capabilities
          </button>

          {expandedSections.capabilities && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '16px'
            }}>
              <div>
                <h4 style={{ margin: '0 0 8px 0', color: '#374151' }}>Version</h4>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {capabilities.version}
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 8px 0', color: '#374151' }}>Execution Modes</h4>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {capabilities.execution_modes?.join(', ')}
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 8px 0', color: '#374151' }}>Features</h4>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {capabilities.features?.slice(0, 4).join(', ')}
                  {capabilities.features?.length > 4 && '...'}
                </div>
              </div>

              <div>
                <h4 style={{ margin: '0 0 8px 0', color: '#374151' }}>File Types</h4>
                <div style={{ fontSize: '14px', color: '#6b7280' }}>
                  {capabilities.supported_file_types?.slice(0, 3).join(', ')}
                  {capabilities.supported_file_types?.length > 3 && '...'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentPanel;