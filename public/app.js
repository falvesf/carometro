import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

import { firebaseConfig, ADMIN_EMAILS } from './firebaseConfig.js';
import { generateCarometroPdfBlob } from './pdfBrowser.js';
import {
  PRINT_FIELD_CATALOG,
  getDefaultPrintFieldsConfig,
  loadPrintFieldsConfig,
  savePrintFieldsConfig,
  buildPackedCardLayout,
} from './printLayout.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

const ADMIN_SET = new Set(ADMIN_EMAILS.map((e) => e.toLowerCase()));

const DEFAULT_SCHOOL_NAME = 'Colégio Adventista de Ibiúna';
const cachedSchoolName = (() => {
  try {
    return localStorage.getItem('carometro_escola_nome') || DEFAULT_SCHOOL_NAME;
  } catch {
    return DEFAULT_SCHOOL_NAME;
  }
})();

const state = {
  user: null,
  isAdmin: false,
  allEmployees: [],
  employees: [],
  stats: { total: 0, professores: 0, funcionarios: 0, ativos: 0, demitidos: 0 },
  settings: {
    escola_nome: cachedSchoolName,
    titulo_relatorio: 'CARÔMETRO GERAL - 2026 - ANO LETIVO',
    usuario_rodape: 'daniele.moraes@adm.educadventista.org',
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
  editingRecordId: null,
  loadedUpdatedAtMs: null,
  pendingSelectId: null,
  isNewMode: false,
  isDirty: false,
  isSaving: false,
  draftChecked: false,
  pendingNavAction: null,
  pendingDuplicateMatch: null,
  pendingDuplicateOpts: null,
  pendingPhotoDataUrl: '',
  rawPhotoObjectUrl: '',
  removePhotoFlag: false,
  pendingDeleteId: null,
  activeTab: 'consulta',
  printFieldsConfig: loadPrintFieldsConfig(),
  tempPrintFields: [],
  accessRequests: [],
  authorizedUsers: [],
  unsubs: [],
};

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
  }, 3400);
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

