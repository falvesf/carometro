export const PRINT_FIELDS_STORAGE_KEY = 'carometro_print_fields_v1';

export const PRINT_FIELD_CATALOG = [
  { key: 'foto', label: 'Foto 3x4', defaultPrintLabel: '', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, isPhoto: true },
  { key: 'codigo', label: 'Código / Matrícula', defaultPrintLabel: '', defaultEnabled: true, defaultBold: true, defaultFullWidth: false, slotW: 48 },
  { key: 'nome', label: 'Nome Completo', defaultPrintLabel: '', defaultEnabled: true, defaultBold: true, defaultFullWidth: false, slotW: 385 },
  { key: 'cpf', label: 'CPF', defaultPrintLabel: 'CPF', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 95 },
  { key: 'endereco', label: 'Endereço', defaultPrintLabel: 'Endereço', defaultEnabled: true, defaultBold: false, defaultFullWidth: true, slotW: 260 },
  { key: 'data_nascimento', label: 'Data de Nascimento', defaultPrintLabel: 'Data de Nascimento', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 174 },
  { key: 'sexo', label: 'Sexo', defaultPrintLabel: 'Sexo', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 93 },
  { key: 'email', label: 'E-mail', defaultPrintLabel: 'E-mail', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 213 },
  { key: 'rg', label: 'RG', defaultPrintLabel: 'RG', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 174 },
  { key: 'emitido_por', label: 'Emitido por', defaultPrintLabel: 'Emitido por', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 168 },
  { key: 'data_emissao', label: 'Data emissão (RG)', defaultPrintLabel: 'Data emissão', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 138 },
  { key: 'data_contratacao', label: 'Data de contratação', defaultPrintLabel: 'Data de contratação', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 174 },
  { key: 'data_demissao', label: 'Data de demissão', defaultPrintLabel: 'Data de demissão', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 168 },
  {
    key: 'tem_assinatura_digitalizada',
    label: 'Tem assinatura digitalizada',
    defaultPrintLabel: 'Tem assinatura digitalizada',
    defaultEnabled: true,
    defaultBold: false,
    defaultFullWidth: false,
    slotW: 138,
    isCheckmark: true,
  },
  { key: 'telefones', label: 'Telefones', defaultPrintLabel: 'Telefones', defaultEnabled: true, defaultBold: false, defaultFullWidth: true, slotW: 213 },
  { key: 'cargo', label: 'Cargo / Função', defaultPrintLabel: 'Cargo / Função', defaultEnabled: true, defaultBold: false, defaultFullWidth: false, slotW: 210 },
  { key: 'tipo', label: 'Categoria (Professor / Funcionário)', defaultPrintLabel: 'Categoria', defaultEnabled: false, defaultBold: false, defaultFullWidth: false, slotW: 174 },
];

const CATALOG_MAP = new Map(PRINT_FIELD_CATALOG.map((f) => [f.key, f]));

