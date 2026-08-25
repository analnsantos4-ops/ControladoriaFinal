// Mecanismo de Conferência de Estoque, Validades e Auditoria por Corredor
import { LOCATIONS, SETORS, CORRIDORS, formatDateBR, parseDateBRtoISO, formatNumber, triggerHaptic, playBeep } from './utils.js';
import { getProductExpirations, getLatestCountsForExpiration, saveInventoryCounts, saveProductExpiration, saveSession, getActiveSession, clearActiveSession, getAllProducts, getProductById } from './db.js';
import { showToast, showView, openPhotoModal } from './ui.js';
import { formatSingleProductWhatsApp, formatMultipleProductsWhatsApp, openWhatsAppExportModal } from './whatsapp.js';

let currentAuditingProduct = null;
let currentSelectedExpiration = null;
let previousCountsForSelectedDate = { countsByLocation: {}, total: 0, hasPreviousCount: false };

// Abre a conferência para um produto
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

// Renderiza seletor de validades existentes ou nova validade
async function renderExpirationSelector(productId, preselectedExpirationId = null) {
  const expirations = await getProductExpirations(productId);
  const container = document.getElementById('conf-expirations-container');
  if (!container) return;

  let html = `
    <div class="conf-section-box">
      <div class="section-label-header">SELECIONAR VALIDADE</div>
      <div class="exp-dates-chips-grid">
  `;

  if (expirations.length > 0) {
    expirations.forEach((exp) => {
      const isSelected = preselectedExpirationId ? exp.id === preselectedExpirationId : false;
      html += `
        <button type="button" class="btn-exp-chip ${isSelected ? 'selected' : ''}" data-expid="${exp.id}" data-date="${exp.expiration_date}">
          📅 ${formatDateBR(exp.expiration_date)}
        </button>
      `;
    });
  }

  html += `
        <button type="button" class="btn-exp-chip btn-add-new-date" id="btn-show-new-date-input">
          + Nova Validade
        </button>
      </div>

      <!-- Formulário de Nova Validade -->
      <div class="new-date-input-row hidden" id="new-date-input-row">
        <label for="conf-custom-exp-date">Data de Validade (DD/MM/AAAA):</label>
        <div class="date-input-group">
          <input type="date" id="conf-custom-exp-date" class="form-input" />
          <button type="button" class="btn-primary-mini" id="btn-confirm-new-date">Usar Data</button>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // Listeners dos chips de data
  container.querySelectorAll('.btn-exp-chip:not(.btn-add-new-date)').forEach((chip) => {
    chip.addEventListener('click', async (e) => {
      container.querySelectorAll('.btn-exp-chip').forEach((c) => c.classList.remove('selected'));
      chip.classList.add('selected');
      const expId = chip.getAttribute('data-expid');
      const expObj = expirations.find((x) => x.id === expId);
      if (expObj) {
        await selectExpirationForCounting(expObj);
      }
    });
  });

  // Botão para mostrar input de nova data
  document.getElementById('btn-show-new-date-input')?.addEventListener('click', () => {
    const row = document.getElementById('new-date-input-row');
    row?.classList.toggle('hidden');
    document.getElementById('conf-custom-exp-date')?.focus();
  });

  // Confirmação de nova data
  document.getElementById('btn-confirm-new-date')?.addEventListener('click', async () => {
    const input = document.getElementById('conf-custom-exp-date');
    let val = input ? input.value : '';
    if (!val) {
      showToast('⚠ Selecione ou digite a data', 'warning');
      return;
    }

    if (val.includes('/')) {
      val = parseDateBRtoISO(val);
    }

    const res = await saveProductExpiration(productId, val);
    await renderExpirationSelector(productId, res.expiration.id);
    await selectExpirationForCounting(res.expiration, !res.isNew);
  });

  // Se houver pré-selecionada ou validades, seleciona a primeira por padrão
  if (preselectedExpirationId) {
    const target = expirations.find((e) => e.id === preselectedExpirationId);
    if (target) {
      selectExpirationForCounting(target);
    }
  } else if (expirations.length === 1) {
    const firstChip = container.querySelector('.btn-exp-chip:not(.btn-add-new-date)');
    firstChip?.classList.add('selected');
    selectExpirationForCounting(expirations[0]);
  } else {
    // Esconde contagem até selecionar data
    document.getElementById('conf-counting-section')?.classList.add('hidden');
  }
}

// Quando uma validade é selecionada
async function selectExpirationForCounting(expiration, wasAlreadyExisting = true) {
  currentSelectedExpiration = expiration;
  const countSection = document.getElementById('conf-counting-section');
  if (!countSection) return;

  countSection.classList.remove('hidden');

  // Busca última conferência para esta validade
  const latestInfo = await getLatestCountsForExpiration(expiration.id);
  previousCountsForSelectedDate = latestInfo;

  // Banner informativo de Data Já Cadastrada se houver contagem anterior
  const alertContainer = document.getElementById('conf-previous-count-alert');
  if (alertContainer) {
    if (latestInfo.hasPreviousCount) {
      alertContainer.innerHTML = `
        <div class="previous-count-banner">
          <div class="prev-banner-header">
            <span class="prev-icon">⚠</span>
            <strong>DATA JÁ CADASTRADA (${formatDateBR(expiration.expiration_date)})</strong>
          </div>
          <div class="prev-banner-body">
            <p class="prev-subtitle">ÚLTIMA CONFERÊNCIA:</p>
            <div class="prev-locs-grid">
              ${LOCATIONS.map((loc) => {
                const qty = latestInfo.countsByLocation[loc] || 0;
                return `<span>${loc}: <strong>${qty}</strong></span>`;
              }).join('')}
            </div>
            <div class="prev-total-row">
              TOTAL ANTERIOR: <strong>${formatNumber(latestInfo.total)} UNIDADES</strong>
            </div>
          </div>
        </div>
      `;
      alertContainer.classList.remove('hidden');
    } else {
      alertContainer.innerHTML = '';
      alertContainer.classList.add('hidden');
    }
  }

  // Preenche inputs dos 8 locais
  renderLocationInputs(latestInfo.countsByLocation);
  updateComparisonCard();
}

// Renderiza os 8 campos de entrada de contagem com botões rápidos (+1, +5, +10, -1, ZERAR)
function renderLocationInputs(previousValues = {}) {
  const container = document.getElementById('conf-location-inputs-grid');
  if (!container) return;

  container.innerHTML = LOCATIONS.map((loc, idx) => {
    // Mantém valor anterior como base inicial se desejado ou inicia em 0
    const prevQty = previousValues[loc] || 0;
    return `
      <div class="location-count-card" data-loc="${loc}">
        <div class="loc-card-header">
          <span class="loc-card-title">${loc}</span>
          <span class="loc-card-prev">Anterior: ${prevQty}</span>
        </div>
        <div class="loc-card-controls">
          <button type="button" class="btn-step btn-step-minus" data-idx="${idx}" data-delta="-1">-1</button>
          <input type="number" id="loc-input-${idx}" class="loc-qty-input" value="${prevQty}" min="0" data-idx="${idx}" inputmode="numeric" />
          <button type="button" class="btn-step btn-step-plus" data-idx="${idx}" data-delta="1">+1</button>
          <button type="button" class="btn-step btn-step-plus-5" data-idx="${idx}" data-delta="5">+5</button>
          <button type="button" class="btn-step btn-step-plus-10" data-idx="${idx}" data-delta="10">+10</button>
        </div>
      </div>
    `;
  }).join('');

  // Listeners de eventos nos controles
  container.querySelectorAll('.loc-qty-input').forEach((input) => {
    input.addEventListener('input', () => {
      if (Number(input.value) < 0) input.value = 0;
      updateComparisonCard();
    });
  });

  container.querySelectorAll('.btn-step').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = btn.getAttribute('data-idx');
      const delta = Number(btn.getAttribute('data-delta'));
      const input = document.getElementById(`loc-input-${idx}`);
      if (input) {
        let current = Number(input.value) || 0;
        current = Math.max(0, current + delta);
        input.value = current;
        triggerHaptic(30);
        updateComparisonCard();
      }
    });
  });
}

// Atualiza a tabela ao vivo de COMPARAÇÃO
export function updateComparisonCard() {
  const comparisonContainer = document.getElementById('conf-comparison-card');
  if (!comparisonContainer || !currentSelectedExpiration) return;

  const currentCounts = {};
  let currentTotal = 0;

  LOCATIONS.forEach((loc, idx) => {
    const input = document.getElementById(`loc-input-${idx}`);
    const q = input ? Number(input.value) || 0 : 0;
    currentCounts[loc] = q;
    currentTotal += q;
  });

  const prevTotal = previousCountsForSelectedDate.total || 0;
  const totalDiff = currentTotal - prevTotal;

  // Monta lista de locais que possuem valor anterior ou atual
  const activeLocations = LOCATIONS.filter((loc) => {
    const prev = previousCountsForSelectedDate.countsByLocation[loc] || 0;
    const curr = currentCounts[loc] || 0;
    return prev > 0 || curr > 0;
  });

  let locsHtml = '';
  if (activeLocations.length === 0) {
    locsHtml = `<div class="comparison-empty">Nenhuma quantidade informada ainda.</div>`;
  } else {
    locsHtml = activeLocations
      .map((loc) => {
        const prev = previousCountsForSelectedDate.countsByLocation[loc] || 0;
        const curr = currentCounts[loc] || 0;
        const diff = curr - prev;
        let diffBadge = `<span class="diff-badge neutral">0</span>`;
        if (diff > 0) {
          diffBadge = `<span class="diff-badge positive">+${diff}</span>`;
        } else if (diff < 0) {
          diffBadge = `<span class="diff-badge negative">${diff}</span>`;
        }

        return `
        <div class="comp-row">
          <span class="comp-loc-name">${loc}</span>
          <span class="comp-val">Ant: ${prev}</span>
          <span class="comp-val">Atual: <strong>${curr}</strong></span>
          <span class="comp-diff">${diffBadge}</span>
        </div>
      `;
      })
      .join('');
  }

  let totalDiffFormatted = `<span class="total-diff-tag neutral">0</span>`;
  if (totalDiff > 0) {
    totalDiffFormatted = `<span class="total-diff-tag positive">+${totalDiff}</span>`;
  } else if (totalDiff < 0) {
    totalDiffFormatted = `<span class="total-diff-tag negative">${totalDiff}</span>`;
  }

  comparisonContainer.innerHTML = `
    <div class="comparison-box">
      <div class="comp-header">
        <span>COMPARAÇÃO</span>
        <span class="comp-date-tag">📅 ${formatDateBR(currentSelectedExpiration.expiration_date)}</span>
      </div>
      <div class="comp-list">
        ${locsHtml}
      </div>
      <div class="comp-footer">
        <div class="comp-footer-row">
          <span>TOTAL ANTERIOR:</span>
          <strong>${formatNumber(prevTotal)}</strong>
        </div>
        <div class="comp-footer-row highlight">
          <span>TOTAL ATUAL:</span>
          <strong>${formatNumber(currentTotal)}</strong>
        </div>
        <div class="comp-footer-row">
          <span>DIFERENÇA:</span>
          <strong>${totalDiffFormatted}</strong>
        </div>
      </div>
    </div>
  `;
}

// Confirma e salva a conferência
export async function confirmConference() {
  if (!currentAuditingProduct || !currentSelectedExpiration) {
    showToast('⚠ Selecione a data de validade', 'warning');
    return;
  }

  const currentCounts = {};
  LOCATIONS.forEach((loc, idx) => {
    const input = document.getElementById(`loc-input-${idx}`);
    currentCounts[loc] = input ? Number(input.value) || 0 : 0;
  });

  const activeSession = getActiveSession();
  const sessionId = activeSession ? activeSession.id : null;

  try {
    const result = await saveInventoryCounts(
      currentAuditingProduct.id,
      currentSelectedExpiration.id,
      currentCounts,
      sessionId
    );

    triggerHaptic(100);
    playBeep('success');
    showToast('✓ Conferência salva com sucesso!', 'success');

    // Abre Modal de Sucesso com o fluxo contínuo "BIPAR PRÓXIMO"
    showConferenceSavedModal(currentAuditingProduct, currentSelectedExpiration, result.total);
  } catch (error) {
    console.error('Erro ao salvar conferência:', error);
    showToast('⚠ Erro ao salvar conferência', 'warning');
  }
}

// Modal de Conferência Salva com ação rápida "BIPAR PRÓXIMO" e "EXPORTAR WHATSAPP"
function showConferenceSavedModal(product, expiration, total) {
  let modal = document.getElementById('modal-conference-saved');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-conference-saved';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const dateBR = formatDateBR(expiration.expiration_date);

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card success-card">
      <div class="saved-check-icon">✓</div>
      <h3 class="saved-title">CONFERÊNCIA SALVA</h3>
      <p class="saved-product-name">${product.name}</p>
      <div class="saved-details-pill">
        <span>Validade: ${dateBR}</span>
        <span>Total: <strong>${formatNumber(total)} un</strong></span>
      </div>

      <div class="modal-actions-stacked">
        <button type="button" class="btn-whatsapp-hero" id="btn-saved-export-wa">
          💬 ENVIAR NO WHATSAPP
        </button>
        <button type="button" class="btn-primary btn-hero-action" id="btn-saved-scan-next">
          📷 BIPAR PRÓXIMO
        </button>
        <button type="button" class="btn-secondary" id="btn-saved-go-dashboard">
          IR PARA O INÍCIO
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  document.getElementById('btn-saved-export-wa')?.addEventListener('click', () => {
    const formatted = formatSingleProductWhatsApp(product.name, product.barcode, dateBR, total);
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
    window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
  });
}

// Exporta todos os produtos do corredor atual para o WhatsApp
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

// ----------------------------------------------------
// CONFERÊNCIA POR CORREDOR (AUDITORIA EM LOTE)
// ----------------------------------------------------

export async function openCorridorAuditView(sector = 'MERCEARIA', corridor = 'CORREDOR 03') {
  populateCorridorAuditFilters(sector, corridor);
  await loadCorridorAuditProducts(sector, corridor);
  showView('view-corridor-audit');
}

function populateCorridorAuditFilters(selectedSector, selectedCorridor) {
  const sectorSelect = document.getElementById('corridor-audit-sector-select');
  const corridorSelect = document.getElementById('corridor-audit-corridor-select');

  if (sectorSelect) {
    sectorSelect.innerHTML = SETORS.map((s) => `<option value="${s}" ${s === selectedSector ? 'selected' : ''}>${s}</option>`).join('');
  }

  if (corridorSelect) {
    corridorSelect.innerHTML = CORRIDORS.map((c) => `<option value="${c}" ${c === selectedCorridor ? 'selected' : ''}>${c}</option>`).join('');
  }
}

export async function loadCorridorAuditProducts(sector, corridor) {
  const all = await getAllProducts();
  const filtered = all.filter((p) => p.sector === sector && p.corridor === corridor);

  const container = document.getElementById('corridor-audit-list');
  const progressContainer = document.getElementById('corridor-audit-progress-box');
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-corridor-card">
        <p>Nenhum produto cadastrado para <strong>${sector} · ${corridor}</strong>.</p>
        <button type="button" class="btn-primary-mini" id="btn-empty-add-prod">Cadastrar Produto Neste Corredor</button>
      </div>
    `;
    if (progressContainer) progressContainer.innerHTML = '';
    document.getElementById('btn-empty-add-prod')?.addEventListener('click', () => {
      showView('view-product-new');
    });
    return;
  }

  // Verifica status de cada produto (conferido hoje ou pendente)
  const todayISO = new Date().toISOString().split('T')[0];
  let auditedCount = 0;
  const productsWithStatus = [];

  for (const prod of filtered) {
    const exps = await getProductExpirations(prod.id);
    let totalStock = 0;
    let auditedToday = false;

    for (const exp of exps) {
      const latest = await getLatestCountsForExpiration(exp.id);
      totalStock += latest.total;
      if (latest.lastCountDate && latest.lastCountDate.startsWith(todayISO)) {
        auditedToday = true;
      }
    }

    if (auditedToday) auditedCount++;
    productsWithStatus.push({
      product: prod,
      totalStock,
      auditedToday
    });
  }

  // Salva sessão ativa
  await saveSession({
    sector,
    corridor,
    location_type: 'PRATELEIRA',
    status: 'IN_PROGRESS'
  });

  // Renderiza barra de progresso
  const totalProds = filtered.length;
  const pendingCount = totalProds - auditedCount;
  const percent = Math.round((auditedCount / totalProds) * 100);

  if (progressContainer) {
    progressContainer.innerHTML = `
      <div class="corridor-progress-card">
        <div class="corridor-progress-numbers">
          <span class="prog-counter">${auditedCount} / ${totalProds}</span>
          <span class="prog-tags">
            <span class="tag-done">✓ ${auditedCount} conferidos</span>
            <span class="tag-pending">○ ${pendingCount} pendentes</span>
          </span>
        </div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width: ${percent}%"></div>
        </div>
      </div>
    `;
  }

  // Renderiza lista de produtos
  container.innerHTML = productsWithStatus
    .map(({ product, totalStock, auditedToday }) => {
      return `
      <div class="corridor-prod-item ${auditedToday ? 'audited' : 'pending'}" data-prodid="${product.id}">
        <div class="prod-item-status-icon">
          ${auditedToday ? '✓' : '○'}
        </div>
        <div class="prod-item-thumb-col">
          ${
            product.image
              ? `<img src="${product.image}" alt="" class="compact-prod-thumb" />`
              : `<div class="photo-placeholder-mini">FOTO</div>`
          }
        </div>
        <div class="prod-item-details-col">
          <h4 class="prod-item-name">${product.name}</h4>
          <span class="prod-item-barcode">${product.barcode}</span>
          <span class="prod-item-stock-tag">Última contagem: <strong>${formatNumber(totalStock)} un</strong></span>
        </div>
        <div class="prod-item-action-col">
          <button type="button" class="btn-audit-item">Conferir</button>
        </div>
      </div>
    `;
    })
    .join('');

  // Listeners para tocar e abrir conferência imediatamente
  container.querySelectorAll('.corridor-prod-item').forEach((item) => {
    item.addEventListener('click', async () => {
      const prodId = item.getAttribute('data-prodid');
      const prod = await getProductById(prodId);
      if (prod) {
        openConferenceForProduct(prod);
      }
    });
  });
}