function maskPhone(val) {
  const d = val.replace(/\D/g, '').slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCep(val) {
  const d = val.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

function parseAddressString(raw) {
  const empty = { cep: '', rua: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' };
  let text = String(raw || '').trim();
  if (!text) return empty;

  let cep = '';
  const cepMatch = text.match(/(?:-\s*)?CEP\s*[:\-]?\s*(\d{5}-?\d{3})/i);
  if (cepMatch) {
    cep = maskCep(cepMatch[1]);
    text = text.replace(cepMatch[0], '').trim();
  }

  const parts = text.split(/\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  let uf = '';
  let cidade = '';
  let bairro = '';
  let streetPart = '';

  if (parts.length > 0 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) {
    uf = parts.pop().toUpperCase();
  }
  if (parts.length >= 4) {
    cidade = parts.pop();
    bairro = parts.pop();
    streetPart = parts.join(' - ');
  } else if (parts.length === 3) {
    cidade = parts[2];
    bairro = parts[1];
    streetPart = parts[0];
  } else if (parts.length === 2) {
    bairro = parts[1];
    streetPart = parts[0];
  } else if (parts.length === 1) {
    streetPart = parts[0];
  }

  let rua = streetPart;
  let numero = '';
  let complemento = '';
  const commaIdx = streetPart.indexOf(',');
  if (commaIdx >= 0) {
    rua = streetPart.slice(0, commaIdx).trim();
    const rest = streetPart.slice(commaIdx + 1).trim();
    const numMatch = rest.match(/^(\d+[A-Za-z]?|S\/N|s\/n)(?:\s+(.+))?$/);
    if (numMatch) {
      numero = numMatch[1];
      complemento = (numMatch[2] || '').trim();
    } else {
      numero = rest;
    }
  }

  return { cep, rua, numero, complemento, bairro, cidade, uf };
}

function composeAddressString(parts) {
  const rua = (parts.rua || '').trim();
  const numero = (parts.numero || '').trim();
  const complemento = (parts.complemento || '').trim();
  const bairro = (parts.bairro || '').trim();
  const cidade = (parts.cidade || '').trim();
  const uf = (parts.uf || '').trim().toUpperCase();
  const cep = (parts.cep || '').trim();

  let streetLine = rua;
  if (numero || complemento) {
    const numComp = [numero, complemento].filter(Boolean).join(' ');
    streetLine = streetLine ? `${streetLine}, ${numComp}` : numComp;
  }

  const segments = [
    streetLine,
    bairro,
    cidade,
    uf,
    cep ? `CEP ${cep}` : '',
  ].filter(Boolean);

  return segments.join(' - ');
}

function getAddressParts() {
  return {
    cep: $('fEndCep').value.trim(),
    rua: $('fEndRua').value.trim(),
    numero: $('fEndNumero').value.trim(),
    complemento: $('fEndComplemento').value.trim(),
    bairro: $('fEndBairro').value.trim(),
    cidade: $('fEndCidade').value.trim(),
    uf: $('fEndUf').value.trim().toUpperCase(),
  };
}

function setAddressFields(emp) {
  const parts =
    emp && emp.endereco_partes && typeof emp.endereco_partes === 'object'
      ? {
          cep: emp.endereco_partes.cep || '',
          rua: emp.endereco_partes.rua || '',
          numero: emp.endereco_partes.numero || '',
          complemento: emp.endereco_partes.complemento || '',
          bairro: emp.endereco_partes.bairro || '',
          cidade: emp.endereco_partes.cidade || '',
          uf: emp.endereco_partes.uf || '',
        }
      : parseAddressString(emp?.endereco || '');

  $('fEndCep').value = parts.cep;
  $('fEndRua').value = parts.rua;
  $('fEndNumero').value = parts.numero;
  $('fEndComplemento').value = parts.complemento;
  $('fEndBairro').value = parts.bairro;
  $('fEndCidade').value = parts.cidade;
  $('fEndUf').value = parts.uf;
}

let lastCepFetched = '';
async function lookupCepIfComplete(cepMasked) {
  const digits = cepMasked.replace(/\D/g, '');
  if (digits.length !== 8 || digits === lastCepFetched) return;
  lastCepFetched = digits;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.erro) return;
    if (data.logradouro && !$('fEndRua').value.trim()) $('fEndRua').value = data.logradouro;
    if (data.bairro && !$('fEndBairro').value.trim()) $('fEndBairro').value = data.bairro;
    if (data.localidade && !$('fEndCidade').value.trim()) $('fEndCidade').value = data.localidade;
    if (data.uf && !$('fEndUf').value.trim()) $('fEndUf').value = data.uf;
    renderLiveCardPreview();
    markFormDirty();
  } catch {
    // Ignore offline / lookup failures silently
  }
}

const CARGOS_LIST = [
  'Administrador(a) Escolar',
  'Administrador(a) Financeiro',
  'Auxiliar de Administrativo',
  'Auxiliar de Conservação e Limpeza',
  'Auxiliar de SOE',
  'Auxiliar de SOE e SOP',
  'Auxiliar de SOP',
  'Auxiliar de Tesouraria',
  'Bibliotecário(a)',
  'Capelão',
  'Coordenador(a) Pedagógico(a)',
  'Diretor(a)',
  'Estagiário(a)',
  'Inspetor(a) de Disciplina',
  'Instrutor de Informática',
  'Menor Aprendiz',
  'Monitor(a) de Alunos',
  'Monitor(a) de Classe',
  'Orientador(a) Educacional',
  'Porteiro(a)',
  'Professor(a)',
  'Promotor(a) de Matrículas',
  'Secretário(a) Escolar',
  'Tesoureiro(a)',
  'Vice Diretor(a)',
  'Zeladoria',
].sort((a, b) => a.localeCompare(b, 'pt-BR'));

const CARGO_OTHER_VALUE = '__OUTRO__';

function populateCargoSelect() {
  const sel = $('fCargoSelect');
  sel.innerHTML = [
    '<option value="">Selecione...</option>',
    ...CARGOS_LIST.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`),
    `<option value="${CARGO_OTHER_VALUE}">Outro (digitar manualmente)...</option>`,
  ].join('');
}

function setCargoValue(cargo) {
  const val = String(cargo || '').trim();
  const sel = $('fCargoSelect');
  const custom = $('fCargoCustom');
  if (!val) {
    sel.value = '';
    custom.value = '';
    custom.hidden = true;
    return;
  }
  const exact = CARGOS_LIST.find((c) => c.toLowerCase() === val.toLowerCase());
  if (exact) {
    sel.value = exact;
    custom.value = '';
    custom.hidden = true;
  } else {
    sel.value = CARGO_OTHER_VALUE;
    custom.value = val;
    custom.hidden = false;
  }
}

function getCargoValue() {
  const selVal = $('fCargoSelect').value;
  if (selVal === CARGO_OTHER_VALUE) {
    return $('fCargoCustom').value.trim();
  }
  return selVal;
}

const PHONE_TYPES = ['Celular', 'WhatsApp', 'Residencial', 'Comercial / Empresarial', 'Recado'];
let phoneRows = [{ tipo: 'Celular', numero: '' }];

function parsePhonesString(str) {
  const raw = String(str || '').trim();
  if (!raw) return [{ tipo: 'Celular', numero: '' }];

  const parts = raw.split(/[,;/]+/).map((s) => s.trim()).filter(Boolean);
  const parsed = [];

  for (const part of parts) {
    if (!/\d/.test(part)) continue; // ignore truncated fragments like ", Ce"
    const m = part.match(/^([A-Za-zÀ-ÿ\s/]+?)\s*[-:]\s*(.+)$/);
    if (m) {
      const rawTipo = m[1].trim();
      const numero = m[2].trim();
      const matchedTipo =
        PHONE_TYPES.find((t) => t.toLowerCase() === rawTipo.toLowerCase()) ||
        (rawTipo.toLowerCase().includes('whats')
          ? 'WhatsApp'
          : rawTipo.toLowerCase().includes('resid')
            ? 'Residencial'
            : rawTipo.toLowerCase().includes('comerc') || rawTipo.toLowerCase().includes('empres')
              ? 'Comercial / Empresarial'
              : rawTipo.toLowerCase().includes('recad')
                ? 'Recado'
                : 'Celular');
      parsed.push({ tipo: matchedTipo, numero });
    } else {
      parsed.push({ tipo: 'Celular', numero: part });
    }
  }
  return parsed.length > 0 ? parsed : [{ tipo: 'Celular', numero: '' }];
}

function serializePhoneRows() {
  return phoneRows
    .map((r) => ({ tipo: r.tipo, numero: (r.numero || '').trim() }))
    .filter((r) => r.numero.length > 0)
    .map((r) => `${r.tipo} - ${r.numero}`)
    .join(', ');
}

function renderPhoneRows() {
  const container = $('phoneRowsContainer');
  container.innerHTML = phoneRows
    .map(
      (row, idx) => `
      <div class="phone-row" data-phone-idx="${idx}">
        <select class="phone-type-select" aria-label="Tipo de contato">
          ${PHONE_TYPES.map(
            (t) => `<option value="${escapeHtml(t)}" ${row.tipo === t ? 'selected' : ''}>${escapeHtml(t)}</option>`
          ).join('')}
        </select>
        <input
          type="text"
          class="phone-number-input"
          value="${escapeHtml(row.numero)}"
          placeholder="(11) 99999-9999"
          maxlength="16"
        />
        <button
          type="button"
          class="btn btn-danger-outline btn-sm phone-remove-btn"
          title="Remover telefone"
        >&times;</button>
      </div>
    `
    )
    .join('');

  container.querySelectorAll('.phone-row').forEach((rowEl) => {
    const idx = parseInt(rowEl.dataset.phoneIdx, 10);
    rowEl.querySelector('.phone-type-select').addEventListener('change', (e) => {
      phoneRows[idx].tipo = e.target.value;
      renderLiveCardPreview();
      markFormDirty();
    });
    rowEl.querySelector('.phone-number-input').addEventListener('input', (e) => {
      const masked = maskPhone(e.target.value);
      e.target.value = masked;
      phoneRows[idx].numero = masked;
      renderLiveCardPreview();
      markFormDirty();
    });
    rowEl.querySelector('.phone-remove-btn').addEventListener('click', () => {
      if (phoneRows.length <= 1) {
        phoneRows[0] = { tipo: 'Celular', numero: '' };
      } else {
        phoneRows.splice(idx, 1);
      }
      renderPhoneRows();
      renderLiveCardPreview();
      markFormDirty();
    });
  });
}

function setPhoneRowsFromString(str) {
  phoneRows = parsePhonesString(str);
  renderPhoneRows();
}

// =========================================================
// Interactive 3x4 Photo Cropper (300x350 = 6:7 portrait)
// =========================================================
const cropState = {
  img: null,
  coverScale: 1,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  startClientX: 0,
  startClientY: 0,
  startOffsetX: 0,
  startOffsetY: 0,
  pendingRawUrl: '',
};

function renderCropCanvas() {
  const canvas = $('cropCanvas');
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!cropState.img) return;
  const drawW = cropState.img.width * cropState.scale;
  const drawH = cropState.img.height * cropState.scale;
  ctx.drawImage(cropState.img, cropState.offsetX, cropState.offsetY, drawW, drawH);

  const pct = Math.round((cropState.scale / cropState.coverScale) * 100);
  $('cropZoomLabel').textContent = `${pct}%`;
  $('cropZoomSlider').value = String(cropState.scale / cropState.coverScale);
}

function resetCropPosition() {
  if (!cropState.img) return;
  const canvas = $('cropCanvas');
  cropState.scale = cropState.coverScale;
  const drawW = cropState.img.width * cropState.scale;
  const drawH = cropState.img.height * cropState.scale;
  cropState.offsetX = (canvas.width - drawW) / 2;
  cropState.offsetY =
    drawH > canvas.height ? Math.max(canvas.height - drawH, -drawH * 0.05) : (canvas.height - drawH) / 2;
  renderCropCanvas();
}

function setCropZoomFactor(factor) {
  if (!cropState.img) return;
  const clamped = Math.max(0.4, Math.min(3.0, factor));
  const canvas = $('cropCanvas');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const newScale = cropState.coverScale * clamped;
  const ratio = newScale / cropState.scale;
  cropState.offsetX = cx - (cx - cropState.offsetX) * ratio;
  cropState.offsetY = cy - (cy - cropState.offsetY) * ratio;
  cropState.scale = newScale;
  renderCropCanvas();
}

function openPhotoCropperFromUrl(sourceUrl, isNewRawUpload = false) {
  const img = new Image();
  img.onload = () => {
    const canvas = $('cropCanvas');
    cropState.img = img;
    cropState.coverScale = Math.max(canvas.width / img.width, canvas.height / img.height);
    cropState.pendingRawUrl = isNewRawUpload ? sourceUrl : '';
    resetCropPosition();
    $('photoCropModal').hidden = false;
  };
  img.onerror = () => {
    if (isNewRawUpload) URL.revokeObjectURL(sourceUrl);
    showToast('Não foi possível abrir a imagem selecionada.', 'error');
  };
  img.src = sourceUrl;
}

function closePhotoCropper(commit = false) {
  if (!commit && cropState.pendingRawUrl && cropState.pendingRawUrl !== state.rawPhotoObjectUrl) {
    URL.revokeObjectURL(cropState.pendingRawUrl);
  }
  cropState.pendingRawUrl = '';
  cropState.img = null;
  $('photoInput').value = '';
  $('photoCropModal').hidden = true;
}

function applyPhotoCrop() {
  if (!cropState.img) return;
  const canvas = $('cropCanvas');
  // Export compact JPEG (~25-40 KB) so every employee document stays well under Firestore's 1 MB limit
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  if (cropState.pendingRawUrl) {
    if (state.rawPhotoObjectUrl && state.rawPhotoObjectUrl !== cropState.pendingRawUrl) {
      URL.revokeObjectURL(state.rawPhotoObjectUrl);
    }
    state.rawPhotoObjectUrl = cropState.pendingRawUrl;
    cropState.pendingRawUrl = '';
  }
  state.pendingPhotoDataUrl = dataUrl;
  state.removePhotoFlag = false;
  updatePhotoEditorUI(dataUrl);
  renderLiveCardPreview();
  markFormDirty();
  closePhotoCropper(true);
}

// =========================================================
// Firebase Auth & Authorization Flow
// =========================================================
function clearListeners() {
  for (const unsub of state.unsubs) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  state.unsubs = [];
}

function showScreen(screen) {
  $('authScreen').hidden = screen !== 'auth';
  $('pendingScreen').hidden = screen !== 'pending';
  $('appShell').hidden = screen !== 'app';
}

function showAuthError(msg) {
  const el = $('authError');
  if (!msg) {
    el.hidden = true;
    el.textContent = '';
  } else {
    el.hidden = false;
    el.textContent = msg;
  }
}

async function handleUserSignedIn(user) {
  clearListeners();
  state.user = user;
  const emailLower = (user.email || '').toLowerCase();
  const isAdmin = ADMIN_SET.has(emailLower);
  state.isAdmin = isAdmin;

  if (!isAdmin) {
    // Check if authorized in Firestore
    let authorized = false;
    try {
      const authSnap = await getDoc(doc(db, 'authorized_users', emailLower));
      authorized = authSnap.exists() && authSnap.data().active === true;
    } catch {
      authorized = false;
    }

    if (!authorized) {
      await showPendingApprovalScreen(user, emailLower);
      return;
    }
  }

  enterMainApp(user, isAdmin);
}

async function showPendingApprovalScreen(user, emailLower) {
  showScreen('pending');
  $('pendingUserEmail').textContent = emailLower;

  const reqRef = doc(db, 'access_requests', emailLower);
  try {
    const snap = await getDoc(reqRef);
    if (!snap.exists()) {
      await setDoc(reqRef, {
        email: emailLower,
        displayName: user.displayName || '',
        photoURL: user.photoURL || '',
        status: 'pending',
        requestedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.error('Erro ao registrar pedido de acesso:', err);
  }

  const unsub = onSnapshot(reqRef, async (snap) => {
    const data = snap.data();
    const box = $('pendingBox');
    if (data?.status === 'approved') {
      const authSnap = await getDoc(doc(db, 'authorized_users', emailLower));
      if (authSnap.exists() && authSnap.data().active === true) {
        clearListeners();
        enterMainApp(user, false);
      }
    } else if (data?.status === 'rejected') {
      $('pendingTitle').textContent = 'Acesso Recusado';
      box.classList.add('is-rejected');
      $('pendingMessage').textContent =
        'O administrador recusou ou revogou o acesso para este e-mail. Fale com a escola caso precise de liberação.';
    } else {
      $('pendingTitle').textContent = 'Aguardando Autorização';
      box.classList.remove('is-rejected');
      $('pendingMessage').textContent =
        'Sua solicitação de acesso foi enviada ao administrador do sistema. Assim que ele autorizar seu e-mail, esta tela será liberada automaticamente.';
    }
  });
  state.unsubs.push(unsub);
}

function applySchoolNameEverywhere(name) {
  const clean = String(name || '').trim() || DEFAULT_SCHOOL_NAME;
  state.settings.escola_nome = clean;
  $('headerSchoolName').textContent = clean;
  if ($('authSchoolSub')) {
    $('authSchoolSub').textContent = `${clean} — Acesso Restrito`;
  }
  document.title = `Carômetro Geral — ${clean}`;
  if (!$('settingsModal').hidden) {
    $('sEscola').value = clean;
  }
  try {
    localStorage.setItem('carometro_escola_nome', clean);
  } catch {
    // ignore storage errors
  }
  if (state.activeTab === 'impressao') {
    renderPrintPreview();
  }
}

async function enterMainApp(user, isAdmin) {
  showScreen('app');
  $('userBadge').textContent = user.email || user.displayName || 'Usuário';
  $('adminAccessSection').hidden = !isAdmin;
  applySchoolNameEverywhere(state.settings.escola_nome);
  if (!$('printData').dataset.edited) {
    $('printData').value = formatTodayBR();
  }
  if (!$('printUsuario').dataset.edited) {
    $('printUsuario').value = user.email || '';
  }

  // Subscribe to settings
  const unsubSettings = onSnapshot(doc(db, 'settings', 'geral'), (snap) => {
    if (snap.exists()) {
      state.settings = { ...state.settings, ...snap.data() };
    }
    applySchoolNameEverywhere(state.settings.escola_nome);
    if (!$('printTitulo').dataset.edited) {
      $('printTitulo').value = state.settings.titulo_relatorio || 'CARÔMETRO GERAL - 2026 - ANO LETIVO';
    }
  });
  state.unsubs.push(unsubSettings);

  // Subscribe to employees
  const unsubEmp = onSnapshot(
    collection(db, 'employees'),
    (snapshot) => {
      const list = [];
      snapshot.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      state.allEmployees = list;
      applyFiltersAndRender();
    },
    (err) => {
      showToast('Erro ao carregar funcionários: ' + err.message, 'error');
    }
  );
  state.unsubs.push(unsubEmp);

  // Admin: subscribe to pending access requests & authorized users
  if (isAdmin) {
    const unsubReq = onSnapshot(collection(db, 'access_requests'), (snapshot) => {
      const reqs = [];
      snapshot.forEach((d) => reqs.push({ id: d.id, ...d.data() }));
      state.accessRequests = reqs;
      renderAdminNotifications();
    });
    const unsubAuthUsers = onSnapshot(collection(db, 'authorized_users'), (snapshot) => {
      const users = [];
      snapshot.forEach((d) => users.push({ id: d.id, ...d.data() }));
      state.authorizedUsers = users;
      renderAdminNotifications();
    });
    state.unsubs.push(unsubReq, unsubAuthUsers);
  }
}

function renderAdminNotifications() {
  if (!state.isAdmin) {
    $('adminRequestsBanner').hidden = true;
    return;
  }

  const pending = state.accessRequests.filter((r) => r.status === 'pending');
  const banner = $('adminRequestsBanner');

  if (pending.length === 0) {
    banner.hidden = true;
    banner.innerHTML = '';
  } else {
    banner.hidden = false;
    banner.innerHTML = pending
      .map(
        (req) => `
      <div class="admin-req-row">
        <div>
          <strong>Solicitação de acesso pendente:</strong>
          ${escapeHtml(req.displayName ? `${req.displayName} (${req.email})` : req.email)}
        </div>
        <div class="admin-req-actions">
          <button class="btn btn-sm btn-primary" data-approve="${escapeHtml(req.email)}">Autorizar</button>
          <button class="btn btn-sm btn-danger-outline" data-reject="${escapeHtml(req.email)}">Recusar</button>
        </div>
      </div>
    `
      )
      .join('');

    banner.querySelectorAll('[data-approve]').forEach((btn) => {
      btn.addEventListener('click', () => approveUserAccess(btn.dataset.approve));
    });
    banner.querySelectorAll('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', () => rejectUserAccess(btn.dataset.reject));
    });
  }

  // Also update modal access manager
  const listEl = $('accessManagerList');
  if (!listEl) return;
  const activeUsers = state.authorizedUsers.filter((u) => u.active === true);
  const itemsHtml = [];

  for (const req of pending) {
    itemsHtml.push(`
      <div class="access-item">
        <div class="access-item-meta">
          <strong>${escapeHtml(req.email)}</strong>
          <small>Pendente${req.displayName ? ` — ${escapeHtml(req.displayName)}` : ''}</small>
        </div>
        <div class="admin-req-actions">
          <button type="button" class="btn btn-sm btn-primary" data-approve="${escapeHtml(req.email)}">Autorizar</button>
          <button type="button" class="btn btn-sm btn-danger-outline" data-reject="${escapeHtml(req.email)}">Recusar</button>
        </div>
      </div>
    `);
  }

  for (const u of activeUsers) {
    itemsHtml.push(`
      <div class="access-item">
        <div class="access-item-meta">
          <strong>${escapeHtml(u.email)}</strong>
          <small>Autorizado${u.displayName ? ` — ${escapeHtml(u.displayName)}` : ''}</small>
        </div>
        <button type="button" class="btn btn-sm btn-danger-outline" data-revoke="${escapeHtml(u.email)}">Revogar</button>
      </div>
    `);
  }

  listEl.innerHTML =
    itemsHtml.length > 0
      ? itemsHtml.join('')
      : '<p class="muted" style="margin:0;">Nenhum usuário adicional autorizado ainda.</p>';

  listEl.querySelectorAll('[data-approve]').forEach((btn) => {
    btn.addEventListener('click', () => approveUserAccess(btn.dataset.approve));
  });
  listEl.querySelectorAll('[data-reject]').forEach((btn) => {
    btn.addEventListener('click', () => rejectUserAccess(btn.dataset.reject));
  });
  listEl.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', () => revokeUserAccess(btn.dataset.revoke));
  });
}

async function approveUserAccess(email) {
  const emailLower = String(email).toLowerCase();
  const reqItem = state.accessRequests.find((r) => r.email === emailLower);
  try {
    await setDoc(doc(db, 'authorized_users', emailLower), {
      email: emailLower,
      displayName: reqItem?.displayName || '',
      active: true,
      approvedBy: state.user?.email || '',
      approvedAt: serverTimestamp(),
    });
    await setDoc(
      doc(db, 'access_requests', emailLower),
      { status: 'approved', reviewedAt: serverTimestamp() },
      { merge: true }
    );
    showToast(`Acesso autorizado para ${emailLower}!`);
  } catch (err) {
    showToast('Erro ao autorizar: ' + err.message, 'error');
  }
}

async function rejectUserAccess(email) {
  const emailLower = String(email).toLowerCase();
  try {
    await setDoc(
      doc(db, 'access_requests', emailLower),
      { status: 'rejected', reviewedAt: serverTimestamp() },
      { merge: true }
    );
    showToast(`Solicitação de ${emailLower} recusada.`);
  } catch (err) {
    showToast('Erro ao recusar: ' + err.message, 'error');
  }
}

async function revokeUserAccess(email) {
  const emailLower = String(email).toLowerCase();
  try {
    await deleteDoc(doc(db, 'authorized_users', emailLower));
    await setDoc(
      doc(db, 'access_requests', emailLower),
      { status: 'rejected', reviewedAt: serverTimestamp() },
      { merge: true }
    );
    showToast(`Acesso revogado para ${emailLower}.`);
  } catch (err) {
    showToast('Erro ao revogar: ' + err.message, 'error');
  }
}

// =========================================================
// Filtering, Sorting & Rendering (Client-Side on Firestore Snapshot)
// =========================================================
function computeStats(list) {
  let professores = 0;
  let funcionarios = 0;
  let ativos = 0;
  let demitidos = 0;
  for (const emp of list) {
    if (emp.tipo === 'Professor') professores++;
    else funcionarios++;
    if ((emp.data_demissao || '').trim()) demitidos++;
    else ativos++;
  }
  return { total: list.length, professores, funcionarios, ativos, demitidos };
}

function sortEmployeeList(list, order) {
  const arr = [...list];
  const byName = (a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' });
  const codeNum = (c) => {
    const n = parseInt(String(c || '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
  };

  switch (order) {
    case 'nome_desc':
      arr.sort((a, b) => byName(b, a));
      break;
    case 'codigo_asc':
      arr.sort((a, b) => codeNum(a.codigo) - codeNum(b.codigo) || byName(a, b));
      break;
    case 'codigo_desc':
      arr.sort((a, b) => codeNum(b.codigo) - codeNum(a.codigo) || byName(a, b));
      break;
    case 'recentes':
      arr.sort((a, b) => (b.updated_at_ms || 0) - (a.updated_at_ms || 0) || byName(a, b));
      break;
    case 'nome_asc':
    default:
      arr.sort(byName);
      break;
  }
  return arr;
}

function applyFiltersAndRender() {
  state.stats = computeStats(state.allEmployees);
  const { q, tipo, status, assinatura, order } = state.filters;
  const term = (q || '').trim().toLowerCase();
  const termDigits = term.replace(/\D/g, '');

  const filtered = state.allEmployees.filter((emp) => {
    if (tipo && tipo !== 'Todos' && emp.tipo !== tipo) return false;
    const isDem = Boolean((emp.data_demissao || '').trim());
    if (status === 'Ativos' && isDem) return false;
    if (status === 'Demitidos' && !isDem) return false;
    if (assinatura === 'sim' && !emp.tem_assinatura_digitalizada) return false;
    if (assinatura === 'nao' && emp.tem_assinatura_digitalizada) return false;

    if (term) {
      const hay = [
        emp.nome,
        emp.codigo,
        emp.cpf,
        emp.rg,
        emp.email,
        emp.endereco,
        emp.telefones,
        emp.cargo,
      ]
        .join(' ')
        .toLowerCase();
      const cpfDigits = (emp.cpf || '').replace(/\D/g, '');
      const matchesText = hay.includes(term);
      const matchesDigits = termDigits.length >= 3 && cpfDigits.includes(termDigits);
      if (!matchesText && !matchesDigits) return false;
    }
    return true;
  });

  state.employees = sortEmployeeList(filtered, order);

  const validIds = new Set(state.employees.map((e) => e.id));
  for (const id of [...state.selectedIds]) {
    if (!validIds.has(id)) state.selectedIds.delete(id);
  }
  if (state.currentIndex >= state.employees.length) {
    state.currentIndex = Math.max(0, state.employees.length - 1);
  }

  renderStats();
  renderTable();
  updatePrintScopeOptions();

  if (state.pendingSelectId) {
    const idx = state.employees.findIndex((item) => item.id === state.pendingSelectId);
    if (idx >= 0) {
      state.pendingSelectId = null;
      state.currentIndex = idx;
      loadCurrentRecordIntoForm();
    }
  } else if (state.activeTab === 'ficha' && !state.isNewMode) {
    if (state.editingRecordId) {
      const idx = state.employees.findIndex((item) => item.id === state.editingRecordId);
      if (idx >= 0) {
        state.currentIndex = idx;
        updateNavButtons();
        const emp = state.employees[idx];
        if (!state.isDirty && emp.updated_at_ms !== state.loadedUpdatedAtMs) {
          loadCurrentRecordIntoForm();
        }
      } else if (!state.isDirty) {
        loadCurrentRecordIntoForm();
      } else {
        showToast('Atenção: este registro foi modificado ou removido por outro usuário. Salve para não perder suas alterações.', 'error');
      }
    }
  }

  if (state.activeTab === 'impressao') {
    renderPrintPreview();
  }

  if (!state.draftChecked) {
    state.draftChecked = true;
    checkPendingDraftOnLogin();
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
  updatePrintScopeOptions();

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
      const photoHtml = emp.foto_data
        ? `<img class="thumb-photo" src="${emp.foto_data}" alt="" loading="lazy" />`
        : `<div class="thumb-empty">Sem foto</div>`;
      const tipoBadge =
        emp.tipo === 'Professor'
          ? '<span class="badge badge-prof">Professor</span>'
          : '<span class="badge badge-func">Funcionário</span>';
      const demBadge = isDemitido ? '<span class="badge badge-dem">Demitido</span>' : '';
      const assinHtml = emp.tem_assinatura_digitalizada
        ? '<img class="check-mini" src="./assets/checkmark.png" alt="Sim" title="Tem assinatura digitalizada" />'
        : '<span class="row-sub">Não</span>';

      return `
        <tr data-index="${idx}" data-id="${escapeHtml(emp.id)}" class="${isDemitido ? 'is-demitido' : ''}">
          <td class="col-check" onclick="event.stopPropagation()">
            <input type="checkbox" class="row-checkbox" data-id="${escapeHtml(emp.id)}" ${checked} />
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
            <button class="btn btn-sm btn-danger-outline" data-action="delete" data-id="${escapeHtml(emp.id)}">Excluir</button>
          </td>
        </tr>
      `;
    })
    .join('');

  tbody.querySelectorAll('tr').forEach((tr) => {
    tr.addEventListener('click', () => {
      openRecordInFicha(parseInt(tr.dataset.index, 10));
    });
  });

  tbody.querySelectorAll('.row-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
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
      askDeleteEmployee(btn.dataset.id);
    });
  });
}

// =========================================================
// Tabs & Ficha / Navigator
// =========================================================
// =========================================================
// Draft Persistence & Unsaved Changes Guard (No browser confirm/alert)
// =========================================================
function getDraftStorageKey() {
  const email = (state.user?.email || 'anon').toLowerCase();
  return `carometro_unsaved_draft_${email}`;
}

function saveDraftToStorage() {
  if (!state.user) return;
  try {
    const snap = getFormEmployeeSnapshot();
    const hasContent = Boolean(
      snap.nome || snap.codigo || snap.cpf || snap.email || snap.endereco || snap.telefones || snap.foto_data
    );
    if (!hasContent && state.isNewMode) {
      localStorage.removeItem(getDraftStorageKey());
      return;
    }
    const payload = {
      isNewMode: state.isNewMode,
      editingRecordId: state.editingRecordId,
      snapshot: snap,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(getDraftStorageKey(), JSON.stringify(payload));
    } catch {
      // Fallback without photo if localStorage quota is tight
      payload.snapshot = { ...snap, foto_data: '' };
      localStorage.setItem(getDraftStorageKey(), JSON.stringify(payload));
    }
  } catch {
    // ignore storage errors
  }
}

function clearDraftFromStorage() {
  try {
    localStorage.removeItem(getDraftStorageKey());
  } catch {
    // ignore
  }
}

function loadDraftFromStorage() {
  try {
    const raw = localStorage.getItem(getDraftStorageKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.snapshot) return null;
    return parsed;
  } catch {
    return null;
  }
}

function updateDirtyUI() {
  const banner = $('unsavedBanner');
  const pill = $('fichaModePill');
  const saveBtn = $('btnSaveEmployee');
  if (banner) banner.hidden = !state.isDirty;

  if (pill) {
    pill.classList.toggle('is-dirty', state.isDirty);
    if (state.isDirty) {
      pill.textContent = '● Alterações não salvas';
    } else if (state.isNewMode) {
      pill.textContent = 'Novo cadastro';
    } else if (state.editingRecordId) {
      const emp = state.employees[state.currentIndex];
      pill.textContent = emp ? `Editando #${emp.codigo || emp.id.slice(0, 6)}` : 'Editando registro';
    }
  }

  if (saveBtn) {
    saveBtn.classList.toggle('btn-save-dirty', state.isDirty);
    saveBtn.textContent = state.isDirty ? 'Salvar Cadastro *' : 'Salvar Cadastro';
  }
}

function markFormDirty(persistDraft = true) {
  state.isDirty = true;
  updateDirtyUI();
  if (persistDraft) saveDraftToStorage();
}

function clearFormDirty(clearStorage = true) {
  state.isDirty = false;
  updateDirtyUI();
  if (clearStorage) clearDraftFromStorage();
}

function guardUnsavedChanges(action) {
  if (state.activeTab === 'ficha' && state.isDirty) {
    state.pendingNavAction = action;
    const snap = getFormEmployeeSnapshot();
    const label = snap.nome ? `"${snap.nome}"` : 'este registro';
    $('unsavedMessage').innerHTML = `As alterações feitas em <strong>${escapeHtml(label)}</strong> ainda <strong>não foram salvas</strong> no banco de dados. Sair desta guia ou recarregar a página sem salvar fará perder o envio definitivo.`;
    $('unsavedModal').hidden = false;
    return false;
  }
  action();
  return true;
}

function applySnapshotToForm(emp, isNew = false, recordId = null) {
  state.isNewMode = isNew;
  state.editingRecordId = recordId;
  clearPendingPhotoState();

  $('empId').value = recordId || '';
  $('fCodigo').value = emp.codigo || '';
  $('fNome').value = emp.nome || '';
  $('fCpf').value = emp.cpf || '';
  $('fTipo').value = emp.tipo || 'Funcionário';
  setCargoValue(emp.cargo || '');
  $('fEmail').value = emp.email || '';
  setAddressFields(emp);
  $('fNascimento').value = emp.data_nascimento || '';
  $('fSexo').value = emp.sexo || '';
  $('fRg').value = emp.rg || '';
  $('fEmitidoPor').value = emp.emitido_por || (isNew ? 'SSP/SP' : '');
  $('fDataEmissao').value = emp.data_emissao || '';
  $('fDataContratacao').value = emp.data_contratacao || '';
  $('fDataDemissao').value = emp.data_demissao || '';
  $('fAssinatura').checked = emp.tem_assinatura_digitalizada !== undefined ? Boolean(emp.tem_assinatura_digitalizada) : true;
  setPhoneRowsFromString(emp.telefones || '');

  if (emp.foto_data) {
    state.pendingPhotoDataUrl = emp.foto_data;
  } else if (!isNew) {
    state.removePhotoFlag = true;
  }

  updatePhotoEditorUI(emp.foto_data || '');
  updateNavButtons();
  $('btnFichaDelete').disabled = isNew;
  $('btnFichaPrintOne').disabled = isNew;
  $('btnFichaPdfOne').disabled = isNew;
  renderLiveCardPreview();
}

function checkPendingDraftOnLogin() {
  const draft = loadDraftFromStorage();
  if (!draft) return;
  const s = draft.snapshot || {};
  const label = [s.codigo, s.nome].filter(Boolean).join(' — ') || 'Novo funcionário sem nome';
  $('draftRecoveryMessage').innerHTML = `Encontramos um cadastro que não foi salvo antes da página ser fechada ou recarregada: <strong>${escapeHtml(label)}</strong>. Deseja retomar de onde parou para concluir e salvar?`;
  $('draftRecoveryModal').hidden = false;
}

function switchTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });

  if (tabName === 'ficha') {
    if (!state.isNewMode && !state.isDirty) loadCurrentRecordIntoForm();
  } else if (tabName === 'impressao') {
    updatePrintScopeOptions();
    renderPrintPreview();
  }
}

