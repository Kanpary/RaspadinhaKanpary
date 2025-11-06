import { verifyToken, getUserById } from './auth.js';

export function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.cookies?.token;
    
    if (!token) {
      return res.status(401).json({ error: 'Token não fornecido' });
    }

    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

export function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Acesso negado. Apenas administradores.' });
  }
  next();
}

export function errorHandler(err, req, res, next) {
  console.error('Erro:', err);
  
  if (err.message.includes('Token')) {
    return res.status(401).json({ error: err.message });
  }
  
  if (err.message.includes('não encontrado')) {
    return res.status(404).json({ error: err.message });
  }
  
  if (err.message.includes('já existe') || err.message.includes('inválido')) {
    return res.status(400).json({ error: err.message });
  }
  
  res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
}
