// Mecanismo de Conferência de Estoque, Validades e Auditoria por Corredor
import { LOCATIONS, SETORS, CORRIDORS, formatDateBR, parseDateBRtoISO, formatNumber, triggerHaptic, playBeep, getTodayISO } from './utils.js';
import { getProductExpirations, getLatestCountsForExpiration, saveInventoryCounts, saveProductExpiration, saveSession, getActiveSession, clearActiveSession, getAllProducts, getProductById, saveBlitzItem } from './db.js';
import { triggerSyncNow } from './sync.js';
import { showToast, showView, openPhotoModal } from './ui.js';
import { formatSingleProductWhatsApp, formatMultipleProductsWhatsApp, openWhatsAppExportModal } from './whatsapp.js';

let currentAuditingProduct = null;
let currentSelectedExpiration = null;
let previousCountsForSelectedDate = { countsByLocation: {}, total: 0, hasPreviousCount: false };
let currentBlitzConferenceContext = null;

export function setBlitzConferenceContext(ctx) {
  currentBlitzConferenceContext = ctx;
}

export function getBlitzConferenceContext() {
  return currentBlitzConferenceContext;
}

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

  let targetExp = null;

  if (preselectedExpirationId) {
    targetExp = expirations.find(
      (e) => String(e.id) === String(preselectedExpirationId) || e.expiration_date === preselectedExpirationId
    );

    // Se a validade procurada ainda não estiver no banco (ex: data informada na Blitz), cria como candidato em memória SEM salvar no DB
    if (!targetExp && typeof preselectedExpirationId === 'string' && preselectedExpirationId.includes('-')) {
      targetExp = {
        id: 'temp_' + preselectedExpirationId,
        product_id: productId,
        expiration_date: preselectedExpirationId,
        is_temporary: true
      };
      expirations.push(targetExp);
    }
  }

  // Se o produto não tiver nenhuma validade cadastrada ainda, oferece uma data candidata em memória
  if (expirations.length === 0) {
    const today = getTodayISO();
    targetExp = {
      id: 'temp_' + today,
      product_id: productId,
      expiration_date: today,
      is_temporary: true
    };
    expirations = [targetExp];
  }

  if (!targetExp && expirations.length > 0) {
    targetExp = expirations[0];
  }

  let html = `
    <div class="conf-section-box">
      <div class="section-label-header">SELECIONAR VALIDADE</div>
      <div class="exp-dates-chips-grid">
  `;

  expirations.forEach((exp) => {
    const isSelected = targetExp && (String(exp.id) === String(targetExp.id) || exp.expiration_date === targetExp.expiration_date);
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
      const expObj = expirations.find((x) => String(x.id) === String(expId) || x.expiration_date === expId);
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
    // Adiciona como candidata em memória sem gravar no banco de dados imediatamente
    await renderExpirationSelector(productId, val);
  });

  // Auto-seleção inicial estrita
  if (targetExp) {
    await selectExpirationForCounting(targetExp);
  }
}

const LOCATION_SHORT_NAMES = {
  'DEPÓSITO': 'Depósito',
  'GELADEIRA': 'Geladeira',
  'PRATELEIRA': 'Prateleira',
  'PONTA DE GÔNDOLA': 'P. Gôndola',
  'ORELHA': 'Orelha',
  'ILHA': 'Ilha',
  'CARRINHO': 'Carrinho',
  'FRENTE DE LOJA': 'Frente Loja'
};

/**
 * Carrega os dados da validade escolhida para iniciar a contagem
 */
