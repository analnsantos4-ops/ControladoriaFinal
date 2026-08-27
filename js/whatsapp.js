// Módulo de Integração, Importação e Exportação do WhatsApp
// Controladoria - Ana Luiza
import { SETORS, CORRIDORS, LOCATIONS, formatDateBR, parseDateBRtoISO, formatNumber, compressImage, getTodayISO } from './utils.js';
import { getProductByBarcode, saveProduct, saveProductExpiration, saveInventoryCounts, getProductExpirations, getLatestCountsForExpiration } from './db.js';
import { showToast, showView } from './ui.js';
import { openConferenceForProduct } from './inventory.js';
import { triggerSyncNow } from './sync.js';

// ----------------------------------------------------
// 1. GERADORES DE TEXTO FORMATADO (PADRÃO WHATSAPP)
// ----------------------------------------------------

/**
 * Formata um produto no padrão estrito solicitado:
 * ➡️ *CANJICA BRANCA ANCHIETA 500G*
 * 》*Código de barras:* 7896505600189
 * 》*Data de validade:* 02/09/2026
 * 》*Quantidade:* 1.344 unidades
 */
export function formatSingleProductWhatsApp(productName, barcode, expirationDateBR, quantity) {
  const cleanName = (productName || '').trim().toUpperCase();
  const cleanBarcode = (barcode || '').trim();
  const cleanDate = (expirationDateBR || '').trim();
  const formattedQty = formatNumber(quantity || 0);

  return [
    `➡️ *${cleanName}*`,
    `》*Código de barras:* ${cleanBarcode}`,
    `》*Data de validade:* ${cleanDate}`,
    `》*Quantidade:* ${formattedQty} unidades`
  ].join('\n');
}

/**
 * Formata múltiplos produtos para envio em lote
 */
export function formatMultipleProductsWhatsApp(items, headerTitle = '') {
  const parts = [];
  if (headerTitle) {
    parts.push(`📋 *CONTROLADORIA — ANA LUIZA*`);
    parts.push(`📅 *${headerTitle}*`);
    parts.push(`--------------------------------`);
  }

  items.forEach((item, idx) => {
    const dateBR = item.expirationDateBR || (item.expirationDate ? formatDateBR(item.expirationDate) : 'N/A');
    parts.push(formatSingleProductWhatsApp(item.name, item.barcode, dateBR, item.quantity));
    if (idx < items.length - 1) {
      parts.push(''); // Linha em branco entre produtos
    }
  });

  return parts.join('\n');
}

// ----------------------------------------------------
// 2. PARSER INTELIGENTE DE TEXTO DO WHATSAPP
// Suporta Formato 1 (múltiplas datas com emojis) e Formato 2 (data única)
// ----------------------------------------------------

/**
 * Converte data curta (ex: "26/08" ou "04/10") ou longa ("02/09/2026") para ISO YYYY-MM-DD
 */
function resolveDateStringToISO(rawDateStr) {
  if (!rawDateStr) return '';
  const clean = rawDateStr.replace(/[^0-9\/\-.]/g, '').trim();

  // Caso 1: Formato DD/MM/YYYY ou DD/MM/YY
  if (clean.match(/^[0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4}$/)) {
    return parseDateBRtoISO(clean);
  }

  // Caso 2: Formato DD/MM (ex: 26/08 ou 04/10)
  const shortMatch = clean.match(/^([0-9]{1,2})[\/\-.]([0-9]{1,2})$/);
  if (shortMatch) {
    const day = parseInt(shortMatch[1], 10);
    const month = parseInt(shortMatch[2], 10);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    // Se o mês for muito anterior ao mês atual, provavelmente é para o próximo ano
    let year = currentYear;
    if (month < currentMonth - 2) {
      year = currentYear + 1;
    }

    const dStr = String(day).padStart(2, '0');
    const mStr = String(month).padStart(2, '0');
    return `${year}-${mStr}-${dStr}`;
  }

  return '';
}

/**
 * Lê e sanitiza números com separador de milhar brasileiro (ex: 1.200 -> 1200, 1.344 -> 1344)
 */
