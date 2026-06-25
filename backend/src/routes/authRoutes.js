const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const db = require('../db');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;

/**
 * POST /auth/login
 * body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Faltan email o password' });
    }

    // 1) Buscar usuario
    const rUser = await db.query(
      `SELECT id, email, password_hash, is_active
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [String(email).toLowerCase()]
    );

    if (rUser.rowCount === 0) {
      return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    }

    const user = rUser.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ ok: false, error: 'Usuario inactivo' });
    }

    // 2) Validar password
    const okPass = await bcrypt.compare(password, user.password_hash);
    if (!okPass) {
      return res.status(401).json({ ok: false, error: 'Credenciales incorrectas' });
    }

    // 3) Traer roles/clubs (FIX: LEFT JOIN para no perder roles si el club fue borrado
    //    o si superadmin no depende de club)
    const rRoles = await db.query(
      `SELECT
          uc.role,
          uc.club_id,
          c.name AS club_name
       FROM user_clubs uc
       LEFT JOIN clubs c ON c.id = uc.club_id
       WHERE uc.user_id = $1`,
      [user.id]
    );

    const roles = rRoles.rows || []; // [{role, club_id, club_name}, ...]

    // 4) Firmar JWT
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ ok: false, error: 'Falta JWT_SECRET en el servidor' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, roles },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      ok: true,
      token,
      user: { id: user.id, email: user.email, roles }
    });
  } catch (err) {
    console.error('❌ /auth/login error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

/**
 * GET /auth/me (requiere Bearer token)
 */
router.get('/me', requireAuth, (req, res) => {
  res.json({
    ok: true,
    user: {
      id: req.user.userId,   // el token trae userId
      email: req.user.email,
      roles: req.user.roles || []
    }
  });
});

// ==============================
// PASSWORD RESET REQUEST
// ==============================
router.post('/password-reset/request', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();

    // Siempre responder OK para seguridad
    const genericResponse = { ok: true };

    if (!email) return res.json(genericResponse);

    const r = await db.query(
      `SELECT id, email
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (!r.rowCount) {
      return res.json(genericResponse);
    }

    const user = r.rows[0];

    // Generar token seguro
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await db.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + interval '1 hour')`,
      [user.id, tokenHash]
    );

    const resetLink = `${process.env.APP_URL}/reset-password.html?token=${rawToken}`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS
      }
    });

    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: user.email,
      subject: 'Recuperar contraseña',
      text: `
Solicitaste cambiar tu contraseña.

Ingresá al siguiente link:
${resetLink}

Este enlace vence en 1 hora.
      `.trim()
    });

    return res.json(genericResponse);

  } catch (e) {
    console.error('❌ password-reset/request', e);
    return res.json({ ok: true });
  }
});


// ==============================
// PASSWORD RESET CONFIRM
// ==============================
router.post('/password-reset/confirm', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');

    if (!token) {
      return res.status(400).json({ ok: false, error: 'Token inválido' });
    }

    if (!PASSWORD_REGEX.test(password)) {
      return res.status(400).json({
        ok: false,
        error: 'La contraseña debe tener más de 8 caracteres, una mayúscula y un carácter especial'
      });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const r = await db.query(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );

    if (!r.rowCount) {
      return res.status(400).json({ ok: false, error: 'Token inválido o vencido' });
    }

    const row = r.rows[0];

    // Encriptar password
    const newHash = await bcrypt.hash(password, 10);

    await db.query('BEGIN');

    await db.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id = $2`,
      [newHash, row.user_id]
    );

    await db.query(
      `UPDATE password_reset_tokens
       SET used_at = NOW()
       WHERE user_id = $1`,
      [row.user_id]
    );

    await db.query('COMMIT');

    return res.json({ ok: true });

  } catch (e) {
    try { await db.query('ROLLBACK'); } catch {}
    console.error('❌ password-reset/confirm', e);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

module.exports = router;
