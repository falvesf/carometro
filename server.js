import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import {
  ROOT_DIR,
  DB_PATH,
  UPLOADS_DIR,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getStats,
  getSettings,
  updateSettings,
  exportAllData,
  restoreFromBackup,
} from './src/db.js';
import { generateCarometroPDF } from './src/pdfGenerator.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = express();

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static assets & frontend
app.use('/assets', express.static(path.join(ROOT_DIR, 'assets')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(ROOT_DIR, 'public')));

// Photo upload storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg'].includes(ext) ? ext : '.png';
    cb(null, `emp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif|bmp)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de imagem inválido. Utilize PNG ou JPG.'));
    }
  },
});

function parseEmployeeBody(body, file, existing = null) {
  const pick = (key, fallback = '') =>
    body[key] !== undefined ? body[key] : existing ? existing[key] : fallback;

  const assinVal =
    body.tem_assinatura_digitalizada !== undefined
      ? body.tem_assinatura_digitalizada === true ||
        body.tem_assinatura_digitalizada === 'true' ||
        body.tem_assinatura_digitalizada === '1' ||
        body.tem_assinatura_digitalizada === 1 ||
        body.tem_assinatura_digitalizada === 'on'
      : existing
        ? Boolean(existing.tem_assinatura_digitalizada)
        : true;

  const data = {
    codigo: pick('codigo', ''),
    nome: pick('nome', ''),
    cpf: pick('cpf', ''),
    endereco: pick('endereco', ''),
    data_nascimento: pick('data_nascimento', ''),
    sexo: pick('sexo', ''),
    email: pick('email', ''),
    rg: pick('rg', ''),
    emitido_por: pick('emitido_por', ''),
    data_emissao: pick('data_emissao', ''),
    data_contratacao: pick('data_contratacao', ''),
    data_demissao: pick('data_demissao', ''),
    tem_assinatura_digitalizada: assinVal,
    telefones: pick('telefones', ''),
    tipo: pick('tipo', 'Funcionário') || 'Funcionário',
    cargo: pick('cargo', ''),
  };

  if (file) {
    data.foto_path = file.filename;
  } else if (body.remove_photo === 'true' || body.remove_photo === true) {
    data.foto_path = '';
  }

  return data;
}

function removeUnusedPhoto(filename) {
  if (!filename) return;
  const safeName = path.basename(filename);
  const stillUsed = listEmployees().some((e) => e.foto_path === safeName);
  if (!stillUsed) {
    const target = path.join(UPLOADS_DIR, safeName);
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
      } catch {
        // Ignore cleanup failures
      }
    }
  }
}

function getLocalNetworkUrls() {
  const urls = [`http://localhost:${PORT}`];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

// API Routes
app.get('/api/info', (_req, res) => {
  res.json({
    status: 'online',
    database: 'SQLite Local (Persistente)',
    db_path: DB_PATH,
    urls: getLocalNetworkUrls(),
    stats: getStats(),
  });
});

app.get('/api/employees', (req, res) => {
  try {
    const employees = listEmployees(req.query);
    const stats = getStats();
    res.json({ employees, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/employees/:id', (req, res) => {
  const emp = getEmployee(parseInt(req.params.id, 10));
  if (!emp) return res.status(404).json({ error: 'Funcionário não encontrado.' });
  res.json(emp);
});

app.post('/api/employees', upload.single('foto'), (req, res) => {
  try {
    const data = parseEmployeeBody(req.body, req.file);
    if (!data.nome.trim()) {
      if (req.file) removeUnusedPhoto(req.file.filename);
      return res.status(400).json({ error: 'O nome do funcionário é obrigatório.' });
    }
    const created = createEmployee(data);
    res.status(201).json({ employee: created, stats: getStats() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/employees/:id', upload.single('foto'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = getEmployee(id);
    if (!existing) {
      if (req.file) removeUnusedPhoto(req.file.filename);
      return res.status(404).json({ error: 'Funcionário não encontrado.' });
    }

    const data = parseEmployeeBody(req.body, req.file, existing);
    if (!data.nome.trim()) {
      if (req.file) removeUnusedPhoto(req.file.filename);
      return res.status(400).json({ error: 'O nome do funcionário é obrigatório.' });
    }

    const oldPhoto = existing.foto_path;
    const updated = updateEmployee(id, data);

    if (oldPhoto && data.foto_path !== undefined && oldPhoto !== data.foto_path) {
      removeUnusedPhoto(oldPhoto);
    }

    res.json({ employee: updated, stats: getStats() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/employees/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const deleted = deleteEmployee(id);
    if (!deleted) return res.status(404).json({ error: 'Funcionário não encontrado.' });
    if (deleted.foto_path) {
      removeUnusedPhoto(deleted.foto_path);
    }
    res.json({ deleted, stats: getStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  try {
    const updated = updateSettings(req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/pdf', async (req, res) => {
  try {
    const settings = getSettings();
    const employees = listEmployees(req.query);
    const pdfOptions = {
      escola_nome: req.query.escola_nome || settings.escola_nome,
      titulo_relatorio: req.query.titulo_relatorio || settings.titulo_relatorio,
      usuario_rodape: req.query.usuario_rodape || settings.usuario_rodape,
      data_impressao: req.query.data_impressao || undefined,
    };

    const pdfBuffer = await generateCarometroPDF(employees, pdfOptions);
    const inline = req.query.inline === '1';
    const filename = `carometro_${new Date().toISOString().slice(0, 10)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${filename}"`
    );
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Erro ao gerar PDF:', err);
    res.status(500).json({ error: 'Erro ao gerar PDF: ' + err.message });
  }
});

app.get('/api/backup/json', (_req, res) => {
  const payload = exportAllData();
  const filename = `carometro_backup_${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(payload, null, 2));
});

app.get('/api/backup/db', (_req, res) => {
  const filename = `carometro_${new Date().toISOString().slice(0, 10)}.db`;
  res.download(DB_PATH, filename);
});

app.post('/api/restore', (req, res) => {
  try {
    const result = restoreFromBackup(req.body);
    res.json({ ok: true, ...result, stats: getStats() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Error handler for Multer / JSON errors
app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || 'Erro interno no servidor.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=== Carômetro Geral - Sistema Ativo ===`);
  console.log(`Banco de dados SQLite local: ${DB_PATH}`);
  for (const url of getLocalNetworkUrls()) {
    console.log(`Acesse em: ${url}`);
  }
  console.log(`Pressione Ctrl+C para encerrar.\n`);
});
