const state = {
  employees: [],
  stats: { total: 0, professores: 0, funcionarios: 0, ativos: 0, demitidos: 0 },
  settings: {
    escola_nome: 'Escola Adventista de Ibiúna',
    titulo_relatorio: 'CARÔMETRO GERAL - 2026 - ANO LETIVO',
    usuario_rodape: 'daniele.moraes@adm.educadventista.org',
    ordenacao_padrao: 'nome_asc',
  },
  filters: {
    q: '',
    tipo: 'Todos',
    status: 'Ativos',
    assinatura: '',
    order: 'nome_asc',
  },
  selectedIds: new Set(),
  currentIndex: 0,
  isNewMode: false,
  pendingPhotoBlob: null,
  pendingPhotoPreviewUrl: '',
  removePhotoFlag: false,
  pendingDeleteId: null,
  activeTab: 'consulta',
};

// DOM refs
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTodayBR() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = `toast ${type === 'error' ? 'toast-error' : 'toast-success'}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3200);
}

// Masks
function maskCpf(val) {
  const d = val.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function maskDate(val) {
  const d = val.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// Convert any uploaded image to a clean 300x350 (6:7 portrait) PNG matching carômetro photo frame
async function normalizePhotoToPngBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const targetW = 300;
        const targetH = 350;
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, targetW, targetH);

        const targetRatio = targetW / targetH;
        const srcRatio = img.width / img.height;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        if (srcRatio > targetRatio) {
          sw = img.height * targetRatio;
          sx = (img.width - sw) / 2;
        } else if (srcRatio < targetRatio) {
          sh = img.width / targetRatio;
          sy = Math.max(0, (img.height - sh) * 0.25); // bias slightly upward to keep head/face centered
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(url);
            if (!blob) return reject(new Error('Falha ao processar imagem.'));
            resolve(blob);
          },
          'image/png',
          0.95
        );
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler a imagem selecionada.'));
    };
    img.src = url;
  });
}

// API Calls
async function fetchSettings() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  state.settings = data;
  $('headerSchoolName').textContent = data.escola_nome || 'Escola Adventista de Ibiúna';
  $('printTitulo').value = data.titulo_relatorio || '';
  $('printUsuario').value = data.usuario_rodape || '';
  if (!$('printData').value) {
    $('printData').value = formatTodayBR();
  }
}

async function fetchEmployees() {
  const params = new URLSearchParams();
  if (state.filters.q) params.set('q', state.filters.q);
  if (state.filters.tipo && state.filters.tipo !== 'Todos') params.set('tipo', state.filters.tipo);
  if (state.filters.status) params.set('status', state.filters.status);
  if (state.filters.assinatura) params.set('assinatura', state.filters.assinatura);
  if (state.filters.order) params.set('order', state.filters.order);

  const res = await fetch(`/api/employees?${params.toString()}`);
  const data = await res.json();
  state.employees = data.employees || [];
  state.stats = data.stats || state.stats;

  // Keep valid selection IDs
  const validIds = new Set(state.employees.map((e) => e.id));
  for (const id of [...state.selectedIds]) {
    if (!validIds.has(id)) state.selectedIds.delete(id);
  }

  if (state.currentIndex >= state.employees.length) {
    state.currentIndex = Math.max(0, state.employees.length - 1);
  }

  renderStats();
  renderTable();
  if (state.activeTab === 'ficha' && !state.isNewMode) {
    loadCurrentRecordIntoForm();
  }
  if (state.activeTab === 'impressao') {
    renderPrintPreview();
  }
}

function renderStats() {
  $('statTotal').textContent = state.stats.total ?? 0;
  $('statProf').textContent = state.stats.professores ?? 0;
  $('statFunc').textContent = state.stats.funcionarios ?? 0;
  $('statAtivos').textContent = state.stats.ativos ?? 0;
}

function renderTable() {
  const tbody = $('empTableBody');
  const empty = $('emptyState');
  $('filteredCountLabel').textContent = state.employees.length;

  const selectedCount = state.selectedIds.size;
  $('selectedCount').textContent = selectedCount;
  $('selectedBadge').hidden = selectedCount === 0;

  const allChecked =
    state.employees.length > 0 && state.employees.every((e) => state.selectedIds.has(e.id));
  $('selectAllCheckbox').checked = allChecked;

  if (state.employees.length === 0) {
    tbody.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = state.employees
    .map((emp, idx) => {
      const isDemitido = Boolean((emp.data_demissao || '').trim());
      const checked = state.selectedIds.has(emp.id) ? 'checked' : '';
      const photoHtml = emp.foto_path
        ? `<img class="thumb-photo" src="/uploads/${encodeURIComponent(emp.foto_path)}" alt="" loading="lazy" />`
        : `<div class="thumb-empty">Sem foto</div>`;
      const tipoBadge =
        emp.tipo === 'Professor'
          ? '<span class="badge badge-prof">Professor</span>'
          : '<span class="badge badge-func">Funcionário</span>';
      const demBadge = isDemitido ? '<span class="badge badge-dem">Demitido</span>' : '';
      const assinHtml = emp.tem_assinatura_digitalizada
        ? '<img class="check-mini" src="/assets/checkmark.png" alt="Sim" title="Tem assinatura digitalizada" />'
        : '<span class="row-sub">Não</span>';

      return `
        <tr data-index="${idx}" data-id="${emp.id}" class="${isDemitido ? 'is-demitido' : ''}">
          <td class="col-check" onclick="event.stopPropagation()">
            <input type="checkbox" class="row-checkbox" data-id="${emp.id}" ${checked} />
          </td>
          <td class="col-photo">${photoHtml}</td>
          <td><strong>${escapeHtml(emp.codigo || '-')}</strong></td>
          <td>
            <div class="row-name">${escapeHtml(emp.nome)}</div>
            <div class="row-sub">${escapeHtml(emp.cargo || (emp.tipo === 'Professor' ? 'Professor(a)' : 'Funcionário(a)'))}</div>
          </td>
          <td>${tipoBadge}${demBadge}</td>
          <td>${escapeHtml(emp.cpf || '-')}</td>
          <td>
            <div>${escapeHtml(emp.telefones || '-')}</div>
            <div class="row-sub">${escapeHtml(emp.email || '')}</div>
          </td>
          <td>${escapeHtml(emp.data_contratacao || '-')}</td>
          <td>${assinHtml}</td>
          <td class="col-actions" onclick="event.stopPropagation()">
            <button class="btn btn-sm btn-secondary" data-action="edit" data-index="${idx}">Editar</button>
            <button class="btn btn-sm btn-danger-outline" data-action="delete" data-id="${emp.id}">Excluir</button>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      const idx = parseInt(tr.dataset.index, 10);
      openRecordInFicha(idx);
    });
  });

  tbody.querySelectorAll('.row-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.dataset.id, 10);
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      renderTable();
    });
  });

  tbody.querySelectorAll('button[data-action="edit"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      openRecordInFicha(parseInt(btn.dataset.index, 10));
    });
  });

  tbody.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      askDeleteEmployee(parseInt(btn.dataset.id, 10));
    });
  });
}

