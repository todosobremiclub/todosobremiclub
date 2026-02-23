const express = require('express');
const app = express();

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'todosobremiclub-backend' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ API listening on port ${PORT}`));