function parseQuantityString(str) {
  if (!str) return 0;
  // Remove pontos de milhar e substitui vírgula por ponto
  const clean = str.toString().replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : Math.round(parsed);
}

/**
 * Lê um texto colado do WhatsApp (com 1 ou vários produtos) e extrai os campos estruturados
 */
export function parseWhatsAppText(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const text = rawText.trim();
  if (!text) return [];

  // Divide o texto em blocos baseando-se no marcador "➡️" ou quebras duplas
  const rawBlocks = [];
  if (text.includes('➡️')) {
    const splitByArrow = text.split(/➡️/g);
    splitByArrow.forEach((chunk) => {
      const trimmed = chunk.trim();
      if (trimmed.length > 5) {
        rawBlocks.push(trimmed);
      }
    });
  } else {
    // Tenta dividir por blocos separados por linhas vazias
    const splitByDoubleLine = text.split(/\n\s*\n+/g);
    splitByDoubleLine.forEach((chunk) => {
      const trimmed = chunk.trim();
      if (trimmed.length > 5) {
        rawBlocks.push(trimmed);
      }
    });
  }

  // Se não dividiu em múltiplos, usa o texto inteiro como 1 bloco
  if (rawBlocks.length === 0 && text.length > 5) {
    rawBlocks.push(text);
  }

  const parsedItems = [];

  rawBlocks.forEach((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    let name = '';
    let barcode = '';
    const expirations = [];
    let singleDateFound = '';
    let singleQtyFound = 0;

    // 1. Tenta extrair o Nome da primeira linha ou de "➡️ *NOME*"
    const firstLine = lines[0];
    const nameMatch = firstLine.match(/^[➡️\s*]*(.*?)(?:\*|$)/);
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1].replace(/[*_~`]/g, '').trim();
    } else {
      name = firstLine.replace(/[*_~`]/g, '').trim();
    }

    // 2. Itera nas linhas do bloco procurando Código de Barras, Datas e Quantidades
    lines.forEach((line) => {
      // Remove caracteres especiais de marcação
      const cleanLine = line.replace(/[*_~`]/g, '').trim();

      // Código de barras
      const barcodeMatch = cleanLine.match(/(?:c[óo]digo(?:\s+de\s+barras)?|ean|barras?|cod)\s*[:*》>\-\s]+([0-9]{6,14})/i);
      if (barcodeMatch) {
        barcode = barcodeMatch[1].trim();
        return;
      } else {
        const genericBarcodeMatch = cleanLine.match(/\b([0-9]{7,14})\b/);
        if (genericBarcodeMatch && !barcode && !cleanLine.match(/(?:validade|vencimento|unidades?)/i)) {
          barcode = genericBarcodeMatch[1].trim();
        }
      }

      // FORMATO 1: Linhas de data com quantidade
      // Ex: "🔴 26/08: 3 unidades", "🟡 04/10: 1.200 unidades", "🟢 15/10: 600 unidades", "02/09/2026 - 1.344 un"
      const multiDateMatch = cleanLine.match(/(?:[🔴🟡🟢🟠⚪\-\s>》]*)\b([0-9]{1,2}[\/\-.][0-9]{1,2}(?:[\/\-.][0-9]{2,4})?)\b\s*[:=\-\s]+\s*([0-9.,]+)\s*(?:unidades?|unids?|un|cx|pct)?/i);
      if (multiDateMatch) {
        const rawDate = multiDateMatch[1].trim();
        const isoDate = resolveDateStringToISO(rawDate);
        const qty = parseQuantityString(multiDateMatch[2]);
        if (isoDate) {
          expirations.push({
            id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            rawDate,
            isoDate,
            quantity: qty
          });
          return;
        }
      }

      // FORMATO 2: Data de validade em linha própria
      // Ex: "》Data de validade: 02/09/2026"
      const singleDateMatch = cleanLine.match(/(?:validade|vencimento|venc|data)\s*[:*》>\-\s]+([0-9]{1,2}[\/\-.][0-9]{1,2}(?:[\/\-.][0-9]{2,4})?)/i);
      if (singleDateMatch) {
        singleDateFound = singleDateMatch[1].trim();
        return;
      }

      // FORMATO 2: Quantidade em linha própria
      // Ex: "》Quantidade: 1.344 unidades"
      const singleQtyMatch = cleanLine.match(/(?:quantidade|qtd|qtde|estoque|total)\s*[:*》>\-\s]+([0-9.,]+)/i);
      if (singleQtyMatch) {
        singleQtyFound = parseQuantityString(singleQtyMatch[1]);
        return;
      }
    });

    // Se encontramos uma data e quantidade únicas pelo Formato 2 e nenhuma lista de múltiplas datas:
    if (expirations.length === 0) {
      if (singleDateFound || singleQtyFound > 0) {
        const iso = resolveDateStringToISO(singleDateFound) || getTodayISO();
        expirations.push({
          id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          rawDate: singleDateFound || formatDateBR(iso),
          isoDate: iso,
          quantity: singleQtyFound || 0
        });
      } else {
        // Data padrão de hoje com 0 unidades caso não informou datas
        expirations.push({
          id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          rawDate: formatDateBR(getTodayISO()),
          isoDate: getTodayISO(),
          quantity: 0
        });
      }
    }

    // Se encontrou ao menos o código de barras ou um nome válido
    if (barcode || name) {
      const totalUnits = expirations.reduce((acc, curr) => acc + (Number(curr.quantity) || 0), 0);

      parsedItems.push({
        id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: name.toUpperCase() || 'PRODUTO IMPORTADO',
        barcode: barcode || '',
        sector: 'MERCEARIA',
        corridor: 'CORREDOR 01',
        image: '',
        expirations,
        totalQuantity: totalUnits,
        isExisting: false,
        existingProduct: null
      });
    }
  });

  return parsedItems;
}

// ----------------------------------------------------
// 3. MODAL DE IMPORTAÇÃO E PRÉVIA DO WHATSAPP
// ----------------------------------------------------

let currentParsedItems = [];

export function openWhatsAppImportModal() {
  let modal = document.getElementById('modal-whatsapp-import');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-whatsapp-import';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="wa-import-backdrop"></div>
    <div class="modal-card modal-card-large">
      <div class="modal-header-accent">
        <div class="modal-title-with-icon">
          <span class="modal-header-icon">💬</span>
          <div>
            <h3 class="modal-title">IMPORTAR DO WHATSAPP</h3>
            <p class="modal-subtitle">Cole mensagens com 1 ou várias datas de validade</p>
          </div>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-wa-import" aria-label="Fechar">✕</button>
      </div>

      <!-- Passo 1: Área de Colagem do Texto -->
      <div id="wa-step-input" class="wa-step-container">
        <div class="wa-paste-instructions">
          <p><strong>Formatos aceitos (único produto ou vários em lote):</strong></p>
          <div class="wa-format-example-box">
            ➡️ *REFRIGERANTE COCA-COLA PET 2L*<br>
            》Código de barras: 7894900027013<br>
            》Datas de validade:<br>
            🔴 26/08: 3 unidades<br>
            🟡 04/10: 1.200 unidades<br>
            🟢 15/10: 600 unidades
          </div>
        </div>

        <div class="form-group">
          <label for="wa-raw-textarea"><strong>Cole o texto aqui:</strong></label>
          <textarea
            id="wa-raw-textarea"
            class="form-textarea"
            rows="6"
            placeholder="Cole aqui a mensagem do WhatsApp..."
          ></textarea>
        </div>

        <div class="modal-actions-grid">
          <button type="button" class="btn-secondary" id="btn-paste-clipboard">
            📋 Colar da Área de Transferência
          </button>
          <button type="button" class="btn-primary" id="btn-process-wa-text">
            ⚡ PROCESSAR E VER PRÉVIA
          </button>
        </div>
      </div>

      <!-- Passo 2: Prévia Completa e Confirmação antes de salvar -->
      <div id="wa-step-preview" class="wa-step-container hidden">
        <div class="wa-preview-header">
          <div class="wa-preview-title-col">
            <span id="wa-parsed-count-badge" class="badge-count">0 produtos</span>
            <span class="badge-total-loja">🏷️ TOTAL LOJA</span>
          </div>
          <button type="button" class="btn-link-mini" id="btn-wa-back-to-input">← Editar Texto</button>
        </div>

        <!-- Opções Globais de Setor e Corredor (Obrigatórios) -->
        <div class="wa-global-defaults-box">
          <span class="defaults-title">📍 Aplicar Setor e Corredor a todos:</span>
          <div class="defaults-row">
            <select id="wa-global-sector" class="form-select form-select-sm">
              ${SETORS.map((s) => `<option value="${s}">${s}</option>`).join('')}
            </select>
            <select id="wa-global-corridor" class="form-select form-select-sm">
              ${CORRIDORS.map((c) => `<option value="${c}">${c}</option>`).join('')}
            </select>
            <button type="button" id="btn-wa-apply-defaults" class="btn-secondary-mini">Aplicar</button>
          </div>
        </div>

        <!-- Lista de Produtos e Datas Identificadas -->
        <div id="wa-parsed-items-list" class="wa-parsed-items-list"></div>

        <div class="modal-actions-bottom-sticky">
          <button type="button" class="btn-primary btn-hero-action" id="btn-wa-save-all">
            ✓ CONFIRMAR E SALVAR NO SISTEMA
          </button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('open');

  // Fechar
  document.getElementById('btn-close-wa-import')?.addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('wa-import-backdrop')?.addEventListener('click', () => modal.classList.remove('open'));

  // Colar da área de transferência
  document.getElementById('btn-paste-clipboard')?.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          document.getElementById('wa-raw-textarea').value = text;
          showToast('✓ Texto colado!', 'success', 1200);
        } else {
          showToast('Área de transferência vazia', 'warning');
        }
      } else {
        showToast('Toque e segure na caixa para colar', 'info');
      }
    } catch (e) {
      showToast('Toque e segure na caixa para colar', 'info');
    }
  });

  // Processar texto e abrir prévia
  document.getElementById('btn-process-wa-text')?.addEventListener('click', async () => {
    const raw = document.getElementById('wa-raw-textarea')?.value || '';
    if (!raw.trim()) {
      showToast('⚠ Cole o texto do WhatsApp primeiro', 'warning');
      return;
    }

    const items = parseWhatsAppText(raw);
    if (items.length === 0) {
      showToast('⚠ Nenhum produto identificado. Verifique o formato do texto.', 'warning');
      return;
    }

    showToast('Identificando produtos e validades...', 'info', 1000);

    // Verifica existência no banco local
    for (const item of items) {
      if (item.barcode) {
        const existing = await getProductByBarcode(item.barcode);
        if (existing) {
          item.isExisting = true;
          item.existingProduct = existing;
          item.name = existing.name || item.name;
          item.sector = existing.sector || item.sector;
          item.corridor = existing.corridor || item.corridor;
          item.image = existing.image || item.image;
        }
      }
    }

    currentParsedItems = items;
    renderParsedItemsList(currentParsedItems);
    document.getElementById('wa-step-input').classList.add('hidden');
    document.getElementById('wa-step-preview').classList.remove('hidden');
  });

  // Voltar para a caixa de texto
  document.getElementById('btn-wa-back-to-input')?.addEventListener('click', () => {
    document.getElementById('wa-step-preview').classList.add('hidden');
    document.getElementById('wa-step-input').classList.remove('hidden');
  });

  // Aplicar defaults globais
  document.getElementById('btn-wa-apply-defaults')?.addEventListener('click', () => {
    const sec = document.getElementById('wa-global-sector')?.value;
    const cor = document.getElementById('wa-global-corridor')?.value;
    currentParsedItems.forEach((item) => {
      item.sector = sec;
      item.corridor = cor;
    });
    renderParsedItemsList(currentParsedItems);
    showToast('✓ Setor e Corredor aplicados a todos!', 'success', 1200);
  });

  // Salvar tudo
  document.getElementById('btn-wa-save-all')?.addEventListener('click', async () => {
    await saveAllParsedItems(currentParsedItems);
  });
}

/**
 * Renderiza a lista de produtos parseados na tela de prévia
 */
function renderParsedItemsList(items) {
  const listContainer = document.getElementById('wa-parsed-items-list');
  const countBadge = document.getElementById('wa-parsed-count-badge');

  if (countBadge) {
    countBadge.textContent = `${items.length} ${items.length === 1 ? 'produto identificado' : 'produtos identificados'}`;
  }

  if (!listContainer) return;

  if (items.length === 0) {
    listContainer.innerHTML = `<div class="empty-exp-state">Nenhum produto restante.</div>`;
    return;
  }

  listContainer.innerHTML = items
    .map((item, pIdx) => {
      // Calcula total de unidades deste produto
      const totalUnits = (item.expirations || []).reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
      item.totalQuantity = totalUnits;

      return `
      <div class="wa-item-card ${item.isExisting ? 'existing-item' : 'new-item'}" id="wa-card-${pIdx}">
        <!-- Cabeçalho do Card -->
        <div class="wa-item-header">
          <div class="wa-header-badges">
            <span class="badge-total-loja">🏷️ TOTAL LOJA</span>
            ${item.isExisting ? '<span class="status-badge-green">✓ JÁ CADASTRADO</span>' : '<span class="status-badge-blue">✨ NOVO PRODUTO</span>'}
          </div>
          <button type="button" class="btn-remove-wa-item" data-pidx="${pIdx}" title="Remover Produto" aria-label="Remover">✕</button>
        </div>

        <!-- Seção de Foto e Dados Principais -->
        <div class="wa-item-top-section">
          <!-- Foto com Miniatura e Botões de Câmera / Galeria -->
          <div class="wa-photo-box">
            <div class="wa-photo-thumb" id="wa-photo-thumb-${pIdx}">
              ${item.image ? `<img src="${item.image}" alt="" class="wa-thumb-img" />` : `<div class="photo-placeholder-mini">SEM FOTO</div>`}
            </div>
            <div class="wa-photo-buttons">
              <button type="button" class="btn-wa-photo-cam" data-pidx="${pIdx}">📷 Câmera</button>
              <button type="button" class="btn-wa-photo-gal" data-pidx="${pIdx}">🖼️ Galeria</button>
              <input type="file" id="wa-cam-file-${pIdx}" accept="image/*" capture="environment" class="hidden" />
              <input type="file" id="wa-gal-file-${pIdx}" accept="image/*" class="hidden" />
            </div>
          </div>

          <!-- Campos: Nome e Código de Barras -->
          <div class="wa-main-fields">
            <div class="form-group-mini">
              <label>NOME DO PRODUTO:</label>
              <input type="text" class="form-input form-input-sm wa-name-input" data-pidx="${pIdx}" value="${item.name}" />
            </div>
            <div class="form-group-mini">
              <label>CÓDIGO DE BARRAS:</label>
              <input type="text" class="form-input form-input-sm wa-barcode-input" data-pidx="${pIdx}" value="${item.barcode}" placeholder="789..." />
            </div>
          </div>
        </div>

        <!-- Setor e Corredor (Obrigatórios) -->
        <div class="wa-loc-fields-row">
          <div class="form-group-mini">
            <label>SETOR OBRIGATÓRIO:</label>
            <select class="form-select form-select-sm wa-sector-input" data-pidx="${pIdx}">
              ${SETORS.map((s) => `<option value="${s}" ${s === item.sector ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="form-group-mini">
            <label>CORREDOR OBRIGATÓRIO:</label>
            <select class="form-select form-select-sm wa-corridor-input" data-pidx="${pIdx}">
              ${CORRIDORS.map((c) => `<option value="${c}" ${c === item.corridor ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Lista de Datas de Validade e Quantidades -->
        <div class="wa-expirations-section">
          <div class="wa-exp-header">
            <span>📅 DATAS DE VALIDADE IDENTIFICADAS (${(item.expirations || []).length}):</span>
            <button type="button" class="btn-add-date-mini" data-pidx="${pIdx}">+ Adicionar Data</button>
          </div>

          <div class="wa-exp-list">
            ${(item.expirations || [])
              .map((exp, eIdx) => {
                return `
                <div class="wa-exp-row" data-pidx="${pIdx}" data-eidx="${eIdx}">
                  <div class="wa-exp-date-col">
                    <label>Validade:</label>
                    <input type="date" class="form-input form-input-sm wa-exp-date-input" data-pidx="${pIdx}" data-eidx="${eIdx}" value="${exp.isoDate}" />
                  </div>
                  <div class="wa-exp-qty-col">
                    <label>Quantidade:</label>
                    <div class="qty-input-wrap">
                      <input type="number" class="form-input form-input-sm wa-exp-qty-input" data-pidx="${pIdx}" data-eidx="${eIdx}" value="${exp.quantity}" min="0" />
                      <span class="qty-unit-label">un</span>
                    </div>
                  </div>
                  <button type="button" class="btn-remove-exp-row" data-pidx="${pIdx}" data-eidx="${eIdx}" title="Remover data">✕</button>
                </div>
              `;
              })
              .join('')}
          </div>

          <!-- Total de Unidades do Produto -->
          <div class="wa-prod-total-banner">
            <span>🔢 TOTAL DESTE PRODUTO:</span>
            <strong id="wa-prod-total-val-${pIdx}">${formatNumber(totalUnits)} unidades</strong>
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  attachPreviewEventListeners();
}

/**
 * Conecta todos os listeners interativos nos inputs da tela de prévia
 */
function attachPreviewEventListeners() {
  const listContainer = document.getElementById('wa-parsed-items-list');
  if (!listContainer) return;

  // 1. Edição de Nome
  listContainer.querySelectorAll('.wa-name-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-pidx'), 10);
      if (currentParsedItems[pIdx]) currentParsedItems[pIdx].name = e.target.value;
    });
  });

  // 2. Edição de Código de Barras
  listContainer.querySelectorAll('.wa-barcode-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-pidx'), 10);
      if (currentParsedItems[pIdx]) currentParsedItems[pIdx].barcode = e.target.value.trim();
    });
  });

  // 3. Setor e Corredor
  listContainer.querySelectorAll('.wa-sector-input').forEach((select) => {
    select.addEventListener('change', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-pidx'), 10);
      if (currentParsedItems[pIdx]) currentParsedItems[pIdx].sector = e.target.value;
    });
  });

  listContainer.querySelectorAll('.wa-corridor-input').forEach((select) => {
    select.addEventListener('change', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-pidx'), 10);
      if (currentParsedItems[pIdx]) currentParsedItems[pIdx].corridor = e.target.value;
    });
  });

  // 4. Edição de Datas
  listContainer.querySelectorAll('.wa-exp-date-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-pidx'), 10);
      const eIdx = parseInt(e.target.getAttribute('data-eidx'), 10);
      if (currentParsedItems[pIdx] && currentParsedItems[pIdx].expirations[eIdx]) {
        currentParsedItems[pIdx].expirations[eIdx].isoDate = e.target.value;
        currentParsedItems[pIdx].expirations[eIdx].rawDate = formatDateBR(e.target.value);
      }
    });
  });

  // 5. Edição de Quantidades
  listContainer.querySelectorAll('.wa-exp-qty-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const pIdx = parseInt(e.target.getAttribute('data-pidx'), 10);
      const eIdx = parseInt(e.target.getAttribute('data-eidx'), 10);
      if (currentParsedItems[pIdx] && currentParsedItems[pIdx].expirations[eIdx]) {
        currentParsedItems[pIdx].expirations[eIdx].quantity = Number(e.target.value) || 0;
        const totalUnits = currentParsedItems[pIdx].expirations.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        currentParsedItems[pIdx].totalQuantity = totalUnits;
        const totalDisplay = document.getElementById(`wa-prod-total-val-${pIdx}`);
        if (totalDisplay) totalDisplay.textContent = `${formatNumber(totalUnits)} unidades`;
      }
    });
  });

  // 6. Adicionar nova data ao produto
  listContainer.querySelectorAll('.btn-add-date-mini').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-pidx'), 10);
      if (currentParsedItems[pIdx]) {
        currentParsedItems[pIdx].expirations.push({
          id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          rawDate: formatDateBR(getTodayISO()),
          isoDate: getTodayISO(),
          quantity: 0
        });
        renderParsedItemsList(currentParsedItems);
      }
    });
  });

  // 7. Remover uma data individual
  listContainer.querySelectorAll('.btn-remove-exp-row').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-pidx'), 10);
      const eIdx = parseInt(e.currentTarget.getAttribute('data-eidx'), 10);
      if (currentParsedItems[pIdx] && currentParsedItems[pIdx].expirations) {
        currentParsedItems[pIdx].expirations.splice(eIdx, 1);
        if (currentParsedItems[pIdx].expirations.length === 0) {
          currentParsedItems[pIdx].expirations.push({
            id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            rawDate: formatDateBR(getTodayISO()),
            isoDate: getTodayISO(),
            quantity: 0
          });
        }
        renderParsedItemsList(currentParsedItems);
      }
    });
  });

  // 8. Remover produto inteiro
  listContainer.querySelectorAll('.btn-remove-wa-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const pIdx = parseInt(e.currentTarget.getAttribute('data-pidx'), 10);
      currentParsedItems.splice(pIdx, 1);
      renderParsedItemsList(currentParsedItems);
      if (currentParsedItems.length === 0) {
        document.getElementById('wa-step-preview').classList.add('hidden');
        document.getElementById('wa-step-input').classList.remove('hidden');
      }
    });
  });

  // 9. Câmera e Galeria para Foto
  listContainer.querySelectorAll('.btn-wa-photo-cam').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const pIdx = e.currentTarget.getAttribute('data-pidx');
      document.getElementById(`wa-cam-file-${pIdx}`)?.click();
    });
  });

  listContainer.querySelectorAll('.btn-wa-photo-gal').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const pIdx = e.currentTarget.getAttribute('data-pidx');
      document.getElementById(`wa-gal-file-${pIdx}`)?.click();
    });
  });

  const handlePhotoFile = async (pIdx, file) => {
    if (!file) return;
    try {
      showToast('Otimizando foto do produto...', 'sync', 1200);
      const compressed = await compressImage(file, 600, 600, 0.72);
      if (currentParsedItems[pIdx]) {
        currentParsedItems[pIdx].image = compressed;
        const thumb = document.getElementById(`wa-photo-thumb-${pIdx}`);
        if (thumb) thumb.innerHTML = `<img src="${compressed}" alt="" class="wa-thumb-img" />`;
        showToast('✓ Foto adicionada com sucesso!', 'success', 1200);
      }
    } catch (err) {
      showToast('Falha ao processar foto', 'warning');
    }
  };

  listContainer.querySelectorAll('input[type="file"]').forEach((fileInput) => {
    fileInput.addEventListener('change', async (e) => {
      const isCam = e.target.id.startsWith('wa-cam-file-');
      const pIdx = parseInt(e.target.id.replace(isCam ? 'wa-cam-file-' : 'wa-gal-file-', ''), 10);
      if (e.target.files && e.target.files[0]) {
        await handlePhotoFile(pIdx, e.target.files[0]);
      }
    });
  });
}