function clearPendingPhotoState() {
  state.pendingPhotoDataUrl = '';
  if (state.rawPhotoObjectUrl) URL.revokeObjectURL(state.rawPhotoObjectUrl);
  state.rawPhotoObjectUrl = '';
  state.removePhotoFlag = false;
}

function openRecordInFicha(index) {
  const safeIdx = Math.max(0, Math.min(index, state.employees.length - 1));
  guardUnsavedChanges(() => {
    state.isNewMode = false;
    state.currentIndex = safeIdx;
    switchTab('ficha');
    loadCurrentRecordIntoForm();
  });
}

function startNewEmployeeForm() {
  guardUnsavedChanges(() => {
    state.isNewMode = true;
    state.editingRecordId = null;
    state.loadedUpdatedAtMs = null;
    clearPendingPhotoState();

    $('empId').value = '';
    $('fCodigo').value = '';
    $('fNome').value = '';
    $('fCpf').value = '';
    $('fTipo').value = state.filters.tipo === 'Professor' ? 'Professor' : 'Funcionário';
    setCargoValue(state.filters.tipo === 'Professor' ? 'Professor(a)' : '');
    $('fEmail').value = '';
    setAddressFields(null);
    $('fNascimento').value = '';
    $('fSexo').value = '';
    $('fRg').value = '';
    $('fEmitidoPor').value = 'SSP/SP';
    $('fDataEmissao').value = '';
    $('fDataContratacao').value = '';
    $('fDataDemissao').value = '';
    $('fAssinatura').checked = true;
    setPhoneRowsFromString('');

    updatePhotoEditorUI('');
    updateNavButtons();
    $('btnFichaDelete').disabled = true;
    $('btnFichaPrintOne').disabled = true;
    $('btnFichaPdfOne').disabled = true;
    clearFormDirty(false);
    renderLiveCardPreview();
    switchTab('ficha');
    $('fNome').focus();
  });
}