// Tabs
function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });

  if (tabName === 'ficha') {
    if (!state.isNewMode) {
      loadCurrentRecordIntoForm();
    }
  } else if (tabName === 'impressao') {
    renderPrintPreview();
  }
}

// Ficha / Form & Navigation
function openRecordInFicha(index) {
  state.isNewMode = false;
  state.currentIndex = Math.max(0, Math.min(index, state.employees.length - 1));
  switchTab('ficha');
  loadCurrentRecordIntoForm();
}

function startNewEmployeeForm() {
  state.isNewMode = true;
  state.pendingPhotoBlob = null;
  state.pendingPhotoPreviewUrl = '';
  state.removePhotoFlag = false;

  $('empId').value = '';
  $('fCodigo').value = '';
  $('fNome').value = '';
  $('fCpf').value = '';
  $('fTipo').value = state.filters.tipo === 'Professor' ? 'Professor' : 'Funcionário';
  $('fCargo').value = '';
  $('fEmail').value = '';
  $('fEndereco').value = '';
  $('fNascimento').value = '';
  $('fSexo').value = '';
  $('fRg').value = '';
  $('fEmitidoPor').value = 'SSP/SP';
  $('fDataEmissao').value = '';
  $('fDataContratacao').value = '';
  $('fDataDemissao').value = '';
  $('fAssinatura').checked = true;
  $('fTelefones').value = '';

  updatePhotoEditorUI('');
  updateNavButtons();
  $('fichaModePill').textContent = 'Novo cadastro';
  $('btnFichaDelete').disabled = true;
  $('btnFichaPrintOne').disabled = true;
  $('btnFichaPdfOne').disabled = true;
  renderLiveCardPreview();
  switchTab('ficha');
  $('fNome').focus();
}

