# Bizimatchaitosarel

AI-powered development pipeline that transforms high-level prompts into production-ready code using Claude, GitHub Actions, and Jira. Includes PRD generation, task decomposition, AI code generation, automated testing, retries, manual review gates, and full traceability.

## Features

- 🤖 **AI-Powered Code Generation**: Uses Claude AI to transform high-level prompts into production-ready code
- 📋 **PRD Generation**: Automatically generates Product Requirements Documents from user prompts
- 🔄 **Task Decomposition**: Breaks down complex requirements into manageable tasks
- 🧪 **Automated Testing**: Includes comprehensive testing and quality assurance
- 👥 **Manual Review Gates**: Human oversight at critical pipeline stages
- 🔗 **Full Traceability**: Complete audit trail from prompt to deployment
- 🚀 **CI/CD Integration**: Seamless integration with GitHub Actions
- 📊 **Jira Integration**: Automatic task and issue management

## Project Structure

```
bizimatchaitosarel/
├── src/
│   ├── main.py              # FastAPI application entry point
│   ├── index.js             # Node.js application entry point
│   ├── core/                # Core pipeline logic
│   │   ├── pipeline.py      # Main pipeline orchestration
│   │   ├── task_manager.py  # Task management
│   │   └── config.py        # Configuration management
│   ├── ai/                  # AI service integrations
│   │   ├── claude_client.py # Claude AI client
│   │   ├── code_generator.py# Code generation logic
│   │   └── prd_generator.py # PRD generation
│   ├── github/              # GitHub integration
│   ├── jira/                # Jira integration
│   ├── api/                 # API routes and handlers
│   ├── models/              # Data models
│   ├── utils/               # Utility functions
│   └── tests/               # Test suite
├── .github/workflows/       # GitHub Actions workflows
├── config/                  # Configuration files
├── docs/                    # Documentation
├── scripts/                 # Utility scripts
├── docker-compose.yml       # Local development setup
├── Dockerfile              # Container configuration
├── requirements.txt        # Python dependencies
└── package.json           # Node.js dependencies
```

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- Docker (optional, for containerized development)
- Git

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/bizimatchaitosarel.git
   cd bizimatchaitosarel
   ```

2. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys and configuration
   ```

3. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Install Node.js dependencies**:
   ```bash
   npm install
   ```

### Running the Application

#### Option 1: Local Development

**Python FastAPI Server**:
```bash
python src/main.py
```

**Node.js Express Server**:
```bash
npm start
```

#### Option 2: Docker Compose
```bash
docker-compose up --build
```

The API will be available at:
- FastAPI: http://localhost:8000
- Node.js: http://localhost:3000

### API Documentation

Once running, visit:
- FastAPI docs: http://localhost:8000/docs
- Health check: http://localhost:8000/health

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

| Variable | Description | Required |
|----------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude AI API key | Yes |
| `GITHUB_TOKEN` | GitHub API token | Yes |
| `JIRA_URL` | Jira instance URL | Yes |
| `JIRA_EMAIL` | Jira user email | Yes |
| `JIRA_API_TOKEN` | Jira API token | Yes |
| `DATABASE_URL` | Database connection string | No |
| `REDIS_URL` | Redis connection string | No |

## Development

### Running Tests

**Python tests**:
```bash
pytest src/tests/
```

**Node.js tests**:
```bash
npm test
```

### Code Quality

**Python formatting and linting**:
```bash
black src/
flake8 src/
mypy src/
```

**Node.js formatting and linting**:
```bash
npm run format
npm run lint
```

## Pipeline Overview

1. **Prompt Input**: User provides high-level description
2. **PRD Generation**: AI creates detailed requirements document
3. **Task Decomposition**: Break down into actionable tasks
4. **Code Generation**: AI generates production-ready code
5. **Automated Testing**: Run comprehensive test suite
6. **Manual Review**: Human oversight and approval
7. **Deployment**: Automated deployment to production

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Run the test suite: `pytest` and `npm test`
5. Commit your changes: `git commit -am 'Add feature'`
6. Push to the branch: `git push origin feature-name`
7. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support and questions:
- Create an issue on GitHub
- Check the documentation in the `docs/` directory
- Review the API documentation at `/docs` when running the server
