// Mecanismo de Conferência de Estoque, Validades e Auditoria por Corredor
import { LOCATIONS, SETORS, CORRIDORS, formatDateBR, parseDateBRtoISO, formatNumber, triggerHaptic, playBeep, getTodayISO } from './utils.js';
import { getProductExpirations, getLatestCountsForExpiration, saveInventoryCounts, saveProductExpiration, saveSession, getActiveSession, clearActiveSession, getAllProducts, getProductById } from './db.js';
import { triggerSyncNow } from './sync.js';
import { showToast, showView, openPhotoModal } from './ui.js';
import { formatSingleProductWhatsApp, formatMultipleProductsWhatsApp, openWhatsAppExportModal } from './whatsapp.js';

let currentAuditingProduct = null;
let currentSelectedExpiration = null;
let previousCountsForSelectedDate = { countsByLocation: {}, total: 0, hasPreviousCount: false };

/**
 * Abre a interface de conferência para um produto específico
 */
export async function openConferenceForProduct(product, preselectedExpirationId = null) {
  currentAuditingProduct = product;
  currentSelectedExpiration = null;

  // Renderiza cabeçalho compacto do produto
  const headerContainer = document.getElementById('conf-product-header');
  if (headerContainer) {
    headerContainer.innerHTML = `
      <div class="product-compact-header-card">
        <div class="product-header-photo-col" id="conf-photo-trigger">
          ${
            product.image
              ? `<img src="${product.image}" alt="${product.name}" class="product-header-thumb" />`
              : `<div class="photo-placeholder-box"><span>FOTO</span></div>`
          }
        </div>
        <div class="product-header-info-col">
          <h2 class="conf-product-name">${product.name}</h2>
          <div class="detail-barcode-row">
            <span class="barcode-badge">${product.barcode}</span>
          </div>
          <div class="detail-location-row">
            <span class="loc-badge sector">${product.sector}</span>
            <span class="loc-badge corridor">${product.corridor}</span>
          </div>
        </div>
      </div>
    `;

    if (product.image) {
      document.getElementById('conf-photo-trigger')?.addEventListener('click', () => {
        openPhotoModal(product.image, product.name);
      });
    }
  }

  // Carrega validades cadastradas para este produto
  await renderExpirationSelector(product.id, preselectedExpirationId);
  showView('view-conference');
}

/**
 * Gerencia a exibição e seleção de datas de validade
 */
