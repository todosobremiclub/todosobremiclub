const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length) return admin;

  // ✅ Opción A (recomendada): JSON completo en Base64
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(jsonStr);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET || serviceAccount.project_id + '.appspot.com'
    });

    return admin;
  }

  // ✅ Opción B (fallback): env vars sueltas (por si las querés seguir usando)
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    // Maneja claves pegadas como una sola línea con \n
    privateKey = privateKey.replace(/\\n/g, '\n').replace(/^"|"$/g, '');
  }

  const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

  if (!projectId || !clientEmail || !privateKey || !storageBucket) {
    console.warn('⚠️ Firebase no configurado. Falta FIREBASE_SERVICE_ACCOUNT_B64 o FIREBASE_*');
    return null;
  }

  admin.initializeApp({
    credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    storageBucket
  });

  return admin;
}

module.exports = { initFirebase };