const { v4: uuidv4 } = require('uuid');
const { initFirebase } = require('../config/firebaseAdmin');

function buildTokenUrl(bucketName, filePath, token) {
  // URL persistente tipo Firebase "download token"
  // https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<pathEncoded>?alt=media&token=<token>
  const encodedPath = encodeURIComponent(filePath);
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
}

async function uploadImageBuffer({ buffer, mimetype, originalname, folder }) {
  const admin = initFirebase();
  if (!admin) throw new Error('Firebase no inicializado (faltan FIREBASE_*)');

  const bucket = admin.storage().bucket();
  const token = uuidv4();

  // nombre limpio + uuid para evitar colisiones
  const safeName = (originalname || 'file')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9.\-_]/g, '');

  const filePath = `${folder}/${Date.now()}-${uuidv4()}-${safeName}`;
  const file = bucket.file(filePath);

  await file.save(buffer, {
    metadata: {
      contentType: mimetype,
      metadata: {
        // token usado por Firebase para generar URL de descarga persistente
        firebaseStorageDownloadTokens: token
      }
    }
  });

  const bucketName = bucket.name;
  const url = buildTokenUrl(bucketName, filePath, token);

  return { url, filePath };
}

module.exports = { uploadImageBuffer };