function loadCurrentRecordIntoForm() {
  if (state.employees.length === 0) {
    startNewEmployeeForm();
    return;
  }

  state.isNewMode = false;
  state.pendingPhotoBlob = null;
  state.pendingPhotoPreviewUrl = '';
  state.removePhotoFlag = false;

  const emp = state.employees[state.currentIndex];
  $('empId').value = emp.id;
  $('fCodigo').value = emp.codigo || '';
  $('fNome').value = emp.nome || '';
  $('fCpf').value = emp.cpf || '';
  $('fTipo').value = emp.tipo || 'Funcionário';
  $('fCargo').value = emp.cargo || '';
  $('fEmail').value = emp.email || '';
  $('fEndereco').value = emp.endereco || '';
  $('fNascimento').value = emp.data_nascimento || '';
  $('fSexo').value = emp.sexo || '';
  $('fRg').value = emp.rg || '';
  $('fEmitidoPor').value = emp.emitido_por || '';
  $('fDataEmissao').value = emp.data_emissao || '';
  $('fDataContratacao').value = emp.data_contratacao || '';
  $('fDataDemissao').value = emp.data_demissao || '';
  $('fAssinatura').checked = Boolean(emp.tem_assinatura_digitalizada);
  $('fTelefones').value = emp.telefones || '';

  const photoUrl = emp.foto_path ? `/uploads/${encodeURIComponent(emp.foto_path)}` : '';
  updatePhotoEditorUI(photoUrl);
  updateNavButtons();
  $('fichaModePill').textContent = `Editando #${emp.codigo || emp.id}`;
  $('btnFichaDelete').disabled = false;
  $('btnFichaPrintOne').disabled = false;
  $('btnFichaPdfOne').disabled = false;
  renderLiveCardPreview();
}

function updateNavButtons() {
  const total = state.employees.length;
  const idx = state.currentIndex;
  if (state.isNewMode || total === 0) {
    $('navCounter').textContent = state.isNewMode ? 'Novo Registro' : '0 de 0';
    $('navFirst').disabled = total === 0;
    $('navPrev').disabled = total === 0;
    $('navNext').disabled = total === 0;
    $('navLast').disabled = total === 0;
    return;
  }
  $('navCounter').textContent = `Registro ${idx + 1} de ${total}`;
  $('navFirst').disabled = idx <= 0;
  $('navPrev').disabled = idx <= 0;
  $('navNext').disabled = idx >= total - 1;
  $('navLast').disabled = idx >= total - 1;
}

function updatePhotoEditorUI(url) {
  const img = $('photoPreviewImg');
  const ph = $('photoPlaceholder');
  if (url) {
    img.src = url;
    img.hidden = false;
    ph.hidden = true;
  } else {
    img.src = '';
    img.hidden = true;
    ph.hidden = false;
  }
}

