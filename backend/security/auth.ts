import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { securityConfig, SecurityUtils } from './config';
import { createClient } from '@supabase/supabase-js';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
  lastActive: string;
  isActive: boolean;
}

export type UserRole = 'admin' | 'user' | 'readonly';

export type Permission = 
  | 'agent:execute'
  | 'agent:cancel'
  | 'agent:view'
  | 'logs:view'
  | 'logs:delete'
  | 'projects:create'
  | 'projects:view'
  | 'projects:delete'
  | 'system:admin'
  | 'api:test';

export interface AuthToken {
  userId: string;
  email: string;
  role: UserRole;
  permissions: Permission[];
  iat: number;
  exp: number;
}

export interface AuthRequest extends Request {
  user?: User;
  token?: AuthToken;
}

class AuthenticationManager {
  private supabase: any;
  private blockedIPs = new Map<string, { blockedUntil: number; attempts: number }>();
  private activeSessions = new Map<string, { userId: string; lastActive: number }>();
  
  constructor() {
    this.supabase = createClient(
      securityConfig.supabaseUrl,
      securityConfig.supabaseServiceRoleKey
    );
  }
  
  /**
   * Generate JWT token for authenticated user
   */
  generateToken(user: User): string {
    const payload: Omit<AuthToken, 'iat' | 'exp'> = {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions
    };
    
    return jwt.sign(payload, securityConfig.jwtSecret, {
      expiresIn: '24h',
      issuer: 'claude-agent-system',
      audience: 'api'
    });
  }
  
  /**
   * Verify and decode JWT token
   */
  verifyToken(token: string): AuthToken | null {
    try {
      const decoded = jwt.verify(token, securityConfig.jwtSecret, {
        issuer: 'claude-agent-system',
        audience: 'api'
      }) as AuthToken;
      
      return decoded;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Create new user account
   */
  async createUser(email: string, password: string, role: UserRole = 'user'): Promise<User> {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new Error('Invalid email format');
    }
    
    // Validate password strength
    if (!this.isStrongPassword(password)) {
      throw new Error('Password must be at least 8 characters with uppercase, lowercase, number, and special character');
    }
    
    // Check if user already exists
    const { data: existingUser } = await this.supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      throw new Error('User already exists');
    }
    
    // Hash password
    const hashedPassword = SecurityUtils.hashPassword(password);
    
    // Create user
    const userData = {
      id: SecurityUtils.generateSecureToken(),
      email,
      password_hash: hashedPassword,
      role,
      permissions: this.getRolePermissions(role),
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString(),
      is_active: true
    };
    
    const { data: newUser, error } = await this.supabase
      .from('users')
      .insert(userData)
      .select()
      .single();
    
    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }
    
