import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = path.join(DATA_DIR, 'carometro.db');
const SEED_PATH = path.join(ROOT_DIR, 'seed', 'employees.json');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Single-file journal mode prevents -wal/-shm sync conflicts inside OneDrive folders
db.exec(`
  PRAGMA journal_mode = DELETE;
  PRAGMA synchronous = FULL;
  PRAGMA foreign_keys = ON;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT NOT NULL DEFAULT '',
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL DEFAULT '',
    endereco TEXT NOT NULL DEFAULT '',
    data_nascimento TEXT NOT NULL DEFAULT '',
    sexo TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    rg TEXT NOT NULL DEFAULT '',
    emitido_por TEXT NOT NULL DEFAULT '',
    data_emissao TEXT NOT NULL DEFAULT '',
    data_contratacao TEXT NOT NULL DEFAULT '',
    data_demissao TEXT NOT NULL DEFAULT '',
    tem_assinatura_digitalizada INTEGER NOT NULL DEFAULT 1,
    telefones TEXT NOT NULL DEFAULT '',
    tipo TEXT NOT NULL DEFAULT 'Funcionário',
    cargo TEXT NOT NULL DEFAULT '',
    foto_path TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_employees_nome ON employees(nome);
  CREATE INDEX IF NOT EXISTS idx_employees_codigo ON employees(codigo);
  CREATE INDEX IF NOT EXISTS idx_employees_tipo ON employees(tipo);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const DEFAULT_SETTINGS = {
  escola_nome: 'Escola Adventista de Ibiúna',
  titulo_relatorio: 'CARÔMETRO GERAL - 2026 - ANO LETIVO',
  usuario_rodape: 'daniele.moraes@adm.educadventista.org',
  ordenacao_padrao: 'nome_asc',
};

function initSettingsAndSeed() {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }

  const seededRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('initial_seeded');
  const countRow = db.prepare('SELECT COUNT(*) as total FROM employees').get();

  if (!seededRow && countRow.total === 0 && fs.existsSync(SEED_PATH)) {
    const seedData = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    const insertEmp = db.prepare(`
      INSERT INTO employees (
        codigo, nome, cpf, endereco, data_nascimento, sexo, email,
        rg, emitido_por, data_emissao, data_contratacao, data_demissao,
        tem_assinatura_digitalizada, telefones, tipo, cargo, foto_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN');
    try {
      for (const emp of seedData) {
        insertEmp.run(
          emp.codigo || '',
          emp.nome || '',
          emp.cpf || '',
          emp.endereco || '',
          emp.data_nascimento || '',
          emp.sexo || '',
          emp.email || '',
          emp.rg || '',
          emp.emitido_por || '',
          emp.data_emissao || '',
          emp.data_contratacao || '',
          emp.data_demissao || '',
          emp.tem_assinatura_digitalizada ? 1 : 0,
          emp.telefones || '',
          emp.tipo || 'Professor',
          emp.cargo || (emp.tipo === 'Professor' ? 'Professor(a)' : ''),
          emp.foto || ''
        );
      }
      insertSetting.run('initial_seeded', '1');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

initSettingsAndSeed();

function normalizeOrder(order) {
  switch (order) {
    case 'nome_desc':
      return 'nome COLLATE NOCASE DESC, id DESC';
    case 'codigo_asc':
      return 'CAST(NULLIF(codigo, "") AS INTEGER) ASC, codigo ASC, nome COLLATE NOCASE ASC';
    case 'codigo_desc':
      return 'CAST(NULLIF(codigo, "") AS INTEGER) DESC, codigo DESC, nome COLLATE NOCASE ASC';
    case 'recentes':
      return 'id DESC';
    case 'nome_asc':
    default:
      return 'nome COLLATE NOCASE ASC, id ASC';
  }
}

export function listEmployees(filters = {}) {
  const { q = '', tipo = '', status = '', assinatura = '', order = 'nome_asc', ids = '' } = filters;
  const where = [];
  const params = [];

  if (ids) {
    const idList = String(ids)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (idList.length > 0) {
      where.push(`id IN (${idList.map(() => '?').join(',')})`);
      params.push(...idList);
    }
  }

  if (q && q.trim()) {
    const term = `%${q.trim()}%`;
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3) {
      where.push(`(
        nome LIKE ? OR codigo LIKE ? OR cpf LIKE ? OR REPLACE(REPLACE(cpf, '.', ''), '-', '') LIKE ?
        OR rg LIKE ? OR email LIKE ? OR endereco LIKE ? OR telefones LIKE ? OR cargo LIKE ?
      )`);
      params.push(term, term, term, `%${digits}%`, term, term, term, term, term);
    } else {
      where.push(`(
        nome LIKE ? OR codigo LIKE ? OR cpf LIKE ? OR rg LIKE ?
        OR email LIKE ? OR endereco LIKE ? OR telefones LIKE ? OR cargo LIKE ?
      )`);
      params.push(term, term, term, term, term, term, term, term);
    }
  }

  if (tipo && tipo !== 'Todos') {
    where.push('tipo = ?');
    params.push(tipo);
  }

  if (status === 'Ativos') {
    where.push(`TRIM(COALESCE(data_demissao, '')) = ''`);
  } else if (status === 'Demitidos') {
    where.push(`TRIM(COALESCE(data_demissao, '')) <> ''`);
  }

  if (assinatura === 'sim') {
    where.push('tem_assinatura_digitalizada = 1');
  } else if (assinatura === 'nao') {
    where.push('tem_assinatura_digitalizada = 0');
  }

  const sql = `
    SELECT * FROM employees
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${normalizeOrder(order)}
  `;
  return db.prepare(sql).all(...params);
}

export function getEmployee(id) {
  return db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
}

export function createEmployee(data) {
  const stmt = db.prepare(`
    INSERT INTO employees (
      codigo, nome, cpf, endereco, data_nascimento, sexo, email,
      rg, emitido_por, data_emissao, data_contratacao, data_demissao,
      tem_assinatura_digitalizada, telefones, tipo, cargo, foto_path
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    String(data.codigo ?? '').trim(),
    String(data.nome ?? '').trim(),
    String(data.cpf ?? '').trim(),
    String(data.endereco ?? '').trim(),
    String(data.data_nascimento ?? '').trim(),
    String(data.sexo ?? '').trim(),
    String(data.email ?? '').trim(),
    String(data.rg ?? '').trim(),
    String(data.emitido_por ?? '').trim(),
    String(data.data_emissao ?? '').trim(),
    String(data.data_contratacao ?? '').trim(),
    String(data.data_demissao ?? '').trim(),
    data.tem_assinatura_digitalizada ? 1 : 0,
    String(data.telefones ?? '').trim(),
    String(data.tipo || 'Funcionário').trim(),
    String(data.cargo ?? '').trim(),
    String(data.foto_path ?? '').trim()
  );
  return getEmployee(info.lastInsertRowid);
}

export function updateEmployee(id, data) {
  const existing = getEmployee(id);
  if (!existing) return null;

  const stmt = db.prepare(`
    UPDATE employees SET
      codigo = ?,
      nome = ?,
      cpf = ?,
      endereco = ?,
      data_nascimento = ?,
      sexo = ?,
      email = ?,
      rg = ?,
      emitido_por = ?,
      data_emissao = ?,
      data_contratacao = ?,
      data_demissao = ?,
      tem_assinatura_digitalizada = ?,
      telefones = ?,
      tipo = ?,
      cargo = ?,
      foto_path = ?,
      updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `);

  stmt.run(
    String(data.codigo ?? existing.codigo).trim(),
    String(data.nome ?? existing.nome).trim(),
    String(data.cpf ?? existing.cpf).trim(),
    String(data.endereco ?? existing.endereco).trim(),
    String(data.data_nascimento ?? existing.data_nascimento).trim(),
    String(data.sexo ?? existing.sexo).trim(),
    String(data.email ?? existing.email).trim(),
    String(data.rg ?? existing.rg).trim(),
    String(data.emitido_por ?? existing.emitido_por).trim(),
    String(data.data_emissao ?? existing.data_emissao).trim(),
    String(data.data_contratacao ?? existing.data_contratacao).trim(),
    String(data.data_demissao ?? existing.data_demissao).trim(),
    data.tem_assinatura_digitalizada !== undefined
      ? (data.tem_assinatura_digitalizada ? 1 : 0)
      : existing.tem_assinatura_digitalizada,
    String(data.telefones ?? existing.telefones).trim(),
    String(data.tipo ?? existing.tipo).trim(),
    String(data.cargo ?? existing.cargo).trim(),
    data.foto_path !== undefined ? String(data.foto_path).trim() : existing.foto_path,
    id
  );
  return getEmployee(id);
}

export function deleteEmployee(id) {
  const existing = getEmployee(id);
  if (!existing) return null;
  db.prepare('DELETE FROM employees WHERE id = ?').run(id);
  return existing;
}

export function getStats() {
  return db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN tipo = 'Professor' THEN 1 ELSE 0 END) as professores,
      SUM(CASE WHEN tipo <> 'Professor' THEN 1 ELSE 0 END) as funcionarios,
      SUM(CASE WHEN TRIM(COALESCE(data_demissao, '')) = '' THEN 1 ELSE 0 END) as ativos,
      SUM(CASE WHEN TRIM(COALESCE(data_demissao, '')) <> '' THEN 1 ELSE 0 END) as demitidos
    FROM employees
  `).get();
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key !== 'initial_seeded') {
      result[row.key] = row.value;
    }
  }
  return result;
}

