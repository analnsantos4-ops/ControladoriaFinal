// Módulo de Integração, Importação e Exportação do WhatsApp
// Controladoria - Ana Luiza
import { SETORS, CORRIDORS, LOCATIONS, formatDateBR, parseDateBRtoISO, formatNumber, compressImage, getTodayISO } from './utils.js';
import { getProductByBarcode, saveProduct, saveProductExpiration, saveInventoryCounts, getProductExpirations, getLatestCountsForExpiration } from './db.js';
import { showToast, showView } from './ui.js';
import { openConferenceForProduct } from './inventory.js';
import { triggerSyncNow } from './sync.js';

// ----------------------------------------------------
// 1. TEMPLATES OFICIAIS PARA REGISTRO EM MASSA
// ----------------------------------------------------

export const WHATSAPP_MASS_TEMPLATE_EXAMPLE = `➡️ *CANJICA BRANCA ANCHIETA 500G*
》Código de barras: 7896505600189
》Corredor: 02
》Setor: MERCEARIA
》Datas de validade:
🔴 02/09/2026: 1.344 unidades
🟡 15/10/2026: 500 unidades

➡️ *HIDRATANTE CORPORAL NIVEA 400ML*
》Código de barras: 7898129330107
》Corredor: 04
》Setor: PERFUMARIA
》Datas de validade:
🔴 26/08/2026: 8 unidades

➡️ *DETERGENTE YPE NEUTRO 500ML*
》Código de barras: 7891024112106
》Corredor: 07
》Setor: LIMPEZA
》Data de validade: 20/12/2026
》Quantidade: 48 unidades`;

export const WHATSAPP_BLANK_TEMPLATE = `➡️ *NOME DO PRODUTO*
》Código de barras: 7890000000000
》Corredor: 01
》Setor: MERCEARIA
》Datas de validade:
🔴 DD/MM/AAAA: 0 unidades`;

// ----------------------------------------------------
// 2. GERADORES DE TEXTO FORMATADO (PADRÃO WHATSAPP)
// ----------------------------------------------------

/**
 * Formata um produto no padrão estrito solicitado:
 * ➡️ *CANJICA BRANCA ANCHIETA 500G*
 * 》*Código de barras:* 7896505600189
 * 》*Corredor:* CORREDOR 02
 * 》*Setor:* MERCEARIA
 * 》*Data de validade:* 02/09/2026
 * 》*Quantidade:* 1.344 unidades
 */
export function formatSingleProductWhatsApp(productName, barcode, expirationDateBR, quantity, corridor = '', sector = '') {
  const cleanName = (productName || '').trim().toUpperCase();
  const cleanBarcode = (barcode || '').trim();
  const cleanDate = (expirationDateBR || '').trim();
  const formattedQty = formatNumber(quantity || 0);

  const lines = [
    `➡️ *${cleanName}*`,
    `》*Código de barras:* ${cleanBarcode}`
  ];

  if (corridor) {
    lines.push(`》*Corredor:* ${corridor}`);
  }
  if (sector) {
    lines.push(`》*Setor:* ${sector}`);
  }

  lines.push(`》*Data de validade:* ${cleanDate}`);
  lines.push(`》*Quantidade:* ${formattedQty} unidades`);

  return lines.join('\n');
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
    parts.push(formatSingleProductWhatsApp(item.name, item.barcode, dateBR, item.quantity, item.corridor, item.sector));
    if (idx < items.length - 1) {
      parts.push(''); // Linha em branco entre produtos
    }
  });

  return parts.join('\n');
}

// ----------------------------------------------------
// 3. PARSER INTELIGENTE DE TEXTO DO WHATSAPP
// Suporta Nome, Código de Barras, Corredor, Setor, Múltiplas Datas e Quantidades
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
  const clean = str.toString().replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
  const parsed = parseFloat(clean);
  return isNaN(parsed) ? 0 : Math.round(parsed);
}

/**
 * Normaliza qualquer texto de corredor para a lista oficial CORRIDORS
 * Aceita: "04", "4", "Corredor 4", "C4", "Adega", "Perfumaria", "Zona do Alho", etc.
 */
