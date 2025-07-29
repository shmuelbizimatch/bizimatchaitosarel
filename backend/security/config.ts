import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface SecurityConfig {
  // API Keys and Secrets
  anthropicApiKey: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
  
  // Application Security
  appSecretKey: string;
  jwtSecret: string;
  encryptionKey: string;
  
  // CORS and Networking
  frontendUrl: string;
  port: number;
  nodeEnv: string;
  
  // Rate Limiting
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  rateLimitDelayMs: number;
  
  // AI Configuration
  defaultAiEngine: string;
  maxTokensPerRequest: number;
  maxRequestsPerMinute: number;
  aiTimeoutMs: number;
  
  // Database Configuration
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  memoryRetentionDays: number;
  maxRetryAttempts: number;
  
  // File Processing
  maxFileSizeBytes: number;
  maxFilesPerRequest: number;
  allowedFileTypes: string[];
  
  // Logging and Monitoring
  logLevel: string;
  logToFile: boolean;
  logToConsole: boolean;
  logRetentionDays: number;
  
  // Security Event Logging
  securityLogEnabled: boolean;
  failedAuthThreshold: number;
  ipBlockDurationMinutes: number;
  
  // Development Settings
  verboseLogging: boolean;
  debugMode: boolean;
  enableApiDocs: boolean;
}

class SecurityConfigValidator {
  private config: SecurityConfig;
  
  constructor() {
    this.config = this.loadAndValidateConfig();
  }
  
  private loadAndValidateConfig(): SecurityConfig {
    const config: SecurityConfig = {
      // API Keys and Secrets
      anthropicApiKey: this.getRequiredEnv('ANTHROPIC_API_KEY'),
      supabaseUrl: this.getRequiredEnv('SUPABASE_URL'),
      supabaseServiceRoleKey: this.getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
      supabaseAnonKey: this.getRequiredEnv('SUPABASE_ANON_KEY'),
      
      // Application Security
      appSecretKey: this.getRequiredEnv('APP_SECRET_KEY'),
      jwtSecret: this.getRequiredEnv('JWT_SECRET'),
      encryptionKey: this.getRequiredEnv('ENCRYPTION_KEY'),
      
      // CORS and Networking
      frontendUrl: this.getOptionalEnv('FRONTEND_URL', 'http://localhost:3000'),
      port: parseInt(this.getOptionalEnv('PORT', '3001')),
      nodeEnv: this.getOptionalEnv('NODE_ENV', 'development'),
      
      // Rate Limiting
      rateLimitWindowMs: parseInt(this.getOptionalEnv('RATE_LIMIT_WINDOW_MS', '900000')),
      rateLimitMaxRequests: parseInt(this.getOptionalEnv('RATE_LIMIT_MAX_REQUESTS', '100')),
      rateLimitDelayMs: parseInt(this.getOptionalEnv('RATE_LIMIT_DELAY_MS', '0')),
      
      // AI Configuration
      defaultAiEngine: this.getOptionalEnv('DEFAULT_AI_ENGINE', 'claude'),
      maxTokensPerRequest: parseInt(this.getOptionalEnv('MAX_TOKENS_PER_REQUEST', '8000')),
      maxRequestsPerMinute: parseInt(this.getOptionalEnv('MAX_REQUESTS_PER_MINUTE', '20')),
      aiTimeoutMs: parseInt(this.getOptionalEnv('AI_TIMEOUT_MS', '30000')),
      
      // Database Configuration
      maxConcurrentTasks: parseInt(this.getOptionalEnv('MAX_CONCURRENT_TASKS', '3')),
      taskTimeoutMs: parseInt(this.getOptionalEnv('TASK_TIMEOUT_MS', '300000')),
      memoryRetentionDays: parseInt(this.getOptionalEnv('MEMORY_RETENTION_DAYS', '30')),
      maxRetryAttempts: parseInt(this.getOptionalEnv('MAX_RETRY_ATTEMPTS', '2')),
      
      // File Processing
      maxFileSizeBytes: parseInt(this.getOptionalEnv('MAX_FILE_SIZE_BYTES', '5242880')),
      maxFilesPerRequest: parseInt(this.getOptionalEnv('MAX_FILES_PER_REQUEST', '50')),
      allowedFileTypes: this.getOptionalEnv('ALLOWED_FILE_TYPES', '.ts,.tsx,.js,.jsx,.json,.css,.html,.md').split(','),
      
      // Logging and Monitoring
      logLevel: this.getOptionalEnv('LOG_LEVEL', 'info'),
      logToFile: this.getBooleanEnv('LOG_TO_FILE', true),
      logToConsole: this.getBooleanEnv('LOG_TO_CONSOLE', true),
      logRetentionDays: parseInt(this.getOptionalEnv('LOG_RETENTION_DAYS', '7')),
      
      // Security Event Logging
      securityLogEnabled: this.getBooleanEnv('SECURITY_LOG_ENABLED', true),
      failedAuthThreshold: parseInt(this.getOptionalEnv('FAILED_AUTH_THRESHOLD', '5')),
      ipBlockDurationMinutes: parseInt(this.getOptionalEnv('IP_BLOCK_DURATION_MINUTES', '15')),
      
      // Development Settings
      verboseLogging: this.getBooleanEnv('VERBOSE_LOGGING', false),
      debugMode: this.getBooleanEnv('DEBUG_MODE', false),
      enableApiDocs: this.getBooleanEnv('ENABLE_API_DOCS', config.nodeEnv === 'development'),
    };
    
    this.validateConfig(config);
    return config;
  }
  
