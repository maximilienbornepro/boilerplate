import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface AuthUser {
  id: number;
  email: string;
  isActive: boolean;
  isAdmin: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.auth_token;

  if (!token) {
    res.status(401).json({ error: 'Non authentifie' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Token invalide' });
    return;
  }
}

export function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies.auth_token;

  if (token) {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as AuthUser;
      req.user = decoded;
    } catch {
      // Token invalid, continue without user
    }
  }

  next();
}

export function adminMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Non authentifie' });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ error: 'Acces reserve aux administrateurs' });
    return;
  }

  next();
}