function getFormEmployeeSnapshot() {
  const existing = !state.isNewMode ? state.employees[state.currentIndex] : null;
  let previewPhotoSrc = '';
  if (state.pendingPhotoPreviewUrl) {
    previewPhotoSrc = state.pendingPhotoPreviewUrl;
  } else if (!state.removePhotoFlag && existing?.foto_path) {
    previewPhotoSrc = `/uploads/${encodeURIComponent(existing.foto_path)}`;
  }

  return {
    id: $('empId').value ? parseInt($('empId').value, 10) : null,
    codigo: $('fCodigo').value.trim(),
    nome: $('fNome').value.trim(),
    cpf: $('fCpf').value.trim(),
    tipo: $('fTipo').value,
    cargo: $('fCargo').value.trim(),
    email: $('fEmail').value.trim(),
    endereco: $('fEndereco').value.trim(),
    data_nascimento: $('fNascimento').value.trim(),
    sexo: $('fSexo').value,
    rg: $('fRg').value.trim(),
    emitido_por: $('fEmitidoPor').value.trim(),
    data_emissao: $('fDataEmissao').value.trim(),
    data_contratacao: $('fDataContratacao').value.trim(),
    data_demissao: $('fDataDemissao').value.trim(),
    tem_assinatura_digitalizada: $('fAssinatura').checked ? 1 : 0,
    telefones: $('fTelefones').value.trim(),
    previewPhotoSrc,
  };
}

// Renders ONE card identically to carometro.pdf
function buildCardHtml(emp, standalone = false) {
  const photoSrc =
    emp.previewPhotoSrc !== undefined
      ? emp.previewPhotoSrc
      : emp.foto_path
        ? `/uploads/${encodeURIComponent(emp.foto_path)}`
        : '';

  const photoHtml = photoSrc
    ? `<img src="${photoSrc}" alt="" />`
    : `<div class="cm-photo-empty">Sem foto</div>`;

  const checkHtml = emp.tem_assinatura_digitalizada
    ? `<img src="/assets/checkmark.png" class="cm-check-icon" alt="Sim" />`
    : '';

  return `
    <div class="cm-card ${standalone ? 'cm-card-standalone' : ''}">
      <div class="cm-card-body">
        <div class="cm-row1">
          ${emp.codigo ? `<span class="cm-codigo">${escapeHtml(emp.codigo)}</span>` : ''}
          <span class="cm-nome">${escapeHtml(emp.nome)}</span>
          <span class="cm-cpf">CPF: ${escapeHtml(emp.cpf || '')}</span>
        </div>
        <div class="cm-addr">Endereço: ${escapeHtml(emp.endereco || '')}</div>
        <div class="cm-grid-row">
          <span class="cm-col-1">Data de Nascimento: ${escapeHtml(emp.data_nascimento || '')}</span>
          <span class="cm-col-2-email">Sexo: ${escapeHtml(emp.sexo || '')}</span>
          <span class="cm-col-3-email">E-mail: ${escapeHtml(emp.email || '')}</span>
        </div>
        <div class="cm-grid-row">
          <span class="cm-col-1">RG: ${escapeHtml(emp.rg || '')}</span>
          <span class="cm-col-2">Emitido por: ${escapeHtml(emp.emitido_por || '')}</span>
          <span class="cm-col-3">Data emissão: ${escapeHtml(emp.data_emissao || '')}</span>
        </div>
        <div class="cm-grid-row">
          <span class="cm-col-1">Data de contratação: ${escapeHtml(emp.data_contratacao || '')}</span>
          <span class="cm-col-2">Data de demissão: ${escapeHtml(emp.data_demissao || '')}</span>
          <span class="cm-col-3">
            Tem assinatura digitalizada:
            ${checkHtml}
          </span>
        </div>
        <div class="cm-tel">Telefones: ${escapeHtml(emp.telefones || '')}</div>
      </div>
      <div class="cm-photo-box">${photoHtml}</div>
    </div>
  `;
}

function renderLiveCardPreview() {
  const snap = getFormEmployeeSnapshot();
  $('liveCardPreview').innerHTML = buildCardHtml(snap, true);
}