function loadCurrentRecordIntoForm() {
  if (state.employees.length === 0) {
    startNewEmployeeForm();
    return;
  }

  state.isNewMode = false;
  clearPendingPhotoState();

  const emp = state.employees[state.currentIndex];
  state.editingRecordId = emp.id;
  state.loadedUpdatedAtMs = emp.updated_at_ms || null;

  $('empId').value = emp.id;
  $('fCodigo').value = emp.codigo || '';
  $('fNome').value = emp.nome || '';
  $('fCpf').value = emp.cpf || '';
  $('fTipo').value = emp.tipo || 'Funcionário';
  setCargoValue(emp.cargo || '');
  $('fEmail').value = emp.email || '';
  setAddressFields(emp);
  $('fNascimento').value = emp.data_nascimento || '';
  $('fSexo').value = emp.sexo || '';
  $('fRg').value = emp.rg || '';
  $('fEmitidoPor').value = emp.emitido_por || '';
  $('fDataEmissao').value = emp.data_emissao || '';
  $('fDataContratacao').value = emp.data_contratacao || '';
  $('fDataDemissao').value = emp.data_demissao || '';
  $('fAssinatura').checked = Boolean(emp.tem_assinatura_digitalizada);
  setPhoneRowsFromString(emp.telefones || '');

  updatePhotoEditorUI(emp.foto_data || '');
  updateNavButtons();
  $('btnFichaDelete').disabled = false;
  $('btnFichaPrintOne').disabled = false;
  $('btnFichaPdfOne').disabled = false;
  clearFormDirty(false);
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
  const btnAdjust = $('btnAdjustPhoto');
  if (url) {
    img.src = url;
    img.hidden = false;
    ph.hidden = true;
    btnAdjust.hidden = false;
  } else {
    img.src = '';
    img.hidden = true;
    ph.hidden = false;
    btnAdjust.hidden = true;
  }
}

