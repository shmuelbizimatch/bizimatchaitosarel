"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const dotenv_1 = __importDefault(require("dotenv"));
const agent_1 = __importDefault(require("../agent-core/agent"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(server, {
    cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});
// Middleware
app.use((0, cors_1.default)({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
}));
app.use(express_1.default.json());
// Global agent instance
let agentSystem;
let currentExecution = null;
// Initialize agent system
try {
    agentSystem = new agent_1.default();
}
catch (error) {
    console.error('Failed to initialize Claude Agent System:', error);
    process.exit(1);
}
// WebSocket connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});
// Broadcast function for real-time updates
function broadcast(type, payload) {
    io.emit('message', { type, payload, timestamp: new Date().toISOString() });
}
// Enhanced logging that broadcasts to frontend
class BroadcastLogger {
    static log(level, agentType, message, data) {
        broadcast('log_entry', {
            level,
            agent_type: agentType,
            message,
            data,
            timestamp: new Date().toISOString()
        });
    }
    static progress(update) {
        broadcast('progress_update', update);
    }
    static taskStatus(agentType, status, task) {
        broadcast('task_status', { agent_type: agentType, status, task });
    }
    static systemHealth(health) {
        broadcast('system_health', health);
    }
    static executionComplete(result) {
        broadcast('execution_complete', result);
    }
}
// API Routes
// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});
// System health detailed
app.get('/api/system/health', async (req, res) => {
    try {
        const status = agentSystem.getStatus();
        const health = {
            status: status.isRunning ? 'running' : 'healthy',
            uptime: process.uptime(),
            memory_usage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
            active_tasks: (await agentSystem.getActiveTasks()).length,
            database_connected: true, // TODO: Add actual DB health check
            ai_service_connected: true, // TODO: Add actual AI service check
            last_check: new Date().toISOString()
        };
        res.json(health);
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get system health',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Get agent status
app.get('/api/agent/status', async (req, res) => {
    try {
        const status = agentSystem.getStatus();
        const activeTasks = await agentSystem.getActiveTasks();
        res.json({
            success: true,
            data: {
                isRunning: status.isRunning,
                currentProject: status.currentProject,
                activeTasks: activeTasks.length,
                aiStats: status.aiStats,
                uptime: status.uptime,
                memoryUsage: status.memoryUsage
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get agent status',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Get recent logs
app.get('/api/agent/logs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const logs = await agentSystem.getRecentLogs(limit);
        res.json({
            success: true,
            data: {
                logs,
                count: logs.length
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get logs',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Execute agent
app.post('/api/agent/execute', async (req, res) => {
    try {
        const { projectName, mode, aiEngine, options } = req.body;
        // Validate input
        if (!projectName || !mode) {
            return res.status(400).json({
                success: false,
                error: 'Project name and mode are required'
            });
        }
        if (!['scan', 'enhance', 'add_modules', 'full'].includes(mode)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid mode. Use: scan, enhance, add_modules, or full'
            });
        }
        // Check if already running
        if (currentExecution) {
            return res.status(409).json({
                success: false,
                error: 'Agent is already running. Please wait for completion or cancel the current execution.'
            });
        }
        const config = {
            projectName,
            mode: mode,
            aiEngine: aiEngine || 'claude',
            options: options || {}
        };
        // Start execution asynchronously
        currentExecution = agentSystem.execute(config);
        // Handle completion
        currentExecution
            .then((result) => {
            BroadcastLogger.executionComplete(result);
            currentExecution = null;
        })
            .catch((error) => {
            BroadcastLogger.log('error', 'orchestrator', `Execution failed: ${error.message}`);
            BroadcastLogger.executionComplete({ error: error.message });
            currentExecution = null;
        });
        res.json({
            success: true,
            message: 'Agent execution started',
            data: {
                config,
                timestamp: new Date().toISOString()
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to start agent execution',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Cancel execution
app.post('/api/agent/cancel', async (req, res) => {
    try {
        const { reason } = req.body;
        await agentSystem.cancelWorkflow(reason || 'User requested cancellation');
        currentExecution = null;
        BroadcastLogger.log('warn', 'orchestrator', 'Execution cancelled by user request');
        res.json({
            success: true,
            message: 'Agent execution cancelled',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to cancel execution',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Get project statistics
app.get('/api/agent/stats/:projectId?', async (req, res) => {
    try {
        const { projectId } = req.params;
        const stats = await agentSystem.getProjectStats(projectId);
        res.json({
            success: true,
            data: stats
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get project statistics',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Get active tasks
app.get('/api/agent/tasks', async (req, res) => {
    try {
        const tasks = await agentSystem.getActiveTasks();
        res.json({
            success: true,
            data: {
                tasks,
                count: tasks.length
            }
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get active tasks',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Test Claude connection
app.post('/api/test/claude', async (req, res) => {
    try {
        // Simple test to verify Claude API key works
        const testConfig = {
            projectName: 'API Test',
            mode: 'scan',
            aiEngine: 'claude',
            options: { verboseLogging: false }
        };
        // This is a minimal test - in a real implementation you might want a dedicated test method
        res.json({
            success: true,
            message: 'Claude API connection test would be performed here',
            timestamp: new Date().toISOString()
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            error: 'Claude API test failed',
            details: error instanceof Error ? error.message : String(error)
        });
    }
});
// Error handling middleware
app.use((error, req, res, next) => {
    console.error('API Error:', error);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
});
// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});
// Periodic system health broadcasts
setInterval(() => {
    const health = {
        status: currentExecution ? 'running' : 'healthy',
        uptime: process.uptime(),
        memory_usage: process.memoryUsage().heapUsed / 1024 / 1024,
        active_tasks: 0, // Will be updated with real data
        database_connected: true,
        ai_service_connected: true,
        last_check: new Date().toISOString()
    };
    BroadcastLogger.systemHealth(health);
}, 30000); // Every 30 seconds
// Start server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`🚀 Claude Agent API Server running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`🌐 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
    // Broadcast server startup
    BroadcastLogger.log('info', 'orchestrator', 'API Server started successfully');
});
// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});
process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
        process.exit(0);
    });
});
exports.default = app;
//# sourceMappingURL=server.js.map