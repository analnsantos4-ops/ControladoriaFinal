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
// 2. PARSER INTELIGENTE DE TEXTO DO WHATSAPP (LOTE OU ÚNICO)
// ----------------------------------------------------

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
    let rawDate = '';
    let quantity = 0;

    // 1. Tenta extrair o Nome da primeira linha ou de "➡️ *NOME*"
    const firstLine = lines[0];
    const nameMatch = firstLine.match(/^[➡️\s*]*(.*?)(?:\*|$)/);
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1].replace(/[*_~`]/g, '').trim();
    } else {
      name = firstLine.replace(/[*_~`]/g, '').trim();
    }

    // 2. Itera nas outras linhas para extrair Código, Validade e Quantidade com Regex tolerante
    lines.forEach((line) => {
      // Código de barras
      const barcodeMatch = line.match(/(?:c[óo]digo(?:\s+de\s+barras)?|ean|barras?|cod)\s*[:*》>\-\s]+([0-9]{6,14})/i);
      if (barcodeMatch) {
        barcode = barcodeMatch[1].trim();
      } else {
        // Busca direta de sequência de 7 a 14 dígitos
        const genericBarcodeMatch = line.match(/\b([0-9]{7,14})\b/);
        if (genericBarcodeMatch && !barcode) {
          barcode = genericBarcodeMatch[1].trim();
        }
      }

      // Data de validade
      const dateMatch = line.match(/(?:validade|vencimento|venc|data)\s*[:*》>\-\s]+([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i);
      if (dateMatch) {
        rawDate = dateMatch[1].trim();
      } else {
        const genericDateMatch = line.match(/\b([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})\b/);
        if (genericDateMatch && !rawDate) {
          rawDate = genericDateMatch[1].trim();
        }
      }

      // Quantidade
      const qtyMatch = line.match(/(?:quantidade|qtd|qtde|estoque|unidades?|total)\s*[:*》>\-\s]+([0-9.,]+)/i);
      if (qtyMatch) {
        // Trata separador de milhar brasileiro (ex: 1.344 -> 1344)
        const cleanQtyStr = qtyMatch[1].replace(/\./g, '').replace(/,/g, '.');
        const parsedQ = parseFloat(cleanQtyStr);
        if (!isNaN(parsedQ)) quantity = Math.round(parsedQ);
      }
    });

    // Se encontrou ao menos o código de barras ou um nome válido
    if (barcode || name) {
      // Normaliza data para ISO se válida
      let isoDate = '';
      if (rawDate) {
        isoDate = parseDateBRtoISO(rawDate);
      }

      parsedItems.push({
        id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: name.toUpperCase() || 'PRODUTO SEM NOME',
        barcode: barcode || '',
        rawDate: rawDate || '',
        isoDate: isoDate || '',
        quantity: quantity || 0,
        sector: 'MERCEARIA',
        corridor: 'CORREDOR 01',
        image: '',
        isExisting: false,
        existingProduct: null
      });
    }
  });

  return parsedItems;
}

