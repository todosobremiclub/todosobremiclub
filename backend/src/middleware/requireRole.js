function requireRole(roleNeeded) {
  return (req, res, next) => {
    const roles = req.user?.roles || [];
    const tieneRol = roles.some(r => r.role === roleNeeded);

    if (!tieneRol) {
      return res.status(403).json({ ok: false, error: 'No autorizado (rol insuficiente)' });
    }
    next();
  };
}

module.exports = requireRole;