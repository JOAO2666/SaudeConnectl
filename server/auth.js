import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, publicUser } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-before-production';
const TOKEN_TTL = process.env.JWT_TTL || '7d';

export function signToken(user, req) {
  const tokenId = crypto.randomUUID();
  const token = jwt.sign({ sub: user.id, role: user.role, jti: tokenId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
  const decoded = jwt.decode(token);

  db.prepare(`
    INSERT INTO auth_sessions (id, user_id, token_id, created_at, expires_at, ip_address, user_agent)
    VALUES (@id, @user_id, @token_id, @created_at, @expires_at, @ip_address, @user_agent)
  `).run({
    id: crypto.randomUUID(),
    user_id: user.id,
    token_id: tokenId,
    created_at: new Date().toISOString(),
    expires_at: new Date(Number(decoded.exp) * 1000).toISOString(),
    ip_address: req?.ip || null,
    user_agent: req?.get?.('user-agent') || null,
  });

  return token;
}

export function authRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Sessao necessaria.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.jti) {
      return res.status(401).json({ message: 'Sessao expirada ou invalida.' });
    }

    const session = db
      .prepare('SELECT * FROM auth_sessions WHERE token_id = ? AND user_id = ?')
      .get(payload.jti, payload.sub);

    if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
      return res.status(401).json({ message: 'Sessao expirada ou invalida.' });
    }

    const user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(payload.sub);

    if (!user) {
      return res.status(401).json({ message: 'Usuario nao encontrado.' });
    }

    req.user = user;
    req.publicUser = publicUser(user);
    req.authSession = session;
    return next();
  } catch {
    return res.status(401).json({ message: 'Sessao expirada ou invalida.' });
  }
}

export function revokeCurrentSession(req) {
  if (!req.authSession?.id) return;
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(
    new Date().toISOString(),
    req.authSession.id,
  );
}

export function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Acesso restrito a administradores.' });
  }
  return next();
}
