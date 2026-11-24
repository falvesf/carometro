export const PRINT_FIELDS_STORAGE_KEY = 'carometro_print_fields_v1';

export const PRINT_FIELD_CATALOG = [
  { key: 'foto', label: 'Foto 3x4', defaultEnabled: true, defaultBold: false, isPhoto: true },
  { key: 'codigo', label: 'Código / Matrícula', defaultEnabled: true, defaultBold: true, slotW: 48 },
  { key: 'nome', label: 'Nome Completo', defaultEnabled: true, defaultBold: true, slotW: 385 },
  { key: 'cpf', label: 'CPF', defaultEnabled: true, defaultBold: false, slotW: 95 },
  { key: 'endereco', label: 'Endereço', defaultEnabled: true, defaultBold: false, fullWidth: true },
  { key: 'data_nascimento', label: 'Data de Nascimento', defaultEnabled: true, defaultBold: false, slotW: 174 },
  { key: 'sexo', label: 'Sexo', defaultEnabled: true, defaultBold: false, slotW: 93 },
  { key: 'email', label: 'E-mail', defaultEnabled: true, defaultBold: false, slotW: 213 },
  { key: 'rg', label: 'RG', defaultEnabled: true, defaultBold: false, slotW: 174 },
  { key: 'emitido_por', label: 'Emitido por', defaultEnabled: true, defaultBold: false, slotW: 168 },
  { key: 'data_emissao', label: 'Data emissão (RG)', defaultEnabled: true, defaultBold: false, slotW: 138 },
  { key: 'data_contratacao', label: 'Data de contratação', defaultEnabled: true, defaultBold: false, slotW: 174 },
  { key: 'data_demissao', label: 'Data de demissão', defaultEnabled: true, defaultBold: false, slotW: 168 },
  {
    key: 'tem_assinatura_digitalizada',
    label: 'Tem assinatura digitalizada',
    defaultEnabled: true,
    defaultBold: false,
    slotW: 138,
    isCheckmark: true,
  },
  { key: 'telefones', label: 'Telefones', defaultEnabled: true, defaultBold: false, fullWidth: true },
  { key: 'cargo', label: 'Cargo / Função', defaultEnabled: true, defaultBold: false, fullWidth: true },
  { key: 'tipo', label: 'Categoria (Professor / Funcionário)', defaultEnabled: false, defaultBold: false, slotW: 174 },
];

const CATALOG_MAP = new Map(PRINT_FIELD_CATALOG.map((f) => [f.key, f]));

export function getDefaultPrintFieldsConfig() {
  return PRINT_FIELD_CATALOG.map((f) => ({
    key: f.key,
    enabled: f.defaultEnabled,
    bold: f.defaultBold,
  }));
}

export function normalizePrintFieldsConfig(rawList) {
  const defaults = getDefaultPrintFieldsConfig();
  if (!Array.isArray(rawList) || rawList.length === 0) return defaults;

  const seen = new Set();
  const normalized = [];
  for (const item of rawList) {
    if (!item || !CATALOG_MAP.has(item.key) || seen.has(item.key)) continue;
    seen.add(item.key);
    normalized.push({
      key: item.key,
      enabled: Boolean(item.enabled),
      bold: Boolean(item.bold),
    });
  }
  for (const def of defaults) {
    if (!seen.has(def.key)) {
      normalized.push({ ...def });
    }
  }
  return normalized;
}

export function loadPrintFieldsConfig() {
  try {
    const raw = localStorage.getItem(PRINT_FIELDS_STORAGE_KEY);
    if (!raw) return getDefaultPrintFieldsConfig();
    return normalizePrintFieldsConfig(JSON.parse(raw));
  } catch {
    return getDefaultPrintFieldsConfig();
  }
}