/**
 * Salva todos os produtos e todas as suas datas no banco IndexedDB
 */
async function saveAllParsedItems(items) {
  if (items.length === 0) return;

  // Validação preliminar: todos devem ter código de barras e nome
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.barcode || !it.barcode.trim()) {
      showToast(`⚠ O produto "${it.name || 'Sem nome'}" precisa de um código de barras.`, 'warning', 3000);
      return;
    }
  }

  showToast(`Salvando ${items.length} produtos no TOTAL LOJA...`, 'sync', 3000);

  let successCount = 0;
  let errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const finalName = (item.name || '').trim().toUpperCase();
      const finalBarcode = (item.barcode || '').trim();
      const finalSector = item.sector || 'MERCEARIA';
      const finalCorridor = item.corridor || 'CORREDOR 01';

      // 1. Salva ou atualiza produto
      let product = item.existingProduct;
      if (!product) {
        product = await saveProduct({
          barcode: finalBarcode,
          name: finalName,
          image: item.image || '',
          sector: finalSector,
          corridor: finalCorridor
        });
      } else {
        product.name = finalName;
        product.sector = finalSector;
        product.corridor = finalCorridor;
        if (item.image) product.image = item.image;
        await saveProduct(product);
      }

      // 2. Salva cada validade e suas quantidades
      const exps = item.expirations || [];
      for (const expItem of exps) {
        let expDate = expItem.isoDate || getTodayISO();
        if (expDate.includes('/')) {
          expDate = parseDateBRtoISO(expDate);
        }

        const { expiration } = await saveProductExpiration(product.id, expDate);
        const qty = Number(expItem.quantity) || 0;

        // Salva a contagem como PRATELEIRA (ou padrão de loja)
        const counts = { 'PRATELEIRA': qty };
        await saveInventoryCounts(product.id, expiration.id, counts);
      }

      successCount++;
    } catch (err) {
      console.error('Erro ao salvar item importado:', err);
      errors.push(`${item.name || 'Produto'}: ${err.message || 'Erro'}`);
    }
  }

  const modal = document.getElementById('modal-whatsapp-import');
  if (modal) modal.classList.remove('open');

  if (errors.length === 0) {
    showToast(`🎉 ${successCount} produtos salvos com sucesso no TOTAL LOJA!`, 'success', 3500);
  } else {
    showToast(`✓ ${successCount} salvos, ${errors.length} falhas`, 'warning', 4000);
  }

  // Dispara sincronização em segundo plano com o Supabase
  triggerSyncNow().catch((e) => console.warn('Sync error:', e));

  // Notifica o app para atualizar telas e dashboard
  window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
}