async function renderExpirationSelector(productId, preselectedExpirationId = null) {
  let expirations = await getProductExpirations(productId);
  const container = document.getElementById('conf-expirations-container');
  if (!container) return;

  // Se o produto não tiver nenhuma validade ainda, cria uma validade padrão (Hoje)
  if (expirations.length === 0) {
    const today = getTodayISO();
    const createdExp = await saveProductExpiration(productId, today);
    expirations = [createdExp.expiration];
  }

  let html = `
    <div class="conf-section-box">
      <div class="section-label-header">SELECIONAR VALIDADE</div>
      <div class="exp-dates-chips-grid">
  `;

  expirations.forEach((exp) => {
    const isSelected = preselectedExpirationId ? String(exp.id) === String(preselectedExpirationId) : false;
    html += `
      <button type="button" class="btn-exp-chip ${isSelected ? 'selected' : ''}" data-expid="${exp.id}" data-date="${exp.expiration_date}">
        📅 ${formatDateBR(exp.expiration_date)}
      </button>
    `;
  });

  html += `
        <button type="button" class="btn-exp-chip btn-add-new-date" id="btn-show-new-date-input">
          + Nova Validade
        </button>
      </div>

      <div class="new-date-input-row hidden" id="new-date-input-row">
        <label for="conf-custom-exp-date">Data de Validade:</label>
        <div class="date-input-group">
          <input type="date" id="conf-custom-exp-date" class="form-input" />
          <button type="button" class="btn-primary-mini" id="btn-confirm-new-date">Usar Data</button>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Eventos dos chips de data
  container.querySelectorAll('.btn-exp-chip:not(.btn-add-new-date)').forEach((chip) => {
    chip.addEventListener('click', async () => {
      container.querySelectorAll('.btn-exp-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      const expId = chip.getAttribute('data-expid');
      const expObj = expirations.find((x) => String(x.id) === String(expId));
      if (expObj) await selectExpirationForCounting(expObj);
    });
  });

  document.getElementById('btn-show-new-date-input')?.addEventListener('click', () => {
    document.getElementById('new-date-input-row')?.classList.toggle('hidden');
    document.getElementById('conf-custom-exp-date')?.focus();
  });

  document.getElementById('btn-confirm-new-date')?.addEventListener('click', async () => {
    const input = document.getElementById('conf-custom-exp-date');
    let val = input ? input.value : '';
    if (!val) {
      showToast('⚠ Selecione a data', 'warning');
      return;
    }
    const res = await saveProductExpiration(productId, val);
    await renderExpirationSelector(productId, res.expiration.id);
  });

  // Auto-seleção inicial
  let targetExp = preselectedExpirationId ? expirations.find(e => String(e.id) === String(preselectedExpirationId)) : expirations[0];
  if (targetExp) {
    const chips = container.querySelectorAll('.btn-exp-chip:not(.btn-add-new-date)');
    chips.forEach(c => {
      if (String(c.getAttribute('data-expid')) === String(targetExp.id)) c.classList.add('selected');
    });
    await selectExpirationForCounting(targetExp);
  }
}

/**
 * Carrega os dados da validade escolhida para iniciar a contagem
 */
async function selectExpirationForCounting(expiration) {
  currentSelectedExpiration = expiration;
  const countSection = document.getElementById('conf-counting-section');
  if (!countSection) return;

  countSection.classList.remove('hidden');
  const latestInfo = await getLatestCountsForExpiration(expiration.id);
  previousCountsForSelectedDate = latestInfo;

  // Alerta de contagem anterior
  const alertContainer = document.getElementById('conf-previous-count-alert');
  if (alertContainer) {
    if (latestInfo.hasPreviousCount) {
      alertContainer.innerHTML = `
        <div class="previous-count-banner">
          <div class="prev-banner-header">
            <strong>DATA JÁ CADASTRADA (${formatDateBR(expiration.expiration_date)})</strong>
          </div>
          <div class="prev-banner-body">
            <p class="prev-subtitle">ÚLTIMA CONFERÊNCIA:</p>
            <div class="prev-locs-grid">
              ${LOCATIONS.map(loc => `<span>${loc}: <strong>${latestInfo.countsByLocation[loc] || 0}</strong></span>`).join('')}
            </div>
            <div class="prev-total-row">TOTAL: <strong>${formatNumber(latestInfo.total)} UN</strong></div>
          </div>
        </div>`;
      alertContainer.classList.remove('hidden');
    } else {
      alertContainer.classList.add('hidden');
    }
  }

  renderLocationInputs(latestInfo.countsByLocation);
  updateComparisonCard();
}

/**
 * Gera os campos de input para os 8 locais
 */
function renderLocationInputs(previousValues = {}) {
  const container = document.getElementById('conf-location-inputs-grid');
  if (!container) return;

  container.innerHTML = LOCATIONS.map((loc, idx) => {
    const qty = previousValues[loc] || 0;
    return `
      <div class="location-count-card" data-loc="${loc}">
        <div class="loc-card-header">
          <span class="loc-card-title">${loc}</span>
          <span class="loc-card-prev">Anterior: ${qty}</span>
        </div>
        <div class="loc-card-controls">
          <button type="button" class="btn-step" data-idx="${idx}" data-delta="-1">-1</button>
          <input type="number" id="loc-input-${idx}" class="loc-qty-input" value="${qty}" min="0" data-idx="${idx}" inputmode="numeric" />
          <button type="button" class="btn-step" data-idx="${idx}" data-delta="1">+1</button>
          <button type="button" class="btn-step" data-idx="${idx}" data-delta="5">+5</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.loc-qty-input').forEach(input => {
    input.addEventListener('input', () => updateComparisonCard());
  });

  container.querySelectorAll('.btn-step').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = btn.getAttribute('data-idx');
      const delta = Number(btn.getAttribute('data-delta'));
      const input = document.getElementById(`loc-input-${idx}`);
      if (input) {
        input.value = Math.max(0, (Number(input.value) || 0) + delta);
        triggerHaptic(30);
        updateComparisonCard();
      }
    });
  });
}

/**
 * Atualiza o painel de comparação (Diferença entre o que tinha e o que foi contado agora)
 */
export function updateComparisonCard() {
  const comparisonContainer = document.getElementById('conf-comparison-card');
  if (!comparisonContainer || !currentSelectedExpiration) return;

  const currentCounts = {};
  let currentTotal = 0;

  LOCATIONS.forEach((loc, idx) => {
    const val = Number(document.getElementById(`loc-input-${idx}`)?.value) || 0;
    currentCounts[loc] = val;
    currentTotal += val;
  });

  const prevTotal = previousCountsForSelectedDate.total || 0;
  const diff = currentTotal - prevTotal;

  comparisonContainer.innerHTML = `
    <div class="comparison-box">
      <div class="comp-header">RESUMO DA CONFERÊNCIA</div>
      <div class="comp-footer">
        <div class="comp-footer-row"><span>ANTERIOR:</span> <strong>${formatNumber(prevTotal)}</strong></div>
        <div class="comp-footer-row highlight"><span>ATUAL:</span> <strong>${formatNumber(currentTotal)}</strong></div>
        <div class="comp-footer-row"><span>DIFERENÇA:</span> <strong class="${diff < 0 ? 'negative' : 'positive'}">${diff > 0 ? '+' : ''}${formatNumber(diff)}</strong></div>
      </div>
    </div>
  `;
}

/**
 * Finaliza e grava a conferência no Banco de Dados e Fila de Sync
 */
