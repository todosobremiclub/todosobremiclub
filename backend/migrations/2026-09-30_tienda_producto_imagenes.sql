-- Hasta 3 fotos por producto de la Tienda Online. Se mantiene imagen_url
-- (ya existente) como la foto 1 por compatibilidad con todo lo que ya lo
-- lee como campo único (Historial de ventas, Pendientes, notificaciones,
-- "Mis reservas" de la app, etc.); imagen_url_2 e imagen_url_3 son las
-- fotos adicionales, opcionales. El backend arma un array "imagenes" con
-- las que estén cargadas (sin huecos) para el carrusel de la app.
ALTER TABLE tienda_productos
  ADD COLUMN IF NOT EXISTS imagen_url_2 TEXT,
  ADD COLUMN IF NOT EXISTS imagen_url_3 TEXT;