// ----------------------------------------------------
// 4. MODAL DE EXPORTAÇÃO E COMPARTILHAMENTO
// ----------------------------------------------------

/**
 * Abre modal com o texto gerado pronto para copiar ou enviar no WhatsApp
 */
export function openWhatsAppExportModal(formattedText, title = 'Exportar para WhatsApp') {
  let modal = document.getElementById('modal-whatsapp-export');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-whatsapp-export';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="wa-export-backdrop"></div>
    <div class="modal-card">
      <div class="modal-header-accent">
        <div class="modal-title-with-icon">
          <span class="modal-header-icon">📲</span>
          <div>
            <h3 class="modal-title">${title}</h3>
            <p class="modal-subtitle">Texto formatado pronto para envio</p>
          </div>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-wa-export">✕</button>
      </div>

      <div class="wa-export-content-box">
        <textarea id="wa-export-text-area" class="form-textarea wa-export-textarea" rows="8" readonly>${formattedText}</textarea>
      </div>

      <div class="modal-actions-stacked">
        <button type="button" class="btn-whatsapp-hero" id="btn-send-whatsapp-direct">
          💬 ABRIR NO WHATSAPP
        </button>
        <button type="button" class="btn-primary" id="btn-copy-wa-clipboard">
          📋 COPIAR TEXTO
        </button>
        <button type="button" class="btn-secondary" id="btn-cancel-wa-export">
          FECHAR
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  document.getElementById('btn-close-wa-export')?.addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('wa-export-backdrop')?.addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('btn-cancel-wa-export')?.addEventListener('click', () => modal.classList.remove('open'));

  // Copiar
  document.getElementById('btn-copy-wa-clipboard')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(formattedText);
      showToast('✓ Texto copiado com sucesso!', 'success', 2000);
    } catch (e) {
      const textarea = document.getElementById('wa-export-text-area');
      if (textarea) {
        textarea.select();
        document.execCommand('copy');
        showToast('✓ Texto copiado!', 'success', 2000);
      }
    }
  });

  // Abrir no WhatsApp
  document.getElementById('btn-send-whatsapp-direct')?.addEventListener('click', () => {
    const encoded = encodeURIComponent(formattedText);
    const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(waUrl, '_blank');
  });
}