export async function confirmConference() {
  if (!currentAuditingProduct || !currentSelectedExpiration) {
    showToast('⚠ Erro: Produto ou validade não selecionados', 'warning');
    return;
  }

  const counts = {};
  LOCATIONS.forEach((loc, idx) => {
    counts[loc] = Number(document.getElementById(`loc-input-${idx}`)?.value) || 0;
  });

  const session = getActiveSession();

  try {
    const result = await saveInventoryCounts(
      currentAuditingProduct.id,
      currentSelectedExpiration.id,
      counts,
      session?.id
    );

    triggerHaptic(100);
    playBeep('success');
    showToast('✓ Conferência salva!', 'success');

    window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
    triggerSyncNow().catch(e => console.warn('Sync background error:', e));

    showConferenceSavedModal(currentAuditingProduct, currentSelectedExpiration, result.total);
  } catch (error) {
    console.error(error);
    showToast('⚠ Erro ao salvar', 'warning');
  }
}

/**
 * Modal de Sucesso após salvar
 */
function showConferenceSavedModal(product, expiration, total) {
  let modal = document.getElementById('modal-conference-saved');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-conference-saved';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card success-card">
      <div class="saved-check-icon">✓</div>
      <h3 class="saved-title">CONFERÊNCIA SALVA</h3>
      <p class="saved-product-name">${product.name}</p>
      <div class="saved-details-pill">
        <span>Validade: ${formatDateBR(expiration.expiration_date)}</span>
        <span>Total: <strong>${formatNumber(total)} un</strong></span>
      </div>
      <div class="modal-actions-stacked">
        <button type="button" class="btn-whatsapp-hero" id="btn-saved-export-wa">💬 WHATSAPP</button>
        <button type="button" class="btn-primary btn-hero-action" id="btn-saved-scan-next">📷 BIPAR PRÓXIMO</button>
        <button type="button" class="btn-secondary" id="btn-saved-go-dashboard">VOLTAR AO INÍCIO</button>
      </div>
    </div>`;

  modal.classList.add('open');

  document.getElementById('btn-saved-export-wa')?.addEventListener('click', () => {
    const formatted = formatSingleProductWhatsApp(product.name, product.barcode, formatDateBR(expiration.expiration_date), total);
    openWhatsAppExportModal(formatted, `Conferência ${product.name}`);
  });

  document.getElementById('btn-saved-scan-next')?.addEventListener('click', () => {
    modal.classList.remove('open');
    showView('view-scanner');
    window.dispatchEvent(new CustomEvent('start-scanner-trigger'));
  });

  document.getElementById('btn-saved-go-dashboard')?.addEventListener('click', () => {
    modal.classList.remove('open');
    showView('view-dashboard');
  });
}

/**
 * Funções de Auditoria por Corredor
 */
export async function openCorridorAuditView(sector = 'MERCEARIA', corridor = 'CORREDOR 01') {
  populateCorridorAuditFilters(sector, corridor);
  await loadCorridorAuditProducts(sector, corridor);
  showView('view-corridor-audit');
}

function populateCorridorAuditFilters(selectedSector, selectedCorridor) {
  const sSelect = document.getElementById('corridor-audit-sector-select');
  const cSelect = document.getElementById('corridor-audit-corridor-select');
  if (sSelect) sSelect.innerHTML = SETORS.map(s => `<option value="${s}" ${s === selectedSector ? 'selected' : ''}>${s}</option>`).join('');
  if (cSelect) cSelect.innerHTML = CORRIDORS.map(c => `<option value="${c}" ${c === selectedCorridor ? 'selected' : ''}>${c}</option>`).join('');
}

export async function loadCorridorAuditProducts(sector, corridor) {
  const all = await getAllProducts();
  const filtered = all.filter(p => p.sector === sector && p.corridor === corridor);
  const container = document.getElementById('corridor-audit-list');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-corridor-card"><p>Sem produtos em <strong>${sector} · ${corridor}</strong>.</p></div>`;
    return;
  }

  const today = getTodayISO();
  let auditedCount = 0;

  const listHtml = await Promise.all(filtered.map(async (prod) => {
    const exps = await getProductExpirations(prod.id);
    let stock = 0;
    let done = false;
    for (const exp of exps) {
      const info = await getLatestCountsForExpiration(exp.id);
      stock += info.total;
      if (info.lastCountDate?.startsWith(today)) done = true;
    }
    if (done) auditedCount++;
    return `
      <div class="corridor-prod-item ${done ? 'audited' : 'pending'}" data-prodid="${prod.id}">
        <div class="prod-item-status-icon">${done ? '✓' : '○'}</div>
        <div class="prod-item-details-col">
          <h4 class="prod-item-name">${prod.name}</h4>
          <span class="prod-item-stock-tag">Estoque: <strong>${formatNumber(stock)}</strong></span>
        </div>
        <button type="button" class="btn-audit-item">Conferir</button>
      </div>`;
  }));

  container.innerHTML = listHtml.join('');
  
  container.querySelectorAll('.corridor-prod-item').forEach(item => {
    item.addEventListener('click', async () => {
      const p = await getProductById(item.getAttribute('data-prodid'));
      if (p) openConferenceForProduct(p);
    });
  });

  // Salva sessão de progresso
  await saveSession({ sector, corridor, status: 'IN_PROGRESS' });
}