export function savePrintFieldsConfig(config) {
  const clean = normalizePrintFieldsConfig(config);
  try {
    localStorage.setItem(PRINT_FIELDS_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // ignore storage errors
  }
  return clean;
}

export function formatPrintFieldValue(key, emp, isTopName = false) {
  switch (key) {
    case 'codigo':
      return String(emp.codigo || '');
    case 'nome':
      return isTopName ? String(emp.nome || '') : `Nome: ${emp.nome || ''}`;
    case 'cpf':
      return `CPF: ${emp.cpf || ''}`;
    case 'endereco':
      return `Endereço: ${emp.endereco || ''}`;
    case 'data_nascimento':
      return `Data de Nascimento: ${emp.data_nascimento || ''}`;
    case 'sexo':
      return `Sexo: ${emp.sexo || ''}`;
    case 'email':
      return `E-mail: ${emp.email || ''}`;
    case 'rg':
      return `RG: ${emp.rg || ''}`;
    case 'emitido_por':
      return `Emitido por: ${emp.emitido_por || ''}`;
    case 'data_emissao':
      return `Data emissão: ${emp.data_emissao || ''}`;
    case 'data_contratacao':
      return `Data de contratação: ${emp.data_contratacao || ''}`;
    case 'data_demissao':
      return `Data de demissão: ${emp.data_demissao || ''}`;
    case 'tem_assinatura_digitalizada':
      return 'Tem assinatura digitalizada:';
    case 'telefones':
      return `Telefones: ${emp.telefones || ''}`;
    case 'cargo': {
      const cargoVal = emp.cargo || (emp.tipo === 'Professor' ? 'Professor(a)' : '');
      return `Cargo / Função: ${cargoVal}`;
    }
    case 'tipo':
      return `Categoria: ${emp.tipo || ''}`;
    default:
      return '';
  }
}

/**
 * Packs active print fields into ordered rows matching the A4 model geometry.
 */
export function buildPackedCardLayout(fieldsConfig, emp, options = {}) {
  const showCargo = options.showCargo !== false;
  const config = normalizePrintFieldsConfig(fieldsConfig);

  const fotoItem = config.find((f) => f.key === 'foto');
  const showPhoto = fotoItem ? fotoItem.enabled : true;
  const maxRowWidth = showPhoto ? 480 : 559;

  const active = config.filter((f) => {
    if (!f.enabled || f.key === 'foto') return false;
    if (f.key === 'cargo' && !showCargo) return false;
    return true;
  });

  const rows = [];
  let currentRow = [];
  let usedW = 0;

  const flushRow = () => {
    if (currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
      usedW = 0;
    }
  };

  for (let i = 0; i < active.length; i++) {
    const f = active[i];
    const meta = CATALOG_MAP.get(f.key);

    // Special natural pairing: codigo immediately followed by nome shares the header slot (385pt)
    if (f.key === 'codigo' && active[i + 1]?.key === 'nome') {
      const nomeCfg = active[i + 1];
      const pairWidth = showPhoto ? 385 : 460;
      if (usedW + pairWidth > maxRowWidth) flushRow();
      currentRow.push({
        type: 'code_name_pair',
        xPt: usedW,
        widthPt: pairWidth,
        codigo: String(emp.codigo || ''),
        codigoBold: f.bold,
        nome: String(emp.nome || ''),
        nomeBold: nomeCfg.bold,
      });
      usedW += pairWidth;
      i++; // consumed nome as well
      continue;
    }

    if (meta.fullWidth) {
      flushRow();
      rows.push([
        {
          type: 'full',
          key: f.key,
          xPt: 0,
          widthPt: showPhoto ? 468 : 555,
          text: formatPrintFieldValue(f.key, emp, false),
          bold: f.bold,
        },
      ]);
      continue;
    }

    const isTopRow = rows.length === 0 && currentRow.length === 0;
    let slotW = meta.slotW || 174;
    let text = formatPrintFieldValue(f.key, emp, isTopRow);

    if (f.key === 'codigo') {
      slotW = 138;
      text = `Código: ${emp.codigo || ''}`;
    } else if (f.key === 'nome') {
      slotW = showPhoto ? 385 : 460;
      text = formatPrintFieldValue('nome', emp, isTopRow);
    }

    if (usedW + slotW > maxRowWidth) {
      flushRow();
    }

    // If this is the last column in a tight row with no photo, give extra breathing room
    const adjustedW =
      f.key === 'cpf' && currentRow.some((item) => item.type === 'code_name_pair' || item.key === 'nome')
        ? maxRowWidth - usedW
        : slotW;

    currentRow.push({
      type: meta.isCheckmark ? 'checkmark' : 'cell',
      key: f.key,
      xPt: usedW,
      widthPt: adjustedW,
      text,
      bold: f.bold,
      checked: f.key === 'tem_assinatura_digitalizada' ? Boolean(emp.tem_assinatura_digitalizada) : false,
      isHeaderName: f.key === 'nome' && isTopRow,
    });
    usedW += slotW;
  }

  flushRow();
  return { showPhoto, maxRowWidth, rows };
}
