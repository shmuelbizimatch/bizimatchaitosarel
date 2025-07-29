-- Claude Agent System - Supabase Database Schema
-- This script sets up all required tables for the autonomous agent system

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{
        "default_ai_engine": "claude",
        "auto_enhance": false,
        "max_file_size_mb": 10,
        "excluded_patterns": ["node_modules", ".git", "dist"],
        "preferred_frameworks": ["react", "typescript"]
    }'::jsonb,
    stats JSONB DEFAULT '{
        "total_tasks": 0,
        "successful_tasks": 0,
        "total_files_processed": 0,
        "total_tokens_used": 0,
        "total_cost": 0,
        "avg_completion_time_ms": 0
    }'::jsonb
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    task_type VARCHAR(50) NOT NULL CHECK (task_type IN ('scan', 'enhance', 'add_modules', 'full')),
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
    agent_type VARCHAR(50) NOT NULL CHECK (agent_type IN ('scanner', 'improver', 'generator', 'orchestrator')),
    input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_data JSONB,
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    metadata JSONB NOT NULL DEFAULT '{
        "priority": 1,
        "retry_count": 0,
        "ai_engine": "claude"
    }'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    level VARCHAR(20) NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error', 'critical')),
    agent_type VARCHAR(50) NOT NULL CHECK (agent_type IN ('scanner', 'improver', 'generator', 'orchestrator')),
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    error_stack TEXT
);

-- Memory table
CREATE TABLE IF NOT EXISTS memory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    memory_type VARCHAR(50) NOT NULL CHECK (memory_type IN ('insight', 'pattern', 'error', 'success', 'preference', 'context')),
    content JSONB NOT NULL,
    embedding vector(1536), -- OpenAI embedding dimension, future use
    importance_score INTEGER NOT NULL DEFAULT 5 CHECK (importance_score >= 1 AND importance_score <= 10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    access_count INTEGER DEFAULT 0
);

-- AI Usage tracking table
CREATE TABLE IF NOT EXISTS ai_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    ai_engine VARCHAR(50) NOT NULL,
    model VARCHAR(100) NOT NULL,
    tokens_used INTEGER NOT NULL DEFAULT 0,
    cost_estimate DECIMAL(10, 6) DEFAULT 0,
    response_time_ms INTEGER,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance Metrics table
CREATE TABLE IF NOT EXISTS performance_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    metric_type VARCHAR(100) NOT NULL,
    value DECIMAL(15, 6) NOT NULL,
    unit VARCHAR(50),
    context JSONB DEFAULT '{}'::jsonb,
    measured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_agent_type ON tasks(agent_type);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_task_id ON tasks(parent_task_id);

CREATE INDEX IF NOT EXISTS idx_logs_project_id ON logs(project_id);
CREATE INDEX IF NOT EXISTS idx_logs_task_id ON logs(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_agent_type ON logs(agent_type);

CREATE INDEX IF NOT EXISTS idx_memory_project_id ON memory(project_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory(importance_score);
CREATE INDEX IF NOT EXISTS idx_memory_last_accessed ON memory(last_accessed);

CREATE INDEX IF NOT EXISTS idx_ai_usage_project_id ON ai_usage(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_task_id ON ai_usage(task_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ai_engine ON ai_usage(ai_engine);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON ai_usage(created_at);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_project_id ON performance_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_type ON performance_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_performance_metrics_measured_at ON performance_metrics(measured_at);

-- Create GIN indexes for JSONB columns
CREATE INDEX IF NOT EXISTS idx_projects_settings_gin ON projects USING GIN(settings);
CREATE INDEX IF NOT EXISTS idx_projects_stats_gin ON projects USING GIN(stats);
CREATE INDEX IF NOT EXISTS idx_tasks_input_data_gin ON tasks USING GIN(input_data);
CREATE INDEX IF NOT EXISTS idx_tasks_output_data_gin ON tasks USING GIN(output_data);
CREATE INDEX IF NOT EXISTS idx_tasks_metadata_gin ON tasks USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_logs_data_gin ON logs USING GIN(data);
CREATE INDEX IF NOT EXISTS idx_memory_content_gin ON memory USING GIN(content);

-- Row Level Security policies
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;

-- Service role can access everything
CREATE POLICY "Service role has full access to projects" ON projects
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to tasks" ON tasks
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to logs" ON logs
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to memory" ON memory
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to ai_usage" ON ai_usage
    FOR ALL USING (true);

CREATE POLICY "Service role has full access to performance_metrics" ON performance_metrics
    FOR ALL USING (true);

-- Functions for automatic updates
CREATE OR REPLACE FUNCTION update_project_last_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE projects 
    SET last_activity = NOW() 
    WHERE id = NEW.project_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS trigger_update_project_activity_tasks ON tasks;
CREATE TRIGGER trigger_update_project_activity_tasks
    AFTER INSERT OR UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_project_last_activity();

DROP TRIGGER IF EXISTS trigger_update_project_activity_logs ON logs;
CREATE TRIGGER trigger_update_project_activity_logs
    AFTER INSERT ON logs
    FOR EACH ROW
    EXECUTE FUNCTION update_project_last_activity();

-- Function to update project stats
CREATE OR REPLACE FUNCTION update_project_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'completed' THEN
        UPDATE projects 
        SET stats = jsonb_set(
            jsonb_set(
                stats,
                '{total_tasks}',
                ((stats->>'total_tasks')::int + 1)::text::jsonb
            ),
            '{successful_tasks}',
            ((stats->>'successful_tasks')::int + 1)::text::jsonb
        )
        WHERE id = NEW.project_id;
    ELSIF NEW.status IN ('failed', 'cancelled') THEN
        UPDATE projects 
        SET stats = jsonb_set(
            stats,
            '{total_tasks}',
            ((stats->>'total_tasks')::int + 1)::text::jsonb
        )
        WHERE id = NEW.project_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_project_stats ON tasks;
CREATE TRIGGER trigger_update_project_stats
    AFTER UPDATE OF status ON tasks
    FOR EACH ROW
    WHEN (OLD.status != NEW.status AND NEW.status IN ('completed', 'failed', 'cancelled'))
    EXECUTE FUNCTION update_project_stats();

-- Views for common queries
CREATE OR REPLACE VIEW task_summary AS
SELECT 
    t.id,
    t.project_id,
    p.name as project_name,
    t.task_type,
    t.status,
    t.agent_type,
    t.started_at,
    t.completed_at,
    EXTRACT(EPOCH FROM (COALESCE(t.completed_at, NOW()) - t.started_at)) * 1000 as duration_ms,
    (t.metadata->>'tokens_used')::int as tokens_used,
    (t.metadata->>'cost_estimate')::decimal as cost_estimate
FROM tasks t
JOIN projects p ON t.project_id = p.id;

CREATE OR REPLACE VIEW project_activity AS
SELECT 
    p.id,
    p.name,
    p.created_at,
    p.last_activity,
    COUNT(t.id) as total_tasks,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
    COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_tasks,
    COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as active_tasks,
    SUM((t.metadata->>'tokens_used')::int) as total_tokens,
    SUM((t.metadata->>'cost_estimate')::decimal) as total_cost
FROM projects p
LEFT JOIN tasks t ON p.id = t.project_id
GROUP BY p.id, p.name, p.created_at, p.last_activity;

-- Sample data (optional - for testing)
-- INSERT INTO projects (name) VALUES ('Sample Project');

COMMIT;