function getFormEmployeeSnapshot() {
  const existing = !state.isNewMode ? state.employees[state.currentIndex] : null;
  let photoData = '';
  if (state.pendingPhotoDataUrl) {
    photoData = state.pendingPhotoDataUrl;
  } else if (!state.removePhotoFlag && existing?.foto_data) {
    photoData = existing.foto_data;
  }

  const addrParts = getAddressParts();
  return {
    id: $('empId').value || null,
    codigo: $('fCodigo').value.trim(),
    nome: $('fNome').value.trim(),
    cpf: $('fCpf').value.trim(),
    tipo: $('fTipo').value,
    cargo: getCargoValue(),
    email: $('fEmail').value.trim(),
    endereco_partes: addrParts,
    endereco: composeAddressString(addrParts),
    data_nascimento: $('fNascimento').value.trim(),
    sexo: $('fSexo').value,
    rg: $('fRg').value.trim(),
    emitido_por: $('fEmitidoPor').value.trim(),
    data_emissao: $('fDataEmissao').value.trim(),
    data_contratacao: $('fDataContratacao').value.trim(),
    data_demissao: $('fDataDemissao').value.trim(),
    tem_assinatura_digitalizada: $('fAssinatura').checked ? 1 : 0,
    telefones: serializePhoneRows(),
    foto_data: photoData,
  };
}

function buildCardHtml(emp, standalone = false, showCargo = true) {
  const fieldsConfig = standalone ? getDefaultPrintFieldsConfig() : state.printFieldsConfig;
  const layout = buildPackedCardLayout(fieldsConfig, emp, { showCargo });

  const rowsHtml = layout.rows
    .map((row) => {
      if (row.length === 1 && row[0].type === 'full') {
        const cell = row[0];
        return `<div class="cm-dyn-full ${cell.bold ? 'cm-bold' : ''}">${escapeHtml(cell.text)}</div>`;
      }

      const isHeaderRow = row.some((c) => c.type === 'code_name_pair' || c.isHeaderName);
      const cellsHtml = row
        .map((cell) => {
          const leftStyle = `left: ${cell.xPt}pt; width: ${cell.widthPt}pt;`;
          if (cell.type === 'code_name_pair') {
            return `
              <div class="cm-dyn-cell is-header is-pair" style="${leftStyle}">
                ${cell.codigo ? `<span class="cm-dyn-codigo ${cell.codigoBold ? 'cm-bold' : ''}">${escapeHtml(cell.codigo)}</span>` : ''}
                <span class="cm-dyn-nome ${cell.nomeBold ? 'cm-bold' : ''}">${escapeHtml(cell.nome)}</span>
              </div>
            `;
          }
          if (cell.type === 'checkmark') {
            const checkImg = cell.checked
              ? `<img src="./assets/checkmark.png" class="cm-check-icon-inline" alt="Sim" />`
              : '';
            return `<span class="cm-dyn-cell ${cell.isHeaderName ? 'is-header' : ''} ${cell.bold ? 'cm-bold' : ''}" style="${leftStyle}">${escapeHtml(cell.text)}${checkImg}</span>`;
          }
          return `<span class="cm-dyn-cell ${cell.isHeaderName ? 'is-header' : ''} ${cell.bold ? 'cm-bold' : ''}" style="${leftStyle}">${escapeHtml(cell.text)}</span>`;
        })
        .join('');

      return `<div class="cm-dyn-row ${isHeaderRow ? 'is-header' : ''}">${cellsHtml}</div>`;
    })
    .join('');

  let photoBoxHtml = '';
  if (layout.showPhoto) {
    const photoSrc = emp.foto_data || '';
    const photoHtml = photoSrc
      ? `<img src="${photoSrc}" alt="" />`
      : `<div class="cm-photo-empty">Sem foto</div>`;
    photoBoxHtml = `<div class="cm-photo-box">${photoHtml}</div>`;
  }

  return `
    <div class="cm-card ${standalone ? 'cm-card-standalone' : ''} ${layout.showPhoto ? '' : 'cm-no-photo'}">
      <div class="cm-card-body">
        ${rowsHtml}
      </div>
      ${photoBoxHtml}
    </div>
  `;
}

function renderLiveCardPreview() {
  const snap = getFormEmployeeSnapshot();
  $('liveCardPreview').innerHTML = buildCardHtml(snap, true, true);
}

// Photo handling
function handleSelectedPhotoFile(file) {
  if (!file) return;
  const rawUrl = URL.createObjectURL(file);
  openPhotoCropperFromUrl(rawUrl, true);
}

function openCurrentPhotoInCropper() {
  const existing = !state.isNewMode ? state.employees[state.currentIndex] : null;
  if (state.rawPhotoObjectUrl) {
    openPhotoCropperFromUrl(state.rawPhotoObjectUrl, false);
  } else if (state.pendingPhotoDataUrl) {
    openPhotoCropperFromUrl(state.pendingPhotoDataUrl, false);
  } else if (!state.removePhotoFlag && existing?.foto_data) {
    openPhotoCropperFromUrl(existing.foto_data, false);
  }
}

// =========================================================
// Firestore CRUD (Add / Edit / Delete)
// =========================================================
async function handleSaveEmployee(e, opts = {}) {
  if (e) e.preventDefault();
  if (state.isSaving) return false;

  const snap = getFormEmployeeSnapshot();
  if (!snap.nome) {
    showToast('Informe o nome completo do funcionário.', 'error');
    $('fNome').focus();
    return false;
  }

  const isNew = state.isNewMode || !snap.id;

  // Guard against accidental duplicate CPF or Código on new entries
  if (isNew && !opts.forceDuplicate) {
    const cpfDigits = snap.cpf.replace(/\D/g, '');
    const codeClean = snap.codigo.trim();
    const match = state.allEmployees.find((emp) => {
      const empCpf = (emp.cpf || '').replace(/\D/g, '');
      const empCode = (emp.codigo || '').trim();
      const sameCpf = cpfDigits.length === 11 && empCpf === cpfDigits;
      const sameCode = codeClean.length > 0 && empCode === codeClean;
      return sameCpf || sameCode;
    });
    if (match) {
      state.pendingDuplicateMatch = match;
      state.pendingDuplicateOpts = opts;
      $('duplicateMessage').innerHTML = `Já existe um cadastro com os mesmos dados: <strong>${escapeHtml(match.nome)}</strong> (Código: ${escapeHtml(match.codigo || 'S/N')}, CPF: ${escapeHtml(match.cpf || 'S/N')}). O que deseja fazer?`;
      $('duplicateModal').hidden = false;
      return false;
    }
  }

  const record = {
    codigo: snap.codigo,
    nome: snap.nome,
    cpf: snap.cpf,
    tipo: snap.tipo,
    cargo: snap.cargo,
    email: snap.email,
    endereco_partes: snap.endereco_partes,
    endereco: snap.endereco,
    data_nascimento: snap.data_nascimento,
    sexo: snap.sexo,
    rg: snap.rg,
    emitido_por: snap.emitido_por,
    data_emissao: snap.data_emissao,
    data_contratacao: snap.data_contratacao,
    data_demissao: snap.data_demissao,
    tem_assinatura_digitalizada: snap.tem_assinatura_digitalizada ? 1 : 0,
    telefones: snap.telefones,
    foto_data: snap.foto_data || '',
    updated_at_ms: Date.now(),
  };

  const btn = $('btnSaveEmployee');
  state.isSaving = true;
  btn.disabled = true;

  try {
    let savedId = snap.id;
    if (isNew) {
      record.created_at_ms = Date.now();
      const docRef = await addDoc(collection(db, 'employees'), record);
      savedId = docRef.id;
      showToast('Funcionário cadastrado com sucesso!');
    } else {
      await updateDoc(doc(db, 'employees', snap.id), record);
      showToast('Cadastro atualizado com sucesso!');
    }

    state.isNewMode = false;
    state.editingRecordId = savedId;
    state.pendingSelectId = savedId;
    clearPendingPhotoState();
    clearFormDirty(true);

    const existingIdx = state.employees.findIndex((item) => item.id === savedId);
    if (existingIdx >= 0) {
      state.pendingSelectId = null;
      state.currentIndex = existingIdx;
      loadCurrentRecordIntoForm();
    }

    if (typeof opts.onAfterSave === 'function') {
      opts.onAfterSave();
    }
    return true;
  } catch (err) {
    showToast('Erro ao salvar: ' + err.message, 'error');
    return false;
  } finally {
    state.isSaving = false;
    btn.disabled = false;
  }
}

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
    await deleteDoc(doc(db, 'employees', id));
    $('confirmModal').hidden = true;
    state.pendingDeleteId = null;
    state.selectedIds.delete(id);
    if (state.editingRecordId === id) {
      state.editingRecordId = null;
      clearFormDirty(true);
    }
    showToast('Registro excluído com sucesso.');
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'error');
  }
}

// =========================================================
// Print A4 & Client-Side PDF Generation
// =========================================================
function updatePrintScopeOptions() {
  const sel = $('printScope');
  if (!sel) return;
  const prev = sel.value || 'filtered';
  const selectedCount = state.selectedIds.size;

  const opts = [
    { value: 'filtered', label: 'Lista filtrada atual' },
    { value: 'all_ativos', label: 'Todos Ativos (Geral / Misturado)' },
    { value: 'professores', label: 'Somente Professores (Ativos)' },
    { value: 'funcionarios', label: 'Somente Funcionários (Ativos)' },
    { value: 'all', label: 'Todos cadastrados (incl. demitidos)' },
  ];

  if (selectedCount > 0) {
    opts.splice(1, 0, {
      value: 'selected',
      label: `Somente selecionados (${selectedCount})`,
    });
  }

  sel.innerHTML = opts
    .map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
    .join('');

  if (opts.some((o) => o.value === prev)) {
    sel.value = prev;
  } else {
    sel.value = 'filtered';
  }
}

