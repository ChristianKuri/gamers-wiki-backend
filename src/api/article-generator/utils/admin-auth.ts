import type { Core } from '@strapi/strapi';
import jwt from 'jsonwebtoken';

/**
 * Extract bearer token from Authorization header.
 */
export function getBearerToken(ctx: any): string | undefined {
  const authHeader = ctx.request?.headers?.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return undefined;
}

/**
 * Extract JWT token from cookie.
 * Strapi 5 stores admin JWT in an HttpOnly cookie named 'jwtToken'.
 */
export function getTokenFromCookie(ctx: any): string | undefined {
  // Try Koa's ctx.cookies.get() method first
  const cookieToken = ctx.cookies?.get?.('jwtToken');
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  
  // Fallback: Parse the Cookie header manually
  const cookieHeader = ctx.request?.headers?.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/jwtToken=([^;]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return undefined;
}

/**
 * Get the AI generation secret from custom header.
 */
export function getSecretFromHeader(ctx: any): string | undefined {
  const value = ctx.request?.headers?.['x-ai-generation-secret'];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Verify an admin JWT token using the ADMIN_JWT_SECRET.
 * Returns true if the token is valid and belongs to an admin user.
 */
export function verifyAdminToken(strapi: Core.Strapi, token: string): boolean {
  try {
    // Get the admin JWT secret from Strapi config
    const secret = strapi.config.get('admin.auth.secret') as string;
    
    if (!secret) {
      strapi.log.warn('[admin-auth] ADMIN_JWT_SECRET not configured');
      return false;
    }
    
    // Verify and decode the token
    const payload = jwt.verify(token, secret) as { 
      id?: number; 
      userId?: string; 
      type?: string;
    };
    
    // Strapi 5 admin tokens have either 'id' (number) or 'userId' (string)
    // and type should be 'access' for valid session tokens
    const hasValidId = typeof payload.id === 'number' || typeof payload.userId === 'string';
    
    strapi.log.debug(`[admin-auth] Token payload: ${JSON.stringify(payload)}`);
    
    return hasValidId;
  } catch (error) {
    // Token verification failed (expired, invalid signature, etc.)
    const message = error instanceof Error ? error.message : String(error);
    strapi.log.debug(`[admin-auth] Token verification failed: ${message}`);
    return false;
  }
}

/**
 * Check if the request is authenticated either via admin JWT or secret header.
 * Checks in order: Authorization header, Cookie, Secret header.
 * @returns true if authenticated, false otherwise
 */
export function isAuthenticated(
  strapi: Core.Strapi,
  ctx: any
): boolean {
  const secret = process.env.AI_GENERATION_SECRET;
  
  // Check for admin JWT in Authorization header first
  const bearerToken = getBearerToken(ctx);
  if (bearerToken) {
    strapi.log.debug('[admin-auth] Found bearer token in Authorization header');
    const isValidAdmin = verifyAdminToken(strapi, bearerToken);
    if (isValidAdmin) {
      strapi.log.debug('[admin-auth] Bearer token is valid');
      return true;
    }
    strapi.log.debug('[admin-auth] Bearer token verification failed');
  }
  
  // Check for admin JWT in cookie (Strapi 5 admin panel uses HttpOnly cookies)
  const cookieToken = getTokenFromCookie(ctx);
  if (cookieToken) {
    strapi.log.debug('[admin-auth] Found token in cookie');
    const isValidAdmin = verifyAdminToken(strapi, cookieToken);
    if (isValidAdmin) {
      strapi.log.debug('[admin-auth] Cookie token is valid');
      return true;
    }
    strapi.log.debug('[admin-auth] Cookie token verification failed');
  } else {
    strapi.log.debug('[admin-auth] No token found in cookie');
  }
  
  // Check for valid secret header (for programmatic/test access)
  if (secret && getSecretFromHeader(ctx) === secret) {
    strapi.log.debug('[admin-auth] Valid secret header');
    return true;
  }
  
  strapi.log.debug('[admin-auth] No valid authentication found');
  return false;
}
