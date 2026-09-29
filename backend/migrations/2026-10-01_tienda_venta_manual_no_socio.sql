-- Venta manual a "No socio": permite cargar una venta en el mostrador sin
-- vincularla a ningún socio del club (ej: un visitante que compra
-- indumentaria pero no es socio). socio_id pasa a ser opcional; cuando la
-- venta es a "No socio" se guarda un nombre de referencia opcional en
-- nombre_referencia (ej: "Juan - no socio") para poder identificarla en
-- el Historial de ventas.
ALTER TABLE tienda_reservas ALTER COLUMN socio_id DROP NOT NULL;
ALTER TABLE tienda_reservas ADD COLUMN IF NOT EXISTS nombre_referencia TEXT;