// ----------------------------------------------------
// 3. MODAL DE IMPORTAÇÃO EM LOTE DO WHATSAPP
// ----------------------------------------------------

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
            <p class="modal-subtitle">Cole uma ou várias mensagens de produtos</p>
          </div>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-wa-import">✕</button>
      </div>

      <!-- Passo 1: Área de Colagem do Texto -->
      <div id="wa-step-input" class="wa-step-container">
        <div class="wa-paste-instructions">
          <p>Exemplo de formato aceito (único ou vários):</p>
          <div class="wa-format-example-box">
            ➡️ *CANJICA BRANCA ANCHIETA 500G*<br>
            》*Código de barras:* 7896505600189<br>
            》*Data de validade:* 02/09/2026<br>
            》*Quantidade:* 1.344 unidades
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
            ⚡ PROCESSAR PRODUTOS
          </button>
        </div>
      </div>

      <!-- Passo 2: Pré-visualização e Edição Rápida (Setor, Corredor e Foto) -->
      <div id="wa-step-preview" class="wa-step-container hidden">
        <div class="wa-preview-header">
          <span id="wa-parsed-count-badge" class="badge-count">0 produtos identificados</span>
          <button type="button" class="btn-link-mini" id="btn-wa-back-to-input">← Editar Texto</button>
        </div>

        <!-- Opções Globais para Aplicar a Todos -->
        <div class="wa-global-defaults-box">
          <span class="defaults-title">📍 Aplicar a todos que não tiverem local:</span>
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

        <!-- Lista de Produtos Parseados -->
        <div id="wa-parsed-items-list" class="wa-parsed-items-list"></div>

        <div class="modal-actions-bottom-sticky">
          <button type="button" class="btn-primary btn-hero-action" id="btn-wa-save-all">
            ✓ SALVAR TODOS NO SISTEMA
          </button>
        </div>
      </div>
    </div>
  `;

  modal.classList.add('open');

  // Event Listeners
  document.getElementById('btn-close-wa-import')?.addEventListener('click', () => modal.classList.remove('open'));
  document.getElementById('wa-import-backdrop')?.addEventListener('click', () => modal.classList.remove('open'));

  // Colar direto da área de transferência
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
        showToast('Toque e segure no campo para colar', 'info');
      }
    } catch (e) {
      showToast('Toque e segure no campo para colar', 'info');
    }
  });

  // Processar texto
  document.getElementById('btn-process-wa-text')?.addEventListener('click', async () => {
    const raw = document.getElementById('wa-raw-textarea')?.value || '';
    if (!raw.trim()) {
      showToast('⚠ Cole o texto do WhatsApp primeiro', 'warning');
      return;
    }

    const items = parseWhatsAppText(raw);
    if (items.length === 0) {
      showToast('⚠ Nenhum produto identificado. Verifique o formato.', 'warning');
      return;
    }

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

    renderParsedItemsList(items);
    document.getElementById('wa-step-input').classList.add('hidden');
    document.getElementById('wa-step-preview').classList.remove('hidden');
  });

  // Voltar para o input
  document.getElementById('btn-wa-back-to-input')?.addEventListener('click', () => {
    document.getElementById('wa-step-preview').classList.add('hidden');
    document.getElementById('wa-step-input').classList.remove('hidden');
  });
}

/**
 * Renderiza a lista de itens parseados para edição e salvamento
 */
let currentParsedItems = [];

function renderParsedItemsList(items) {
  currentParsedItems = items;
  const listContainer = document.getElementById('wa-parsed-items-list');
  const countBadge = document.getElementById('wa-parsed-count-badge');

  if (countBadge) {
    countBadge.textContent = `${items.length} ${items.length === 1 ? 'produto identificado' : 'produtos identificados'}`;
  }

  if (!listContainer) return;

  listContainer.innerHTML = items
    .map((item, idx) => {
      const dateDisplay = item.rawDate || (item.isoDate ? formatDateBR(item.isoDate) : 'Não informada');
      return `
      <div class="wa-item-card ${item.isExisting ? 'existing-item' : 'new-item'}" id="wa-card-${idx}">
        <div class="wa-item-header">
          <div class="wa-item-badge-status">
            ${item.isExisting ? '<span class="status-badge-green">✓ JÁ CADASTRADO</span>' : '<span class="status-badge-blue">✨ NOVO PRODUTO</span>'}
          </div>
          <button type="button" class="btn-remove-wa-item" data-idx="${idx}" title="Remover">✕</button>
        </div>

        <div class="wa-item-grid-details">
          <!-- Nome e Código -->
          <div class="wa-field-col full">
            <label>NOME DO PRODUTO:</label>
            <input type="text" class="form-input form-input-sm wa-name-input" data-idx="${idx}" value="${item.name}" />
          </div>

          <div class="wa-field-col">
            <label>CÓDIGO DE BARRAS:</label>
            <input type="text" class="form-input form-input-sm wa-barcode-input" data-idx="${idx}" value="${item.barcode}" ${item.isExisting ? 'readonly' : ''} />
          </div>

          <div class="wa-field-col">
            <label>VALIDADE:</label>
            <input type="date" class="form-input form-input-sm wa-date-input" data-idx="${idx}" value="${item.isoDate}" />
          </div>

          <div class="wa-field-col">
            <label>QUANTIDADE TOTAL:</label>
            <input type="number" class="form-input form-input-sm wa-qty-input" data-idx="${idx}" value="${item.quantity}" min="0" />
          </div>

          <div class="wa-field-col">
            <label>LOCAL PADRÃO:</label>
            <select class="form-select form-select-sm wa-loc-type-input" data-idx="${idx}">
              <option value="PRATELEIRA">PRATELEIRA</option>
              <option value="DEPÓSITO">DEPÓSITO</option>
              <option value="GELADEIRA">GELADEIRA</option>
              <option value="ILHA">ILHA</option>
              <option value="PONTA DE GÔNDOLA">PONTA DE GÔNDOLA</option>
              <option value="ORELHA">ORELHA</option>
              <option value="CARRINHO">CARRINHO</option>
              <option value="FRENTE DE LOJA">FRENTE DE LOJA</option>
            </select>
          </div>

          <!-- Setor e Corredor (solicitados) -->
          <div class="wa-field-col">
            <label>SETOR:</label>
            <select class="form-select form-select-sm wa-sector-input" data-idx="${idx}">
              ${SETORS.map((s) => `<option value="${s}" ${s === item.sector ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>

          <div class="wa-field-col">
            <label>CORREDOR:</label>
            <select class="form-select form-select-sm wa-corridor-input" data-idx="${idx}">
              ${CORRIDORS.map((c) => `<option value="${c}" ${c === item.corridor ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>

          <!-- Foto Opcional -->
          <div class="wa-field-col full wa-photo-row">
            <label>FOTO (OPCIONAL):</label>
            <div class="wa-photo-controls">
              <div class="wa-photo-preview-thumb" id="wa-photo-thumb-${idx}">
                ${item.image ? `<img src="${item.image}" alt="" />` : `<span>SEM FOTO</span>`}
              </div>
              <button type="button" class="btn-secondary-mini btn-wa-photo" data-idx="${idx}">📷 Adicionar Foto</button>
              <input type="file" id="wa-file-${idx}" accept="image/*" class="hidden" />
            </div>
          </div>
        </div>
      </div>
    `;
    })
    .join('');

  // Event Listeners nos inputs
  listContainer.querySelectorAll('.wa-name-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      if (currentParsedItems[idx]) currentParsedItems[idx].name = e.target.value;
    });
  });

  listContainer.querySelectorAll('.wa-barcode-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      if (currentParsedItems[idx]) currentParsedItems[idx].barcode = e.target.value;
    });
  });

  listContainer.querySelectorAll('.wa-date-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      if (currentParsedItems[idx]) currentParsedItems[idx].isoDate = e.target.value;
    });
  });

  listContainer.querySelectorAll('.wa-qty-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      if (currentParsedItems[idx]) currentParsedItems[idx].quantity = Number(e.target.value) || 0;
    });
  });

  listContainer.querySelectorAll('.wa-sector-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      if (currentParsedItems[idx]) currentParsedItems[idx].sector = e.target.value;
    });
  });

  listContainer.querySelectorAll('.wa-corridor-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = e.target.getAttribute('data-idx');
      if (currentParsedItems[idx]) currentParsedItems[idx].corridor = e.target.value;
    });
  });

  // Fotos
  listContainer.querySelectorAll('.btn-wa-photo').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = e.currentTarget.getAttribute('data-idx');
      document.getElementById(`wa-file-${idx}`)?.click();
    });
  });

  listContainer.querySelectorAll('input[type="file"]').forEach((fileInput) => {
    fileInput.addEventListener('change', async (e) => {
      const idx = e.target.id.replace('wa-file-', '');
      if (e.target.files && e.target.files[0]) {
        try {
          showToast('Processando foto...', 'sync', 800);
          const compressed = await compressImage(e.target.files[0], 600, 600, 0.72);
          if (currentParsedItems[idx]) currentParsedItems[idx].image = compressed;
          const thumb = document.getElementById(`wa-photo-thumb-${idx}`);
          if (thumb) thumb.innerHTML = `<img src="${compressed}" alt="" />`;
          showToast('✓ Foto pronta', 'success', 1000);
        } catch (err) {
          showToast('Falha na foto', 'warning');
        }
      }
    });
  });

  // Remover item individual da lista de importação
  listContainer.querySelectorAll('.btn-remove-wa-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
      currentParsedItems.splice(idx, 1);
      renderParsedItemsList(currentParsedItems);
      if (currentParsedItems.length === 0) {
        document.getElementById('wa-step-preview').classList.add('hidden');
        document.getElementById('wa-step-input').classList.remove('hidden');
      }
    });
  });

  // Aplicar defaults globais
  document.getElementById('btn-wa-apply-defaults')?.addEventListener('click', () => {
    const sec = document.getElementById('wa-global-sector')?.value;
    const cor = document.getElementById('wa-global-corridor')?.value;
    currentParsedItems.forEach((item) => {
      if (!item.isExisting) {
        item.sector = sec;
        item.corridor = cor;
      }
    });
    renderParsedItemsList(currentParsedItems);
    showToast('✓ Setor e Corredor aplicados!', 'success', 1200);
  });

  // Salvar todos
  document.getElementById('btn-wa-save-all')?.addEventListener('click', async () => {
    await saveAllParsedItems(currentParsedItems);
  });
}

/**
 * Salva todos os produtos importados no banco IndexedDB
 */
async function saveAllParsedItems(items) {
  if (items.length === 0) return;

  showToast(`Salvando ${items.length} produtos...`, 'sync', 2500);

  let successCount = 0;
  let errors = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      // Lê valores mais atuais dos inputs da tela (caso o usuário tenha editado diretamente)
      const nameInput = document.querySelector(`.wa-name-input[data-idx="${i}"]`);
      const barcodeInput = document.querySelector(`.wa-barcode-input[data-idx="${i}"]`);
      const dateInput = document.querySelector(`.wa-date-input[data-idx="${i}"]`);
      const qtyInput = document.querySelector(`.wa-qty-input[data-idx="${i}"]`);
      const locSelect = document.querySelector(`.wa-loc-type-input[data-idx="${i}"]`);
      const secSelect = document.querySelector(`.wa-sector-input[data-idx="${i}"]`);
      const corSelect = document.querySelector(`.wa-corridor-input[data-idx="${i}"]`);

      const finalName = (nameInput ? nameInput.value : (item.name || '')).trim().toUpperCase();
      const finalBarcode = (barcodeInput ? barcodeInput.value : (item.barcode || '')).trim();
      let finalDate = dateInput ? dateInput.value : (item.isoDate || '');
      const finalQty = qtyInput ? (Number(qtyInput.value) || 0) : (Number(item.quantity) || 0);
      const locType = locSelect ? locSelect.value : 'PRATELEIRA';
      const finalSector = secSelect ? secSelect.value : (item.sector || 'MERCEARIA');
      const finalCorridor = corSelect ? corSelect.value : (item.corridor || 'CORREDOR 01');

      // 1. Salva ou atualiza o produto
      let product = item.existingProduct;
      if (!product) {
        if (!finalBarcode) {
          throw new Error(`Produto "${finalName}" não possui código de barras.`);
        }
        product = await saveProduct({
          barcode: finalBarcode,
          name: finalName,
          image: item.image || '',
          sector: finalSector,
          corridor: finalCorridor
        });
      } else {
        // Se já existia, atualiza imagem caso tenha sido adicionada agora
        if (item.image && !product.image) {
          product.image = item.image;
          await saveProduct(product);
        }
      }

      // 2. Se informou data de validade OU se tem quantidade > 0, salva validade e contagem
      if (finalDate || finalQty > 0) {
        if (!finalDate) {
          finalDate = getTodayISO();
        } else if (finalDate.includes('/')) {
          finalDate = parseDateBRtoISO(finalDate);
        }

        const { expiration } = await saveProductExpiration(product.id, finalDate);

        const counts = {};
        counts[locType] = finalQty;

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
    showToast(`✓ ${successCount} produtos importados com sucesso!`, 'success', 3000);
  } else {
    showToast(`✓ ${successCount} importados, ${errors.length} falhas`, 'warning', 3500);
  }

  // Dispara envio imediato para a nuvem Supabase em segundo plano
  triggerSyncNow().catch((e) => console.warn('Sync background error:', e));

  // Notifica o app para atualizar telas
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