function getEmployeesForPrint(overrideScope = null, specificIds = null) {
  const scope = overrideScope || $('printScope').value || 'filtered';
  if (specificIds && specificIds.length > 0) {
    return state.employees.filter((e) => specificIds.includes(e.id));
  }
  if (scope === 'selected') {
    if (state.selectedIds.size === 0) {
      return state.employees;
    }
    return sortEmployeeList(
      state.allEmployees.filter((e) => state.selectedIds.has(e.id)),
      state.filters.order
    );
  }
  if (scope === 'professores') {
    return sortEmployeeList(
      state.allEmployees.filter(
        (e) => e.tipo === 'Professor' && !(e.data_demissao || '').trim()
      ),
      state.filters.order
    );
  }
  if (scope === 'funcionarios') {
    return sortEmployeeList(
      state.allEmployees.filter(
        (e) => e.tipo !== 'Professor' && !(e.data_demissao || '').trim()
      ),
      state.filters.order
    );
  }
  if (scope === 'all_ativos') {
    return sortEmployeeList(
      state.allEmployees.filter((e) => !(e.data_demissao || '').trim()),
      state.filters.order
    );
  }
  if (scope === 'all') {
    return sortEmployeeList(state.allEmployees, state.filters.order);
  }
  return state.employees;
}

function shouldShowCargo(overrideScope = null, specificIds = null) {
  if (specificIds && specificIds.length > 0) return true;
  const scope = overrideScope || $('printScope')?.value || 'filtered';
  if (scope === 'professores') return false;
  if ((scope === 'filtered' || scope === 'selected') && state.filters.tipo === 'Professor') {
    return false;
  }
  return true;
}

function estimateHtmlCardHeightPt(emp, showCargo = true) {
  const layout = buildPackedCardLayout(state.printFieldsConfig, emp, { showCargo });
  const maxChars = layout.showPhoto ? 95 : 112;
  let textHeight = 0;
  for (const row of layout.rows) {
    if (row.length === 1 && row[0].type === 'full') {
      const lines = Math.max(1, Math.ceil((row[0].text || '').length / maxChars));
      textHeight += lines * 11.4 + 0.8;
    } else {
      const isHeaderRow = row.some((c) => c.type === 'code_name_pair' || c.isHeaderName);
      textHeight += isHeaderRow ? 13.0 : 11.4;
    }
  }
  const minCardH = layout.showPhoto ? 96 : 36;
  return Math.max(minCardH, 16 + textHeight);
}

