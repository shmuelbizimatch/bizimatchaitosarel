"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = __importDefault(require("react"));
const AgentPanel_1 = __importDefault(require("./components/AgentPanel"));
require("./index.css");
function App() {
    return (<div className="min-h-screen bg-gray-100">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 text-center">
            🤖 Claude Agent System
          </h1>
          <p className="text-gray-600 text-center mt-2">
            Autonomous AI-powered code analysis, enhancement, and generation
          </p>
        </div>
        
        <AgentPanel_1.default className="max-w-6xl mx-auto"/>
        
        <div className="mt-8 text-center">
          <div className="text-sm text-gray-500">
            <p>
              Powered by Claude 3.5 Sonnet • 
              <a href="https://github.com/your-org/claude-agent-system" className="text-blue-600 hover:text-blue-800 ml-1" target="_blank" rel="noopener noreferrer">
                View on GitHub
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>);
}
exports.default = App;
//# sourceMappingURL=App.js.map