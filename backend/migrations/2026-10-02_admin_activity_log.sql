-- Log de auditoría de administradores: registra tanto los inicios de sesión
-- (exitosos y fallidos) como las acciones de escritura (crear/editar/
-- eliminar/cambios) que hacen los usuarios del panel admin (superadmin y
-- usuarios de club) en cualquier módulo del sistema.
--
-- Se conserva un máximo de 3 meses: un worker corre todos los días
-- (src/services/auditLogPurgeWorker.js, llamado desde src/app.js) y borra
-- automáticamente las filas con más de 3 meses de antigüedad.
CREATE TABLE IF NOT EXISTS admin_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Usuario que hizo la acción. Se guarda también el email "congelado" al
  -- momento del evento para que el registro siga siendo legible aunque el
  -- usuario se elimine más adelante (ON DELETE SET NULL en vez de CASCADE).
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,

  -- Club afectado por la acción (NULL si es una acción a nivel superadmin/
  -- global, sin un club puntual — ej: crear un club nuevo).
  club_id UUID,

  accion TEXT NOT NULL,        -- código corto, ej: 'login_exitoso', 'login_fallido', 'POST:tienda_productos'
  descripcion TEXT,            -- detalle legible, ej: "Creó tienda / productos"
  metodo_http TEXT,            -- GET/POST/PUT/PATCH/DELETE (NULL para eventos que no vienen de un request HTTP)
  ruta TEXT,                   -- path del request, ej: /club/<uuid>/tienda/productos
  status_code INTEGER,         -- código de respuesta HTTP de esa acción
  ip_address TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created_at ON admin_activity_log (created_at);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_user_id ON admin_activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_admin_activity_log_club_id ON admin_activity_log (club_id);