export function resolveCorridorString(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return '';
  const clean = rawStr.trim().toUpperCase().replace(/[*_~`]/g, '');

  if (clean.includes('ADEGA')) {
    return 'Adega';
  }
  if (clean.includes('ALHO')) {
    return 'Área do Alho';
  }

  // Tenta extrair número de 1 a 14
  const numMatch = clean.match(/(?:CORREDOR|G[ÔO]NDOLA|LOCAL|C|PRATELEIRA)?\s*0*([1-9]|1[0-4])\b/i);
  if (numMatch && numMatch[1]) {
    const num = parseInt(numMatch[1], 10);
    if (num >= 1 && num <= 14) {
      return `Corredor ${num}`;
    }
  }

  // Match exato ou aproximado
  const exact = CORRIDORS.find((c) => c.toUpperCase() === clean);
  if (exact) return exact;

  return '';
}

/**
 * Normaliza qualquer texto de setor para a lista oficial SETORS
 * Aceita: "Mercearia", "Perfumaria", "Higiene", "Limpeza", "Bebidas", "Bazar", "Alho", etc.
 */
export function resolveSectorString(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return '';
  const clean = rawStr.trim().toUpperCase().replace(/[*_~`]/g, '');

  const direct = SETORS.find((s) => s.toUpperCase() === clean);
  if (direct) return direct;

  if (clean.includes('ALHO') || clean.includes('TEMPERO')) return 'ALHO';
  if (clean.includes('PERFUMARIA') || clean.includes('HIGIENE') || clean.includes('BELEZA') || clean.includes('COSMET') || clean.includes('SHAMPOO') || clean.includes('SABONETE') || clean.includes('HIDRATANTE')) return 'PERFUMARIA';
  if (clean.includes('LIMPEZA') || clean.includes('DETERGENTE') || clean.includes('SABAO') || clean.includes('SABÃO') || clean.includes('DESINFETANTE')) return 'LIMPEZA';
  if (clean.includes('BEBIDA') || clean.includes('REFRIGERANTE') || clean.includes('CERVEJA') || clean.includes('SUCO') || clean.includes('VINHO') || clean.includes('AGUA') || clean.includes('ÁGUA')) return 'BEBIDAS';
  if (clean.includes('BAZAR') || clean.includes('UTILIDADE') || clean.includes('BRINQUEDO') || clean.includes('CASA') || clean.includes('PAPELARIA')) return 'BAZAR';
  if (clean.includes('MERCEARIA') || clean.includes('ALIMENTO') || clean.includes('GRAO') || clean.includes('GRÃO') || clean.includes('DOCE') || clean.includes('BISCOITO') || clean.includes('MASSA') || clean.includes('ARROZ') || clean.includes('FEIJAO') || clean.includes('FEIJÃO')) return 'MERCEARIA';

  return '';
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
    const splitByDoubleLine = text.split(/\n\s*\n+/g);
    splitByDoubleLine.forEach((chunk) => {
      const trimmed = chunk.trim();
      if (trimmed.length > 5) {
        rawBlocks.push(trimmed);
      }
    });
  }

  if (rawBlocks.length === 0 && text.length > 5) {
    rawBlocks.push(text);
  }

  const parsedItems = [];

  rawBlocks.forEach((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;

    let name = '';
    let barcode = '';
    let corridorFound = '';
    let sectorFound = '';
    const expirations = [];
    let singleDateFound = '';
    let singleQtyFound = 0;

    // 1. Nome da primeira linha
    const firstLine = lines[0];
    const nameMatch = firstLine.match(/^[➡️\s*]*(.*?)(?:\*|$)/);
    if (nameMatch && nameMatch[1]) {
      name = nameMatch[1].replace(/[*_~`]/g, '').trim();
    } else {
      name = firstLine.replace(/[*_~`]/g, '').trim();
    }

    // 2. Itera nas linhas do bloco
    lines.forEach((line) => {
      const cleanLine = line.replace(/[*_~`]/g, '').trim();

      // Código de barras
      const barcodeMatch = cleanLine.match(/(?:c[óo]digo(?:\s+de\s+barras)?|ean|barras?|cod)\s*[:*》>\-\s]+([0-9]{6,14})/i);
      if (barcodeMatch) {
        barcode = barcodeMatch[1].trim();
        return;
      } else {
        const genericBarcodeMatch = cleanLine.match(/\b([0-9]{7,14})\b/);
        if (genericBarcodeMatch && !barcode && !cleanLine.match(/(?:validade|vencimento|unidades?|corredor|setor)/i)) {
          barcode = genericBarcodeMatch[1].trim();
        }
      }

      // Corredor (ex: "》Corredor: 04", "Corredor 2", "Corredor: Adega", "C04", "Gôndola 05")
      const corridorMatch = cleanLine.match(/(?:corredor|g[ôo]ndola|local|corr|gondola)\s*[:*》>\-\s]+([a-z0-9\s]+)/i);
      if (corridorMatch && !corridorFound) {
        const resolved = resolveCorridorString(corridorMatch[1]);
        if (resolved) {
          corridorFound = resolved;
          return;
        }
      }

      // Setor (ex: "》Setor: Bazar", "Setor: Mercearia", "Categoria: Perfumaria")
      const sectorMatch = cleanLine.match(/(?:setor|categoria|departamento|cat|dep)\s*[:*》>\-\s]+([a-zà-ú\s]+)/i);
      if (sectorMatch && !sectorFound) {
        const resolved = resolveSectorString(sectorMatch[1]);
        if (resolved) {
          sectorFound = resolved;
          return;
        }
      }

      // FORMATO 1: Linhas de data com quantidade (ex: "🔴 26/08: 3 unidades", "🟡 04/10: 1.200 unidades", "02/09/2026 - 1.344 un")
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

      // FORMATO 2: Data de validade em linha própria (ex: "》Data de validade: 02/09/2026")
      const singleDateMatch = cleanLine.match(/(?:validade|vencimento|venc|data)\s*[:*》>\-\s]+([0-9]{1,2}[\/\-.][0-9]{1,2}(?:[\/\-.][0-9]{2,4})?)/i);
      if (singleDateMatch) {
        singleDateFound = singleDateMatch[1].trim();
        return;
      }

      // FORMATO 2: Quantidade em linha própria (ex: "》Quantidade: 1.344 unidades")
      const singleQtyMatch = cleanLine.match(/(?:quantidade|qtd|qtde|estoque|total)\s*[:*》>\-\s]+([0-9.,]+)/i);
      if (singleQtyMatch) {
        singleQtyFound = parseQuantityString(singleQtyMatch[1]);
        return;
      }
    });

    // Se encontrou data/quantidade únicas pelo Formato 2
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
        expirations.push({
          id: `exp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          rawDate: formatDateBR(getTodayISO()),
          isoDate: getTodayISO(),
          quantity: 0
        });
      }
    }

    if (barcode || name) {
      const totalUnits = expirations.reduce((acc, curr) => acc + (Number(curr.quantity) || 0), 0);

      parsedItems.push({
        id: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: name.toUpperCase() || 'PRODUTO IMPORTADO',
        barcode: barcode || '',
        sector: sectorFound || 'MERCEARIA',
        corridor: corridorFound || 'CORREDOR 01',
        hasExplicitSector: !!sectorFound,
        hasExplicitCorridor: !!corridorFound,
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
// 4. MODAL DE IMPORTAÇÃO E PRÉVIA DO WHATSAPP
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
    <div class="modal-card modal-card-large wa-modal-responsive">
      <div class="modal-header-accent">
        <div class="modal-title-with-icon">
          <span class="modal-header-icon">💬</span>
          <div>
            <h3 class="modal-title">IMPORTAR DO WHATSAPP</h3>
            <p class="modal-subtitle">Registro rápido de produtos e validades em massa</p>
          </div>
        </div>
        <button type="button" class="btn-close-modal" id="btn-close-wa-import" aria-label="Fechar">✕</button>
      </div>

      <!-- Passo 1: Área de Colagem e Templates Oficiais -->
      <div id="wa-step-input" class="wa-step-container">
        
        <!-- Bloco de Template e Exemplos -->
        <div class="wa-template-card">
          <div class="wa-template-header">
            <span class="wa-template-badge">📋 MODELO OFICIAL PARA REGISTRO EM MASSA</span>
            <button type="button" class="btn-copy-template-mini" id="btn-copy-wa-template" title="Copiar modelo em branco para preencher no WhatsApp">
              📋 Copiar Modelo
            </button>
          </div>

          <p class="wa-template-desc">
            Você pode colar <strong>vários produtos de uma vez</strong>! O sistema reconhece <strong>Nome</strong>, <strong>Código de Barras</strong>, <strong>Corredor</strong>, <strong>Setor</strong> e <strong>Validades</strong> automaticamente:
          </p>

          <pre class="wa-format-example-box" id="wa-example-code-preview">➡️ *HIDRATANTE CORPORAL NIVEA 400ML*
》Código de barras: 7898129330107
》Corredor: 04
》Setor: PERFUMARIA
》Datas de validade:
🔴 26/08/2026: 8 unidades
🟡 15/10/2026: 12 unidades</pre>

          <div class="wa-template-buttons-row">
            <button type="button" class="btn-secondary-mini" id="btn-fill-example-test">
              🧪 Testar com 3 Produtos de Exemplo
            </button>
            <button type="button" class="btn-secondary-mini" id="btn-fill-blank-template">
              📝 Inserir Modelo em Branco
            </button>
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 0;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <label for="wa-raw-textarea" style="font-weight: 800; font-size: 0.85rem; color: var(--text-primary);">
              Cole sua mensagem do WhatsApp abaixo:
            </label>
            <button type="button" class="btn-link-mini" id="btn-paste-clipboard" style="font-size: 0.78rem; color: #3b82f6;">
              📋 Colar do Celular
            </button>
          </div>
          <textarea
            id="wa-raw-textarea"
            class="form-textarea wa-input-textarea"
            rows="6"
            placeholder="Cole aqui o texto enviado no grupo ou conversa do WhatsApp..."
          ></textarea>
        </div>

        <div class="modal-actions-grid" style="margin-top: 4px;">
          <button type="button" class="btn-primary btn-hero-action" id="btn-process-wa-text">
            ⚡ IDENTIFICAR E VER PRÉVIA COMPLETA
          </button>
        </div>
      </div>

      <!-- Passo 2: Prévia Completa e Espaçosa antes de salvar -->
      <div id="wa-step-preview" class="wa-step-container hidden">
        <div class="wa-preview-header">
          <div class="wa-preview-title-col">
            <span id="wa-parsed-count-badge" class="badge-count">0 produtos</span>
            <span class="badge-total-loja">🏷️ TOTAL LOJA</span>
          </div>
          <button type="button" class="btn-secondary-mini" id="btn-wa-back-to-input">
            ← Editar Texto
          </button>
        </div>

        <!-- Opções Globais de Setor e Corredor (Obrigatórios) - Compacto e Expansível -->
        <div class="wa-global-defaults-box">
          <button type="button" class="defaults-toggle-header" id="btn-toggle-wa-defaults">
            <span class="defaults-title">📍 Aplicar Setor & Corredor em massa para todos</span>
            <span class="defaults-toggle-icon" id="wa-defaults-toggle-icon">▼ Abrir</span>
          </button>
          <div id="wa-defaults-content" class="defaults-content hidden">
            <div class="defaults-row">
              <div class="defaults-select-wrap">
                <label>Setor:</label>
                <select id="wa-global-sector" class="form-select form-select-sm">
                  ${SETORS.map((s) => `<option value="${s}">${s}</option>`).join('')}
                </select>
              </div>
              <div class="defaults-select-wrap">
                <label>Corredor:</label>
                <select id="wa-global-corridor" class="form-select form-select-sm">
                  ${CORRIDORS.map((c) => `<option value="${c}">${c}</option>`).join('')}
                </select>
              </div>
              <button type="button" id="btn-wa-apply-defaults" class="btn-primary-mini btn-wa-apply-defaults">
                Aplicar em Todos
              </button>
            </div>
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

  // Toggle do bloco de Setor/Corredor em Massa
  document.getElementById('btn-toggle-wa-defaults')?.addEventListener('click', () => {
    const content = document.getElementById('wa-defaults-content');
    const icon = document.getElementById('wa-defaults-toggle-icon');
    if (content) {
      const isHidden = content.classList.toggle('hidden');
      if (icon) {
        icon.textContent = isHidden ? '▼ Abrir' : '▲ Fechar';
      }
    }
  });

  // Copiar Modelo Oficial
  document.getElementById('btn-copy-wa-template')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(WHATSAPP_MASS_TEMPLATE_EXAMPLE);
      showToast('✓ Modelo copiado! Cole no WhatsApp para preencher.', 'success', 2500);
    } catch (e) {
      showToast('✓ Modelo pronto! Copie do exemplo na tela.', 'info', 2000);
    }
  });

  // Preencher Exemplo de Teste
  document.getElementById('btn-fill-example-test')?.addEventListener('click', () => {
    const area = document.getElementById('wa-raw-textarea');
    if (area) {
      area.value = WHATSAPP_MASS_TEMPLATE_EXAMPLE;
      showToast('✓ 3 produtos de exemplo preenchidos! Clique em Processar.', 'info', 2000);
    }
  });

  // Inserir Modelo em Branco
  document.getElementById('btn-fill-blank-template')?.addEventListener('click', () => {
    const area = document.getElementById('wa-raw-textarea');
    if (area) {
      area.value = WHATSAPP_BLANK_TEMPLATE;
      showToast('✓ Modelo em branco inserido.', 'info', 1500);
    }
  });

  // Colar da área de transferência
  document.getElementById('btn-paste-clipboard')?.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          document.getElementById('wa-raw-textarea').value = text;
          showToast('✓ Mensagem colada!', 'success', 1200);
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

    showToast(`Identificando ${items.length} produto(s)...`, 'info', 1000);

    // Verifica existência no banco local
    for (const item of items) {
      if (item.barcode) {
        const existing = await getProductByBarcode(item.barcode);
        if (existing) {
          item.isExisting = true;
          item.existingProduct = existing;
          item.name = existing.name || item.name;
          // Se o texto não definiu explicitamente, usa o do cadastro existente
          if (!item.hasExplicitSector && existing.sector) {
            item.sector = existing.sector;
          }
          if (!item.hasExplicitCorridor && existing.corridor) {
            item.corridor = existing.corridor;
          }
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
    showToast('✓ Setor e Corredor aplicados a todos!', 'success', 1500);
  });

  // Salvar tudo
  document.getElementById('btn-wa-save-all')?.addEventListener('click', async () => {
    await saveAllParsedItems(currentParsedItems);
  });
}

/**
 * Renderiza a lista de produtos parseados na tela de prévia com layout espaçoso e legível
 */
function renderParsedItemsList(items) {
  const listContainer = document.getElementById('wa-parsed-items-list');
  const countBadge = document.getElementById('wa-parsed-count-badge');

  if (countBadge) {
    countBadge.textContent = `${items.length} ${items.length === 1 ? 'produto identificado' : 'produtos identificados'}`;
  }

  if (!listContainer) return;

  if (items.length === 0) {
    listContainer.innerHTML = `<div class="empty-exp-state">Nenhum produto restante na lista.</div>`;
    return;
  }

  listContainer.innerHTML = items
    .map((item, pIdx) => {
      const totalUnits = (item.expirations || []).reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
      item.totalQuantity = totalUnits;

      return `
      <div class="wa-item-card ${item.isExisting ? 'existing-item' : 'new-item'}" id="wa-card-${pIdx}">
        
        <!-- Cabeçalho do Card com Número e Status -->
        <div class="wa-item-header">
          <div class="wa-header-badges">
            <span class="wa-item-index-badge">#${pIdx + 1}</span>
            <span class="badge-total-loja">🏷️ TOTAL LOJA</span>
            ${item.isExisting ? '<span class="status-badge-green">✓ JÁ CADASTRADO</span>' : '<span class="status-badge-blue">✨ NOVO PRODUTO</span>'}
          </div>
          <button type="button" class="btn-remove-wa-item" data-pidx="${pIdx}" title="Remover Produto da lista" aria-label="Remover">
            ✕ Remover
          </button>
        </div>

        <!-- 1. Nome do Produto (Largura Total, Destaque e Tema Escuro) -->
        <div class="wa-field-group-full">
          <label class="wa-field-label">NOME DO PRODUTO:</label>
          <input
            type="text"
            class="form-input wa-name-input"
            data-pidx="${pIdx}"
            value="${(item.name || '').replace(/"/g, '&quot;')}"
            placeholder="Ex: HIDRATANTE CORPORAL NIVEA 400ML"
          />
        </div>

        <!-- 2. Código de Barras e Foto -->
        <div class="wa-barcode-photo-row">
          <div class="wa-barcode-col">
            <label class="wa-field-label">CÓDIGO DE BARRAS:</label>
            <input
              type="text"
              class="form-input wa-barcode-input"
              data-pidx="${pIdx}"
              value="${item.barcode || ''}"
              placeholder="789..."
              inputmode="numeric"
            />
          </div>

          <div class="wa-photo-compact-box">
            <div class="wa-photo-thumb" id="wa-photo-thumb-${pIdx}">
              ${item.image ? `<img src="${item.image}" alt="" class="wa-thumb-img" />` : `<div class="photo-placeholder-mini">SEM FOTO</div>`}
            </div>
            <div class="wa-photo-actions">
              <button type="button" class="btn-wa-photo-action btn-wa-photo-cam" data-pidx="${pIdx}" title="Tirar foto">
                📷 Foto
              </button>
              <button type="button" class="btn-wa-photo-action btn-wa-photo-gal" data-pidx="${pIdx}" title="Galeria">
                🖼️ Galeria
              </button>
              <input type="file" id="wa-cam-file-${pIdx}" accept="image/*" capture="environment" class="hidden" />
              <input type="file" id="wa-gal-file-${pIdx}" accept="image/*" class="hidden" />
            </div>
          </div>
        </div>

        <!-- 3. Setor e Corredor (Lado a Lado em 2 Colunas) -->
        <div class="wa-loc-fields-row">
          <div class="wa-loc-col">
            <label class="wa-field-label">SETOR OBRIGATÓRIO:</label>
            <select class="form-select wa-sector-input" data-pidx="${pIdx}">
              ${SETORS.map((s) => `<option value="${s}" ${s === item.sector ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div class="wa-loc-col">
            <label class="wa-field-label">CORREDOR OBRIGATÓRIO:</label>
            <select class="form-select wa-corridor-input" data-pidx="${pIdx}">
              ${CORRIDORS.map((c) => `<option value="${c}" ${c === item.corridor ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- 4. Lista de Datas de Validade e Quantidades -->
        <div class="wa-expirations-section">
          <div class="wa-exp-header">
            <span class="wa-exp-title">📅 DATAS DE VALIDADE (${(item.expirations || []).length}):</span>
            <button type="button" class="btn-add-date-mini" data-pidx="${pIdx}">
              + Adicionar Validade
            </button>
          </div>

          <div class="wa-exp-list">
            ${(item.expirations || [])
              .map((exp, eIdx) => {
                return `
                <div class="wa-exp-row" data-pidx="${pIdx}" data-eidx="${eIdx}">
                  <div class="wa-exp-date-col">
                    <label>Data de Validade:</label>
                    <input
                      type="date"
                      class="form-input wa-exp-date-input"
                      data-pidx="${pIdx}"
                      data-eidx="${eIdx}"
                      value="${exp.isoDate}"
                    />
                  </div>
                  <div class="wa-exp-qty-col">
                    <label>Quantidade:</label>
                    <div class="qty-input-wrap">
                      <input
                        type="number"
                        class="form-input wa-exp-qty-input"
                        data-pidx="${pIdx}"
                        data-eidx="${eIdx}"
                        value="${exp.quantity}"
                        min="0"
                      />
                      <span class="qty-unit-label">un</span>
                    </div>
                  </div>
                  <button type="button" class="btn-remove-exp-row" data-pidx="${pIdx}" data-eidx="${eIdx}" title="Remover esta data">
                    ✕
                  </button>
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
// 5. MODAL DE EXPORTAÇÃO E COMPARTILHAMENTO
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