async function selectExpirationForCounting(expiration) {
  currentSelectedExpiration = expiration;
  const countSection = document.getElementById('conf-counting-section');
  if (!countSection) return;

  countSection.classList.remove('hidden');

  const isTemporary = expiration.is_temporary || String(expiration.id).startsWith('temp_');
  let latestInfo = { countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false };

  if (!isTemporary) {
    latestInfo = await getLatestCountsForExpiration(expiration.id);
  }
  previousCountsForSelectedDate = latestInfo;

  // Alerta de contagem anterior e triagem
  const alertContainer = document.getElementById('conf-previous-count-alert');
  if (alertContainer) {
    const isTriaged = !isTemporary && (expiration.is_triaged === true || expiration.is_triaged === 1 || expiration.is_triaged === 'true');
    let triageWarningHtml = '';
    if (isTriaged) {
      triageWarningHtml = `
        <div style="background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.5); border-radius: 6px; padding: 6px 10px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <span style="font-size: 0.74rem; font-weight: 800; color: #eab308;">📦 VALIDADE RETIRADA PARA TRIAGEM</span>
          <button type="button" id="btn-conf-restore-triage" style="background: #eab308; color: #000; border: none; font-size: 0.7rem; font-weight: 800; padding: 3px 8px; border-radius: 4px; cursor: pointer;">↩️ Restaurar</button>
        </div>
      `;
    }

    if (latestInfo.hasPreviousCount || isTriaged) {
      alertContainer.innerHTML = `
        ${triageWarningHtml}
        ${
          latestInfo.hasPreviousCount
            ? `<div class="previous-count-banner">
                <div class="prev-banner-header">
                  <span>📅 <strong>DATA JÁ CADASTRADA (${formatDateBR(expiration.expiration_date)})</strong></span>
                  <span class="prev-banner-total-badge">TOTAL: <strong>${formatNumber(latestInfo.total)} UN</strong></span>
                </div>
                <div class="prev-banner-body">
                  <div class="prev-locs-compact-grid">
                    ${LOCATIONS.map(loc => `
                      <div class="prev-loc-chip">
                        <span class="loc-lbl">${LOCATION_SHORT_NAMES[loc] || loc}:</span>
                        <strong class="loc-val">${latestInfo.countsByLocation[loc] || 0}</strong>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>`
            : ''
        }`;
      alertContainer.classList.remove('hidden');

      document.getElementById('btn-conf-restore-triage')?.addEventListener('click', async () => {
        await toggleExpirationTriaged(expiration.id, false);
        expiration.is_triaged = false;
        showToast('✓ Validade restaurada ao estoque ativo!', 'success', 2000);
        selectExpirationForCounting(expiration);
      });
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
    const shortName = LOCATION_SHORT_NAMES[loc] || loc;
    return `
      <div class="location-count-card" data-loc="${loc}">
        <div class="loc-card-header">
          <span class="loc-card-title" title="${loc}">${shortName}</span>
          <span class="loc-card-prev">Ant: <strong>${qty}</strong></span>
        </div>
        <div class="loc-card-controls">
          <button type="button" class="btn-step btn-step-minus" data-idx="${idx}" data-delta="-1" aria-label="Diminuir 1">-1</button>
          <input type="number" id="loc-input-${idx}" class="loc-qty-input" value="${qty}" min="0" data-idx="${idx}" inputmode="numeric" onfocus="this.select()" />
          <button type="button" class="btn-step btn-step-plus" data-idx="${idx}" data-delta="1" aria-label="Aumentar 1">+1</button>
          <button type="button" class="btn-step btn-step-plus-five" data-idx="${idx}" data-delta="5" aria-label="Aumentar 5">+5</button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.loc-qty-input').forEach(input => {
    input.addEventListener('input', () => updateComparisonCard());
    input.addEventListener('focus', function() { this.select(); });
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
    <div class="comp-summary-strip">
      <div class="comp-summary-item">
        <span class="comp-summary-lbl">ANTERIOR</span>
        <span class="comp-summary-val">${formatNumber(prevTotal)} <small>un</small></span>
      </div>
      <div class="comp-summary-item current-highlight">
        <span class="comp-summary-lbl">ATUAL</span>
        <span class="comp-summary-val">${formatNumber(currentTotal)} <small>un</small></span>
      </div>
      <div class="comp-summary-item ${diff < 0 ? 'diff-neg' : diff > 0 ? 'diff-pos' : ''}">
        <span class="comp-summary-lbl">DIFERENÇA</span>
        <span class="comp-summary-val">${diff > 0 ? '+' : ''}${formatNumber(diff)} <small>un</small></span>
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
  let totalCount = 0;
  LOCATIONS.forEach((loc, idx) => {
    const val = Number(document.getElementById(`loc-input-${idx}`)?.value) || 0;
    counts[loc] = val;
    totalCount += val;
  });

  const isTemporary = currentSelectedExpiration.is_temporary || String(currentSelectedExpiration.id).startsWith('temp_');

  // Se for uma nova data (não gravada ainda) e a contagem estiver zerada, não grava data fantasma
  if (isTemporary && totalCount === 0) {
    showToast('⚠ Digite a quantidade contada nos locais para registrar esta nova validade.', 'warning', 3500);
    return;
  }

  try {
    // Se a validade era apenas uma candidata temporária em memória, grava no banco agora que há quantidade confirmada
    if (isTemporary) {
      const expRes = await saveProductExpiration(currentAuditingProduct.id, currentSelectedExpiration.expiration_date);
      if (expRes && expRes.expiration) {
        currentSelectedExpiration = expRes.expiration;
      }
    }

    const session = getActiveSession();

    const result = await saveInventoryCounts(
      currentAuditingProduct.id,
      currentSelectedExpiration.id,
      counts,
      session?.id
    );

    // Se houver contexto de Blitz ativo, registra o item da Blitz como TEM
    if (currentBlitzConferenceContext) {
      try {
        await saveBlitzItem({
          blitz_session_id: currentBlitzConferenceContext.sessionId,
          product_id: currentAuditingProduct.id,
          barcode: currentAuditingProduct.barcode,
          requested_expiration_date: currentBlitzConferenceContext.requestedDate || currentSelectedExpiration.expiration_date,
          result: 'TEM',
          conference_id: result.countRecord?.id || null,
          total_quantity: result.total
        });
      } catch (errBlitz) {
        console.warn('Erro ao associar contagem com a Blitz:', errBlitz);
      }
    }

    triggerHaptic(100);
    playBeep('success');
    showToast('✓ Conferência salva!', 'success');

    window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
    triggerSyncNow().catch(e => console.warn('Sync background error:', e));

    showConferenceSavedModal(currentAuditingProduct, currentSelectedExpiration, result.total, currentBlitzConferenceContext);
    currentBlitzConferenceContext = null;
  } catch (error) {
    console.error(error);
    showToast('⚠ Erro ao salvar', 'warning');
  }
}

/**
 * Modal de Sucesso após salvar
 */
function showConferenceSavedModal(product, expiration, total, blitzContext = null) {
  let modal = document.getElementById('modal-conference-saved');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-conference-saved';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const isBlitz = Boolean(blitzContext);

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card success-card">
      <div class="saved-check-icon">✓</div>
      <h3 class="saved-title">${isBlitz ? 'CONFERÊNCIA DA BLITZ SALVA' : 'CONFERÊNCIA SALVA'}</h3>
      <p class="saved-product-name">${product.name}</p>
      <div class="saved-details-pill">
        <span>Validade: ${formatDateBR(expiration.expiration_date)}</span>
        <span>Total: <strong>${formatNumber(total)} un</strong></span>
      </div>
      <div class="modal-actions-stacked">
        <button type="button" class="btn-whatsapp-hero" id="btn-saved-export-wa">💬 WHATSAPP</button>
        <button type="button" class="btn-primary btn-hero-action" id="btn-saved-scan-next">
          ${isBlitz ? '📷 BIPAR PRÓXIMO NA BLITZ' : '📷 BIPAR PRÓXIMO'}
        </button>
        <button type="button" class="btn-secondary" id="btn-saved-go-dashboard">
          ${isBlitz ? '📊 PAINEL DA BLITZ' : 'VOLTAR AO INÍCIO'}
        </button>
      </div>
    </div>`;

  modal.classList.add('open');

  document.getElementById('btn-saved-export-wa')?.addEventListener('click', () => {
    const formatted = formatSingleProductWhatsApp(product.name, product.barcode, formatDateBR(expiration.expiration_date), total, product.corridor, product.sector);
    openWhatsAppExportModal(formatted, `Conferência ${product.name}`);
  });

  document.getElementById('btn-saved-scan-next')?.addEventListener('click', () => {
    modal.classList.remove('open');
    showView('view-scanner');
    window.dispatchEvent(new CustomEvent('start-scanner-trigger'));
  });

  document.getElementById('btn-saved-go-dashboard')?.addEventListener('click', () => {
    modal.classList.remove('open');
    if (isBlitz) {
      window.dispatchEvent(new CustomEvent('open-blitz-dashboard-trigger'));
    } else {
      showView('view-dashboard');
    }
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
    let activeStock = 0;
    let triagedStock = 0;
    let done = false;
    for (const exp of exps) {
      const info = await getLatestCountsForExpiration(exp.id);
      const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';
      if (isTriaged) {
        triagedStock += info.total;
      } else {
        activeStock += info.total;
      }
      if (info.lastCountDate?.startsWith(today)) done = true;
    }
    if (exps.length === 0 && Number(prod.total_quantity) > 0) {
      activeStock = Number(prod.total_quantity);
    }
    if (done) auditedCount++;

    let stockDisplay = '';
    if (activeStock === 0 && triagedStock > 0) {
      stockDisplay = `<span class="prod-item-stock-tag" style="color: #eab308; background: rgba(234, 179, 8, 0.15); border-color: rgba(234, 179, 8, 0.3);">📦 Em Triagem (${formatNumber(triagedStock)} un)</span>`;
    } else {
      stockDisplay = `<span class="prod-item-stock-tag">Estoque: <strong>${formatNumber(activeStock)} un</strong></span>`;
    }

    return `
      <div class="corridor-prod-item ${done ? 'audited' : 'pending'}" data-prodid="${prod.id}">
        <div class="prod-item-status-icon">${done ? '✓' : '○'}</div>
        <div class="prod-item-details-col">
          <h4 class="prod-item-name">${prod.name}</h4>
          ${stockDisplay}
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

/**
 * Exporta todos os produtos do corredor atual para o WhatsApp
 */
export async function exportCurrentCorridorWhatsApp(sector, corridor) {
  const all = await getAllProducts();
  const filtered = all.filter((p) => p.sector === sector && p.corridor === corridor);

  if (filtered.length === 0) {
    showToast('Nenhum produto neste corredor para exportar.', 'warning');
    return;
  }

  showToast('Gerando relatório do WhatsApp...', 'sync', 1000);

  const exportItems = [];

  for (const prod of filtered) {
    const exps = await getProductExpirations(prod.id);
    if (exps.length === 0) {
      exportItems.push({
        name: prod.name,
        barcode: prod.barcode,
        expirationDateBR: 'NÃO INFORMADA',
        quantity: 0
      });
    } else {
      for (const exp of exps) {
        const latest = await getLatestCountsForExpiration(exp.id);
        exportItems.push({
          name: prod.name,
          barcode: prod.barcode,
          expirationDateBR: formatDateBR(exp.expiration_date),
          quantity: latest.total
        });
      }
    }
  }

  const text = formatMultipleProductsWhatsApp(exportItems, `${sector} — ${corridor}`);
  openWhatsAppExportModal(text, `Corredor: ${corridor}`);
}