  private getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value || value.includes('your_') || value.includes('your-')) {
      throw new Error(`Required environment variable ${key} is missing or contains placeholder value`);
    }
    return value;
  }
  
  private getOptionalEnv(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
  }
  
  private getBooleanEnv(key: string, defaultValue: boolean): boolean {
    const value = process.env[key];
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true' || value === '1';
  }
  
  private validateConfig(config: SecurityConfig): void {
    // Validate URLs
    if (!this.isValidUrl(config.supabaseUrl)) {
      throw new Error('Invalid SUPABASE_URL format');
    }
    
    if (!this.isValidUrl(config.frontendUrl)) {
      throw new Error('Invalid FRONTEND_URL format');
    }
    
    // Validate port range
    if (config.port < 1 || config.port > 65535) {
      throw new Error('PORT must be between 1 and 65535');
    }
    
    // Validate key lengths for security
    if (config.appSecretKey.length < 32) {
      throw new Error('APP_SECRET_KEY must be at least 32 characters long');
    }
    
    if (config.jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }
    
    if (config.encryptionKey.length < 32) {
      throw new Error('ENCRYPTION_KEY must be at least 32 characters long');
    }
    
    // Validate numeric ranges
    if (config.maxConcurrentTasks < 1 || config.maxConcurrentTasks > 10) {
      throw new Error('MAX_CONCURRENT_TASKS must be between 1 and 10');
    }
    
    if (config.maxFileSizeBytes > 50 * 1024 * 1024) { // 50MB limit
      throw new Error('MAX_FILE_SIZE_BYTES cannot exceed 50MB');
    }
    
    if (config.rateLimitMaxRequests < 1 || config.rateLimitMaxRequests > 1000) {
      throw new Error('RATE_LIMIT_MAX_REQUESTS must be between 1 and 1000');
    }
    
    // Validate AI configuration
    if (!['claude', 'gpt-4', 'gemini'].includes(config.defaultAiEngine)) {
      throw new Error('DEFAULT_AI_ENGINE must be one of: claude, gpt-4, gemini');
    }
    
    // Validate log level
    if (!['debug', 'info', 'warn', 'error', 'critical'].includes(config.logLevel)) {
      throw new Error('LOG_LEVEL must be one of: debug, info, warn, error, critical');
    }
    
    // Security warnings for production
    if (config.nodeEnv === 'production') {
      if (config.debugMode) {
        console.warn('⚠️  WARNING: DEBUG_MODE is enabled in production environment');
      }
      
      if (config.enableApiDocs) {
        console.warn('⚠️  WARNING: API documentation is enabled in production environment');
      }
      
      if (config.logLevel === 'debug') {
        console.warn('⚠️  WARNING: Debug logging is enabled in production environment');
      }
    }
  }
  
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
  
  public getConfig(): SecurityConfig {
    return { ...this.config };
  }
  
  public isProduction(): boolean {
    return this.config.nodeEnv === 'production';
  }
  
  public isDevelopment(): boolean {
    return this.config.nodeEnv === 'development';
  }
}

// Utility functions for encryption/decryption
export class SecurityUtils {
  private static algorithm = 'aes-256-gcm';
  
  public static encrypt(text: string, key: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(this.algorithm, key);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }
  
  public static decrypt(encryptedData: string, key: string): string {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const decipher = crypto.createDecipher(this.algorithm, key);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
  
  public static generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }
  
  public static hashPassword(password: string, salt?: string): string {
    const actualSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, actualSalt, 10000, 64, 'sha512');
    return actualSalt + ':' + hash.toString('hex');
  }
  
  public static verifyPassword(password: string, hashedPassword: string): boolean {
    const [salt, hash] = hashedPassword.split(':');
    const newHash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512');
    return hash === newHash.toString('hex');
  }
  
  public static sanitizeInput(input: string): string {
    // Remove potentially dangerous characters
    return input
      .replace(/[<>\"']/g, '') // Remove HTML/JS injection chars
      .replace(/\\/g, '') // Remove backslashes
      .replace(/\$\{/g, '') // Remove template literal injection
      .trim();
  }
  
  public static isValidFileType(filename: string, allowedTypes: string[]): boolean {
    const extension = filename.toLowerCase().substring(filename.lastIndexOf('.'));
    return allowedTypes.includes(extension);
  }
  
  public static validateApiKey(apiKey: string): boolean {
    // Basic API key validation
    return apiKey && 
           apiKey.length >= 32 && 
           !apiKey.includes('your_') && 
           !apiKey.includes('your-') &&
           !apiKey.includes('example');
  }
}

// Create and export singleton instance
const securityConfigValidator = new SecurityConfigValidator();
export const securityConfig = securityConfigValidator.getConfig();
export default securityConfigValidator;