export function getDefaultPrintFieldsConfig() {
  return PRINT_FIELD_CATALOG.map((f) => ({
    key: f.key,
    enabled: f.defaultEnabled,
    bold: f.defaultBold,
    fullWidth: f.defaultFullWidth,
    customLabel: f.defaultPrintLabel,
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
    const meta = CATALOG_MAP.get(item.key);
    normalized.push({
      key: item.key,
      enabled: Boolean(item.enabled),
      bold: Boolean(item.bold),
      fullWidth: typeof item.fullWidth === 'boolean' ? item.fullWidth : Boolean(meta.defaultFullWidth),
      customLabel: typeof item.customLabel === 'string' ? item.customLabel : meta.defaultPrintLabel,
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

export function formatPrintFieldValue(fieldOrKey, emp, isTopName = false) {
  const key = typeof fieldOrKey === 'string' ? fieldOrKey : fieldOrKey?.key;
  const meta = CATALOG_MAP.get(key);
  const hasCustomLabel =
    typeof fieldOrKey === 'object' && fieldOrKey !== null && typeof fieldOrKey.customLabel === 'string';
  const labelPrefix = hasCustomLabel
    ? fieldOrKey.customLabel.trim()
    : (meta?.defaultPrintLabel ?? '').trim();

  const withLabel = (rawVal) => (labelPrefix ? `${labelPrefix}: ${rawVal}` : String(rawVal));

  switch (key) {
    case 'codigo':
      return withLabel(emp.codigo || '');
    case 'nome':
      if (!hasCustomLabel && !isTopName) {
        return `Nome: ${emp.nome || ''}`;
      }
      return withLabel(emp.nome || '');
    case 'cpf':
      return withLabel(emp.cpf || '');
    case 'endereco':
      return withLabel(emp.endereco || '');
    case 'data_nascimento':
      return withLabel(emp.data_nascimento || '');
    case 'sexo':
      return withLabel(emp.sexo || '');
    case 'email':
      return withLabel(emp.email || '');
    case 'rg':
      return withLabel(emp.rg || '');
    case 'emitido_por':
      return withLabel(emp.emitido_por || '');
    case 'data_emissao':
      return withLabel(emp.data_emissao || '');
    case 'data_contratacao':
      return withLabel(emp.data_contratacao || '');
    case 'data_demissao':
      return withLabel(emp.data_demissao || '');
    case 'tem_assinatura_digitalizada':
      return labelPrefix ? `${labelPrefix}:` : '';
    case 'telefones':
      return withLabel(emp.telefones || '');
    case 'cargo': {
      const cargoVal = emp.cargo || (emp.tipo === 'Professor' ? 'Professor(a)' : '');
      return withLabel(cargoVal);
    }
    case 'tipo':
      return withLabel(emp.tipo || '');
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
      const last = currentRow[currentRow.length - 1];
      if (last && last.type !== 'full') {
        last.widthPt = Math.max(last.widthPt, maxRowWidth - last.xPt);
      }
      rows.push(currentRow);
      currentRow = [];
      usedW = 0;
    }
  };

  const getSlotWidthForField = (field) => {
    const meta = CATALOG_MAP.get(field.key);
    if (field.key === 'cpf') return 90;
    if (field.key === 'codigo') return 138;
    return meta?.slotW || 174;
  };

  const computeHeaderWidth = (nextField, currentUsedW) => {
    const defaultW = showPhoto ? 385 : 460;
    if (!nextField || nextField.fullWidth) {
      return { widthPt: defaultW, advanceW: defaultW };
    }
    if (nextField.key === 'cpf') {
      const w = showPhoto ? 385 : 460;
      return { widthPt: w, advanceW: w + 5 };
    }
    const nextSlot = getSlotWidthForField(nextField);
    const gap = 5;
    const minHeaderW = showPhoto ? 210 : 250;
    const remaining = maxRowWidth - currentUsedW - nextSlot - gap;
    if (remaining >= minHeaderW) {
      const w = Math.min(defaultW, remaining);
      return { widthPt: w, advanceW: w + gap };
    }
    return { widthPt: defaultW, advanceW: defaultW };
  };

  for (let i = 0; i < active.length; i++) {
    const f = active[i];
    const meta = CATALOG_MAP.get(f.key);

    // Special natural pairing: codigo immediately followed by nome shares the header slot
    if (f.key === 'codigo' && !f.fullWidth && active[i + 1]?.key === 'nome' && !active[i + 1]?.fullWidth) {
      const nomeCfg = active[i + 1];
      const nextAfterNome = active[i + 2];
      const { widthPt, advanceW } = computeHeaderWidth(nextAfterNome, usedW);
      if (usedW + advanceW > maxRowWidth) flushRow();
      const adj = computeHeaderWidth(nextAfterNome, usedW);
      const codeLabel = (f.customLabel ?? '').trim();
      const nomeLabel = (nomeCfg.customLabel ?? '').trim();
      currentRow.push({
        type: 'code_name_pair',
        xPt: usedW,
        widthPt: adj.widthPt,
        codigo: codeLabel ? `${codeLabel}: ${emp.codigo || ''}` : String(emp.codigo || ''),
        codigoBold: f.bold,
        nome: nomeLabel ? `${nomeLabel}: ${emp.nome || ''}` : String(emp.nome || ''),
        nomeBold: nomeCfg.bold,
      });
      usedW += adj.advanceW;
      i++; // consumed nome as well
      continue;
    }

    if (f.fullWidth) {
      flushRow();
      rows.push([
        {
          type: 'full',
          key: f.key,
          xPt: 0,
          widthPt: showPhoto ? 468 : 555,
          text: formatPrintFieldValue(f, emp, false),
          bold: f.bold,
        },
      ]);
      continue;
    }

    const isTopRow = rows.length === 0 && currentRow.length === 0;
    let slotW = getSlotWidthForField(f);
    let advanceW = slotW;
    const text = formatPrintFieldValue(f, emp, isTopRow);

    if (f.key === 'nome') {
      const nextAfter = active[i + 1];
      const adj = computeHeaderWidth(nextAfter, usedW);
      if (usedW + adj.advanceW > maxRowWidth) flushRow();
      const adjAfterFlush = computeHeaderWidth(nextAfter, usedW);
      slotW = adjAfterFlush.widthPt;
      advanceW = adjAfterFlush.advanceW;
    }

    if (usedW + slotW > maxRowWidth) {
      flushRow();
    }

    const rowHasName = currentRow.some((item) => item.type === 'code_name_pair' || item.key === 'nome');
    const adjustedW = rowHasName && f.key === 'cpf' ? maxRowWidth - usedW : slotW;

    currentRow.push({
      type: meta?.isCheckmark ? 'checkmark' : 'cell',
      key: f.key,
      xPt: usedW,
      widthPt: adjustedW,
      text,
      bold: f.bold,
      checked: f.key === 'tem_assinatura_digitalizada' ? Boolean(emp.tem_assinatura_digitalizada) : false,
      isHeaderName: f.key === 'nome' && isTopRow,
    });
    usedW += advanceW;
  }

  flushRow();
  return { showPhoto, maxRowWidth, rows };
}
