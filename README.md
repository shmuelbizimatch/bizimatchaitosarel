# 🤖 Claude Agent System

A comprehensive autonomous AI agent system optimized for Claude 3.5 Sonnet with Supabase backend integration. This system provides intelligent code analysis, enhancement, and module generation capabilities through a sophisticated multi-agent architecture.

## ✨ Features

### Core Capabilities
- **🔍 Intelligent Code Scanning**: Deep structural analysis, issue detection, and quality metrics
- **✨ UX/UI Enhancement**: Automated accessibility improvements, performance optimizations, and design system compliance
- **⚡ Module Generation**: Smart creation of components, services, and utilities based on existing patterns
- **🧠 Persistent Memory**: Learning system that accumulates knowledge across sessions
- **📊 Real-time Monitoring**: Live progress tracking, logging, and performance metrics

### Agent Architecture
- **📋 Orchestrator Agent**: Main workflow coordinator and task manager
- **🔍 Scanner Agent**: Project analysis and issue detection
- **✨ Improver Agent**: UX/UI enhancement and optimization
- **⚡ Generator Agent**: New module and component creation

### Technical Stack
- **AI Engine**: Claude 3.5 Sonnet (primary), with future GPT-4 and Gemini support
- **Backend**: Node.js + TypeScript + Express
- **Database**: Supabase (PostgreSQL) with real-time capabilities
- **Frontend**: React + TypeScript + Tailwind CSS
- **Real-time**: Socket.IO for live updates

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** and npm ([Download here](https://nodejs.org/))
- **Anthropic API key** ([Get one here](https://console.anthropic.com/))
- **Supabase project** ([Create one here](https://supabase.com/))

### Installation

1. **Clone and Install Dependencies**
   ```bash
   git clone <repository-url>
   cd claude-agent-system
   npm install
   cd frontend && npm install && cd ..
   ```

2. **Configure Environment**
   ```bash
   # Copy the example environment file
   cp .env.example .env
   
   # Edit .env with your actual credentials:
   # ANTHROPIC_API_KEY=your_actual_claude_api_key
   # SUPABASE_URL=https://your-project-id.supabase.co
   # SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key
   ```

3. **Verify Setup**
   ```bash
   # Check if all prerequisites are met
   npm run check
   ```

4. **Build and Setup Database**
   ```bash
   # This will check prerequisites, build, and setup database
   npm run setup
   ```

5. **Start the System**
   ```bash
   # Terminal 1: Start API server
   npm run api

   # Terminal 2: Start frontend  
   npm run frontend
   ```

6. **Access the Interface**
   - Frontend: http://localhost:3000
   - API Health: http://localhost:3001/api/health

### Troubleshooting

#### Common Issues

**"Prerequisites check FAILED"**
- Run `npm run check` to see specific issues
- Ensure all environment variables are set with real values (not placeholders)
- Verify Node.js version is 18+

**"Database setup failed: TypeError: fetch failed"**
- Check your Supabase URL and service role key are correct
- Verify your Supabase project is active and accessible
- Ensure you're using the service role key (not anon key)
- See [Manual Setup Guide](setup/manual-setup.md) for alternative setup

**"API server not starting"**
- Verify environment variables are configured: `npm run check`
- Check if port 3001 is already in use: `lsof -i :3001`
- Look for detailed error messages in the console

**"Frontend can't connect to API"**
- Ensure API server is running on port 3001
- Check that CORS is configured properly
- Verify frontend proxy setting in `frontend/package.json`

#### Getting Help

1. **Run diagnostics**: `npm run check`
2. **Check logs**: Look for detailed error messages in console output
3. **Verify environment**: Ensure all `.env` variables are set correctly
4. **Database connectivity**: Test your Supabase connection independently

## 📋 Usage

### Execution Modes

1. **Scan** 📊
   - Analyzes project structure and identifies issues
   - Generates code quality metrics and improvement suggestions
   - Best for: Initial project assessment

2. **Enhance** ✨
   - Focuses on UX/UI improvements and accessibility
   - Optimizes performance and design consistency
   - Best for: Improving existing projects

3. **Add Modules** ⚡
   - Generates new components, services, or utilities
   - Follows existing code patterns and conventions
   - Best for: Expanding project functionality

4. **Full** 🎯
   - Complete analysis, enhancement, and module generation
   - Comprehensive project optimization workflow
   - Best for: Complete project transformation

### API Endpoints

- `GET /api/health` - Server health check
- `GET /api/system/health` - Detailed system status
- `POST /api/agent/execute` - Start agent execution
- `POST /api/agent/cancel` - Cancel current execution
- `GET /api/agent/status` - Current agent status
- `GET /api/agent/logs` - Recent logs
- `GET /api/agent/stats/:projectId?` - Project statistics

### WebSocket Events

Real-time updates via Socket.IO:
- `log_entry` - New log messages
- `progress_update` - Execution progress
- `task_status` - Agent status changes
- `system_health` - System health updates
- `execution_complete` - Workflow completion

## 🏗️ Architecture

### Directory Structure
```
claude-agent-system/
├── agent-core/           # Core agent system
│   ├── agent.ts         # Main orchestrator
│   ├── agents/          # Sub-agent implementations
│   ├── engines/         # AI client (Claude integration)
│   ├── logger/          # Dual logging system
│   ├── memory/          # Persistent memory management
│   └── tasks/           # Task lifecycle management
├── api/                 # Express API server
├── frontend/            # React frontend application
├── types/               # Shared TypeScript interfaces
├── setup/               # Database setup scripts
└── supabase/           # Database schema
```

### Data Flow
1. **Frontend** sends execution request via API
2. **Orchestrator** creates workflow and sub-tasks
3. **Sub-agents** execute specialized operations
4. **Memory Manager** stores learnings and insights
5. **Logger** provides audit trail and debugging
6. **Real-time updates** stream to frontend via WebSocket

### Memory System
- **Insights**: High-level learnings and patterns
- **Errors**: Failed operations with solutions
- **Successes**: Effective strategies and outcomes
- **Preferences**: User and project-specific settings
- **Context**: Situational information and metadata

## 🔧 Configuration

### Environment Variables
```bash
# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# AI Configuration  
ANTHROPIC_API_KEY=your_claude_api_key

# Application Settings
NODE_ENV=development
PORT=3001
LOG_LEVEL=info

# Agent Configuration
DEFAULT_AI_ENGINE=claude
MAX_CONCURRENT_TASKS=5
TASK_TIMEOUT_MS=300000
MEMORY_RETENTION_DAYS=30
MAX_RETRY_ATTEMPTS=2
```

### Agent Options
```typescript
interface AgentOptions {
  maxConcurrentTasks?: number;    // Parallel task limit
  timeoutMs?: number;             // Task timeout
  retryAttempts?: number;         // Retry failed tasks
  verboseLogging?: boolean;       // Detailed logs
  targetFiles?: string[];         // Specific files to analyze
  excludePatterns?: string[];     // Files/patterns to ignore
}
```

## 📊 Database Schema

### Core Tables
- **projects**: Project metadata and settings
- **tasks**: Task lifecycle and execution history
- **logs**: Comprehensive audit trail
- **memory**: Persistent agent knowledge
- **ai_usage**: API usage tracking and costs
- **performance_metrics**: System performance data

### Key Features
- **UUID primary keys** for distributed scaling
- **JSONB fields** for flexible metadata storage
- **Indexed columns** for fast queries
- **Row Level Security** for data protection
- **Real-time subscriptions** for live updates

## 🎯 Development

### Building
```bash
npm run build          # Build backend TypeScript
cd frontend && npm run build  # Build React frontend
```

### Testing
```bash
npm test              # Run backend tests
cd frontend && npm test  # Run frontend tests
```

### Development Mode
```bash
npm run dev           # Start backend in dev mode
npm run api           # Start API server
npm run frontend      # Start React dev server
```

### Quick Start (Development Only)
If you want to test the frontend without full backend setup:

```bash
# 1. Install dependencies
npm install && cd frontend && npm install && cd ..

# 2. Build the project
npm run build

# 3. Start frontend only (some features won't work)
npm run frontend
```

**Note**: Without proper environment configuration, the API server won't start and some features will be unavailable.

## 🔍 Monitoring & Debugging

### Logging
- **Console**: Real-time colored output
- **File**: Local `logbook.md` markdown file
- **Database**: Persistent Supabase logs table
- **Frontend**: Live log streaming via WebSocket

### Performance Metrics
- Token usage and API costs
- Task execution times
- Memory usage statistics
- Database query performance
- Real-time system health

### Debugging Tips
1. Check logs in `logbook.md` for detailed execution traces
2. Monitor database tables for task status and errors
3. Use frontend monitoring panel for real-time insights
4. Verify API keys and Supabase connectivity
5. Check network connectivity for AI service calls

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Guidelines
- Use TypeScript for all new code
- Follow existing code patterns and conventions
- Add comprehensive error handling
- Include logging for debugging
- Update types for new interfaces
- Test both backend and frontend changes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-org/claude-agent-system/issues)
- **Documentation**: This README and inline code comments
- **Community**: Discussions and feature requests

## 🎉 Acknowledgments

- **Anthropic** for Claude 3.5 Sonnet API
- **Supabase** for backend infrastructure
- **React** and **TypeScript** communities
- **Open source contributors** and maintainers

---

Built with ❤️ using Claude 3.5 Sonnet
