import { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult, ValidationError } from 'express-validator';
import { SecurityUtils } from './config';
import { securityConfig } from './config';

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'email' | 'url' | 'uuid' | 'enum' | 'array';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enumValues?: string[];
  sanitize?: boolean;
  customValidator?: (value: any) => boolean | string;
}

export class InputValidator {
  /**
   * Generic validation middleware generator
   */
  static validate(rules: ValidationRule[]) {
    const validationChain = rules.map(rule => {
      let validator: any;
      
      // Determine validator source (body, param, query)
      if (rule.field.startsWith('params.')) {
        validator = param(rule.field.replace('params.', ''));
      } else if (rule.field.startsWith('query.')) {
        validator = query(rule.field.replace('query.', ''));
      } else {
        validator = body(rule.field);
      }
      
      // Apply required/optional
      if (rule.required) {
        validator = validator.notEmpty().withMessage(`${rule.field} is required`);
      } else {
        validator = validator.optional();
      }
      
      // Apply type-specific validations
      switch (rule.type) {
        case 'string':
          validator = validator.isString().withMessage(`${rule.field} must be a string`);
          if (rule.minLength) {
            validator = validator.isLength({ min: rule.minLength }).withMessage(`${rule.field} must be at least ${rule.minLength} characters`);
          }
          if (rule.maxLength) {
            validator = validator.isLength({ max: rule.maxLength }).withMessage(`${rule.field} must be at most ${rule.maxLength} characters`);
          }
          if (rule.pattern) {
            validator = validator.matches(rule.pattern).withMessage(`${rule.field} format is invalid`);
          }
          break;
          
        case 'number':
          validator = validator.isNumeric().withMessage(`${rule.field} must be a number`);
          if (rule.min !== undefined) {
            validator = validator.isFloat({ min: rule.min }).withMessage(`${rule.field} must be at least ${rule.min}`);
          }
          if (rule.max !== undefined) {
            validator = validator.isFloat({ max: rule.max }).withMessage(`${rule.field} must be at most ${rule.max}`);
          }
          break;
          
        case 'boolean':
          validator = validator.isBoolean().withMessage(`${rule.field} must be a boolean`);
          break;
          
        case 'email':
          validator = validator.isEmail().withMessage(`${rule.field} must be a valid email`);
          break;
          
        case 'url':
          validator = validator.isURL().withMessage(`${rule.field} must be a valid URL`);
          break;
          
        case 'uuid':
          validator = validator.isUUID().withMessage(`${rule.field} must be a valid UUID`);
          break;
          
        case 'enum':
          if (rule.enumValues) {
            validator = validator.isIn(rule.enumValues).withMessage(`${rule.field} must be one of: ${rule.enumValues.join(', ')}`);
          }
          break;
          
        case 'array':
          validator = validator.isArray().withMessage(`${rule.field} must be an array`);
          if (rule.minLength) {
            validator = validator.isLength({ min: rule.minLength }).withMessage(`${rule.field} must have at least ${rule.minLength} items`);
          }
          if (rule.maxLength) {
            validator = validator.isLength({ max: rule.maxLength }).withMessage(`${rule.field} must have at most ${rule.maxLength} items`);
          }
          break;
      }
      
      // Apply custom validator
      if (rule.customValidator) {
        validator = validator.custom((value: any) => {
          const result = rule.customValidator!(value);
          if (typeof result === 'string') {
            throw new Error(result);
          }
          return result;
        });
      }
      
      // Apply sanitization
      if (rule.sanitize && rule.type === 'string') {
        validator = validator.customSanitizer((value: string) => {
          return SecurityUtils.sanitizeInput(value);
        });
      }
      
      return validator;
    });
    
    return [
      ...validationChain,
      InputValidator.handleValidationErrors
    ];
  }
  
  /**
   * Handle validation errors
   */
  static handleValidationErrors(req: Request, res: Response, next: NextFunction) {
    const errors = validationResult(req);
    
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((error: ValidationError) => ({
        field: error.param || error.type,
        message: error.msg,
        value: error.value
      }));
      
      // Log security validation failure
      console.warn('Input validation failed:', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.originalUrl,
        errors: errorMessages
      });
      
