const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) return res.status(401).json({ ok: false, error: 'Token requerido' });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload; // { userId, email, roles, ... }
    next();
  } catch (err) {
    return res.status(401).json({ ok: false, error: 'Token inválido' });
  }
}

module.exports = requireAuth;