// Photo handling
async function handleSelectedPhotoFile(file) {
  if (!file) return;
  try {
    const pngBlob = await normalizePhotoToPngBlob(file);
    if (state.pendingPhotoPreviewUrl) {
      URL.revokeObjectURL(state.pendingPhotoPreviewUrl);
    }
    state.pendingPhotoBlob = pngBlob;
    state.pendingPhotoPreviewUrl = URL.createObjectURL(pngBlob);
    state.removePhotoFlag = false;
    updatePhotoEditorUI(state.pendingPhotoPreviewUrl);
    renderLiveCardPreview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save Employee (Add or Update)
async function handleSaveEmployee(e) {
  e.preventDefault();
  const snap = getFormEmployeeSnapshot();
  if (!snap.nome) {
    showToast('Informe o nome completo do funcionário.', 'error');
    $('fNome').focus();
    return;
  }

  const fd = new FormData();
  fd.append('codigo', snap.codigo);
  fd.append('nome', snap.nome);
  fd.append('cpf', snap.cpf);
  fd.append('tipo', snap.tipo);
  fd.append('cargo', snap.cargo);
  fd.append('email', snap.email);
  fd.append('endereco', snap.endereco);
  fd.append('data_nascimento', snap.data_nascimento);
  fd.append('sexo', snap.sexo);
  fd.append('rg', snap.rg);
  fd.append('emitido_por', snap.emitido_por);
  fd.append('data_emissao', snap.data_emissao);
  fd.append('data_contratacao', snap.data_contratacao);
  fd.append('data_demissao', snap.data_demissao);
  fd.append('tem_assinatura_digitalizada', snap.tem_assinatura_digitalizada ? '1' : '0');
  fd.append('telefones', snap.telefones);

  if (state.pendingPhotoBlob) {
    fd.append('foto', state.pendingPhotoBlob, 'foto.png');
  } else if (state.removePhotoFlag) {
    fd.append('remove_photo', 'true');
  }

  const isNew = state.isNewMode || !snap.id;
  const url = isNew ? '/api/employees' : `/api/employees/${snap.id}`;
  const method = isNew ? 'POST' : 'PUT';

  const btn = $('btnSaveEmployee');
  btn.disabled = true;
  try {
    const res = await fetch(url, { method, body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao salvar cadastro.');

    showToast(isNew ? 'Funcionário cadastrado com sucesso!' : 'Cadastro atualizado com sucesso!');
    state.isNewMode = false;
    await fetchEmployees();

    const savedId = data.employee?.id;
    const foundIdx = state.employees.findIndex((item) => item.id === savedId);
    if (foundIdx >= 0) {
      state.currentIndex = foundIdx;
    }
    loadCurrentRecordIntoForm();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Delete Employee
function askDeleteEmployee(id) {
  const emp = state.employees.find((e) => e.id === id);
  if (!emp) return;
  state.pendingDeleteId = id;
  $('confirmMessage').textContent = `Deseja realmente excluir "${emp.nome}" (Código ${emp.codigo || 'S/N'})? Esta ação não pode ser desfeita.`;
  $('confirmModal').hidden = false;
}

async function confirmDeleteEmployee() {
  const id = state.pendingDeleteId;
  if (!id) return;
  try {
    const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao excluir.');

    $('confirmModal').hidden = true;
    state.pendingDeleteId = null;
    state.selectedIds.delete(id);
    showToast('Registro excluído com sucesso.');
    await fetchEmployees();
    if (state.activeTab === 'ficha') {
      loadCurrentRecordIntoForm();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Print & PDF Helpers
function getScopeQueryParams(overrideScope = null, specificIds = null) {
  const params = new URLSearchParams();
  const scope = overrideScope || $('printScope').value || 'filtered';

  if (specificIds && specificIds.length > 0) {
    params.set('ids', specificIds.join(','));
  } else if (scope === 'selected' && state.selectedIds.size > 0) {
    params.set('ids', [...state.selectedIds].join(','));
  } else if (scope === 'filtered') {
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.tipo && state.filters.tipo !== 'Todos') params.set('tipo', state.filters.tipo);
    if (state.filters.status) params.set('status', state.filters.status);
    if (state.filters.assinatura) params.set('assinatura', state.filters.assinatura);
  }
  if (state.filters.order) params.set('order', state.filters.order);

  params.set('escola_nome', state.settings.escola_nome || 'Escola Adventista de Ibiúna');
  params.set('titulo_relatorio', $('printTitulo').value || state.settings.titulo_relatorio);
  params.set('usuario_rodape', $('printUsuario').value || state.settings.usuario_rodape);
  params.set('data_impressao', $('printData').value || formatTodayBR());
  return params;
}

async function getEmployeesForPrint(overrideScope = null, specificIds = null) {
  const scope = overrideScope || $('printScope').value || 'filtered';
  if (specificIds && specificIds.length > 0) {
    return state.employees.filter((e) => specificIds.includes(e.id));
  }
  if (scope === 'selected') {
    if (state.selectedIds.size === 0) {
      showToast('Nenhum funcionário selecionado. Mostrando lista filtrada.', 'error');
      return state.employees;
    }
    return state.employees.filter((e) => state.selectedIds.has(e.id));
  }
  if (scope === 'all') {
    const res = await fetch(`/api/employees?order=${encodeURIComponent(state.filters.order)}`);
    const data = await res.json();
    return data.employees || [];
  }
  return state.employees;
}

function estimateHtmlCardHeightPt(emp) {
  const addrLen = (`Endereço: ${emp.endereco || ''}`).length;
  const addrLines = Math.max(1, Math.ceil(addrLen / 95));
  const telLen = (`Telefones: ${emp.telefones || ''}`).length;
  const telLines = Math.max(1, Math.ceil(telLen / 95));
  return Math.max(96, 86 + (addrLines - 1) * 11.4 + (telLines - 1) * 11.4);
}

function buildA4PagesHtml(employees) {
  const escola = state.settings.escola_nome || 'Escola Adventista de Ibiúna';
  const titulo = $('printTitulo').value || state.settings.titulo_relatorio;
  const usuario = $('printUsuario').value || state.settings.usuario_rodape;
  const dataStr = $('printData').value || formatTodayBR();

  // Paginate up to 7 cards per page without ever colliding with the footer (y <= 795pt)
  const pages = [];
  let current = [];
  let y = 78.3;
  for (const emp of employees) {
    const h = estimateHtmlCardHeightPt(emp);
    if (current.length >= 7 || (current.length > 0 && y + h > 792)) {
      pages.push(current);
      current = [];
      y = 78.3;
    }
    current.push(emp);
    y += h;
  }
  if (current.length > 0 || pages.length === 0) {
    pages.push(current);
  }

  const totalPages = pages.length;
  return pages
    .map((group, pIdx) => {
      const cardsHtml = group.map((emp) => buildCardHtml(emp, false)).join('');
      return `
        <div class="a4-page">
          <div class="cm-header">
            <img src="/assets/logo.png" alt="Educação Adventista" class="cm-logo" />
            <div class="cm-school">${escapeHtml(escola)}</div>
            <div class="cm-title">${escapeHtml(titulo)}</div>
          </div>
          <div class="cm-cards">${cardsHtml}</div>
          <div class="cm-footer">
            <span>${escapeHtml(dataStr)}</span>
            <span>Usuário:${escapeHtml(usuario)}</span>
            <span>${pIdx + 1}/${totalPages}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

async function renderPrintPreview() {
  const list = await getEmployeesForPrint();
  const html = buildA4PagesHtml(list);
  $('printPreviewContainer').innerHTML = html;
  $('printOnlyRoot').innerHTML = html;
}

async function triggerBrowserPrint(overrideScope = null, specificIds = null) {
  const list = await getEmployeesForPrint(overrideScope, specificIds);
  $('printOnlyRoot').innerHTML = buildA4PagesHtml(list);
  window.print();
}

function downloadPdf(overrideScope = null, specificIds = null, inline = false) {
  const params = getScopeQueryParams(overrideScope, specificIds);
  if (inline) params.set('inline', '1');
  const url = `/api/pdf?${params.toString()}`;
  if (inline) {
    window.open(url, '_blank');
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = `carometro_${new Date().toISOString().slice(0, 10)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

// Settings & Backup Modal
async function openSettingsModal() {
  $('sEscola').value = state.settings.escola_nome || '';
  $('sTitulo').value = state.settings.titulo_relatorio || '';
  $('sUsuario').value = state.settings.usuario_rodape || '';
  $('settingsModal').hidden = false;

  try {
    const res = await fetch('/api/info');
    const info = await res.json();
    $('systemInfoBox').innerHTML = `
      <div><strong>Arquivo do banco:</strong> ${escapeHtml(info.db_path)}</div>
      <div><strong>Endereços na rede local:</strong> ${info.urls.map((u) => escapeHtml(u)).join(' | ')}</div>
    `;
  } catch {
    $('systemInfoBox').textContent = '';
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const payload = {
    escola_nome: $('sEscola').value.trim() || 'Escola Adventista de Ibiúna',
    titulo_relatorio: $('sTitulo').value.trim() || 'CARÔMETRO GERAL - 2026 - ANO LETIVO',
    usuario_rodape: $('sUsuario').value.trim(),
  };
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    await fetchSettings();
    $('settingsModal').hidden = true;
    showToast('Configurações salvas!');
    if (state.activeTab === 'impressao') renderPrintPreview();
  } else {
    showToast('Erro ao salvar configurações.', 'error');
  }
}

async function handleRestoreBackup(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao restaurar backup.');
    await fetchSettings();
    await fetchEmployees();
    $('settingsModal').hidden = true;
    showToast(`Backup restaurado com ${data.count} registro(s)!`);
  } catch (err) {
    showToast('Erro no backup: ' + err.message, 'error');
  }
}

// Event Listeners
function bindEvents() {
  // Tabs
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Topbar buttons
  $('btnNewEmployee').addEventListener('click', startNewEmployeeForm);
  $('btnPrintPreview').addEventListener('click', () => {
    switchTab('impressao');
  });
  $('btnDownloadPdf').addEventListener('click', () => {
    const scope = state.selectedIds.size > 0 ? 'selected' : 'filtered';
    downloadPdf(scope);
  });
  $('btnSettings').addEventListener('click', openSettingsModal);

  // Filters
  let searchTimeout = null;
  $('searchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.filters.q = e.target.value;
      fetchEmployees();
    }, 180);
  });

  $('tipoFilter').querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('tipoFilter').querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.tipo = btn.dataset.value;
      fetchEmployees();
    });
  });

  $('statusFilter').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    fetchEmployees();
  });

  $('assinaturaFilter').addEventListener('change', (e) => {
    state.filters.assinatura = e.target.value;
    fetchEmployees();
  });

  $('orderSelect').addEventListener('change', (e) => {
    state.filters.order = e.target.value;
    fetchEmployees();
  });

  $('btnResetFilters').addEventListener('click', () => {
    $('searchInput').value = '';
    state.filters = { q: '', tipo: 'Todos', status: '', assinatura: '', order: 'nome_asc' };
    $('statusFilter').value = '';
    $('assinaturaFilter').value = '';
    $('orderSelect').value = 'nome_asc';
    $('tipoFilter').querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.value === 'Todos');
    });
    fetchEmployees();
  });

  // Selection
  $('selectAllCheckbox').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.employees.forEach((emp) => state.selectedIds.add(emp.id));
    } else {
      state.selectedIds.clear();
    }
    renderTable();
  });

  $('btnClearSelection').addEventListener('click', () => {
    state.selectedIds.clear();
    renderTable();
  });

  $('btnPrintFiltered').addEventListener('click', () => {
    const scope = state.selectedIds.size > 0 ? 'selected' : 'filtered';
    triggerBrowserPrint(scope);
  });

  $('btnPdfFiltered').addEventListener('click', () => {
    const scope = state.selectedIds.size > 0 ? 'selected' : 'filtered';
    downloadPdf(scope);
  });

  // Navigator
  $('navFirst').addEventListener('click', () => openRecordInFicha(0));
  $('navPrev').addEventListener('click', () => openRecordInFicha(state.currentIndex - 1));
  $('navNext').addEventListener('click', () => openRecordInFicha(state.currentIndex + 1));
  $('navLast').addEventListener('click', () => openRecordInFicha(state.employees.length - 1));

  document.addEventListener('keydown', (e) => {
    if (state.activeTab === 'ficha' && e.altKey) {
      if (e.key === 'ArrowLeft' && state.currentIndex > 0) {
        e.preventDefault();
        openRecordInFicha(state.currentIndex - 1);
      } else if (e.key === 'ArrowRight' && state.currentIndex < state.employees.length - 1) {
        e.preventDefault();
        openRecordInFicha(state.currentIndex + 1);
      }
    }
  });

  $('btnFichaNew').addEventListener('click', startNewEmployeeForm);
  $('btnFichaDelete').addEventListener('click', () => {
    const emp = state.employees[state.currentIndex];
    if (emp) askDeleteEmployee(emp.id);
  });
  $('btnFichaPrintOne').addEventListener('click', () => {
    const emp = state.employees[state.currentIndex];
    if (emp) triggerBrowserPrint(null, [emp.id]);
  });
  $('btnFichaPdfOne').addEventListener('click', () => {
    const emp = state.employees[state.currentIndex];
    if (emp) downloadPdf(null, [emp.id]);
  });
  $('btnCancelForm').addEventListener('click', () => switchTab('consulta'));

  // Form inputs & masks & live preview
  $('fCpf').addEventListener('input', (e) => {
    e.target.value = maskCpf(e.target.value);
    renderLiveCardPreview();
  });
  ['fNascimento', 'fDataEmissao', 'fDataContratacao', 'fDataDemissao'].forEach((id) => {
    $(id).addEventListener('input', (e) => {
      e.target.value = maskDate(e.target.value);
      renderLiveCardPreview();
    });
  });
  ['fCodigo', 'fNome', 'fTipo', 'fCargo', 'fEmail', 'fEndereco', 'fSexo', 'fRg', 'fEmitidoPor', 'fTelefones'].forEach(
    (id) => {
      $(id).addEventListener('input', renderLiveCardPreview);
      $(id).addEventListener('change', renderLiveCardPreview);
    }
  );
  $('fAssinatura').addEventListener('change', renderLiveCardPreview);

  // Photo drag/drop/click
  const dropZone = $('photoDropZone');
  dropZone.addEventListener('click', () => $('photoInput').click());
  $('btnChoosePhoto').addEventListener('click', () => $('photoInput').click());
  $('photoInput').addEventListener('change', (e) => handleSelectedPhotoFile(e.target.files[0]));
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files?.[0]) handleSelectedPhotoFile(e.dataTransfer.files[0]);
  });
  $('btnRemovePhoto').addEventListener('click', () => {
    state.pendingPhotoBlob = null;
    if (state.pendingPhotoPreviewUrl) URL.revokeObjectURL(state.pendingPhotoPreviewUrl);
    state.pendingPhotoPreviewUrl = '';
    state.removePhotoFlag = true;
    $('photoInput').value = '';
    updatePhotoEditorUI('');
    renderLiveCardPreview();
  });

  $('employeeForm').addEventListener('submit', handleSaveEmployee);

  // Print preview controls
  $('printTituloPreset').addEventListener('change', (e) => {
    if (e.target.value) {
      $('printTitulo').value = e.target.value;
      e.target.value = '';
      renderPrintPreview();
    }
  });
  ['printTitulo', 'printUsuario', 'printData', 'printScope'].forEach((id) => {
    $(id).addEventListener('input', renderPrintPreview);
    $(id).addEventListener('change', renderPrintPreview);
  });
  $('btnPrintBrowser').addEventListener('click', () => triggerBrowserPrint());
  $('btnOpenPdfPrint').addEventListener('click', () => downloadPdf(null, null, true));
  $('btnDownloadPdfFromPreview').addEventListener('click', () => downloadPdf(null, null, false));

  // Modals
  $('btnCloseSettings').addEventListener('click', () => ($('settingsModal').hidden = true));
  $('settingsForm').addEventListener('submit', saveSettings);
  $('restoreFileInput').addEventListener('change', (e) => handleRestoreBackup(e.target.files[0]));
  $('btnCloseConfirm').addEventListener('click', () => ($('confirmModal').hidden = true));
  $('btnCancelDelete').addEventListener('click', () => ($('confirmModal').hidden = true));
  $('btnConfirmDelete').addEventListener('click', confirmDeleteEmployee);
}

// Init
(async function init() {
  bindEvents();
  await fetchSettings();
  await fetchEmployees();
})();
