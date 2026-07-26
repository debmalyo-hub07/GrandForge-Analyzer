import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set and at least 32 characters');
  }
  return secret;
}

function extractToken(req: Request): string | undefined {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '');
}

export function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    // Pin to HS256 (the algorithm signToken uses) so a forged token claiming a
    // different alg (e.g. "none") can never be accepted — defense in depth.
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
      userId: string;
      email: string;
    };
    req.userId = payload.userId;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function signToken(payload: { userId: string; email: string }): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export function optionalAuth(req: AuthRequest, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      // Pin to HS256 (see requireAuth) — defense in depth against alg confusion.
      const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as {
        userId: string;
        email: string;
      };
      req.userId = payload.userId;
      req.userEmail = payload.email;
    } catch {
      /* ignore */
    }
  }
  next();
}