    return this.mapDbUserToUser(newUser);
  }
  
  /**
   * Authenticate user with email and password
   */
  async authenticateUser(email: string, password: string, ip: string): Promise<{ user: User; token: string }> {
    // Check IP blocking
    if (this.isIPBlocked(ip)) {
      throw new Error('IP address is temporarily blocked due to multiple failed attempts');
    }
    
    try {
      // Get user from database
      const { data: dbUser, error } = await this.supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .eq('is_active', true)
        .single();
      
      if (error || !dbUser) {
        this.recordFailedAttempt(ip);
        throw new Error('Invalid credentials');
      }
      
      // Verify password
      if (!SecurityUtils.verifyPassword(password, dbUser.password_hash)) {
        this.recordFailedAttempt(ip);
        throw new Error('Invalid credentials');
      }
      
      // Update last active
      await this.supabase
        .from('users')
        .update({ last_active: new Date().toISOString() })
        .eq('id', dbUser.id);
      
      const user = this.mapDbUserToUser(dbUser);
      const token = this.generateToken(user);
      
      // Record successful login
      this.clearFailedAttempts(ip);
      this.recordActiveSession(token, user.id);
      
      return { user, token };
    } catch (error) {
      this.recordFailedAttempt(ip);
      throw error;
    }
  }
  
  /**
   * Refresh authentication token
   */
  async refreshToken(oldToken: string): Promise<string> {
    const decoded = this.verifyToken(oldToken);
    if (!decoded) {
      throw new Error('Invalid token');
    }
    
    // Get current user data
    const { data: dbUser, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .eq('is_active', true)
      .single();
    
    if (error || !dbUser) {
      throw new Error('User not found or inactive');
    }
    
    const user = this.mapDbUserToUser(dbUser);
    return this.generateToken(user);
  }
  
  /**
   * Logout user and invalidate session
   */
  async logout(token: string): Promise<void> {
    const decoded = this.verifyToken(token);
    if (decoded) {
      this.activeSessions.delete(token);
      
      // Log logout event
      await this.logSecurityEvent('user_logout', {
        userId: decoded.userId,
        email: decoded.email
      });
    }
  }
  
  /**
   * Get user permissions based on role
   */
  private getRolePermissions(role: UserRole): Permission[] {
    const rolePermissions: Record<UserRole, Permission[]> = {
      admin: [
        'agent:execute', 'agent:cancel', 'agent:view',
        'logs:view', 'logs:delete',
        'projects:create', 'projects:view', 'projects:delete',
        'system:admin', 'api:test'
      ],
      user: [
        'agent:execute', 'agent:cancel', 'agent:view',
        'logs:view',
        'projects:create', 'projects:view',
        'api:test'
      ],
      readonly: [
        'agent:view',
        'logs:view',
        'projects:view'
      ]
    };
    
    return rolePermissions[role] || [];
  }
  
  private isStrongPassword(password: string): boolean {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
  }
  
  private isIPBlocked(ip: string): boolean {
    const blockData = this.blockedIPs.get(ip);
    if (!blockData) return false;
    
    if (Date.now() > blockData.blockedUntil) {
      this.blockedIPs.delete(ip);
      return false;
    }
    
    return true;
  }
  
  private recordFailedAttempt(ip: string): void {
    const blockData = this.blockedIPs.get(ip) || { blockedUntil: 0, attempts: 0 };
    blockData.attempts++;
    
    if (blockData.attempts >= securityConfig.failedAuthThreshold) {
      blockData.blockedUntil = Date.now() + (securityConfig.ipBlockDurationMinutes * 60 * 1000);
      this.logSecurityEvent('ip_blocked', { ip, attempts: blockData.attempts });
    }
    
    this.blockedIPs.set(ip, blockData);
  }
  
  private clearFailedAttempts(ip: string): void {
    this.blockedIPs.delete(ip);
  }
  
  private recordActiveSession(token: string, userId: string): void {
    this.activeSessions.set(token, {
      userId,
      lastActive: Date.now()
    });
  }
  
  private mapDbUserToUser(dbUser: any): User {
    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
      permissions: dbUser.permissions || this.getRolePermissions(dbUser.role),
      createdAt: dbUser.created_at,
      lastActive: dbUser.last_active,
      isActive: dbUser.is_active
    };
  }
  
  private async logSecurityEvent(eventType: string, data: any): Promise<void> {
    if (securityConfig.securityLogEnabled) {
      try {
        await this.supabase
          .from('security_logs')
          .insert({
            event_type: eventType,
            data,
            timestamp: new Date().toISOString(),
            ip_address: data.ip
          });
      } catch (error) {
        console.error('Failed to log security event:', error);
      }
    }
  }
}

// Middleware functions
export class AuthMiddleware {
  private static authManager = new AuthenticationManager();
  
  /**
   * Authenticate request using JWT token
   */
  static authenticateToken(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access token required'
      });
    }
    
    const decoded = AuthMiddleware.authManager.verifyToken(token);
    if (!decoded) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    req.token = decoded;
    next();
  }
  
  /**
   * Check if user has required permission
   */
  static requirePermission(permission: Permission) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }
      
      if (!req.token.permissions.includes(permission)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions'
        });
      }
      
      next();
    };
  }
  
  /**
   * Check if user has required role
   */
  static requireRole(role: UserRole) {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
      if (!req.token) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }
      
      if (req.token.role !== role && req.token.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Insufficient role'
        });
      }
      
      next();
    };
  }
  
  /**
   * Optional authentication - sets user if token is valid but doesn't require it
   */
  static optionalAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      const decoded = AuthMiddleware.authManager.verifyToken(token);
      if (decoded) {
        req.token = decoded;
      }
    }
    
    next();
  }
}

// Create and export singleton instance
const authManager = new AuthenticationManager();
export { authManager };
export default AuthMiddleware;