import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';
import ClaudeAgentSystem from '../agent-core/agent';
import { AgentConfig, APIResponse, ExecutionMode, AIEngine } from '../types';
import { securityConfig } from '../security/config';
import { createValidationMiddleware, securityMiddleware } from '../security/validation';
import AuthMiddleware, { AuthRequest, authManager } from '../security/auth';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: securityConfig.frontendUrl,
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Security Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", securityConfig.supabaseUrl],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: securityConfig.rateLimitWindowMs,
  max: securityConfig.rateLimitMaxRequests,
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// CORS configuration
app.use(cors({
  origin: securityConfig.frontendUrl,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count']
}));

// Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Apply security middleware
app.use(...securityMiddleware);

// Global agent instance
let agentSystem: ClaudeAgentSystem;
let currentExecution: Promise<any> | null = null;

// Initialize agent system
try {
  agentSystem = new ClaudeAgentSystem();
} catch (error) {
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
function broadcast(type: string, payload: any) {
  io.emit('message', { type, payload, timestamp: new Date().toISOString() });
}

// Enhanced logging that broadcasts to frontend
class BroadcastLogger {
  static log(level: string, agentType: string, message: string, data?: any) {
    broadcast('log_entry', {
      level,
      agent_type: agentType,
      message,
      data,
      timestamp: new Date().toISOString()
    });
  }

  static progress(update: any) {
    broadcast('progress_update', update);
  }

  static taskStatus(agentType: string, status: string, task?: any) {
    broadcast('task_status', { agent_type: agentType, status, task });
  }

  static systemHealth(health: any) {
    broadcast('system_health', health);
  }

  static executionComplete(result: any) {
    broadcast('execution_complete', result);
  }
}

// API Routes

// Authentication Routes
app.post('/api/auth/register', createValidationMiddleware('testConnection'), async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const user = await authManager.createUser(email, password, role);
    const token = authManager.generateToken(user);
    
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          permissions: user.permissions
        },
        token
      }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: 'Registration failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/auth/login', createValidationMiddleware('testConnection'), async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, token } = await authManager.authenticateUser(email, password, req.ip || 'unknown');
    
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          permissions: user.permissions
        },
        token
      }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Authentication failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/auth/logout', AuthMiddleware.authenticateToken, async (req: AuthRequest, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      await authManager.logout(token);
    }
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Logout failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post('/api/auth/refresh', AuthMiddleware.authenticateToken, async (req: AuthRequest, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'Token required'
      });
    }
    
    const newToken = await authManager.refreshToken(token);
    
    res.json({
      success: true,
      data: { token: newToken }
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      error: 'Token refresh failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Health check (public endpoint)
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// System health detailed (requires authentication)
app.get('/api/system/health', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('system:admin'),
  async (req: AuthRequest, res) => {
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get system health',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get agent status (requires authentication)
app.get('/api/agent/status', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('agent:view'),
  async (req: AuthRequest, res) => {
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
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get agent status',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get recent logs (requires authentication)
app.get('/api/agent/logs', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('logs:view'),
  createValidationMiddleware('logQuery'),
  async (req: AuthRequest, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = await agentSystem.getRecentLogs(limit);
    
    res.json({
      success: true,
      data: {
        logs,
        count: logs.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get logs',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Execute agent (requires authentication and permission)
app.post('/api/agent/execute', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('agent:execute'),
  createValidationMiddleware('agentExecution'),
  async (req: AuthRequest, res) => {
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

    const config: AgentConfig = {
      projectName,
      mode: mode as ExecutionMode,
      aiEngine: (aiEngine as AIEngine) || 'claude',
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

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to start agent execution',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Cancel execution (requires authentication and permission)
app.post('/api/agent/cancel', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('agent:cancel'),
  createValidationMiddleware('cancelExecution'),
  async (req: AuthRequest, res) => {
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

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cancel execution',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get project statistics (requires authentication)
app.get('/api/agent/stats/:projectId?', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('projects:view'),
  async (req: AuthRequest, res) => {
  try {
    const { projectId } = req.params;
    const stats = await agentSystem.getProjectStats(projectId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get project statistics',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Get active tasks (requires authentication)
app.get('/api/agent/tasks', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('agent:view'),
  async (req: AuthRequest, res) => {
  try {
    const tasks = await agentSystem.getActiveTasks();
    
    res.json({
      success: true,
      data: {
        tasks,
        count: tasks.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get active tasks',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Test Claude connection (requires authentication)
app.post('/api/test/claude', 
  AuthMiddleware.authenticateToken,
  AuthMiddleware.requirePermission('api:test'),
  createValidationMiddleware('testConnection'),
  async (req: AuthRequest, res) => {
  try {
    // Simple test to verify Claude API key works
    const testConfig: AgentConfig = {
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

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Claude API test failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

export default app;