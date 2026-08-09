const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer'); // ✅ NUEVO: para el email de bienvenida al usuario del club

const db = require('../db');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

// ===============================
// BIENVENIDA POR EMAIL – usuarios de club creados/asignados desde el superadmin
// ===============================

// Mismo transporter que ya usa el proyecto en authRoutes.js / sociosRoutes.js
function getMailTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
}

// Trae el nombre de los clubs a partir de una lista de club_id
async function getClubNamesByIds(clubIds) {
  const ids = [...new Set((clubIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const r = await db.query(`SELECT id, name FROM clubs WHERE id = ANY($1)`, [ids]);
  const map = {};
  r.rows.forEach((c) => {
    map[String(c.id)] = c.name;
  });
  return map;
}

const ROLE_LABELS = {
  admin: 'Administrador/a',
  solo_lectura: 'Solo lectura',
  comunicacion: 'Comunicación',
  finanzas: 'Finanzas',
  staff: 'Staff',
  profesor: 'Profesor/a',
  asistencias: 'Asistencias'
};

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

// ✅ Email de bienvenida cuando se crea un usuario NUEVO (incluye usuario y contraseña).
// Editar SOLO el contenido de este helper para cambiar la redacción del mail.
function buildNuevoUsuarioEmail({ fullName, email, password, asignaciones }) {
  const nombre = fullName || email;
  const loginUrl = `${process.env.APP_URL || 'https://www.todosobremiclub.com.ar'}/admin.html`;

  const listaClubsTxt = asignaciones
    .map((a) => `- ${a.clubName} (${roleLabel(a.role)})`)
    .join('\n');

  const listaClubsHtml = asignaciones
    .map((a) => `<li><b>${a.clubName}</b> — ${roleLabel(a.role)}</li>`)
    .join('');

  const subject = '¡Bienvenido/a a Todo Sobre Mi Club! Tus datos de acceso';

  const text = `Hola ${nombre},

¡Te damos la bienvenida a la plataforma Todo Sobre Mi Club!

Ya podés ingresar al panel de administración con estos datos:

Usuario: ${email}
Contraseña: ${password}

Club/es y rol asignado:
${listaClubsTxt}

Ingresá desde acá: ${loginUrl}

Por seguridad, te recomendamos cambiar la contraseña después de tu primer ingreso
(podés hacerlo desde la opción "Olvidé mi contraseña" en la pantalla de acceso).

Cualquier duda, respondé este mismo correo.

Saludos,
Equipo Todo Sobre Mi Club`;

  const html = `
    <div style="font-family:Arial, sans-serif; color:#111; max-width:520px;">
      <p>Hola <b>${nombre}</b>,</p>
      <p>¡Te damos la bienvenida a la plataforma <b>Todo Sobre Mi Club</b>!</p>
      <p>Ya podés ingresar al panel de administración con estos datos:</p>
      <table style="border-collapse:collapse; margin:12px 0;">
        <tr>
          <td style="padding:4px 8px; color:#555;">Usuario:</td>
          <td style="padding:4px 8px;"><b>${email}</b></td>
        </tr>
        <tr>
          <td style="padding:4px 8px; color:#555;">Contraseña:</td>
          <td style="padding:4px 8px;"><b>${password}</b></td>
        </tr>
      </table>
      <p>Club/es y rol asignado:</p>
      <ul>${listaClubsHtml}</ul>
      <p style="margin:20px 0;">
        <a href="${loginUrl}" target="_blank"
           style="background:#1a73e8; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; display:inline-block;">
          Ingresar a la plataforma
        </a>
      </p>
      <p style="color:#555; font-size:13px;">
        Por seguridad, te recomendamos cambiar la contraseña después de tu primer ingreso
        (opción "Olvidé mi contraseña" en la pantalla de acceso).
      </p>
      <p>Cualquier duda, respondé este mismo correo.</p>
      <p>Saludos,<br>Equipo Todo Sobre Mi Club</p>
    </div>
  `;

  return { subject, text, html };
}

// ✅ Email cuando un usuario YA EXISTENTE se agrega a un club nuevo
// (no se conoce ni se cambia su contraseña, así que no se incluye en el mail).
function buildUsuarioAgregadoClubEmail({ fullName, email, asignaciones }) {
  const nombre = fullName || email;
  const loginUrl = `${process.env.APP_URL || 'https://www.todosobremiclub.com.ar'}/admin.html`;

  const listaClubsTxt = asignaciones
    .map((a) => `- ${a.clubName} (${roleLabel(a.role)})`)
    .join('\n');

  const listaClubsHtml = asignaciones
    .map((a) => `<li><b>${a.clubName}</b> — ${roleLabel(a.role)}</li>`)
    .join('');

  const subject = 'Te agregamos a un nuevo club en Todo Sobre Mi Club';

  const text = `Hola ${nombre},

Te agregamos acceso a un nuevo club en la plataforma Todo Sobre Mi Club:

${listaClubsTxt}

Podés ingresar con tu cuenta habitual (usuario: ${email}) desde acá: ${loginUrl}

Si no recordás tu contraseña, usá la opción "Olvidé mi contraseña" en la pantalla de acceso.

Saludos,
Equipo Todo Sobre Mi Club`;

  const html = `
    <div style="font-family:Arial, sans-serif; color:#111; max-width:520px;">
      <p>Hola <b>${nombre}</b>,</p>
      <p>Te agregamos acceso a un nuevo club en la plataforma <b>Todo Sobre Mi Club</b>:</p>
      <ul>${listaClubsHtml}</ul>
      <p>Podés ingresar con tu cuenta habitual (usuario: <b>${email}</b>).</p>
      <p style="margin:20px 0;">
        <a href="${loginUrl}" target="_blank"
           style="background:#1a73e8; color:#fff; padding:10px 18px; border-radius:6px; text-decoration:none; display:inline-block;">
          Ingresar a la plataforma
        </a>
      </p>
      <p style="color:#555; font-size:13px;">
        Si no recordás tu contraseña, usá la opción "Olvidé mi contraseña" en la pantalla de acceso.
      </p>
      <p>Saludos,<br>Equipo Todo Sobre Mi Club</p>
    </div>
  `;

  return { subject, text, html };
}

// Envío best-effort: si falla, se loguea pero NO rompe la respuesta al superadmin
// (el usuario/club ya quedó creado/asignado en la base igual).
async function enviarEmailUsuarioClub({ to, subject, text, html }) {
  try {
    const transporter = getMailTransporter();
    await transporter.sendMail({
      from: `"Todo Sobre Mi Club" <${process.env.MAIL_USER}>`,
      to,
      subject,
      text,
      html
    });
    return true;
  } catch (e) {
    console.error('❌ error enviando email de bienvenida a usuario de club:', e.message);
    return false;
  }
}

// ================== LISTAR ==================
router.get('/', requireAuth, requireRole('superadmin'), async (_req, res) => {
  try {
    const r = await db.query(`
      SELECT
        u.id, u.email, u.full_name, u.is_active,
        json_agg(
          json_build_object(
            'club_id', uc.club_id,
            'club_name', c.name,
            'role', uc.role
          )
        ) AS roles
      FROM users u
      LEFT JOIN user_clubs uc ON uc.user_id = u.id
      LEFT JOIN clubs c ON c.id = uc.club_id
      GROUP BY u.id
      ORDER BY u.email
    `);
    res.json({ ok: true, users: r.rows });
  } catch (e) {
    console.error('❌ list users', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== CREAR ==================
router.post('/', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { email, full_name, password, assignments } = req.body || {};
  const is_active = (req.body?.is_active ?? true); // null/undefined => true

  try {
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan email o password' });
    }
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ ok: false, error: 'Faltan assignments (club/rol)' });
    }

    const emailNorm = String(email).trim().toLowerCase();
    const passHash = await bcrypt.hash(password, 10);

    await db.query('BEGIN');

    // ✅ Si el usuario ya existe, lo asignamos al club en vez de crear uno nuevo
    const rExisting = await db.query(
      'SELECT id, email, full_name, is_active FROM users WHERE email = $1',
      [emailNorm]
    );

    if (rExisting.rowCount > 0) {
      const existingUserId = rExisting.rows[0].id;
      const existingUser = rExisting.rows[0];
      const asignacionesAplicadas = [];

      for (const a of assignments) {
        if (!a?.club_id || !a?.role) continue;

        await db.query(
          `INSERT INTO user_clubs (user_id, club_id, role)
           VALUES ($1,$2,$3)
           ON CONFLICT (user_id, club_id) DO UPDATE SET role = EXCLUDED.role`,
          [existingUserId, a.club_id, a.role]
        );
        asignacionesAplicadas.push(a);
      }

      await db.query('COMMIT');

      // ✅ NUEVO: aviso por email de que se lo agregó a un club (best-effort).
      // No se envía contraseña porque la del usuario existente no se toca acá.
      if (asignacionesAplicadas.length) {
        const clubNames = await getClubNamesByIds(asignacionesAplicadas.map((a) => a.club_id));
        const asignacionesConNombre = asignacionesAplicadas.map((a) => ({
          role: a.role,
          clubName: clubNames[String(a.club_id)] || 'tu club'
        }));
        const { subject, text, html } = buildUsuarioAgregadoClubEmail({
          fullName: existingUser.full_name,
          email: existingUser.email,
          asignaciones: asignacionesConNombre
        });
        await enviarEmailUsuarioClub({ to: existingUser.email, subject, text, html });
      }

      return res.json({ ok: true, user: rExisting.rows[0] });
    }

    // ✅ Crear usuario nuevo
    const rUser = await db.query(
      `INSERT INTO users (email, full_name, password_hash, is_active)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, full_name, is_active`,
      [emailNorm, full_name || null, passHash, is_active]
    );

    const userId = rUser.rows[0].id;
    const asignacionesAplicadas = [];

    for (const a of assignments) {
      if (!a?.club_id || !a?.role) continue;

      await db.query(
        `INSERT INTO user_clubs (user_id, club_id, role)
         VALUES ($1,$2,$3)`,
        [userId, a.club_id, a.role]
      );
      asignacionesAplicadas.push(a);
    }

    await db.query('COMMIT');

    // ✅ NUEVO: enviar email de bienvenida con usuario y contraseña (best-effort,
    // si falla el envío no se revierte la creación del usuario).
    if (asignacionesAplicadas.length) {
      const clubNames = await getClubNamesByIds(asignacionesAplicadas.map((a) => a.club_id));
      const asignacionesConNombre = asignacionesAplicadas.map((a) => ({
        role: a.role,
        clubName: clubNames[String(a.club_id)] || 'tu club'
      }));
      const { subject, text, html } = buildNuevoUsuarioEmail({
        fullName: full_name,
        email: emailNorm,
        password,
        asignaciones: asignacionesConNombre
      });
      await enviarEmailUsuarioClub({ to: emailNorm, subject, text, html });
    }

    return res.json({ ok: true, user: rUser.rows[0] });

  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}

    // Si alguien pegó justo entre BEGIN y INSERT y explota, devolvemos algo claro
    if (e.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese email' });
    }
    console.error('❌ create user', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== EDITAR ==================
router.put('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { email, full_name, is_active, assignments, password } = req.body || {};

  try {
    const emailNorm = email ? String(email).trim().toLowerCase() : email;

    // ✅ FIX: antes este endpoint no leía `password` del body, así que si se
    // escribía una contraseña nueva en el formulario de edición, se ignoraba por
    // completo (el usuario seguía con la contraseña vieja). Ahora, si llega una
    // contraseña no vacía, se hashea y se actualiza junto con el resto de los datos.
    if (password) {
      const passHash = await bcrypt.hash(password, 10);
      await db.query(
        `UPDATE users
         SET email=$1, full_name=$2, is_active=COALESCE($3, is_active), password_hash=$4
         WHERE id=$5`,
        [emailNorm, full_name || null, is_active, passHash, id]
      );
    } else {
      await db.query(
        `UPDATE users SET email=$1, full_name=$2, is_active=COALESCE($3, is_active) WHERE id=$4`,
        [emailNorm, full_name || null, is_active, id]
      );
    }

    // ✅ FIX: antes se hacía `DELETE FROM user_clubs WHERE user_id=$1` y después se
    // insertaban solo las asignaciones que llegaban en este request. Como el
    // formulario "Editar usuario del club" únicamente manda la asignación del club
    // que se está editando en ese momento, esto borraba (sin avisar) el acceso del
    // usuario a CUALQUIER OTRO club al que también estuviera asignado. Ahora se
    // actualiza/inserta el rol solo para los club_id que llegan en `assignments`,
    // sin tocar las asignaciones a otros clubes.
    if (Array.isArray(assignments)) {
      for (const a of assignments) {
        if (!a?.club_id || !a?.role) continue;

        await db.query(
          `INSERT INTO user_clubs (user_id, club_id, role)
           VALUES ($1,$2,$3)
           ON CONFLICT (user_id, club_id) DO UPDATE SET role = EXCLUDED.role`,
          [id, a.club_id, a.role]
        );
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('❌ update user', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== ✅ ACTIVAR / DESACTIVAR (NUEVO) ==================
// PATCH /admin/users/:id/active
// body: { is_active: boolean }
router.patch('/:id/active', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body || {};

  try {
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'is_active debe ser boolean' });
    }

    const r = await db.query(
      `UPDATE users SET is_active=$1 WHERE id=$2 RETURNING id, email, is_active`,
      [is_active, id]
    );

    if (!r.rowCount) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    console.error('❌ toggle user active', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ================== ELIMINAR ==================
router.delete('/:id', requireAuth, requireRole('superadmin'), async (req, res) => {
  const { id } = req.params;

  try {
    await db.query('BEGIN');

    await db.query(`DELETE FROM user_clubs WHERE user_id=$1`, [id]);
    await db.query(`DELETE FROM password_reset_tokens WHERE user_id=$1`, [id]);
    await db.query(`DELETE FROM users WHERE id=$1`, [id]);

    await db.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try { await db.query('ROLLBACK'); } catch (_) {}
    console.error('❌ delete user', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