function buildA4PagesHtml(employees, showCargo = true) {
  const escola = state.settings.escola_nome || DEFAULT_SCHOOL_NAME;
  const titulo = $('printTitulo').value.trim() || state.settings.titulo_relatorio;
  const usuario = $('printUsuario').value.trim();
  const dataStr = $('printData').value.trim();

  const pages = [];
  let current = [];
  let y = 78.3;
  for (const emp of employees) {
    const h = estimateHtmlCardHeightPt(emp, showCargo);
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
      const cardsHtml = group.map((emp) => buildCardHtml(emp, false, showCargo)).join('');
      return `
        <div class="a4-page">
          <div class="cm-header">
            <img src="./assets/logo.png" alt="Educação Adventista" class="cm-logo" />
            <div class="cm-school">${escapeHtml(escola)}</div>
            <div class="cm-title">${escapeHtml(titulo)}</div>
          </div>
          <div class="cm-cards">${cardsHtml}</div>
          <div class="cm-footer">
            <span>${dataStr ? escapeHtml(dataStr) : ''}</span>
            <span>${usuario ? `Usuário:${escapeHtml(usuario)}` : ''}</span>
            <span>${pIdx + 1}/${totalPages}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderPrintPreview() {
  const list = getEmployeesForPrint();
  const showCargo = shouldShowCargo();
  const html = buildA4PagesHtml(list, showCargo);
  $('printPreviewContainer').innerHTML = html;
  $('printOnlyRoot').innerHTML = html;
}

const PRINT_FIELDS_LABEL_MAP = new Map(PRINT_FIELD_CATALOG.map((f) => [f.key, f.label]));
const PRINT_FIELDS_MINIMAL_SET = new Set(['foto', 'codigo', 'nome', 'cpf', 'telefones', 'cargo']);
let dragPrintFieldIndex = null;

function openPrintFieldsModal() {
  state.tempPrintFields = state.printFieldsConfig.map((item) => ({ ...item }));
  renderPrintFieldsModalList();
  $('printFieldsModal').hidden = false;
}

function moveTempPrintField(fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
  if (fromIdx >= state.tempPrintFields.length || toIdx >= state.tempPrintFields.length) return;
  const [moved] = state.tempPrintFields.splice(fromIdx, 1);
  state.tempPrintFields.splice(toIdx, 0, moved);
  renderPrintFieldsModalList();
}

function renderPrintFieldsModalList() {
  const container = $('printFieldsList');
  if (!container) return;
  container.innerHTML = '';

  const total = state.tempPrintFields.length;
  state.tempPrintFields.forEach((item, idx) => {
    const label = PRINT_FIELDS_LABEL_MAP.get(item.key) || item.key;
    const isPhoto = item.key === 'foto';

    const row = document.createElement('div');
    row.className = `pf-row${item.enabled ? '' : ' is-disabled'}`;
    row.draggable = true;
    row.dataset.index = String(idx);

    row.innerHTML = `
      <div class="pf-row-left">
        <span class="pf-handle" title="Arraste para reordenar">&#9776;</span>
        <label class="pf-check-label">
          <input type="checkbox" class="pf-checkbox" ${item.enabled ? 'checked' : ''} />
          <span class="pf-field-name">${escapeHtml(label)}</span>
        </label>
        <div class="pf-label-wrap">
          <input
            type="text"
            class="pf-label-input"
            value="${escapeHtml(isPhoto ? 'Imagem 3x4' : (item.customLabel ?? ''))}"
            placeholder="Sem prefixo (só valor)"
            title="${isPhoto ? 'Campo de imagem' : 'Nome que sairá na impressão (vazio = só o valor)'}"
            ${isPhoto ? 'disabled' : ''}
          />
        </div>
      </div>
      <div class="pf-actions">
        <button type="button" class="pf-wrap-btn ${item.fullWidth ? 'is-full' : ''}" title="${isPhoto ? 'Foto fixa à direita' : (item.fullWidth ? 'Ocupando linha inteira (clique p/ tabular na mesma linha)' : 'Tabulado na mesma linha quando couber (clique p/ linha toda)')}" ${isPhoto ? 'disabled' : ''}>${isPhoto ? 'Fixa' : (item.fullWidth ? 'Linha toda' : 'Tabulado')}</button>
        <button type="button" class="pf-bold-btn ${item.bold ? 'active' : ''}" title="${isPhoto ? 'Foto não usa negrito' : 'Alternar negrito na impressão'}" ${isPhoto ? 'disabled' : ''}>N</button>
        <button type="button" class="pf-move-btn pf-move-up" title="Mover para cima" ${idx === 0 ? 'disabled' : ''}>&#8593;</button>
        <button type="button" class="pf-move-btn pf-move-down" title="Mover para baixo" ${idx === total - 1 ? 'disabled' : ''}>&#8595;</button>
      </div>
    `;

    row.querySelector('.pf-checkbox').addEventListener('change', (e) => {
      item.enabled = e.target.checked;
      row.classList.toggle('is-disabled', !item.enabled);
    });

    if (!isPhoto) {
      const labelInput = row.querySelector('.pf-label-input');
      labelInput.addEventListener('input', (e) => {
        item.customLabel = e.target.value;
      });
      labelInput.addEventListener('focus', () => {
        row.draggable = false;
      });
      labelInput.addEventListener('blur', () => {
        row.draggable = true;
      });

      row.querySelector('.pf-wrap-btn').addEventListener('click', (e) => {
        item.fullWidth = !item.fullWidth;
        e.currentTarget.classList.toggle('is-full', item.fullWidth);
        e.currentTarget.textContent = item.fullWidth ? 'Linha toda' : 'Tabulado';
        e.currentTarget.title = item.fullWidth
          ? 'Ocupando linha inteira (clique p/ tabular na mesma linha)'
          : 'Tabulado na mesma linha quando couber (clique p/ linha toda)';
      });

      row.querySelector('.pf-bold-btn').addEventListener('click', (e) => {
        item.bold = !item.bold;
        e.currentTarget.classList.toggle('active', item.bold);
      });
    }

    row.querySelector('.pf-move-up').addEventListener('click', () => moveTempPrintField(idx, idx - 1));
    row.querySelector('.pf-move-down').addEventListener('click', () => moveTempPrintField(idx, idx + 1));

    row.addEventListener('dragstart', (e) => {
      dragPrintFieldIndex = idx;
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
      }
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragPrintFieldIndex !== null && dragPrintFieldIndex !== idx) {
        row.classList.add('drag-over');
      }
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const fromIdx = dragPrintFieldIndex;
      dragPrintFieldIndex = null;
      if (fromIdx !== null && fromIdx !== idx) {
        moveTempPrintField(fromIdx, idx);
      }
    });
    row.addEventListener('dragend', () => {
      dragPrintFieldIndex = null;
      row.classList.remove('dragging');
      container.querySelectorAll('.pf-row.drag-over').forEach((el) => el.classList.remove('drag-over'));
    });

    container.appendChild(row);
  });
}

function triggerBrowserPrint(overrideScope = null, specificIds = null) {
  const list = getEmployeesForPrint(overrideScope, specificIds);
  const showCargo = shouldShowCargo(overrideScope, specificIds);
  $('printOnlyRoot').innerHTML = buildA4PagesHtml(list, showCargo);
  window.print();
}

async function downloadPdf(overrideScope = null, specificIds = null, inline = false) {
  try {
    const list = getEmployeesForPrint(overrideScope, specificIds);
    const showCargo = shouldShowCargo(overrideScope, specificIds);
    showToast('Gerando PDF...');
    const blob = await generateCarometroPdfBlob(list, {
      escola_nome: state.settings.escola_nome || DEFAULT_SCHOOL_NAME,
      titulo_relatorio: $('printTitulo').value.trim() || state.settings.titulo_relatorio,
      usuario_rodape: $('printUsuario').value.trim(),
      data_impressao: $('printData').value.trim(),
      show_cargo: showCargo,
      fields_config: state.printFieldsConfig,
    });
    const url = URL.createObjectURL(blob);
    if (inline) {
      window.open(url, '_blank');
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = `carometro_${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (err) {
    showToast('Erro ao gerar PDF: ' + err.message, 'error');
  }
}

// =========================================================
// Settings, Backup & Import
// =========================================================
function openSettingsModal() {
  $('sEscola').value = state.settings.escola_nome || '';
  $('sTitulo').value = state.settings.titulo_relatorio || '';
  $('sUsuario').value = state.settings.usuario_rodape || '';
  renderAdminNotifications();
  $('settingsModal').hidden = false;
}

async function saveSettings(e) {
  e.preventDefault();
  const payload = {
    escola_nome: $('sEscola').value.trim() || DEFAULT_SCHOOL_NAME,
    titulo_relatorio: $('sTitulo').value.trim() || 'CARÔMETRO GERAL - 2026 - ANO LETIVO',
    usuario_rodape: $('sUsuario').value.trim(),
  };
  try {
    await setDoc(doc(db, 'settings', 'geral'), payload, { merge: true });
    applySchoolNameEverywhere(payload.escola_nome);
    delete $('printTitulo').dataset.edited;
    delete $('printUsuario').dataset.edited;
    $('settingsModal').hidden = true;
    showToast('Configurações salvas!');
  } catch (err) {
    showToast('Erro ao salvar configurações: ' + err.message, 'error');
  }
}

let inlineSchoolEditing = false;
function openInlineSchoolEditor() {
  inlineSchoolEditing = true;
  $('headerSchoolName').hidden = true;
  const input = $('headerSchoolInput');
  input.value = state.settings.escola_nome || DEFAULT_SCHOOL_NAME;
  input.hidden = false;
  input.focus();
  input.select();
}

async function commitInlineSchoolName(save = true) {
  if (!inlineSchoolEditing) return;
  inlineSchoolEditing = false;
  const input = $('headerSchoolInput');
  const nextName = input.value.trim();
  input.hidden = true;
  $('headerSchoolName').hidden = false;

  if (!save || !nextName || nextName === state.settings.escola_nome) return;
  applySchoolNameEverywhere(nextName);
  try {
    await setDoc(doc(db, 'settings', 'geral'), { escola_nome: nextName }, { merge: true });
    showToast('Nome da instituição atualizado em todo o sistema!');
  } catch (err) {
    showToast('Erro ao salvar nome da escola: ' + err.message, 'error');
  }
}

function downloadJsonBackup() {
  const payload = {
    exported_at: new Date().toISOString(),
    settings: state.settings,
    employees: sortEmployeeList(state.allEmployees, 'nome_asc').map(({ id: _id, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `carometro_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function handleRestoreBackup(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (!json || !Array.isArray(json.employees)) {
      throw new Error('Arquivo JSON inválido.');
    }

    // Build lookup of existing records by (codigo + nome) to avoid duplicates on import
    const existingMap = new Map();
    for (const emp of state.allEmployees) {
      const key = `${(emp.codigo || '').trim()}|${(emp.nome || '').trim().toLowerCase()}`;
      existingMap.set(key, emp.id);
    }

    let imported = 0;
    const batchSize = 150;
    for (let i = 0; i < json.employees.length; i += batchSize) {
      const chunk = json.employees.slice(i, i + batchSize);
      const batch = writeBatch(db);
      for (const raw of chunk) {
        const record = {
          codigo: String(raw.codigo ?? '').trim(),
          nome: String(raw.nome ?? '').trim(),
          cpf: String(raw.cpf ?? '').trim(),
          endereco: String(raw.endereco ?? '').trim(),
          data_nascimento: String(raw.data_nascimento ?? '').trim(),
          sexo: String(raw.sexo ?? '').trim(),
          email: String(raw.email ?? '').trim(),
          rg: String(raw.rg ?? '').trim(),
          emitido_por: String(raw.emitido_por ?? '').trim(),
          data_emissao: String(raw.data_emissao ?? '').trim(),
          data_contratacao: String(raw.data_contratacao ?? '').trim(),
          data_demissao: String(raw.data_demissao ?? '').trim(),
          tem_assinatura_digitalizada: raw.tem_assinatura_digitalizada ? 1 : 0,
          telefones: String(raw.telefones ?? '').trim(),
          tipo: String(raw.tipo || 'Funcionário').trim(),
          cargo: String(raw.cargo ?? '').trim(),
          foto_data: String(raw.foto_data ?? '').trim(),
          updated_at_ms: Date.now(),
        };
        if (!record.nome) continue;

        const key = `${record.codigo}|${record.nome.toLowerCase()}`;
        const existingId = existingMap.get(key);
        if (existingId) {
          batch.set(doc(db, 'employees', existingId), record, { merge: true });
        } else {
          record.created_at_ms = Date.now();
          batch.set(doc(collection(db, 'employees')), record);
        }
        imported++;
      }
      await batch.commit();
    }

    if (json.settings && typeof json.settings === 'object') {
      await setDoc(
        doc(db, 'settings', 'geral'),
        {
          escola_nome: json.settings.escola_nome || state.settings.escola_nome,
          titulo_relatorio: json.settings.titulo_relatorio || state.settings.titulo_relatorio,
          usuario_rodape: json.settings.usuario_rodape || state.settings.usuario_rodape,
        },
        { merge: true }
      );
    }

    $('restoreFileInput').value = '';
    $('settingsModal').hidden = true;
    showToast(`Importação concluída: ${imported} registro(s) sincronizado(s)!`);
  } catch (err) {
    showToast('Erro ao importar: ' + err.message, 'error');
  }
}

// =========================================================
// Event Listeners
// =========================================================
function bindEvents() {
  // Auth
  $('btnGoogleLogin').addEventListener('click', async () => {
    showAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      showAuthError('Não foi possível entrar com o Google: ' + (err.message || err.code));
    }
  });

  $('emailLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    showAuthError('');
    const email = $('loginEmail').value.trim();
    const pass = $('loginPassword').value;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch {
      showAuthError('E-mail ou senha inválidos.');
    }
  });

  $('btnLogout').addEventListener('click', () =>
    guardUnsavedChanges(() => signOut(auth))
  );
  $('btnPendingLogout').addEventListener('click', () => signOut(auth));
  $('btnRetryAuthCheck').addEventListener('click', () => {
    if (auth.currentUser) handleUserSignedIn(auth.currentUser);
  });

  // Tabs
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetTab = btn.dataset.tab;
      if (targetTab === state.activeTab) return;
      guardUnsavedChanges(() => switchTab(targetTab));
    });
  });

  // Topbar buttons
  $('btnNewEmployee').addEventListener('click', startNewEmployeeForm);
  $('btnPrintPreview').addEventListener('click', () => {
    guardUnsavedChanges(() => {
      updatePrintScopeOptions();
      if (state.selectedIds.size > 0) {
        $('printScope').value = 'selected';
      }
      switchTab('impressao');
    });
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
      applyFiltersAndRender();
    }, 120);
  });

  $('tipoFilter').querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('tipoFilter').querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.tipo = btn.dataset.value;
      applyFiltersAndRender();
    });
  });

  $('statusFilter').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    applyFiltersAndRender();
  });

  $('assinaturaFilter').addEventListener('change', (e) => {
    state.filters.assinatura = e.target.value;
    applyFiltersAndRender();
  });

  $('orderSelect').addEventListener('change', (e) => {
    state.filters.order = e.target.value;
    applyFiltersAndRender();
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
    applyFiltersAndRender();
  });

  // Selection
  $('selectAllCheckbox').addEventListener('change', (e) => {
    if (e.target.checked) {
      state.employees.forEach((emp) => state.selectedIds.add(emp.id));
    } else {
      state.selectedIds.clear();
    }
    renderTable();
    updatePrintScopeOptions();
  });

  $('btnClearSelection').addEventListener('click', () => {
    state.selectedIds.clear();
    renderTable();
    updatePrintScopeOptions();
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
  $('btnCancelForm').addEventListener('click', () =>
    guardUnsavedChanges(() => switchTab('consulta'))
  );
  $('btnQuickSave').addEventListener('click', () => handleSaveEmployee(null));

  // Form inputs & masks
  $('fCpf').addEventListener('input', (e) => {
    e.target.value = maskCpf(e.target.value);
    renderLiveCardPreview();
    markFormDirty();
  });
  ['fNascimento', 'fDataEmissao', 'fDataContratacao', 'fDataDemissao'].forEach((id) => {
    $(id).addEventListener('input', (e) => {
      e.target.value = maskDate(e.target.value);
      renderLiveCardPreview();
      markFormDirty();
    });
  });
  ['fCodigo', 'fNome', 'fTipo', 'fEmail', 'fEndRua', 'fEndNumero', 'fEndComplemento', 'fEndBairro', 'fEndCidade', 'fEndUf', 'fSexo', 'fRg', 'fEmitidoPor'].forEach(
    (id) => {
      $(id).addEventListener('input', () => {
        if (id === 'fEndUf') $(id).value = $(id).value.toUpperCase();
        renderLiveCardPreview();
        markFormDirty();
      });
      $(id).addEventListener('change', () => {
        renderLiveCardPreview();
        markFormDirty();
      });
    }
  );
  $('fEndCep').addEventListener('input', (e) => {
    e.target.value = maskCep(e.target.value);
    renderLiveCardPreview();
    markFormDirty();
    lookupCepIfComplete(e.target.value);
  });
  $('fCargoSelect').addEventListener('change', (e) => {
    const isOther = e.target.value === CARGO_OTHER_VALUE;
    $('fCargoCustom').hidden = !isOther;
    if (isOther) $('fCargoCustom').focus();
    renderLiveCardPreview();
    markFormDirty();
  });
  $('fCargoCustom').addEventListener('input', () => {
    renderLiveCardPreview();
    markFormDirty();
  });
  $('btnAddPhone').addEventListener('click', () => {
    phoneRows.push({ tipo: 'WhatsApp', numero: '' });
    renderPhoneRows();
    markFormDirty();
    const inputs = $('phoneRowsContainer').querySelectorAll('.phone-number-input');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  $('fAssinatura').addEventListener('change', () => {
    renderLiveCardPreview();
    markFormDirty();
  });

  // Photo drag/drop/click & 3x4 cropper
  const dropZone = $('photoDropZone');
  dropZone.addEventListener('click', () => {
    if (!$('photoPreviewImg').hidden) {
      openCurrentPhotoInCropper();
    } else {
      $('photoInput').click();
    }
  });
  $('btnChoosePhoto').addEventListener('click', () => $('photoInput').click());
  $('btnAdjustPhoto').addEventListener('click', openCurrentPhotoInCropper);
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
    clearPendingPhotoState();
    state.removePhotoFlag = true;
    $('photoInput').value = '';
    updatePhotoEditorUI('');
    renderLiveCardPreview();
    markFormDirty();
  });

  // 3x4 Cropper pointer & zoom controls
  const cropViewport = $('cropViewport');
  cropViewport.addEventListener('pointerdown', (e) => {
    if (!cropState.img) return;
    cropState.dragging = true;
    cropState.startClientX = e.clientX;
    cropState.startClientY = e.clientY;
    cropState.startOffsetX = cropState.offsetX;
    cropState.startOffsetY = cropState.offsetY;
    cropViewport.classList.add('dragging');
    cropViewport.setPointerCapture(e.pointerId);
  });
  cropViewport.addEventListener('pointermove', (e) => {
    if (!cropState.dragging) return;
    const rect = cropViewport.getBoundingClientRect();
    const canvas = $('cropCanvas');
    const factorX = canvas.width / rect.width;
    const factorY = canvas.height / rect.height;
    cropState.offsetX = cropState.startOffsetX + (e.clientX - cropState.startClientX) * factorX;
    cropState.offsetY = cropState.startOffsetY + (e.clientY - cropState.startClientY) * factorY;
    renderCropCanvas();
  });
  const endCropDrag = () => {
    cropState.dragging = false;
    cropViewport.classList.remove('dragging');
  };
  cropViewport.addEventListener('pointerup', endCropDrag);
  cropViewport.addEventListener('pointercancel', endCropDrag);
  cropViewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const currentFactor = cropState.scale / cropState.coverScale;
      const step = e.deltaY < 0 ? 0.08 : -0.08;
      setCropZoomFactor(currentFactor + step);
    },
    { passive: false }
  );

  $('cropZoomSlider').addEventListener('input', (e) => {
    setCropZoomFactor(parseFloat(e.target.value));
  });
  $('btnZoomIn').addEventListener('click', () => {
    setCropZoomFactor(cropState.scale / cropState.coverScale + 0.1);
  });
  $('btnZoomOut').addEventListener('click', () => {
    setCropZoomFactor(cropState.scale / cropState.coverScale - 0.1);
  });
  $('btnCropReset').addEventListener('click', resetCropPosition);
  $('btnApplyCrop').addEventListener('click', applyPhotoCrop);
  $('btnCancelCrop').addEventListener('click', () => closePhotoCropper(false));
  $('btnCloseCrop').addEventListener('click', () => closePhotoCropper(false));

  $('employeeForm').addEventListener('submit', handleSaveEmployee);

  // Print preview controls
  $('printTituloPreset').addEventListener('change', (e) => {
    if (e.target.value) {
      $('printTitulo').value = e.target.value;
      $('printTitulo').dataset.edited = '1';
      e.target.value = '';
      renderPrintPreview();
    }
  });
  $('printTitulo').addEventListener('input', () => {
    $('printTitulo').dataset.edited = '1';
    renderPrintPreview();
  });
  $('printUsuario').addEventListener('input', () => {
    $('printUsuario').dataset.edited = '1';
    renderPrintPreview();
  });
  $('printData').addEventListener('input', () => {
    $('printData').dataset.edited = '1';
    renderPrintPreview();
  });
  $('printScope').addEventListener('change', (e) => {
    if (!$('printTitulo').dataset.edited) {
      if (e.target.value === 'professores') {
        $('printTitulo').value = 'PROFESSORES ATIVOS - 2026 - ANO LETIVO';
      } else if (e.target.value === 'funcionarios') {
        $('printTitulo').value = 'FUNCIONÁRIOS ATIVOS - 2026 - ANO LETIVO';
      } else if (e.target.value === 'all_ativos' || e.target.value === 'all') {
        $('printTitulo').value = state.settings.titulo_relatorio || 'CARÔMETRO GERAL - 2026 - ANO LETIVO';
      }
    }
    renderPrintPreview();
  });
  $('btnPrintFields').addEventListener('click', openPrintFieldsModal);
  $('btnPrintBrowser').addEventListener('click', () => triggerBrowserPrint());
  $('btnOpenPdfPrint').addEventListener('click', () => downloadPdf(null, null, true));
  $('btnDownloadPdfFromPreview').addEventListener('click', () => downloadPdf(null, null, false));

  // Print Fields Customization Modal
  const closePrintFieldsModal = () => {
    $('printFieldsModal').hidden = true;
  };
  $('btnClosePrintFieldsModal').addEventListener('click', closePrintFieldsModal);
  $('btnCancelPrintFields').addEventListener('click', closePrintFieldsModal);
  $('printFieldsModal').addEventListener('click', (e) => {
    if (e.target === $('printFieldsModal')) closePrintFieldsModal();
  });
  $('btnPfSelectAll').addEventListener('click', () => {
    state.tempPrintFields.forEach((item) => {
      item.enabled = true;
    });
    renderPrintFieldsModalList();
  });
  $('btnPfMinimal').addEventListener('click', () => {
    state.tempPrintFields.forEach((item) => {
      item.enabled = PRINT_FIELDS_MINIMAL_SET.has(item.key);
    });
    renderPrintFieldsModalList();
  });
  $('btnPfReset').addEventListener('click', () => {
    state.tempPrintFields = getDefaultPrintFieldsConfig();
    renderPrintFieldsModalList();
  });
  $('btnApplyPrintFields').addEventListener('click', () => {
    const anyEnabled = state.tempPrintFields.some((item) => item.enabled);
    if (!anyEnabled) {
      showToast('Selecione ao menos um campo para exibir na impressão.', 'error');
      return;
    }
    state.printFieldsConfig = savePrintFieldsConfig(state.tempPrintFields);
    $('printFieldsModal').hidden = true;
    renderPrintPreview();
    showToast('Campos da impressão atualizados!', 'success');
  });

  // Modals & Inline School Name Edit
  $('headerSchoolName').addEventListener('click', openInlineSchoolEditor);
  $('headerSchoolInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitInlineSchoolName(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      commitInlineSchoolName(false);
    }
  });
  $('headerSchoolInput').addEventListener('blur', () => commitInlineSchoolName(true));

  $('btnCloseSettings').addEventListener('click', () => ($('settingsModal').hidden = true));
  $('settingsForm').addEventListener('submit', saveSettings);
  $('btnDownloadJsonBackup').addEventListener('click', downloadJsonBackup);
  $('restoreFileInput').addEventListener('change', (e) => handleRestoreBackup(e.target.files[0]));
  $('btnCloseConfirm').addEventListener('click', () => ($('confirmModal').hidden = true));
  $('btnCancelDelete').addEventListener('click', () => ($('confirmModal').hidden = true));
  $('btnConfirmDelete').addEventListener('click', confirmDeleteEmployee);

  // Unsaved Changes Modal
  const closeUnsavedModal = () => {
    $('unsavedModal').hidden = true;
    state.pendingNavAction = null;
  };
  $('btnCloseUnsaved').addEventListener('click', closeUnsavedModal);
  $('btnUnsavedStay').addEventListener('click', closeUnsavedModal);
  $('btnUnsavedDiscard').addEventListener('click', () => {
    const action = state.pendingNavAction;
    $('unsavedModal').hidden = true;
    state.pendingNavAction = null;
    clearFormDirty(true);
    if (typeof action === 'function') action();
  });
  $('btnUnsavedSaveAndGo').addEventListener('click', async () => {
    const action = state.pendingNavAction;
    $('unsavedModal').hidden = true;
    state.pendingNavAction = null;
    await handleSaveEmployee(null, { onAfterSave: action });
  });

  // Draft Recovery Modal
  const discardDraftModal = () => {
    $('draftRecoveryModal').hidden = true;
    clearDraftFromStorage();
  };
  $('btnCloseDraft').addEventListener('click', () => ($('draftRecoveryModal').hidden = true));
  $('btnDraftDiscard').addEventListener('click', discardDraftModal);
  $('btnDraftResume').addEventListener('click', () => {
    const draft = loadDraftFromStorage();
    $('draftRecoveryModal').hidden = true;
    if (!draft || !draft.snapshot) return;
    applySnapshotToForm(draft.snapshot, Boolean(draft.isNewMode), draft.editingRecordId || null);
    markFormDirty(false);
    switchTab('ficha');
    showToast('Rascunho restaurado! Revise e clique em Salvar Cadastro.');
  });

  // Duplicate Warning Modal
  const closeDuplicateModal = () => {
    $('duplicateModal').hidden = true;
    state.pendingDuplicateMatch = null;
    state.pendingDuplicateOpts = null;
  };
  $('btnCloseDuplicate').addEventListener('click', closeDuplicateModal);
  $('btnDupCancel').addEventListener('click', closeDuplicateModal);
  $('btnDupOpenExisting').addEventListener('click', () => {
    const match = state.pendingDuplicateMatch;
    closeDuplicateModal();
    if (!match) return;
    clearFormDirty(true);
    const idx = state.employees.findIndex((e) => e.id === match.id);
    if (idx >= 0) {
      state.isNewMode = false;
      state.currentIndex = idx;
      switchTab('ficha');
      loadCurrentRecordIntoForm();
    }
  });
  $('btnDupSaveAnyway').addEventListener('click', async () => {
    const opts = state.pendingDuplicateOpts || {};
    closeDuplicateModal();
    await handleSaveEmployee(null, { ...opts, forceDuplicate: true });
  });
}

// Keep sticky offset aligned with actual header height
const stickyChromeEl = $('stickyChrome');
if (stickyChromeEl && typeof ResizeObserver !== 'undefined') {
  const syncChromeHeight = () => {
    document.documentElement.style.setProperty('--chrome-h', `${stickyChromeEl.offsetHeight}px`);
  };
  new ResizeObserver(syncChromeHeight).observe(stickyChromeEl);
  syncChromeHeight();
}

// Init
applySchoolNameEverywhere(state.settings.escola_nome);
populateCargoSelect();
renderPhoneRows();
bindEvents();
onAuthStateChanged(auth, (user) => {
  if (!user) {
    clearListeners();
    state.user = null;
    state.isAdmin = false;
    state.draftChecked = false;
    state.isDirty = false;
    state.editingRecordId = null;
    state.pendingSelectId = null;
    showScreen('auth');
  } else {
    handleUserSignedIn(user);
  }
});
