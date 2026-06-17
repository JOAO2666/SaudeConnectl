import jwt from 'jsonwebtoken';
import { db, publicUser } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-before-production';
const TOKEN_TTL = process.env.JWT_TTL || '7d';

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function authRequired(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: 'Sessao necessaria.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(payload.sub);

    if (!user) {
      return res.status(401).json({ message: 'Usuario nao encontrado.' });
    }

    req.user = user;
    req.publicUser = publicUser(user);
    return next();
  } catch {
    return res.status(401).json({ message: 'Sessao expirada ou invalida.' });
  }
}

export function adminRequired(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Acesso restrito a administradores.' });
  }
  return next();
}