export function updateSettings(updates) {
  const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(updates)) {
      if (k in DEFAULT_SETTINGS) {
        upsert.run(k, String(v ?? ''));
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return getSettings();
}

export function exportAllData() {
  return {
    exported_at: new Date().toISOString(),
    settings: getSettings(),
    employees: db.prepare('SELECT * FROM employees ORDER BY nome COLLATE NOCASE ASC').all(),
  };
}

export function restoreFromBackup(payload) {
  if (!payload || !Array.isArray(payload.employees)) {
    throw new Error('Arquivo de backup inválido.');
  }

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM employees');
    const insertEmp = db.prepare(`
      INSERT INTO employees (
        codigo, nome, cpf, endereco, data_nascimento, sexo, email,
        rg, emitido_por, data_emissao, data_contratacao, data_demissao,
        tem_assinatura_digitalizada, telefones, tipo, cargo, foto_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const emp of payload.employees) {
      insertEmp.run(
        emp.codigo || '',
        emp.nome || '',
        emp.cpf || '',
        emp.endereco || '',
        emp.data_nascimento || '',
        emp.sexo || '',
        emp.email || '',
        emp.rg || '',
        emp.emitido_por || '',
        emp.data_emissao || '',
        emp.data_contratacao || '',
        emp.data_demissao || '',
        emp.tem_assinatura_digitalizada ? 1 : 0,
        emp.telefones || '',
        emp.tipo || 'Funcionário',
        emp.cargo || '',
        emp.foto_path || ''
      );
    }
    if (payload.settings && typeof payload.settings === 'object') {
      const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
      for (const [k, v] of Object.entries(payload.settings)) {
        if (k in DEFAULT_SETTINGS) {
          upsert.run(k, String(v ?? ''));
        }
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { count: payload.employees.length };
}

export function getDbInstance() {
  return db;
}