      return res.status(400).json({
        success: false,
        error: 'Input validation failed',
        details: errorMessages
      });
    }
    
    next();
  }
  
  /**
   * Sanitize request data
   */
  static sanitizeRequest(req: Request, res: Response, next: NextFunction) {
    // Sanitize query parameters
    for (const key in req.query) {
      if (typeof req.query[key] === 'string') {
        req.query[key] = SecurityUtils.sanitizeInput(req.query[key] as string);
      }
    }
    
    // Sanitize body parameters (if they are strings)
    if (req.body && typeof req.body === 'object') {
      req.body = InputValidator.sanitizeObject(req.body);
    }
    
    next();
  }
  
  private static sanitizeObject(obj: any): any {
    if (typeof obj === 'string') {
      return SecurityUtils.sanitizeInput(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => InputValidator.sanitizeObject(item));
    }
    
    if (obj && typeof obj === 'object') {
      const sanitized: any = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = InputValidator.sanitizeObject(obj[key]);
        }
      }
      return sanitized;
    }
    
    return obj;
  }
  
  /**
   * File upload validation
   */
  static validateFileUpload(maxSize: number = securityConfig.maxFileSizeBytes) {
    return (req: Request, res: Response, next: NextFunction) => {
      if (!req.file && !req.files) {
        return next();
      }
      
      const files = req.files ? (Array.isArray(req.files) ? req.files : [req.files]) : [req.file];
      
      for (const file of files) {
        if (!file) continue;
        
        // Check file size
        if (file.size > maxSize) {
          return res.status(400).json({
            success: false,
            error: 'File too large',
            details: `File size must be less than ${maxSize / 1024 / 1024}MB`
          });
        }
        
        // Check file type
        if (!SecurityUtils.isValidFileType(file.originalname, securityConfig.allowedFileTypes)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid file type',
            details: `Allowed file types: ${securityConfig.allowedFileTypes.join(', ')}`
          });
        }
        
        // Check for potential malicious content
        if (InputValidator.containsMaliciousContent(file.originalname)) {
          return res.status(400).json({
            success: false,
            error: 'Potentially malicious file detected',
            details: 'File name contains suspicious characters'
          });
        }
      }
      
      next();
    };
  }
  
  private static containsMaliciousContent(filename: string): boolean {
    const maliciousPatterns = [
      /\.\./,  // Directory traversal
      /[<>:"\/\\|?*]/,  // Invalid filename characters
      /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i,  // Windows reserved names
      /\.(exe|bat|cmd|scr|pif|vbs|js)$/i,  // Executable extensions
    ];
    
    return maliciousPatterns.some(pattern => pattern.test(filename));
  }
  
  /**
   * Rate limiting validation
   */
  static validateRateLimit(maxRequests: number, windowMs: number) {
    const requests = new Map<string, { count: number; resetTime: number }>();
    
    return (req: Request, res: Response, next: NextFunction) => {
      const clientId = req.ip || 'unknown';
      const now = Date.now();
      const clientData = requests.get(clientId);
      
      if (!clientData || now > clientData.resetTime) {
        requests.set(clientId, { count: 1, resetTime: now + windowMs });
        return next();
      }
      
      if (clientData.count >= maxRequests) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          details: 'Too many requests, please try again later'
        });
      }
      
      clientData.count++;
      next();
    };
  }
}

// Pre-defined validation schemas for common endpoints
export const ValidationSchemas = {
  agentExecution: [
    { field: 'projectName', type: 'string' as const, required: true, minLength: 1, maxLength: 100, sanitize: true },
    { field: 'mode', type: 'enum' as const, required: true, enumValues: ['scan', 'enhance', 'add_modules', 'full'] },
    { field: 'aiEngine', type: 'enum' as const, required: false, enumValues: ['claude', 'gpt-4', 'gemini'] },
    { field: 'options.maxConcurrentTasks', type: 'number' as const, required: false, min: 1, max: 10 },
    { field: 'options.timeoutMs', type: 'number' as const, required: false, min: 10000, max: 600000 },
    { field: 'options.verboseLogging', type: 'boolean' as const, required: false }
  ],
  
  projectId: [
    { field: 'params.projectId', type: 'uuid' as const, required: true }
  ],
  
  logQuery: [
    { field: 'query.limit', type: 'number' as const, required: false, min: 1, max: 1000 },
    { field: 'query.level', type: 'enum' as const, required: false, enumValues: ['debug', 'info', 'warn', 'error', 'critical'] },
    { field: 'query.agentType', type: 'enum' as const, required: false, enumValues: ['scanner', 'improver', 'generator', 'orchestrator'] }
  ],
  
  cancelExecution: [
    { field: 'reason', type: 'string' as const, required: false, maxLength: 500, sanitize: true }
  ],
  
  testConnection: [
    { field: 'apiKey', type: 'string' as const, required: false, minLength: 32, customValidator: SecurityUtils.validateApiKey }
  ]
};

// Middleware factory for common validations
export const createValidationMiddleware = (schemaName: keyof typeof ValidationSchemas) => {
  return InputValidator.validate(ValidationSchemas[schemaName]);
};

// Security-focused middleware
export const securityMiddleware = [
  InputValidator.sanitizeRequest,
  InputValidator.validateRateLimit(
    securityConfig.rateLimitMaxRequests,
    securityConfig.rateLimitWindowMs
  )
];

export default InputValidator;