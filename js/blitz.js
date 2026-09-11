// ====================================================
// MÓDULO BLITZ DE CONFERÊNCIA RÁPIDA POR PERÍODO
// Controladoria - Ana Luiza
//
// Conceito: A conferência é guiada pela listagem/papel físico.
// Fluxo: INICIAR BLITZ → INFORMAR PERÍODO → OLHAR PAPEL → BIPAR PRODUTO
//        → INFORMAR DATA SOLICITADA → TEM/NÃO TEM → PRÓXIMO
// ====================================================

import {
  initDB,
  createBlitzSession,
  updateBlitzSessionPeriod,
  getActiveBlitzSession,
  getBlitzSessionById,
  finishBlitzSession,
  cancelBlitzSession,
  getAllBlitzSessions,
  saveBlitzItem,
  getBlitzItemsBySessionId,
  getBlitzItemBySessionProductAndDate,
  getBlitzItemBySessionBarcodeAndDate,
  getLastBlitzItemForProductAndDate,
  getLastBlitzItemForBarcodeAndDate,
  getAllBlitzItemsForProductAndDate,
  getAllBlitzItemsForBarcode,
  getAllBlitzItems,
  saveBlitzConferenceRecord,
  getProductByBarcode,
  getProductById,
  saveProduct,
  saveProductExpiration,
  getProductExpirations,
  getLatestCountsForExpiration,
  getExpirationByProductAndDate,
  getComprehensiveConferenceRecordForProductAndDate,
  getPreviousFinalizedBlitzConference,
  getCurrentBlitzConferenceRecord,
  saveProductPhotoRecord,
  getProductPhotoFromDb,
  bulkRegisterBlitzProducts,
  updateProductCorridor,
  updateProductStatus,
  getAllProducts
} from './db.js';

import {
  BLITZ_LOCATIONS,
  SETORS,
  CORRIDORS,
  formatDateBR,
  formatNumber,
  parseDateBRtoISO,
  getTodayISO,
  formatDateWithWeekday,
  compressImage,
  generateId,
  triggerHaptic
} from './utils.js';

import {
  parseBlitzInputList,
  createBlitzRecord,
  importBlitzItemsWithHistory,
  getBlitzItens,
  saveBlitzConference,
  finalizeBlitzWithAutoZeros,
  reopenBlitzRecord,
  correctConferenceQuantity,
  calculateBlitzMetrics,
  calculateBlitzPaceMetrics,
  getSessionBlitzItems,
  getWeeklyRoutineStatus,
  getWhatChangedAnalysis,
  recordAudit,
  repairBlitzSessionData
} from './blitz_engine.js';

import { showView, showToast, promptConfirmDialog } from './ui.js';
import { startCameraScanner, stopCameraScanner } from './scanner.js';
import { openWhatsAppExportModal } from './whatsapp.js';
import { triggerSyncNow } from './sync.js';
import { openConferenceForProduct } from './inventory.js';
import { getCurrentUser, getUserById, getAllowedSectorsForUser, isSectorAllowedForUser } from './auth.js';

let currentActiveBlitzSession = null;

export function getActiveBlitz() {
  return currentActiveBlitzSession;
}

export function setActiveBlitz(session) {
  currentActiveBlitzSession = session;
  if (session) {
    localStorage.setItem('active_blitz_session_cache', JSON.stringify(session));
  } else {
    localStorage.removeItem('active_blitz_session_cache');
  }
  updateBlitzTopBarIndicator();
}

/**
 * Renderizador padronizado e ultra-robusto de foto do produto.
 * Se a foto não existir ou falhar ao carregar no navegador, ativa imediatamente
 * o placeholder neutro (.photo-placeholder-neutral) SEM NUNCA exibir interrogação azul ou ícone de imagem quebrada.
 */
export function renderProductPhotoHtml(photoUrl, altText = '', options = {}) {
  const size = options.size || 52;
  const rounded = options.rounded || '8px';
  const customStyle = options.style || '';
  const customClass = options.className || '';

  const cleanUrl = (photoUrl && typeof photoUrl === 'string' && photoUrl.trim() !== '' && photoUrl.trim() !== 'null' && photoUrl.trim() !== 'undefined')
    ? photoUrl.trim()
    : null;

  if (cleanUrl) {
    return `
      <div class="blitz-prod-thumb-box ${customClass}" style="width: ${size}px; height: ${size}px; border-radius: ${rounded}; ${customStyle}">
        <img 
          src="${cleanUrl}" 
          alt="${altText ? String(altText).replace(/"/g, '&quot;') : 'Foto do Produto'}" 
          class="blitz-prod-thumb-img" 
          referrerpolicy="no-referrer"
          onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';" 
        />
        <div class="photo-placeholder-neutral" style="display: none;">
          <span>📷 Sem foto</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="blitz-prod-thumb-box ${customClass}" style="width: ${size}px; height: ${size}px; border-radius: ${rounded}; ${customStyle}">
      <div class="photo-placeholder-neutral">
        <span>📷 Sem foto</span>
      </div>
    </div>
  `;
}

// Inicializa o módulo e recupera sessão ativa se houver
export async function initBlitzModule() {
  try {
    const active = await getActiveBlitzSession();
    if (active) {
      currentActiveBlitzSession = active;
      localStorage.setItem('active_blitz_session_cache', JSON.stringify(active));
    } else {
      currentActiveBlitzSession = null;
      localStorage.removeItem('active_blitz_session_cache');
    }
  } catch (e) {
    const cached = localStorage.getItem('active_blitz_session_cache');
    currentActiveBlitzSession = cached ? JSON.parse(cached) : null;
  }
  updateBlitzTopBarIndicator();
}

// Atualiza o banner no Dashboard e a barra indicadora no Scanner
export function updateBlitzTopBarIndicator() {
  const dashBanner = document.getElementById('dashboard-active-blitz-banner');
  const scannerBar = document.getElementById('scanner-blitz-indicator-bar');

  if (!currentActiveBlitzSession) {
    if (dashBanner) {
      dashBanner.classList.add('hidden');
      dashBanner.innerHTML = '';
    }
    if (scannerBar) {
      scannerBar.classList.add('hidden');
      scannerBar.innerHTML = '';
    }
    return;
  }

  let periodLabel = currentActiveBlitzSession.period_label;
  if (!periodLabel || periodLabel.includes('--/--/----') || periodLabel === 'Geral') {
    if (currentActiveBlitzSession.start_date && currentActiveBlitzSession.end_date) {
      periodLabel = `${formatDateBR(currentActiveBlitzSession.start_date)} → ${formatDateBR(currentActiveBlitzSession.end_date)}`;
    } else {
      periodLabel = 'Definir Período';
    }
  }
  const startedAtTime = currentActiveBlitzSession.started_at
    ? new Date(currentActiveBlitzSession.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

  const bannerHtml = `
    <div style="
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(217, 119, 6, 0.24) 100%);
      border: 1px solid rgba(245, 158, 11, 0.5);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    ">
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span style="font-size: 1.4rem; flex-shrink: 0;">📋</span>
        <div style="min-width: 0;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="background: #f59e0b; color: #000; font-size: 0.65rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
              BLITZ ATIVA
            </span>
            <span style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; font-size: 0.68rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
              SETOR: ${currentActiveBlitzSession.sector || 'GERAL'}
            </span>
            <span style="font-size: 0.78rem; color: #fbbf24; font-weight: 800;">
              Período: ${periodLabel}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: #a1a1aa; margin-top: 2px;">
            Por ${currentActiveBlitzSession.responsible_user_name || currentActiveBlitzSession.user_name || 'Ana Luiza'} • Iniciada às ${startedAtTime}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center;">
        <button type="button" id="btn-dash-resume-blitz" class="btn-primary" style="padding: 6px 12px; font-size: 0.78rem; font-weight: 900; background: #f59e0b; color: #000; border-radius: 6px; white-space: nowrap;">
          🔎 Continuar
        </button>
        <button type="button" id="btn-dash-finish-blitz-top" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; padding: 5px 8px; border-radius: 6px; font-size: 0.74rem; font-weight: 800; cursor: pointer; white-space: nowrap;" title="Finalizar Blitz">
          ✓ Finalizar
        </button>
      </div>
    </div>
  `;

  if (dashBanner) {
    dashBanner.innerHTML = bannerHtml;
    dashBanner.classList.remove('hidden');
    document.getElementById('btn-dash-resume-blitz')?.addEventListener('click', () => {
      openBlitzDashboardView();
    });
    document.getElementById('btn-dash-finish-blitz-top')?.addEventListener('click', async () => {
      await finishActiveBlitzSession(currentActiveBlitzSession?.id);
    });
  }

  if (scannerBar) {
    scannerBar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
        <span style="font-size: 1rem;">🔍</span>
        <span style="font-size: 0.74rem; font-weight: 900; color: #fbbf24; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          BLITZ [${currentActiveBlitzSession.sector || 'GERAL'}]: ${periodLabel}
        </span>
      </div>
      <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0;">
        <button type="button" id="btn-scanner-blitz-dash" style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #fef08a; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
          📋 Painel
        </button>
        <button type="button" id="btn-scanner-blitz-finish" style="background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); color: #86efac; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
          ✓ Finalizar
        </button>
      </div>
    `;
    scannerBar.classList.remove('hidden');
    document.getElementById('btn-scanner-blitz-dash')?.addEventListener('click', () => {
      stopCameraScanner();
      openBlitzDashboardView();
    });
    document.getElementById('btn-scanner-blitz-finish')?.addEventListener('click', async () => {
      stopCameraScanner();
      await finishActiveBlitzSession(currentActiveBlitzSession?.id);
    });
  }
}

// ----------------------------------------------------
// 1. INICIAR BLITZ: SOLICITA O SETOR E O PERÍODO
// ----------------------------------------------------

export async function promptStartBlitz() {
  if (currentActiveBlitzSession) {
    showActiveBlitzDialog();
    return;
  }
  showStartBlitzModal();
}

function showActiveBlitzDialog() {
  let modal = document.getElementById('modal-active-blitz-dialog');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-active-blitz-dialog';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const periodLabel = currentActiveBlitzSession.period_label || 'Geral';
  const startedAt = new Date(currentActiveBlitzSession.started_at).toLocaleString('pt-BR');
  const sectorLabel = currentActiveBlitzSession.sector || 'GERAL';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-active-blitz-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      <div style="font-size: 2rem; margin-bottom: 4px; text-align: center;">🔍</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; text-align: center; margin: 0 0 6px 0;">
        BLITZ ATIVA EM ANDAMENTO
      </h3>
      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; padding: 12px; margin-bottom: 14px; text-align: center;">
        <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 6px;">
          <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.8rem; font-weight: 900; padding: 3px 10px; border-radius: 6px;">
            🏷️ SETOR: ${sectorLabel}
          </span>
        </div>
        <div style="font-size: 0.72rem; color: #a1a1aa; text-transform: uppercase; font-weight: 800;">Período da Blitz:</div>
        <div style="font-size: 1.15rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">
          ${periodLabel}
        </div>
        <div style="font-size: 0.72rem; color: #71717a; margin-top: 4px;">
          Iniciada em ${startedAt} por ${currentActiveBlitzSession.responsible_user_name || currentActiveBlitzSession.user_name || 'Ana Luiza'}
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-dialog-resume-blitz" class="btn-primary" style="height: 48px; font-weight: 900; font-size: 0.95rem; justify-content: center; background: #f59e0b; color: #000;">
          ▶ CONTINUAR ESTA BLITZ
        </button>
        <button type="button" id="btn-dialog-config-blitz" class="btn-secondary" style="height: 44px; font-weight: 800; font-size: 0.88rem; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
          ⚙️ Configurar Setor e Período
        </button>
        <button type="button" id="btn-dialog-finish-blitz" class="btn-secondary" style="height: 44px; font-weight: 800; font-size: 0.88rem; justify-content: center; color: #10b981; border-color: rgba(16, 185, 129, 0.4);">
          ✅ FINALIZAR BLITZ
        </button>
        <button type="button" id="btn-dialog-new-blitz" class="btn-secondary" style="height: 40px; font-weight: 700; font-size: 0.82rem; justify-content: center; color: #a1a1aa;">
          ➕ Iniciar Outra Blitz
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-active-blitz-backdrop')?.addEventListener('click', closeModal);

  document.getElementById('btn-dialog-resume-blitz')?.addEventListener('click', () => {
    closeModal();
    openBlitzDashboardView();
  });

  document.getElementById('btn-dialog-config-blitz')?.addEventListener('click', () => {
    closeModal();
    promptEditActiveBlitzPeriod(currentActiveBlitzSession);
  });

  document.getElementById('btn-dialog-finish-blitz')?.addEventListener('click', async () => {
    closeModal();
    await finishActiveBlitzSession(currentActiveBlitzSession?.id);
  });

  document.getElementById('btn-dialog-new-blitz')?.addEventListener('click', async () => {
    closeModal();
    showStartBlitzModal();
  });
}

// ====================================================
// 1. CADASTRO EM MASSA DE PRODUTOS PARA A BLITZ
// ====================================================

export function parseBulkProductText(rawText) {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results = [];
  const seenBarcodes = new Set();

  for (const line of lines) {
    // 1. Formato "7896036000717 - EXTRATO TOMATE ELEFANTE POTE 300G" ou com tab/dois-pontos
    const match = line.match(/^(\d{4,14})\s*[-–—:;\t, ]\s*(.+)$/) || line.match(/^(\d{4,14})\s+(.+)$/);
    if (match) {
      const barcode = match[1].trim();
      const name = match[2].trim().replace(/^[-–—:;\t, ]+/, '').trim().toUpperCase();
      if (barcode && !seenBarcodes.has(barcode)) {
        seenBarcodes.add(barcode);
        results.push({ barcode, name: name || `PRODUTO ${barcode}` });
      }
    } else {
      // 2. Linha contendo apenas código de barras numérico
      const onlyDigits = line.match(/^(\d{4,14})$/);
      if (onlyDigits) {
        const barcode = onlyDigits[1].trim();
        if (!seenBarcodes.has(barcode)) {
          seenBarcodes.add(barcode);
          results.push({ barcode, name: `PRODUTO ${barcode}` });
        }
      } else {
        // 3. Caso código esteja no final
        const endMatch = line.match(/^(.+?)\s*[-–—:;\t, ]\s*(\d{4,14})$/);
        if (endMatch) {
          const barcode = endMatch[2].trim();
          const name = endMatch[1].trim().toUpperCase();
          if (barcode && !seenBarcodes.has(barcode)) {
            seenBarcodes.add(barcode);
            results.push({ barcode, name });
          }
        }
      }
    }
  }
  return results;
}

export function openBlitzMassRegisterModal(defaultSector = 'MERCEARIA') {
  let modal = document.getElementById('modal-blitz-mass-register');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-mass-register';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const activeSector = currentActiveBlitzSession?.sector || defaultSector || 'MERCEARIA';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-mass-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 480px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.4rem;">📥</span>
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">
              IMPORTAR LISTA DA BLITZ
            </h3>
            <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; text-transform: uppercase;">Colar Texto ou Carregar Arquivo</span>
          </div>
        </div>
        <button type="button" id="btn-close-blitz-mass" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.76rem; color: #fef08a; line-height: 1.4;">
        💡 <strong>Como funciona:</strong> Cole a lista com código e descrição (e opcionalmente validade), ou suba um arquivo <strong>.txt</strong> ou <strong>.csv</strong>. O sistema pesquisa automaticamente o histórico de conferências de cada item!
      </div>

      <form id="form-blitz-mass-register" style="display: flex; flex-direction: column; gap: 12px;">
        <!-- Escolha do Setor -->
        <div>
          <label for="select-blitz-mass-sector" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            🏷️ Setor da Blitz:
          </label>
          <select id="select-blitz-mass-sector" class="form-input" style="height: 46px; font-weight: 800; color: #fbbf24; background: #18181c; border-color: #f59e0b;">
            ${SETORS.map(s => `<option value="${s}" ${s === activeSector ? 'selected' : ''}>${s}</option>`).join('')}
            <option value="GERAL" ${activeSector === 'GERAL' ? 'selected' : ''}>GERAL / DIVERSOS</option>
          </select>
        </div>

        <!-- Botão Carregar Arquivo .txt / .csv -->
        <div>
          <input type="file" id="input-file-blitz-list" accept=".txt,.csv" class="hidden" />
          <button type="button" id="btn-upload-blitz-file" class="btn-secondary" style="width: 100%; height: 42px; font-size: 0.84rem; font-weight: 800; justify-content: center; gap: 6px;">
            <span>📁</span> <span>Carregar arquivo (.txt ou .csv)</span>
          </button>
        </div>

        <!-- Textarea para colar a lista -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <label for="textarea-blitz-mass-input" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase;">
              📋 Ou cole o texto aqui:
            </label>
            <span id="badge-blitz-mass-counter" style="font-size: 0.72rem; color: #10b981; font-weight: 800;">
              0 produtos detectados
            </span>
          </div>
          <textarea
            id="textarea-blitz-mass-input"
            class="form-input"
            rows="8"
            placeholder="7896036000717 - EXTRATO TOMATE ELEFANTE POTE 300G&#10;7896036000809 - EXTRATO TOMATE ELEFANTE TP 275G 15/10/2025&#10;789517206284 - EXTRATO TOMATE FUGINI SACHE"
            style="font-family: monospace; font-size: 0.84rem; line-height: 1.4; padding: 10px; background: #121214; border-color: #3f3f46; resize: vertical;"
          ></textarea>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button type="button" id="btn-cancel-blitz-mass" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" id="btn-submit-blitz-mass" class="btn-primary" style="flex: 1.4; height: 46px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 0.95rem;">
            💾 IMPORTAR LISTA
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-mass-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-mass')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-mass')?.addEventListener('click', closeModal);

  const textarea = document.getElementById('textarea-blitz-mass-input');
  const counterBadge = document.getElementById('badge-blitz-mass-counter');
  const fileInput = document.getElementById('input-file-blitz-list');

  document.getElementById('btn-upload-blitz-file')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result || '';
      if (textarea) {
        textarea.value = text;
        updateCount();
      }
      showToast(`Arquivo "${file.name}" carregado!`, 'success', 1500);
    };
    reader.readAsText(file);
  });

  const updateCount = () => {
    const parsed = parseBlitzInputList(textarea?.value || '');
    if (counterBadge) {
      counterBadge.textContent = `${parsed.length} produto${parsed.length === 1 ? '' : 's'} detectado${parsed.length === 1 ? '' : 's'}`;
      counterBadge.style.color = parsed.length > 0 ? '#10b981' : '#a1a1aa';
    }
  };

  textarea?.addEventListener('input', updateCount);
  textarea?.addEventListener('paste', () => setTimeout(updateCount, 50));

  document.getElementById('form-blitz-mass-register')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = textarea?.value?.trim() || '';
    const chosenSector = document.getElementById('select-blitz-mass-sector')?.value || 'MERCEARIA';

    const parsedItems = parseBlitzInputList(raw);
    if (parsedItems.length === 0) {
      showToast('Cole ao menos um código de barras com descrição', 'warning');
      textarea?.focus();
      return;
    }

    try {
      showToast(`Importando ${parsedItems.length} produtos...`, 'sync', 1200);

      // 1. Cadastra/atualiza produtos no catálogo
      const bulkPayload = parsedItems.map(p => ({
        barcode: p.ean,
        name: p.descricao,
        sector: chosenSector,
        corridor: p.corredor || '',
        expiration_date: p.data_validade || null
      }));
      await bulkRegisterBlitzProducts({ items: bulkPayload, sector: chosenSector });

      // 2. Se houver Blitz ativa, vincula como itens oficiais da Blitz com histórico automático
      let importStats = null;
      if (currentActiveBlitzSession) {
        importStats = await importBlitzItemsWithHistory(currentActiveBlitzSession.id, parsedItems, chosenSector);
      }

      closeModal();
      triggerSyncNow().catch(err => console.warn('Sync error:', err));

      if (importStats && currentActiveBlitzSession) {
        showBlitzImportSummaryModal(importStats);
      } else {
        showToast(`✓ ${parsedItems.length} produtos importados!`, 'success', 2000);
        if (currentActiveBlitzSession) {
          openBlitzDashboardView();
        }
      }
    } catch (err) {
      console.error('Erro ao importar lista da blitz:', err);
      showToast('Erro ao importar lista da blitz', 'warning');
    }
  });
}

/**
 * Resumo da Importação com Estatísticas (Item 17)
 */
export function showBlitzImportSummaryModal(stats) {
  let modal = document.getElementById('modal-blitz-import-summary');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-import-summary';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const itemsList = stats.itens || [];
  const totalCount = stats.total || stats.totalImportados || itemsList.length;
  const novosCount = stats.novos || stats.produtosNovos || 0;
  const jaVerificadosCount = stats.jaVerificados || 0;
  const tinhamQtdCount = stats.tinhamQuantidade || 0;
  const tinhamZeroCount = stats.tinhamZero || 0;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-import-summary-backdrop"></div>
    <div class="modal-card" style="padding: 18px; max-width: 520px; width: 100%; box-sizing: border-box; max-height: 92vh; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.5rem;">📊</span>
          <div>
            <h3 style="font-size: 1.08rem; font-weight: 900; color: #10b981; margin: 0;">
              LISTA IMPORTADA COM SUCESSO!
            </h3>
            <span style="font-size: 0.72rem; color: #a1a1aa;">Histórico de conferências anteriores cruzado</span>
          </div>
        </div>
        <button type="button" id="btn-close-import-summary-x" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <!-- Cards de Métricas do Histórico -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 12px;">
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #a1a1aa; font-weight: 800;">TOTAL</div>
          <div style="font-size: 1.25rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">${totalCount}</div>
        </div>
        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #38bdf8; font-weight: 800;">JÁ CONFERIDOS</div>
          <div style="font-size: 1.25rem; font-weight: 900; color: #38bdf8; margin-top: 2px;">${jaVerificadosCount}</div>
        </div>
        <div style="background: rgba(52, 211, 153, 0.08); border: 1px solid rgba(52, 211, 153, 0.3); border-radius: 8px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #34d399; font-weight: 800;">PROD. NOVOS</div>
          <div style="font-size: 1.25rem; font-weight: 900; color: #34d399; margin-top: 2px;">${novosCount}</div>
        </div>
        <div style="background: rgba(251, 191, 36, 0.08); border: 1px solid rgba(251, 191, 36, 0.3); border-radius: 8px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #fbbf24; font-weight: 800;">TINHAM QTD</div>
          <div style="font-size: 1.25rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">${tinhamQtdCount}</div>
        </div>
      </div>

      <!-- Abas de visualização rápida da lista importada -->
      <div style="display: flex; gap: 4px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 8px; scrollbar-width: none;">
        <button type="button" class="btn-summary-tab active" data-tab="TODOS" style="padding: 5px 10px; font-size: 0.72rem; font-weight: 800; border-radius: 6px; background: #10b981; color: #022c22; border: none; cursor: pointer; white-space: nowrap;">
          Todos (${totalCount})
        </button>
        <button type="button" class="btn-summary-tab" data-tab="JA_CONFERIDOS" style="padding: 5px 10px; font-size: 0.72rem; font-weight: 800; border-radius: 6px; background: #272730; color: #a1a1aa; border: none; cursor: pointer; white-space: nowrap;">
          📋 Já Conferidos (${jaVerificadosCount})
        </button>
        <button type="button" class="btn-summary-tab" data-tab="NOVOS" style="padding: 5px 10px; font-size: 0.72rem; font-weight: 800; border-radius: 6px; background: #272730; color: #a1a1aa; border: none; cursor: pointer; white-space: nowrap;">
          🆕 Novos (${novosCount})
        </button>
        <button type="button" class="btn-summary-tab" data-tab="TINHAM_QTD" style="padding: 5px 10px; font-size: 0.72rem; font-weight: 800; border-radius: 6px; background: #272730; color: #a1a1aa; border: none; cursor: pointer; white-space: nowrap;">
          🟢 Tinham Qtd (${tinhamQtdCount})
        </button>
        <button type="button" class="btn-summary-tab" data-tab="TINHAM_ZERO" style="padding: 5px 10px; font-size: 0.72rem; font-weight: 800; border-radius: 6px; background: #272730; color: #a1a1aa; border: none; cursor: pointer; white-space: nowrap;">
          🔴 Tinham 0 (${tinhamZeroCount})
        </button>
      </div>

      <!-- Campo de filtro rápido -->
      <div style="margin-bottom: 8px;">
        <input
          type="text"
          id="input-filter-imported-summary"
          placeholder="🔍 Filtrar produtos importados..."
          style="width: 100%; height: 36px; background: #18181d; border: 1px solid #33333d; border-radius: 6px; padding: 0 10px; font-size: 0.8rem; color: #f4f4f5; outline: none;"
        />
      </div>

      <!-- Container rolável com a lista de itens e histórico -->
      <div id="summary-items-list-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; max-height: 320px; padding-right: 2px;">
        <!-- Itens injetados via renderSummaryItems() -->
      </div>

      <!-- Ações de Rodapé -->
      <div style="display: flex; gap: 8px; margin-top: 12px; border-top: 1px solid #27272a; padding-top: 12px;">
        <button type="button" id="btn-view-dash-after-import" class="btn-secondary" style="flex: 1; height: 48px; font-size: 0.88rem; font-weight: 800; justify-content: center; border-radius: 8px;">
          📋 Ver Painel
        </button>
        <button type="button" id="btn-start-scanning-after-import" class="btn-primary" style="flex: 1.5; height: 48px; font-size: 0.95rem; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; border-radius: 8px;">
          📷 BIPAR AGORA
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  let activeTab = 'TODOS';
  let searchText = '';

  const renderSummaryItems = () => {
    const listEl = document.getElementById('summary-items-list-container');
    if (!listEl) return;

    let filtered = itemsList.slice();

    if (activeTab === 'JA_CONFERIDOS') {
      filtered = filtered.filter(i => !i.is_new_product);
    } else if (activeTab === 'NOVOS') {
      filtered = filtered.filter(i => i.is_new_product === true);
    } else if (activeTab === 'TINHAM_QTD') {
      filtered = filtered.filter(i => i.had_quantity_previously === true || (Number(i.previous_quantity) || 0) > 0);
    } else if (activeTab === 'TINHAM_ZERO') {
      filtered = filtered.filter(i => i.had_zero_previously === true);
    }

    if (searchText) {
      const q = searchText.toLowerCase();
      filtered = filtered.filter(i => {
        const name = String(i.nome_produto || i.nome || i.descricao || '').toLowerCase();
        const barcode = String(i.ean || i.barcode || '').toLowerCase();
        return name.includes(q) || barcode.includes(q);
      });
    }

    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 24px 10px; color: #71717a; font-size: 0.82rem; background: #18181d; border-radius: 8px;">
          Nenhum produto nesta filtragem.
        </div>
      `;
      return;
    }

    listEl.innerHTML = filtered.map(it => {
      const name = it.nome_produto || it.nome || it.descricao || `Produto ${it.ean || it.barcode}`;
      const barcode = it.ean || it.barcode || '';
      const expDate = it.data_validade || it.requested_expiration_date;
      const isNew = it.is_new_product === true;
      const prevQty = Number(it.previous_quantity) || 0;
      const hadQty = it.had_quantity_previously === true || prevQty > 0;
      const hadZero = it.had_zero_previously === true;

      let historyBadge = '';
      if (isNew) {
        historyBadge = `<span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.35);">🆕 PRODUTO NOVO</span>`;
      } else if (hadQty) {
        historyBadge = `<span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35);">📋 CONFERIDO ANTERIOR: ${prevQty} un</span>`;
      } else if (hadZero) {
        historyBadge = `<span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35);">🔴 ZERADO NA ÚLTIMA BLITZ</span>`;
      } else {
        historyBadge = `<span style="font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(161, 161, 170, 0.15); color: #d4d4d8;">📋 JÁ NO HISTÓRICO</span>`;
      }

      return `
        <div style="background: #18181d; border: 1px solid #27272e; border-radius: 6px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.82rem; font-weight: 800; color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${name}
            </div>
            <div style="font-size: 0.7rem; color: #a1a1aa; margin-top: 2px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              <span style="font-family: monospace; color: #fbbf24;">${barcode}</span>
              ${expDate ? `<span>• Val: ${formatDateBR(expDate)}</span>` : ''}
              ${it.corredor ? `<span>• Corredor: <strong>${it.corredor}</strong></span>` : ''}
            </div>
          </div>
          <div>
            ${historyBadge}
          </div>
        </div>
      `;
    }).join('');
  };

  renderSummaryItems();

  modal.querySelectorAll('.btn-summary-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.btn-summary-tab').forEach(b => {
        b.classList.remove('active');
        b.style.background = '#272730';
        b.style.color = '#a1a1aa';
      });
      btn.classList.add('active');
      btn.style.background = '#10b981';
      btn.style.color = '#022c22';
      activeTab = btn.getAttribute('data-tab') || 'TODOS';
      renderSummaryItems();
    });
  });

  const searchInput = document.getElementById('input-filter-imported-summary');
  searchInput?.addEventListener('input', (e) => {
    searchText = e.target.value?.trim() || '';
    renderSummaryItems();
  });

  document.getElementById('modal-import-summary-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-import-summary-x')?.addEventListener('click', closeModal);
  document.getElementById('btn-start-scanning-after-import')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });
  document.getElementById('btn-view-dash-after-import')?.addEventListener('click', () => {
    closeModal();
    openBlitzDashboardView();
  });
}

// ====================================================
// 2. INÍCIO DA BLITZ (PERÍODO, SETOR E LISTAGEM EM MASSA)
// ====================================================

// Modal para configurar o Período, Setor e a Listagem em Massa de Produtos
function showStartBlitzModal() {
  let modal = document.getElementById('modal-start-blitz');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-start-blitz';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // Datas padrão sugeridas: Hoje até +30 dias
  const today = new Date();
  const next30 = new Date();
  next30.setDate(next30.getDate() + 30);

  const defaultStartISO = today.toISOString().split('T')[0];
  const defaultEndISO = next30.toISOString().split('T')[0];

  const currentUser = getCurrentUser();
  const isAngelica = currentUser?.id === 'angelica';
  const userPrimaryColor = isAngelica ? '#10b981' : '#a855f7';
  const userBadgeColor = isAngelica ? 'rgba(16, 185, 129, 0.15)' : 'rgba(168, 85, 247, 0.15)';
  const userBadgeText = isAngelica ? '🟢 Angélica' : '🟣 Ana Luiza';
  const userBadgeColorText = isAngelica ? '#34d399' : '#c084fc';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-start-blitz-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 480px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.4rem;">📋</span>
          <div>
            <h3 style="font-size: 1.1rem; font-weight: 900; color: #f4f4f5; margin: 0;">
              INICIAR BLITZ
            </h3>
            <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800;">PERÍODO, SETOR E LISTA DE PRODUTOS</span>
          </div>
        </div>
        <button type="button" id="btn-close-start-blitz" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <!-- Identificação da Usuária Ativa Responsável -->
      <div style="background: ${userBadgeColor}; border: 1.5px solid ${userPrimaryColor}55; border-radius: 8px; padding: 8px 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-size: 0.74rem; color: #a1a1aa; font-weight: 700;">Responsável por esta Blitz:</span>
        <span style="font-size: 0.86rem; font-weight: 900; color: ${userBadgeColorText};">
          ${userBadgeText}
        </span>
      </div>

      <form id="form-start-blitz-period" style="display: flex; flex-direction: column; gap: 14px;">
        
        <!-- 1. PERÍODO DA BLITZ (DATA INICIAL E DATA FINAL) -->
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <label style="font-size: 0.78rem; font-weight: 900; color: #fbbf24; text-transform: uppercase; margin: 0;">
              📅 Período da Blitz:
            </label>
            <span style="font-size: 0.7rem; color: #a1a1aa; font-weight: 700;">
              Ex: 08/09/2026 até 10/10/2026
            </span>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
            <div>
              <label for="input-blitz-start-date" style="font-size: 0.7rem; color: #a1a1aa; font-weight: 800; display: block; margin-bottom: 4px;">
                Data Inicial:
              </label>
              <input
                type="date"
                id="input-blitz-start-date"
                class="form-input"
                value="${defaultStartISO}"
                required
                style="height: 42px; font-size: 0.95rem; font-weight: 800; color-scheme: dark; border-color: #f59e0b;"
              />
            </div>
            <div>
              <label for="input-blitz-end-date" style="font-size: 0.7rem; color: #a1a1aa; font-weight: 800; display: block; margin-bottom: 4px;">
                Data Final:
              </label>
              <input
                type="date"
                id="input-blitz-end-date"
                class="form-input"
                value="${defaultEndISO}"
                required
                style="height: 42px; font-size: 0.95rem; font-weight: 800; color-scheme: dark; border-color: #f59e0b;"
              />
            </div>
          </div>

          <div style="margin-top: 8px; font-size: 0.76rem; color: #fbbf24; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 6px; padding: 6px 10px; font-weight: 800; text-align: center;">
            Período: <strong id="preview-blitz-period-label">${formatDateBR(defaultStartISO)} até ${formatDateBR(defaultEndISO)}</strong>
          </div>
        </div>

        <!-- 2. SETOR DA BLITZ (Personalizado para a usuária ativa) -->
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px;">
          <label style="font-size: 0.78rem; font-weight: 900; color: #fbbf24; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span>🏷️ Setor da Blitz:</span>
            <span style="font-size: 0.68rem; color: ${userBadgeColorText}; text-transform: none; font-weight: 700;">Setores de ${currentUser?.name || 'Ana Luiza'}</span>
          </label>

          ${isAngelica ? `
            <!-- Setores Prioritários de Angélica -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
              <button type="button" class="btn-start-blitz-chip btn-secondary active" data-sector="MERCEARIA" style="padding: 9px 8px; font-size: 0.82rem; font-weight: 900; justify-content: center; border-color: #10b981; background: rgba(16, 185, 129, 0.2); color: #34d399;">
                🥫 MERCEARIA
              </button>
              <button type="button" class="btn-start-blitz-chip btn-secondary" data-sector="PERFUMARIA" style="padding: 9px 8px; font-size: 0.82rem; font-weight: 900; justify-content: center;">
                🧴 PERFUMARIA
              </button>
            </div>
            <div style="margin-bottom: 8px;">
              <button type="button" class="btn-start-blitz-chip btn-secondary" data-sector="LIMPEZA" style="width: 100%; padding: 7px 8px; font-size: 0.76rem; font-weight: 800; justify-content: center;">
                🧹 PRODUTOS DE LIMPEZA
              </button>
            </div>
          ` : `
            <!-- Setores Prioritários de Ana Luiza -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
              <button type="button" class="btn-start-blitz-chip btn-secondary active" data-sector="MERCEARIA" style="padding: 9px 8px; font-size: 0.82rem; font-weight: 900; justify-content: center; border-color: #a855f7; background: rgba(168, 85, 247, 0.2); color: #c084fc;">
                🥫 MERCEARIA
              </button>
              <button type="button" class="btn-start-blitz-chip btn-secondary" data-sector="BEBIDAS" style="padding: 9px 8px; font-size: 0.82rem; font-weight: 900; justify-content: center;">
                🍾 BEBIDAS
              </button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 8px;">
              <button type="button" class="btn-start-blitz-chip btn-secondary" data-sector="ALHO" style="padding: 7px 4px; font-size: 0.74rem; font-weight: 800; justify-content: center;">🧄 Alho</button>
              <button type="button" class="btn-start-blitz-chip btn-secondary" data-sector="BAZAR" style="padding: 7px 4px; font-size: 0.74rem; font-weight: 800; justify-content: center;">📦 Bazar</button>
            </div>
          `}

          <div style="font-size: 0.7rem; color: #71717a; margin-bottom: 6px;">
            💡 <em>Mercearia é compartilhada entre Ana Luiza e Angélica.</em>
          </div>

          <select id="select-blitz-start-sector" class="form-input" style="font-weight: 800; height: 40px; color: #fbbf24; background: #121214; border-color: #3f3f46;">
            ${SETORS.map(s => `<option value="${s}" ${s === 'MERCEARIA' ? 'selected' : ''}>SETOR: ${s}</option>`).join('')}
            <option value="GERAL">TODOS OS SETORES (GERAL)</option>
          </select>
        </div>

        <!-- 3. PRODUTOS QUE SERÃO CONFERIDOS (LISTAGEM EM MASSA) -->
        <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 10px; padding: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <label for="textarea-start-blitz-mass" style="font-size: 0.78rem; font-weight: 900; color: #34d399; text-transform: uppercase;">
              📦 Produtos a Conferir (Listagem em Massa):
            </label>
            <span id="badge-start-blitz-counter" style="font-size: 0.72rem; color: #10b981; font-weight: 800;">
              0 produtos detectados
            </span>
          </div>

          <p style="font-size: 0.72rem; color: #a1a1aa; margin: 0 0 8px 0; line-height: 1.3;">
            Cole a listagem dos produtos (código e descrição). Ao enviar, a Blitz inicia imediatamente com todos os itens carregados!
          </p>

          <textarea
            id="textarea-start-blitz-mass"
            class="form-input"
            rows="6"
            placeholder="Cole aqui os produtos para a Blitz...&#10;&#10;Exemplo:&#10;7898530843159 - PACOCA DADINHO ZERO QUADRADA 144G - 28/09/26&#10;7897115108805 - PACOCA ROLHA AMENDUPA 1,005KG - 30/09/26&#10;7896065201079 - ACUCAR CRISTAL CORURIPE 5KG - 09/10/26"
            style="font-family: monospace; font-size: 0.82rem; line-height: 1.4; padding: 10px; background: #121214; border-color: #3f3f46; resize: vertical;"
          ></textarea>

          <div style="margin-top: 8px;">
            <input type="file" id="input-file-start-blitz" accept=".txt,.csv" class="hidden" />
            <button type="button" id="btn-upload-start-blitz-file" class="btn-secondary" style="width: 100%; height: 38px; font-size: 0.8rem; font-weight: 800; justify-content: center; gap: 6px; border-color: #3f3f46; background: #18181c; color: #d4d4d8;">
              <span>📁</span> <span>Carregar arquivo pronto (.txt ou .csv)</span>
            </button>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button type="button" id="btn-cancel-start-blitz" class="btn-secondary" style="flex: 1; height: 48px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" id="btn-confirm-start-blitz" class="btn-primary" style="flex: 1.5; height: 48px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 1rem;">
            🚀 INICIAR BLITZ
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');

  const startInput = document.getElementById('input-blitz-start-date');
  const endInput = document.getElementById('input-blitz-end-date');
  const sectorSelect = document.getElementById('select-blitz-start-sector');
  const sectorChips = modal.querySelectorAll('.btn-start-blitz-chip');
  const textarea = document.getElementById('textarea-start-blitz-mass');
  const counterBadge = document.getElementById('badge-start-blitz-counter');
  const fileInput = document.getElementById('input-file-start-blitz');
  const previewLabel = document.getElementById('preview-blitz-period-label');

  // Atualiza o resumo visual do período
  const updatePeriodPreview = () => {
    const s = startInput?.value;
    const e = endInput?.value;
    if (previewLabel && s && e) {
      previewLabel.textContent = `${formatDateBR(s)} até ${formatDateBR(e)}`;
    }
  };
  startInput?.addEventListener('change', updatePeriodPreview);
  endInput?.addEventListener('change', updatePeriodPreview);

  // Contador de produtos em tempo real na textarea
  const updateCount = () => {
    const eDate = endInput?.value || defaultEndISO;
    const parsed = parseBlitzInputList(textarea?.value || '', eDate);
    if (counterBadge) {
      counterBadge.textContent = `${parsed.length} produto${parsed.length === 1 ? '' : 's'} detectado${parsed.length === 1 ? '' : 's'}`;
      counterBadge.style.color = parsed.length > 0 ? '#10b981' : '#a1a1aa';
    }
  };
  textarea?.addEventListener('input', updateCount);
  textarea?.addEventListener('paste', () => setTimeout(updateCount, 50));

  // Carregamento de arquivo .txt ou .csv
  document.getElementById('btn-upload-start-blitz-file')?.addEventListener('click', () => {
    fileInput?.click();
  });

  fileInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target.result || '';
      if (textarea) {
        textarea.value = text;
        updateCount();
      }
      showToast(`Arquivo "${file.name}" carregado!`, 'success', 1500);
    };
    reader.readAsText(file);
  });

  // Interação dos chips de setor
  sectorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const sec = chip.getAttribute('data-sector');
      if (sectorSelect) sectorSelect.value = sec;
      sectorChips.forEach(c => {
        c.classList.remove('active');
        c.style.borderColor = '';
        c.style.background = '';
        c.style.color = '';
      });
      chip.classList.add('active');
      chip.style.borderColor = '#f59e0b';
      chip.style.background = 'rgba(245, 158, 11, 0.2)';
      chip.style.color = '#fbbf24';
    });
  });

  sectorSelect?.addEventListener('change', () => {
    const val = sectorSelect.value;
    sectorChips.forEach(c => {
      if (c.getAttribute('data-sector') === val) {
        c.classList.add('active');
        c.style.borderColor = '#f59e0b';
        c.style.background = 'rgba(245, 158, 11, 0.2)';
        c.style.color = '#fbbf24';
      } else {
        c.classList.remove('active');
        c.style.borderColor = '';
        c.style.background = '';
        c.style.color = '';
      }
    });
  });

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-start-blitz-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-start-blitz')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-start-blitz')?.addEventListener('click', closeModal);

  document.getElementById('form-start-blitz-period')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const sDateRaw = startInput?.value?.trim();
    const eDateRaw = endInput?.value?.trim();
    const chosenSector = sectorSelect?.value?.trim() || 'MERCEARIA';
    const rawList = textarea?.value?.trim() || '';

    if (!sDateRaw || !eDateRaw) {
      showToast('Informe o período da Blitz (Data Inicial e Final)', 'warning');
      return;
    }

    const parsedItems = parseBlitzInputList(rawList, eDateRaw);
    if (parsedItems.length === 0) {
      showToast('Cole a listagem dos produtos a serem conferidos para iniciar', 'warning');
      textarea?.focus();
      return;
    }

    closeModal();
    await startNewBlitzSession(sDateRaw, eDateRaw, chosenSector, [sDateRaw, eDateRaw], parsedItems);
  });
}

// Inicia a sessão com período, setor e listagem em massa informados e abre a tela da Blitz
export async function startNewBlitzSession(startDateInput, endDateInput, sectorInput = 'MERCEARIA', targetDates = [], parsedItems = []) {
  try {
    let sDateISO = startDateInput ? (startDateInput.includes('/') ? parseDateBRtoISO(startDateInput) : String(startDateInput).trim().split('T')[0]) : null;
    let eDateISO = endDateInput ? (endDateInput.includes('/') ? parseDateBRtoISO(endDateInput) : String(endDateInput).trim().split('T')[0]) : null;

    if (!sDateISO || !eDateISO) {
      const today = new Date();
      const next30 = new Date();
      next30.setDate(next30.getDate() + 30);
      sDateISO = sDateISO || today.toISOString().split('T')[0];
      eDateISO = eDateISO || next30.toISOString().split('T')[0];
    }

    const cleanTargetDates = [sDateISO, eDateISO];
    const chosenSector = (sectorInput || 'MERCEARIA').trim().toUpperCase();
    const periodLabel = `${formatDateBR(sDateISO)} até ${formatDateBR(eDateISO)}`;

    showToast(`Iniciando Blitz [${chosenSector}]...`, 'sync', 1000);

    const currentUser = getCurrentUser();
    const effectiveUserId = currentUser?.id || 'ana_luiza';
    const effectiveUserName = currentUser?.name || 'Ana Luiza';

    const session = await createBlitzSession({
      blitz_type: chosenSector,
      sector: chosenSector,
      start_date: sDateISO,
      end_date: eDateISO,
      target_dates: cleanTargetDates,
      period_label: periodLabel,
      user_id: effectiveUserId,
      user_name: effectiveUserName,
      responsible_user_id: effectiveUserId,
      responsible_user_name: effectiveUserName
    });

    // Registra auditoria da criação da Blitz
    try {
      await recordAudit({
        blitz_id: session.id,
        registro_id: session.id,
        tabela: 'blitz_sessions',
        acao: 'CRIACAO_BLITZ',
        usuario: effectiveUserName,
        userId: effectiveUserId,
        userName: effectiveUserName,
        responsible_user_id: effectiveUserId,
        responsible_user_name: effectiveUserName,
        descricao: `Blitz iniciada por ${effectiveUserName} no setor ${chosenSector} (${periodLabel})`
      });
    } catch (_) {}

    // Se foram fornecidos produtos na listagem em massa:
    let importStats = null;
    if (Array.isArray(parsedItems) && parsedItems.length > 0) {
      // 1. Cadastra/atualiza produtos no catálogo
      const bulkPayload = parsedItems.map(p => ({
        barcode: p.ean,
        name: p.nome,
        sector: chosenSector,
        corridor: p.corredor || '',
        expiration_date: p.dataValidade || null
      }));
      await bulkRegisterBlitzProducts({ items: bulkPayload, sector: chosenSector });

      // 2. Vincula à Blitz com histórico de conferências
      importStats = await importBlitzItemsWithHistory(session.id, parsedItems, chosenSector);
    }

    setActiveBlitz(session);

    if (parsedItems && parsedItems.length > 0 && importStats) {
      showToast(`✓ Blitz iniciada com ${parsedItems.length} produtos carregados!`, 'success', 2500);
      showBlitzImportSummaryModal(importStats);
    } else {
      showToast(`✓ Blitz iniciada: Setor ${chosenSector}`, 'success', 2000);
      // Abre diretamente a tela principal da Blitz
      openBlitzDashboardView();
    }
  } catch (err) {
    console.error('Erro ao iniciar Blitz:', err);
    showToast('Erro ao criar sessão da Blitz', 'warning');
  }
}

// Modal para alterar ou definir o setor e período da blitz em andamento
export async function promptEditActiveBlitzPeriod(session) {
  if (!session) {
    session = currentActiveBlitzSession;
  }
  if (!session) {
    showToast('Nenhuma blitz ativa para configurar', 'warning');
    return;
  }

  let modal = document.getElementById('modal-edit-blitz-period');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-edit-blitz-period';
    document.body.appendChild(modal);
  }
  modal.className = 'custom-modal';

  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
  const next30 = new Date();
  next30.setDate(next30.getDate() + 30);
  const next30ISO = next30.toISOString().split('T')[0];

  const currentStart = session.start_date 
    ? (session.start_date.includes('/') ? parseDateBRtoISO(session.start_date) : String(session.start_date).split('T')[0]) 
    : todayISO;
  const currentEnd = session.end_date 
    ? (session.end_date.includes('/') ? parseDateBRtoISO(session.end_date) : String(session.end_date).split('T')[0]) 
    : next30ISO;
  const currentSector = (session.sector || 'MERCEARIA').toUpperCase();

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-edit-blitz-period-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid #27272a; padding-bottom: 10px;">
        <h3 style="font-size: 1.1rem; font-weight: 900; color: #f4f4f5; margin: 0; display: flex; align-items: center; gap: 8px;">
          ⚙️ <span>Configurar Blitz</span>
        </h3>
        <button type="button" id="btn-close-edit-blitz-period" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <p style="font-size: 0.8rem; color: #a1a1aa; margin: 0 0 12px 0;">
        Altere o setor ou as datas da blitz. A alteração é salva imediatamente sem perder os itens já conferidos.
      </p>

      <form id="form-edit-blitz-period" style="display: flex; flex-direction: column; gap: 12px;">
        
        <!-- ALTERAÇÃO DO SETOR DA BLITZ -->
        <div class="form-group" style="margin-bottom: 0;">
          <label style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 6px; display: block;">
            🏷️ Setor da Blitz:
          </label>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
            <button type="button" class="btn-edit-blitz-chip btn-secondary ${currentSector === 'MERCEARIA' ? 'active' : ''}" data-sector="MERCEARIA" style="padding: 8px; font-size: 0.8rem; font-weight: 800; justify-content: center; ${currentSector === 'MERCEARIA' ? 'border-color: #f59e0b; background: rgba(245, 158, 11, 0.2); color: #fbbf24;' : ''}">
              🥫 MERCEARIA
            </button>
            <button type="button" class="btn-edit-blitz-chip btn-secondary ${currentSector === 'BEBIDAS' ? 'active' : ''}" data-sector="BEBIDAS" style="padding: 8px; font-size: 0.8rem; font-weight: 800; justify-content: center; ${currentSector === 'BEBIDAS' ? 'border-color: #f59e0b; background: rgba(245, 158, 11, 0.2); color: #fbbf24;' : ''}">
              🍾 BEBIDAS
            </button>
          </div>

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 6px;">
            <button type="button" class="btn-edit-blitz-chip btn-secondary ${currentSector === 'LIMPEZA' ? 'active' : ''}" data-sector="LIMPEZA" style="padding: 6px 2px; font-size: 0.7rem; font-weight: 700; justify-content: center;">🧹 Limpeza</button>
            <button type="button" class="btn-edit-blitz-chip btn-secondary ${currentSector === 'PERFUMARIA' ? 'active' : ''}" data-sector="PERFUMARIA" style="padding: 6px 2px; font-size: 0.7rem; font-weight: 700; justify-content: center;">🧴 Perfumaria</button>
            <button type="button" class="btn-edit-blitz-chip btn-secondary ${currentSector === 'ALHO' ? 'active' : ''}" data-sector="ALHO" style="padding: 6px 2px; font-size: 0.7rem; font-weight: 700; justify-content: center;">🧄 Alho</button>
            <button type="button" class="btn-edit-blitz-chip btn-secondary ${currentSector === 'BAZAR' ? 'active' : ''}" data-sector="BAZAR" style="padding: 6px 2px; font-size: 0.7rem; font-weight: 700; justify-content: center;">📦 Bazar</button>
          </div>

          <select id="select-edit-blitz-sector" class="form-input" style="font-weight: 800; height: 42px; color: #fbbf24; background: #18181c; border-color: #3f3f46;">
            ${SETORS.map(s => `<option value="${s}" ${s === currentSector ? 'selected' : ''}>SETOR: ${s}</option>`).join('')}
            <option value="GERAL" ${currentSector === 'GERAL' ? 'selected' : ''}>TODOS OS SETORES (GERAL)</option>
          </select>
        </div>

        <div class="form-group" style="margin-bottom: 0;">
          <label for="input-edit-blitz-start" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase;">
            📅 Data Inicial:
          </label>
          <input
            type="date"
            id="input-edit-blitz-start"
            class="form-input form-input-lg"
            value="${currentStart}"
            required
            style="font-size: 1.15rem; font-weight: 800; text-align: center; border-color: #f59e0b; height: 50px; color-scheme: dark; cursor: pointer;"
          />
        </div>

        <div class="form-group" style="margin-bottom: 0;">
          <label for="input-edit-blitz-end" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase;">
            📅 Data Final:
          </label>
          <input
            type="date"
            id="input-edit-blitz-end"
            class="form-input form-input-lg"
            value="${currentEnd}"
            required
            style="font-size: 1.15rem; font-weight: 800; text-align: center; border-color: #f59e0b; height: 50px; color-scheme: dark; cursor: pointer;"
          />
        </div>

        <!-- Atalhos Rápidos -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 2px;">
          <button type="button" class="btn-edit-quick-period btn-secondary" data-preset="month" style="padding: 6px; font-size: 0.72rem; font-weight: 800; justify-content: center;">Este Mês</button>
          <button type="button" class="btn-edit-quick-period btn-secondary" data-preset="30d" style="padding: 6px; font-size: 0.72rem; font-weight: 800; justify-content: center;">+30 Dias</button>
          <button type="button" class="btn-edit-quick-period btn-secondary" data-preset="next_month" style="padding: 6px; font-size: 0.72rem; font-weight: 800; justify-content: center;">Próximo Mês</button>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button type="button" id="btn-cancel-edit-blitz-period" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.2; height: 46px; justify-content: center; background: #f59e0b; color: #000; font-weight: 900; font-size: 0.95rem;">
            💾 SALVAR ALTERAÇÕES
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');

  const startInput = document.getElementById('input-edit-blitz-start');
  const endInput = document.getElementById('input-edit-blitz-end');
  const sectorSelect = document.getElementById('select-edit-blitz-sector');
  const editSectorChips = modal.querySelectorAll('.btn-edit-blitz-chip');

  editSectorChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const sec = chip.getAttribute('data-sector');
      if (sectorSelect) sectorSelect.value = sec;
      editSectorChips.forEach(c => {
        c.classList.remove('active');
        c.style.borderColor = '';
        c.style.background = '';
        c.style.color = '';
      });
      chip.classList.add('active');
      chip.style.borderColor = '#f59e0b';
      chip.style.background = 'rgba(245, 158, 11, 0.2)';
      chip.style.color = '#fbbf24';
    });
  });

  sectorSelect?.addEventListener('change', () => {
    const val = sectorSelect.value;
    editSectorChips.forEach(c => {
      if (c.getAttribute('data-sector') === val) {
        c.classList.add('active');
        c.style.borderColor = '#f59e0b';
        c.style.background = 'rgba(245, 158, 11, 0.2)';
        c.style.color = '#fbbf24';
      } else {
        c.classList.remove('active');
        c.style.borderColor = '';
        c.style.background = '';
        c.style.color = '';
      }
    });
  });

  modal.querySelectorAll('.btn-edit-quick-period').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const now = new Date();
      if (preset === 'month') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        if (startInput) startInput.value = firstDay.toISOString().split('T')[0];
        if (endInput) endInput.value = lastDay.toISOString().split('T')[0];
      } else if (preset === '30d') {
        const end = new Date(now);
        end.setDate(end.getDate() + 30);
        if (startInput) startInput.value = now.toISOString().split('T')[0];
        if (endInput) endInput.value = end.toISOString().split('T')[0];
      } else if (preset === 'next_month') {
        const firstDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        if (startInput) startInput.value = firstDay.toISOString().split('T')[0];
        if (endInput) endInput.value = lastDay.toISOString().split('T')[0];
      }
    });
  });

  const closeModal = () => {
    modal.classList.remove('open');
  };

  document.getElementById('modal-edit-blitz-period-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-edit-blitz-period')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-edit-blitz-period')?.addEventListener('click', closeModal);

  document.getElementById('form-edit-blitz-period')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sDate = startInput?.value?.trim();
    const eDate = endInput?.value?.trim();
    const newSector = sectorSelect?.value?.trim() || session.sector || 'MERCEARIA';

    if (!sDate || !eDate) {
      showToast('Selecione as datas inicial e final no calendário', 'warning');
      return;
    }

    const newLabel = `${formatDateBR(sDate)} → ${formatDateBR(eDate)}`;
    closeModal();
    showToast(`Atualizando Blitz [${newSector}]...`, 'sync', 1000);

    try {
      const updated = await updateBlitzSessionPeriod(session.id, {
        start_date: sDate,
        end_date: eDate,
        period_label: newLabel,
        sector: newSector,
        blitz_type: newSector
      });

      const finalSession = updated || {
        ...session,
        start_date: sDate,
        end_date: eDate,
        period_label: newLabel,
        sector: newSector,
        blitz_type: newSector
      };

      currentActiveBlitzSession = finalSession;
      setActiveBlitz(finalSession);
      showToast(`✓ Blitz atualizada: Setor ${newSector} (${newLabel})`, 'success', 2000);
      await openBlitzDashboardView();
      triggerSyncNow().catch(err => console.warn('Sync error:', err));
    } catch (err) {
      console.error('Erro ao atualizar período da blitz:', err);
      const fallbackSession = {
        ...session,
        start_date: sDate,
        end_date: eDate,
        period_label: newLabel,
        sector: newSector,
        blitz_type: newSector
      };
      currentActiveBlitzSession = fallbackSession;
      setActiveBlitz(fallbackSession);
      showToast(`✓ Blitz atualizada: Setor ${newSector}`, 'success', 2000);
      await openBlitzDashboardView();
    }
  });
}

// ----------------------------------------------------
// 2. TELA DA BLITZ (SIMPLES, RÁPIDA E SEM POLUIÇÃO)
// ----------------------------------------------------

export async function openBlitzDashboardView() {
  if (!currentActiveBlitzSession) {
    promptStartBlitz();
    return;
  }

  const session = await getBlitzSessionById(currentActiveBlitzSession.id) || currentActiveBlitzSession;
  currentActiveBlitzSession = session;

  // Auto-reparo prévio para normalizar quaisquer itens antigos gravados com undefined
  try {
    await repairBlitzSessionData(session.id);
  } catch (_) {}

  // Busca métricas completas de ritmo, progresso e conferência
  const metrics = await calculateBlitzPaceMetrics(session.id);
  const items = await getBlitzItemsBySessionId(session.id);
  const sessionListItems = await getSessionBlitzItems(session.id);

  let periodLabel = session.period_label;
  if (!periodLabel || periodLabel.includes('--/--/----') || periodLabel === 'Geral') {
    if (session.start_date && session.end_date) {
      periodLabel = `${formatDateBR(session.start_date)} até ${formatDateBR(session.end_date)}`;
    }
  }
  const hasValidPeriod = Boolean(periodLabel && !periodLabel.includes('--/--/----') && periodLabel !== 'Geral');

  const container = document.getElementById('view-blitz-dashboard');
  if (!container) return;

  const totalCount = sessionListItems.length > 0 ? sessionListItems.length : metrics.total;
  const jaConferidosCount = sessionListItems.filter(i => i.had_quantity_previously === true || i.had_zero_previously === true || (Number(i.previous_quantity) || 0) > 0 || (Array.isArray(i.previous_history) && i.previous_history.length > 0) || (i.is_new_product === false)).length;
  const novosCount = sessionListItems.filter(i => i.is_new_product === true).length;
  const startTimeFormatted = session.started_at
    ? new Date(session.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : '--:--';

  container.innerHTML = `
    <header class="app-top-bar" style="background: #121216; border-bottom: 1px solid #27272e; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between;">
      <button type="button" id="btn-blitz-dash-back" class="btn-back" style="color: #a1a1aa; font-weight: 700; font-size: 0.88rem; background: none; border: none; cursor: pointer;">
        ← Início
      </button>
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 9999px; background: #10b981; box-shadow: 0 0 8px #10b981;"></span>
        <span class="top-bar-title" style="font-weight: 900; font-size: 0.95rem; color: #f4f4f5; letter-spacing: 0.5px;">BLITZ ATIVA</span>
      </div>
      <button type="button" id="btn-blitz-dash-history" class="btn-icon-link" style="color: #38bdf8; font-weight: 800; font-size: 0.82rem; background: none; border: none; cursor: pointer;">
        📋 Histórico
      </button>
    </header>

    <main style="padding: 14px 12px 40px; max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px;">
      
      <!-- Card Principal da Blitz Ativa -->
      <div style="background: #141418; border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 14px; padding: 16px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <h2 style="font-size: 1.12rem; font-weight: 900; color: #ffffff; margin: 0; letter-spacing: 0.3px;">
                BLITZ OFICIAL
              </h2>
              <span style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.5); color: #fbbf24; font-size: 0.72rem; font-weight: 900; padding: 3px 8px; border-radius: 6px; text-transform: uppercase;">
                🏷️ ${session.sector || 'GERAL'}
              </span>
            </div>
            <div style="font-size: 0.84rem; font-weight: 800; color: #fbbf24; margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span>📅 Período: <strong id="blitz-active-period-text" style="cursor: pointer; text-decoration: underline dotted;">${hasValidPeriod ? periodLabel : '<span style="color: #ef4444; font-weight: 900;">Não Definido</span>'}</strong></span>
              <button type="button" id="btn-edit-active-blitz-period" style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; padding: 3px 8px; border-radius: 6px; font-size: 0.72rem; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                ✏️ Alterar
              </button>
            </div>
          </div>
          <span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.7rem; font-weight: 900; padding: 3px 8px; border-radius: 9999px; white-space: nowrap;">
            ● EM ANDAMENTO
          </span>
        </div>

        <!-- Barra de Progresso Visual e Ritmo da Conferência -->
        <div style="background: #1a1a20; border: 1px solid #27272f; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; font-weight: 800;">
            <span style="color: #f4f4f5;">Progresso: <strong style="color: #38bdf8;">${metrics.conferidos}</strong> de <strong>${totalCount}</strong> itens</span>
            <span style="background: rgba(16, 185, 129, 0.2); color: #34d399; padding: 2px 8px; border-radius: 6px; font-size: 0.84rem; font-weight: 900;">${metrics.percentual}%</span>
          </div>
          <div style="height: 9px; border-radius: 6px; background: #27272f; overflow: hidden; width: 100%;">
            <div style="height: 100%; width: ${metrics.percentual}%; background: linear-gradient(90deg, #10b981, #34d399); transition: width 0.3s; border-radius: 6px;"></div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #a1a1aa; flex-wrap: wrap; gap: 6px;">
            <span>⚡ Ritmo: <strong style="color: ${metrics.ritmoCor};">${metrics.ritmoLabel}</strong> (${metrics.itensPorHora} itens/h)</span>
            <span>Previsão: <strong style="color: #fef08a;">${metrics.previsaoTermino}</strong></span>
          </div>
        </div>

        <div style="font-size: 0.74rem; color: #71717a; border-top: 1px solid #22222a; padding-top: 8px; display: flex; justify-content: space-between; align-items: center;">
          <span>Auditora: <strong style="color: #d4d4d8;">${session.responsible_user_name || session.user_name || 'Ana Luiza'}</strong></span>
          <span>Iniciada às <strong style="color: #d4d4d8;">${startTimeFormatted}</strong></span>
        </div>
      </div>

      <!-- BOTÃO GIGANTE: BIPAR PRODUTO -->
      <button type="button" id="btn-blitz-big-scan" class="btn-primary" style="
        height: 56px;
        font-size: 1.05rem;
        font-weight: 900;
        justify-content: center;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: #ffffff;
        border: none;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.35);
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        letter-spacing: 0.3px;
      ">
        <span style="font-size: 1.4rem;">📷</span>
        <span>BIPAR COM A CÂMERA</span>
      </button>

      <!-- Entrada Manual Rápida de Código de Barras -->
      <form id="form-blitz-manual-bip" style="display: flex; gap: 6px;">
        <input
          type="text"
          id="input-blitz-manual-code"
          class="form-input"
          placeholder="🏷️ Digitar código de barras ou bipar leitor..."
          style="height: 44px; font-size: 0.88rem; flex: 1; background: #18181d; border: 1px solid #33333d; border-radius: 8px; color: #f4f4f5; padding: 0 12px;"
        />
        <button type="submit" class="btn-secondary" style="height: 44px; font-weight: 900; font-size: 0.84rem; padding: 0 16px; white-space: nowrap; background: #272730; border: 1px solid #3f3f4e; color: #fbbf24; border-radius: 8px; cursor: pointer;">
          ➔ Bipar
        </button>
      </form>

      <!-- PAINEL DE AÇÕES COMPLEMENTARES -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
        <button type="button" id="btn-blitz-dash-mass-register" class="btn-secondary" style="height: 42px; font-size: 0.74rem; font-weight: 800; justify-content: center; padding: 0 4px; text-align: center; background: #191920; border: 1px solid #2d2d38; color: #e4e4e7; border-radius: 8px; cursor: pointer;">
          📥 + Produtos
        </button>
        <button type="button" id="btn-blitz-dash-exported" class="btn-secondary" style="height: 42px; font-size: 0.74rem; font-weight: 800; justify-content: center; padding: 0 4px; text-align: center; background: #191920; border: 1px solid #2d2d38; color: #e4e4e7; border-radius: 8px; cursor: pointer;">
          📋 Exportados
        </button>
        <button type="button" id="btn-blitz-dash-what-changed" class="btn-secondary" style="height: 42px; font-size: 0.74rem; font-weight: 800; justify-content: center; padding: 0 4px; text-align: center; color: #fbbf24; background: #191920; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 8px; cursor: pointer;">
          📊 O Que Mudou
        </button>
        <button type="button" id="btn-blitz-export-wa-active" class="btn-secondary" style="height: 42px; font-size: 0.74rem; font-weight: 800; justify-content: center; padding: 0 4px; text-align: center; color: #25d366; background: #191920; border: 1px solid rgba(37, 211, 102, 0.4); border-radius: 8px; cursor: pointer;">
          💬 WhatsApp
        </button>
      </div>

      <!-- CONTADORES DA BLITZ -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
        <div style="background: #16161b; border: 1px solid #272730; border-radius: 10px; padding: 10px 4px; text-align: center;">
          <div style="font-size: 0.65rem; color: #a1a1aa; font-weight: 800; text-transform: uppercase;">Total</div>
          <div id="stat-total-count" style="font-size: 1.3rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">
            ${totalCount}
          </div>
        </div>

        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 10px; padding: 10px 4px; text-align: center;">
          <div style="font-size: 0.65rem; color: #34d399; font-weight: 800; text-transform: uppercase;">🟢 Com Qtd</div>
          <div id="stat-com-qtd" style="font-size: 1.3rem; font-weight: 900; color: #34d399; margin-top: 2px;">
            ${metrics.comQtd}
          </div>
        </div>

        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 10px; padding: 10px 4px; text-align: center;">
          <div style="font-size: 0.65rem; color: #f87171; font-weight: 800; text-transform: uppercase;">🔴 Zerados</div>
          <div id="stat-zerados" style="font-size: 1.3rem; font-weight: 900; color: #f87171; margin-top: 2px;">
            ${metrics.zerados}
          </div>
        </div>

        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 10px; padding: 10px 4px; text-align: center;">
          <div style="font-size: 0.65rem; color: #fbbf24; font-weight: 800; text-transform: uppercase;">⏳ Pendentes</div>
          <div id="stat-pendentes" style="font-size: 1.3rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">
            ${metrics.pendentes}
          </div>
        </div>
      </div>

      <!-- BOTÃO PARA FINALIZAR BLITZ -->
      <button type="button" id="btn-blitz-finish-session" class="btn-primary" style="height: 48px; font-size: 0.95rem; font-weight: 900; justify-content: center; background: #f59e0b; color: #000000; border: none; border-radius: 10px; cursor: pointer; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);">
        🏁 FINALIZAR BLITZ
      </button>

      <!-- ABAS DE FILTRAGEM -->
      <div style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; margin-top: 4px; scrollbar-width: none;">
        <button type="button" class="btn-filter-pill active" data-filter="TODOS" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #f59e0b; color: #000; border: none; white-space: nowrap; cursor: pointer;">
          Todos (${totalCount})
        </button>
        <button type="button" class="btn-filter-pill" data-filter="PENDENTES" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #272730; color: #a1a1aa; border: none; white-space: nowrap; cursor: pointer;">
          ⏳ Pendentes (${metrics.pendentes})
        </button>
        <button type="button" class="btn-filter-pill" data-filter="CONFERIDOS" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #272730; color: #a1a1aa; border: none; white-space: nowrap; cursor: pointer;">
          ✅ Conferidos (${metrics.conferidos})
        </button>
        <button type="button" class="btn-filter-pill" data-filter="COM_QTD" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #272730; color: #a1a1aa; border: none; white-space: nowrap; cursor: pointer;">
          🟢 Com Qtd (${metrics.comQtd})
        </button>
        <button type="button" class="btn-filter-pill" data-filter="ZERADOS" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #272730; color: #a1a1aa; border: none; white-space: nowrap; cursor: pointer;">
          🔴 Zerados (${metrics.zerados})
        </button>
        <button type="button" class="btn-filter-pill" data-filter="JA_CONFERIDOS" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #272730; color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); white-space: nowrap; cursor: pointer;">
          📋 Já Conferidos (${jaConferidosCount})
        </button>
        <button type="button" class="btn-filter-pill" data-filter="NOVOS" style="padding: 7px 14px; font-size: 0.76rem; font-weight: 800; border-radius: 9999px; background: #272730; color: #34d399; border: 1px solid rgba(52, 211, 153, 0.4); white-space: nowrap; cursor: pointer;">
          🆕 Produtos Novos (${novosCount})
        </button>
      </div>

      <!-- LISTA DE ITENS DA BLITZ -->
      <div style="background: #141418; border: 1px solid #27272e; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 4px;">
          <span id="blitz-list-header-title" style="font-size: 0.82rem; font-weight: 900; color: #ffffff; text-transform: uppercase; letter-spacing: 0.5px;">
            ITENS DA BLITZ (${totalCount})
          </span>
          <span style="font-size: 0.72rem; color: #a1a1aa;">Toque para bipar ou editar</span>
        </div>

        <!-- Barra de busca rápida em tempo real -->
        <div style="position: relative;">
          <input
            type="text"
            id="input-search-blitz-list"
            placeholder="🔍 Buscar por nome ou código de barras..."
            style="width: 100%; height: 38px; background: #1c1c22; border: 1px solid #33333e; border-radius: 8px; padding: 0 12px; font-size: 0.82rem; color: #f4f4f5; outline: none;"
          />
        </div>

        <div id="blitz-session-items-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 520px; overflow-y: auto; padding-right: 2px;">
          <!-- Itens renderizados dinamicamente -->
        </div>
      </div>

      <!-- Opção secundária: Cancelar -->
      <div style="text-align: center; margin-top: 4px; margin-bottom: 20px;">
        <button type="button" id="btn-blitz-cancel-secondary" style="background: none; border: none; color: #ef4444; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 6px;">
          Cancelar esta Blitz
        </button>
      </div>

    </main>
  `;

  showView('view-blitz-dashboard');

  // Event Listeners
  document.getElementById('btn-blitz-dash-back')?.addEventListener('click', () => {
    showView('view-dashboard');
  });

  document.getElementById('btn-blitz-dash-history')?.addEventListener('click', () => {
    openBlitzHistoryView();
  });

  document.getElementById('btn-blitz-dash-mass-register')?.addEventListener('click', () => {
    openBlitzMassRegisterModal(session.sector || 'MERCEARIA');
  });

  document.getElementById('btn-blitz-dash-exported')?.addEventListener('click', () => {
    openExportedBlitzProductsModal(session.id);
  });

  document.getElementById('btn-blitz-dash-what-changed')?.addEventListener('click', () => {
    openWhatChangedModal(session.id);
  });

  document.getElementById('btn-edit-active-blitz-period')?.addEventListener('click', () => {
    promptEditActiveBlitzPeriod(session);
  });

  document.getElementById('blitz-active-period-text')?.addEventListener('click', () => {
    promptEditActiveBlitzPeriod(session);
  });

  document.getElementById('btn-blitz-big-scan')?.addEventListener('click', () => {
    startBlitzScanning();
  });

  // Bipar manual
  document.getElementById('form-blitz-manual-bip')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const codeInput = document.getElementById('input-blitz-manual-code');
    const code = codeInput?.value?.trim();
    if (code) {
      codeInput.value = '';
      await handleBlitzBarcodeScanned(code);
    }
  });

  document.getElementById('btn-blitz-export-wa-active')?.addEventListener('click', async () => {
    const formatted = await formatBlitzSessionWhatsApp(session, items);
    openWhatsAppExportModal(formatted, `Blitz ${periodLabel}`);
  });

  document.getElementById('btn-blitz-finish-session')?.addEventListener('click', async () => {
    await finishActiveBlitzSession(session.id);
  });

  document.getElementById('btn-blitz-cancel-secondary')?.addEventListener('click', async () => {
    await cancelActiveBlitzSession(session.id);
  });

  // Alternância de filtros
  let currentFilter = 'TODOS';
  let currentSearch = '';

  const searchInput = document.getElementById('input-search-blitz-list');
  searchInput?.addEventListener('input', async (e) => {
    currentSearch = e.target.value || '';
    await renderBlitzSessionItemsListFiltered(session, currentFilter, currentSearch);
  });

  container.querySelectorAll('.btn-filter-pill').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.btn-filter-pill').forEach(b => {
        b.style.background = '#272730';
        b.style.color = '#a1a1aa';
      });
      btn.style.background = '#f59e0b';
      btn.style.color = '#000';
      currentFilter = btn.getAttribute('data-filter') || 'TODOS';
      await renderBlitzSessionItemsListFiltered(session, currentFilter, currentSearch);
    });
  });

  await renderBlitzSessionItemsListFiltered(session, currentFilter, currentSearch);
}

// Renderiza a lista filtrada de itens da Blitz
async function renderBlitzSessionItemsListFiltered(session, filter = 'TODOS', searchQuery = '') {
  const container = document.getElementById('blitz-session-items-list');
  if (!container) return;

  const sessionItems = await getSessionBlitzItems(session.id);
  const conferences = await getBlitzItemsBySessionId(session.id);

  // Mapeia conferências por (barcode + data) para conferência rápida
  const confMap = new Map();
  conferences.forEach(c => {
    const b = String(c.barcode || c.ean || '').trim();
    const d = String(c.requested_expiration_date || c.data_validade || '').trim();
    if (b) {
      confMap.set(`${b}_${d}`, c);
      confMap.set(b, c);
    }
  });

  let itemsToRender = [];

  if (sessionItems.length > 0) {
    itemsToRender = sessionItems.map(it => {
      const barcode = String(it.ean || it.barcode || '').trim();
      const expDate = String(it.data_validade || it.requested_expiration_date || '').trim();
      const conf = confMap.get(`${barcode}_${expDate}`) || confMap.get(barcode);

      const isConferred = it.status === 'CONFERIDO' || it.status === 'conferido' || Boolean(conf) || Boolean(it.conferido_em);
      const qty = conf ? (Number(conf.total_quantity) || 0) : (Number(it.total_quantity || it.quantidade) || 0);
      const result = conf ? conf.result : (qty > 0 ? 'TEM' : (isConferred ? 'NAO_TEM' : 'PENDENTE'));

      return {
        ...it,
        ean: barcode,
        barcode: barcode,
        data_validade: expDate,
        requested_expiration_date: expDate,
        isConferred,
        total_quantity: qty,
        result,
        conferencia_id: conf?.id || it.id,
        checked_at: conf?.checked_at || it.conferido_em || it.created_at
      };
    });
  } else {
    itemsToRender = conferences.map(c => {
      const barcode = String(c.barcode || c.ean || '').trim();
      const expDate = String(c.requested_expiration_date || c.data_validade || '').trim();
      return {
        ...c,
        ean: barcode,
        barcode: barcode,
        isConferred: true,
        data_validade: expDate,
        requested_expiration_date: expDate,
        total_quantity: Number(c.total_quantity) || 0,
        result: c.result || ((Number(c.total_quantity) || 0) > 0 ? 'TEM' : 'NAO_TEM')
      };
    });
  }

  // Aplica filtro selecionado
  if (filter === 'PENDENTES') {
    itemsToRender = itemsToRender.filter(i => !i.isConferred);
  } else if (filter === 'CONFERIDOS') {
    itemsToRender = itemsToRender.filter(i => i.isConferred);
  } else if (filter === 'COM_QTD') {
    itemsToRender = itemsToRender.filter(i => i.isConferred && (Number(i.total_quantity) || 0) > 0);
  } else if (filter === 'ZERADOS') {
    itemsToRender = itemsToRender.filter(i => i.isConferred && (Number(i.total_quantity) || 0) === 0);
  } else if (filter === 'JA_CONFERIDOS') {
    itemsToRender = itemsToRender.filter(i => i.had_quantity_previously === true || i.had_zero_previously === true || (Number(i.previous_quantity) || 0) > 0 || (Array.isArray(i.previous_history) && i.previous_history.length > 0) || (i.is_new_product === false));
  } else if (filter === 'NOVOS') {
    itemsToRender = itemsToRender.filter(i => i.is_new_product === true);
  }

  // Aplica busca por texto em tempo real (se houver)
  const cleanSearch = String(searchQuery || '').trim().toLowerCase();
  if (cleanSearch) {
    itemsToRender = itemsToRender.filter(it => {
      const b = String(it.barcode || it.ean || '').toLowerCase();
      const n = String(it.nome_produto || it.nome || it.descricao || it.name || '').toLowerCase();
      return b.includes(cleanSearch) || n.includes(cleanSearch);
    });
  }

  const headerTitle = document.getElementById('blitz-list-header-title');
  if (headerTitle) {
    headerTitle.textContent = `ITENS DA BLITZ (${itemsToRender.length}${cleanSearch ? ' filtrados' : ''})`;
  }

  if (itemsToRender.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: #71717a; font-size: 0.85rem; background: #17171c; border-radius: 8px; border: 1px dashed #272730;">
        ${cleanSearch
          ? `Nenhum produto encontrado para "<strong>${cleanSearch}</strong>".`
          : `Nenhum item nesta categoria.<br>Toque em <strong>📷 BIPAR COM A CÂMERA</strong> para conferir.`}
      </div>
    `;
    return;
  }

  // Ordena itens: pendentes primeiro para facilitar conferência rápida
  itemsToRender.sort((a, b) => {
    if (a.isConferred !== b.isConferred) {
      return a.isConferred ? 1 : -1;
    }
    return new Date(b.checked_at || 0) - new Date(a.checked_at || 0);
  });

  const cardsHtml = await Promise.all(itemsToRender.map(async (item) => {
    const barcode = String(item.ean || item.barcode || '').trim();
    const prodId = item.produto_id || item.product_id;

    let prod = null;
    if (prodId) {
      prod = await getProductById(prodId);
    }
    if (!prod && barcode && barcode !== 'undefined') {
      prod = await getProductByBarcode(barcode);
    }

    // Resolução segura e limpa do nome do produto (sem undefined)
    let rawName = String(item.nome_produto || item.nome || item.descricao || item.name || '').trim();
    if (rawName.includes('undefined')) {
      rawName = '';
    }

    let name = rawName;
    if (!name || name.startsWith('PRODUTO ')) {
      if (prod?.name && !prod.name.includes('undefined')) {
        name = prod.name;
      }
    }
    if (!name && barcode && barcode !== 'undefined') {
      name = `PRODUTO ${barcode}`;
    }
    if (!name) {
      name = 'PRODUTO EM CONFERÊNCIA';
    }

    const expDate = item.data_validade || item.requested_expiration_date;
    const dateFormatted = expDate ? formatDateBR(expDate) : '--/--/----';
    const isConferred = Boolean(item.isConferred);
    const isTem = item.result === 'TEM' || (Number(item.total_quantity) || 0) > 0;
    const qty = Number(item.total_quantity) || 0;
    const corridor = prod?.corridor || item.corredor || item.corridor || '';

    // Smart tags de controle
    let tagHtml = '';
    if (item.tinha_na_blitz_anterior === true && isConferred && qty === 0) {
      tagHtml = `<span style="font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.2); color: #fca5a5;">🔻 Zerou</span>`;
    } else if (item.tinha_na_blitz_anterior === false && isConferred && qty > 0) {
      tagHtml = `<span style="font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.2); color: #7dd3fc;">⚠️ Voltou a ter</span>`;
    }

    // Histórico de conferências anteriores ou produto novo
    let historyBadgeHtml = '';
    if (item.had_quantity_previously === true || (Number(item.previous_quantity) || 0) > 0) {
      const prevQty = Number(item.previous_quantity) || 0;
      historyBadgeHtml = `<span style="font-size: 0.66rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35);">📋 Anterior: ${prevQty} un</span>`;
    } else if (item.had_zero_previously === true) {
      historyBadgeHtml = `<span style="font-size: 0.66rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35);">📋 Anterior: 0 un</span>`;
    } else if (item.is_new_product === true) {
      historyBadgeHtml = `<span style="font-size: 0.66rem; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.35);">🆕 Novo</span>`;
    }

    const displayBarcode = (barcode && barcode !== 'undefined') ? barcode : 'S/ CÓDIGO';
    let photoUrl = prod?.image || prod?.photo_url || item.foto_url || item.photo_proof;
    if (!photoUrl && (prodId || (barcode && barcode !== 'undefined'))) {
      try {
        const dbPhoto = await getProductPhotoFromDb(prodId, barcode);
        if (dbPhoto) photoUrl = dbPhoto;
      } catch (_) {}
    }

    return `
      <div class="blitz-item-card-row" data-id="${item.id}" data-barcode="${barcode}" data-date="${expDate || ''}" data-conferred="${isConferred}" style="
        background: #18181e;
        border: 1px solid ${!isConferred ? '#2a2a35' : isTem ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'};
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        cursor: pointer;
        transition: transform 0.1s ease, border-color 0.2s ease, background 0.2s ease;
      ">
        <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
          <div style="flex-shrink: 0;">
            ${renderProductPhotoHtml(photoUrl, name, { size: 52, rounded: '8px' })}
          </div>
          <div style="flex: 1; min-width: 0;">
            <!-- Linha superior de status e validade -->
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px; flex-wrap: wrap;">
              ${!isConferred ? `
                <span style="font-size: 0.68rem; font-weight: 900; padding: 2px 7px; border-radius: 9999px; background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);">
                  ⏳ PENDENTE
                </span>
              ` : isTem ? `
                <span style="font-size: 0.68rem; font-weight: 900; padding: 2px 7px; border-radius: 9999px; background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);">
                  ✓ TEM (${formatNumber(qty)} un)
                </span>
              ` : `
                <span style="font-size: 0.68rem; font-weight: 900; padding: 2px 7px; border-radius: 9999px; background: rgba(239, 68, 68, 0.18); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35);">
                  ✕ ZERADO
                </span>
              `}
              <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; background: #22222a; padding: 2px 7px; border-radius: 5px; border: 1px solid #333340;">
                📅 Val: ${dateFormatted}
              </span>
              ${tagHtml}
              ${historyBadgeHtml}
            </div>

            <!-- Nome do produto com alto contraste e legibilidade -->
            <div style="font-size: 0.92rem; font-weight: 800; color: #ffffff; line-height: 1.35; margin: 2px 0 3px 0; word-break: break-word;">
              ${name}
            </div>

            <!-- Metadados: Código de barras e corredor -->
            <div style="font-size: 0.72rem; color: #a1a1aa; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-family: monospace; background: #121216; padding: 1px 6px; border-radius: 4px; border: 1px solid #282832; color: #d4d4d8;">
                🏷️ ${displayBarcode}
              </span>
              ${corridor ? `<span style="color: #38bdf8; font-weight: 700;">📍 ${corridor}</span>` : ''}
            </div>
          </div>
        </div>

        <!-- Ação do lado direito: Bipar ou Editar quantidade -->
        <div style="text-align: right; flex-shrink: 0;">
          ${!isConferred ? `
            <span style="font-size: 0.78rem; font-weight: 900; color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); padding: 6px 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">
              ⚡ Bipar ➔
            </span>
          ` : `
            <span style="font-size: 0.95rem; font-weight: 900; color: ${isTem ? '#34d399' : '#f87171'}; background: ${isTem ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)'}; border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.35)'}; padding: 6px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;">
              ${isTem ? `${formatNumber(qty)} un` : '0 un'} ✏️
            </span>
          `}
        </div>
      </div>
    `;
  }));

  container.innerHTML = cardsHtml.join('');

  // Adiciona click nos cards para abrir edição rápida ou conferir
  container.querySelectorAll('.blitz-item-card-row').forEach(row => {
    row.addEventListener('click', async () => {
      const barcode = row.getAttribute('data-barcode');
      const isConferred = row.getAttribute('data-conferred') === 'true';
      const dateISO = row.getAttribute('data-date');
      const itemObj = itemsToRender.find(i => i.barcode === barcode && (i.data_validade === dateISO || i.requested_expiration_date === dateISO));

      if (isConferred && itemObj) {
        // Se já conferido -> abre correção auditada
        promptCorrectBlitzItemQuantity(itemObj, session, () => {
          renderBlitzSessionItemsListFiltered(session, filter, searchQuery);
        });
      } else {
        // Se pendente -> bipa ou abre a conferência diretamente
        if (barcode && barcode !== 'undefined') {
          await handleBlitzBarcodeScanned(barcode);
        } else if (itemObj) {
          showToast('Produto sem código de barras registrado', 'warning');
        }
      }
    });
  });
}

// Renderiza a lista simplificada de itens da Blitz
async function renderBlitzSessionItemsList(items) {
  if (currentActiveBlitzSession) {
    await renderBlitzSessionItemsListFiltered(currentActiveBlitzSession, 'TODOS');
  }
}

// ----------------------------------------------------
// 3. SCANNER NO MODO BLITZ
// ----------------------------------------------------

export function startBlitzScanning() {
  if (!currentActiveBlitzSession) {
    promptStartBlitz();
    return;
  }
  showView('view-scanner');
  updateBlitzTopBarIndicator();
  window.dispatchEvent(new CustomEvent('start-scanner-trigger', { detail: { mode: 'BLITZ' } }));
}

// ----------------------------------------------------
// 4. APÓS O BIP: IDENTIFICAÇÃO, CORREDOR E VERIFICAÇÃO DE DATAS
// ----------------------------------------------------

export async function handleBlitzBarcodeScanned(cleanBarcode) {
  if (!currentActiveBlitzSession) {
    return false;
  }

  // Para o scanner temporariamente enquanto a conferência está na tela
  stopCameraScanner();
  showToast(`Código: ${cleanBarcode}`, 'info', 800);

  // 1. Pesquisa se o produto está cadastrado no banco
  let product = await getProductByBarcode(cleanBarcode);

  if (!product) {
    // Cria produto no banco para não travar o fluxo da Blitz
    const draftId = generateId();
    product = {
      id: draftId,
      barcode: cleanBarcode,
      name: `PRODUTO ${cleanBarcode}`,
      sector: currentActiveBlitzSession?.sector || 'MERCEARIA',
      corridor: '', // Sem corredor inicialmente para produtos novos
      status: 'LISTA_DE_BLITZ',
      is_blitz_import: true,
      origin: 'BLITZ_IMPORT',
      total_quantity: 0
    };
    try {
      await saveProduct(product);
    } catch (_) {}
  }

  // 2. Busca itens na Blitz ativa para este código de barras
  let blitzItems = [];
  try {
    const allItems = await getBlitzItens(currentActiveBlitzSession.id);
    blitzItems = allItems.filter(it => 
      String(it.ean).trim() === cleanBarcode ||
      String(it.barcode || '').trim() === cleanBarcode
    );
  } catch (err) {
    console.warn('Erro ao consultar itens da blitz:', err);
  }

  // SITUAÇÃO A: O produto está na lista da Blitz com UMA única data
  if (blitzItems.length === 1) {
    const item = blitzItems[0];
    const targetDateISO = item.data_validade || item.requested_expiration_date;
    routeProductCorridorAndConference(product, targetDateISO, item);
    return true;
  }

  // SITUAÇÃO B: O produto está na lista com DUAS OU MAIS datas
  if (blitzItems.length > 1) {
    promptBlitzSelectMultipleDates(product, blitzItems);
    return true;
  }

  // SITUAÇÃO C: O produto NÃO está na lista da Blitz
  promptBlitzProductNotInList(product, cleanBarcode);
  return true;
}

/**
 * Roteia a verificação do corredor e prossegue para a conferência
 */
function routeProductCorridorAndConference(product, targetDateISO, blitzItem = null) {
  if (!product.corridor && (blitzItem?.corredor || blitzItem?.corridor)) {
    product.corridor = blitzItem.corredor || blitzItem.corridor;
  }
  const rawCorridor = product.corridor ? String(product.corridor).trim() : '';
  const hasCorridor = rawCorridor !== '' &&
    rawCorridor !== 'null' &&
    rawCorridor !== 'undefined' &&
    rawCorridor !== 'Sem corredor';

  if (!hasCorridor) {
    // Não tem corredor cadastrado: solicita os corredores
    promptSetProductCorridor(product, (updatedProd) => {
      promptBlitzQuantityAndHistoryStep(updatedProd, targetDateISO, blitzItem);
    });
  } else {
    // Já tem corredor cadastrado: vai direto para a conferência sem interromper!
    promptBlitzQuantityAndHistoryStep(product, targetDateISO, blitzItem);
  }
}

/**
 * Confirmação rápida de corredor existente (1 toque para confirmar)
 */
export function promptConfirmCorridor(product, targetDateISO, blitzItem = null) {
  let modal = document.getElementById('modal-blitz-confirm-corridor');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-confirm-corridor';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const corridorName = product.corridor || 'Corredor 1';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-confirm-corridor-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box; text-align: center;">
      <div style="display: flex; justify-content: center; margin-bottom: 8px;">
        ${renderProductPhotoHtml(product.image || product.photo_url || blitzItem?.foto_url, product.name, { size: 68, rounded: '10px' })}
      </div>
      <h3 style="font-size: 1.1rem; font-weight: 900; color: #f4f4f5; margin: 0 0 6px 0;">
        CONFIRMAR CORREDOR
      </h3>
      <div style="font-size: 0.95rem; color: #f4f4f5; font-weight: 800; line-height: 1.4; margin-bottom: 12px;">
        ${product.name}
      </div>
      <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px solid #10b981; border-radius: 10px; padding: 14px; margin-bottom: 16px;">
        <div style="font-size: 0.82rem; color: #a7f3d0; font-weight: 700;">Já tenho esse produto no:</div>
        <div style="font-size: 1.4rem; font-weight: 900; color: #34d399; margin: 4px 0;">
          ${corridorName}
        </div>
        <div style="font-size: 0.8rem; color: #e4e4e7;">Está certo?</div>
      </div>

      <div style="display: flex; gap: 10px;">
        <button type="button" id="btn-alter-corridor" class="btn-secondary" style="flex: 1; height: 50px; justify-content: center; font-weight: 800; border-radius: 8px;">
          ✏️ Alterar
        </button>
        <button type="button" id="btn-confirm-corridor-ok" class="btn-primary" style="flex: 1.5; height: 50px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 1rem; border-radius: 8px;">
          ✓ Sim, confirmar
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-confirm-corridor-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-confirm-corridor-ok')?.addEventListener('click', () => {
    triggerHaptic(30);
    closeModal();
    promptBlitzQuantityAndHistoryStep(product, targetDateISO, blitzItem);
  });

  document.getElementById('btn-alter-corridor')?.addEventListener('click', () => {
    closeModal();
    promptSetProductCorridor(product, (updatedProd) => {
      promptBlitzQuantityAndHistoryStep(updatedProd, targetDateISO, blitzItem);
    });
  });
}

/**
 * SITUAÇÃO B: Produto com 2 ou mais datas nesta Blitz
 */
export function promptBlitzSelectMultipleDates(product, blitzItems) {
  let modal = document.getElementById('modal-blitz-select-multiple-dates');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-select-multiple-dates';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-select-mult-dates-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <h3 style="font-size: 1.05rem; font-weight: 900; color: #fbbf24; margin: 0; display: flex; align-items: center; gap: 6px;">
          <span>📅</span> <span>ESCOLHA A VALIDADE</span>
        </h3>
        <button type="button" id="btn-close-mult-dates" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 0.95rem; font-weight: 900; color: #f4f4f5; line-height: 1.3;">
          ${product.name}
        </div>
        <div style="font-size: 0.75rem; color: #a1a1aa; margin-top: 4px;">
          Código: <strong style="color: #fbbf24;">${product.barcode}</strong> • Setor: <strong>${product.sector || 'MERCEARIA'}</strong>
        </div>
      </div>

      <div style="font-size: 0.84rem; color: #e4e4e7; font-weight: 700; margin-bottom: 10px;">
        Existem <strong>${blitzItems.length} datas</strong> para este produto nesta Blitz. Qual validade você está conferindo agora?
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; max-height: 280px; overflow-y: auto; margin-bottom: 12px;">
        ${blitzItems.map(item => {
          const dateISO = item.data_validade || item.requested_expiration_date;
          const isConferido = item.status === 'CONFERIDO';
          const qty = Number(item.total_quantity != null ? item.total_quantity : item.quantidade) || 0;
          return `
            <button type="button" class="btn-select-blitz-date-item btn-secondary" data-date="${dateISO}" data-item-id="${item.id}" style="height: 54px; padding: 0 14px; display: flex; align-items: center; justify-content: space-between; border-radius: 8px; border-color: ${isConferido ? 'rgba(16, 185, 129, 0.4)' : '#3f3f46'};">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1.15rem; font-weight: 900; color: #fbbf24; font-family: monospace;">
                  ${formatDateBR(dateISO)}
                </span>
              </div>
              <div>
                ${isConferido
                  ? `<span style="font-size: 0.74rem; font-weight: 800; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; padding: 2px 8px; border-radius: 6px;">✓ CONFERIDO (${qty} un)</span>`
                  : `<span style="font-size: 0.74rem; font-weight: 800; background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid #f59e0b; padding: 2px 8px; border-radius: 6px;">⏳ PENDENTE</span>`
                }
              </div>
            </button>
          `;
        }).join('')}
      </div>

      <button type="button" id="btn-cancel-mult-dates" class="btn-secondary" style="width: 100%; height: 46px; justify-content: center; font-weight: 800; border-radius: 8px;">
        Voltar para a Câmera
      </button>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-select-mult-dates-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-mult-dates')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });
  document.getElementById('btn-cancel-mult-dates')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  modal.querySelectorAll('.btn-select-blitz-date-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const chosenDate = btn.getAttribute('data-date');
      const itemId = btn.getAttribute('data-item-id');
      const chosenItem = blitzItems.find(it => it.id === itemId) || blitzItems.find(it => it.data_validade === chosenDate);
      triggerHaptic(30);
      closeModal();
      routeProductCorridorAndConference(product, chosenDate, chosenItem);
    });
  });
}

/**
 * SITUAÇÃO C: Produto não está na lista da Blitz atual
 */
export function promptBlitzProductNotInList(product, cleanBarcode) {
  let modal = document.getElementById('modal-blitz-not-in-list');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-not-in-list';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-not-in-list-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box; text-align: center;">
      <div style="font-size: 2.2rem; margin-bottom: 6px;">⚠️</div>
      <h3 style="font-size: 1.1rem; font-weight: 900; color: #fbbf24; margin: 0 0 6px 0;">
        PRODUTO NÃO ESTÁ NA LISTA
      </h3>
      <div style="font-size: 0.95rem; color: #f4f4f5; font-weight: 800; line-height: 1.35; margin-bottom: 12px;">
        ${product.name}
      </div>
      <div style="font-size: 0.78rem; color: #a1a1aa; margin-bottom: 16px;">
        Código: <strong style="color: #fbbf24;">${cleanBarcode}</strong>
      </div>

      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 12px; margin-bottom: 16px; font-size: 0.84rem; color: #fef08a;">
        Este produto não consta na lista importada desta Blitz.<br>
        <strong>Deseja incluir agora?</strong>
      </div>

      <div style="display: flex; gap: 10px;">
        <button type="button" id="btn-skip-not-in-list" class="btn-secondary" style="flex: 1; height: 50px; justify-content: center; font-weight: 800; border-radius: 8px;">
          Não, bipar outro
        </button>
        <button type="button" id="btn-include-in-blitz" class="btn-primary" style="flex: 1.4; height: 50px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 1rem; border-radius: 8px;">
          ✓ Sim, incluir
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-not-in-list-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-skip-not-in-list')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-include-in-blitz')?.addEventListener('click', () => {
    triggerHaptic(30);
    closeModal();
    // Abre a seleção de validade para registrar o item na Blitz
    promptBlitzDateInputStep(product);
  });
}

/**
 * 4. INFORMAR / CONFIRMAR CORREDOR DO PRODUTO (1ª VEZ)
 * Exibe os 14 corredores + Adega e Área do Alho.
 * Ao salvar: grava o corredor no cadastro do produto de forma definitiva
 * e nas próximas verificações o sistema não pedirá mais.
 */
export function promptSetProductCorridor(product, onComplete) {
  let modal = document.getElementById('modal-blitz-corridor-prompt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-corridor-prompt';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const defaultSector = product.sector || currentActiveBlitzSession?.sector || 'MERCEARIA';
  const initialCorridor = (product.corridor && String(product.corridor).trim() !== '' && product.corridor !== 'null' && product.corridor !== 'undefined' && product.corridor !== 'Sem corredor')
    ? String(product.corridor).trim()
    : 'Corredor 1';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-corridor-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="text-align: center; font-size: 2.2rem; margin-bottom: 4px;">📍</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; text-align: center; margin: 0 0 6px 0;">
        DEFINIR CORREDOR DO PRODUTO
      </h3>

      <div style="background: rgba(14, 165, 233, 0.12); border: 1px solid rgba(14, 165, 233, 0.4); border-radius: 8px; padding: 10px; margin-bottom: 12px; font-size: 0.84rem; color: #7dd3fc; text-align: center; line-height: 1.4;">
        Informe o corredor deste produto. Ele será gravado e <strong>não será mais solicitado</strong> nas próximas verificações.
      </div>

      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 12px; margin-bottom: 14px; display: flex; align-items: center; gap: 12px;">
        <div style="flex-shrink: 0;">
          ${renderProductPhotoHtml(product.image || product.photo_url, product.name, { size: 52, rounded: '8px' })}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.95rem; font-weight: 900; color: #f4f4f5; line-height: 1.35;">
            ${product.name || 'PRODUTO SEM NOME'}
          </div>
          <div style="font-size: 0.78rem; color: #a1a1aa; margin-top: 6px; display: flex; flex-direction: column; gap: 3px;">
            <span>》 Código: <strong style="color: #fbbf24; font-family: monospace;">${product.barcode}</strong></span>
            <span>》 Setor: <strong style="color: #38bdf8;">${defaultSector}</strong></span>
          </div>
        </div>
      </div>

      <form id="form-blitz-save-corridor" style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label for="input-blitz-corridor-val" style="font-size: 0.82rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>📍 Selecione o Corredor:</span>
            <span style="font-size: 0.75rem; color: #a1a1aa; font-weight: 600;">14 corredores + Adega e Área do Alho</span>
          </label>
          
          <div id="quick-corridors-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; max-height: 220px; overflow-y: auto; padding-right: 2px;">
            ${CORRIDORS.map(c => {
              const isSelected = c === initialCorridor;
              return `
                <button type="button" class="btn-quick-corridor btn-secondary ${isSelected ? 'selected-corridor-btn' : ''}" data-corridor="${c}" style="min-height: 44px; padding: 6px 2px; font-size: 0.78rem; font-weight: 800; justify-content: center; text-align: center; border-radius: 8px; line-height: 1.2; ${isSelected ? 'background: rgba(16, 185, 129, 0.2); border-color: #10b981; color: #34d399;' : ''}">
                  ${c}
                </button>
              `;
            }).join('')}
          </div>

          <div style="margin-top: 4px;">
            <label for="input-blitz-corridor-val" style="font-size: 0.76rem; color: #a1a1aa; display: block; margin-bottom: 4px;">
              Corredor confirmado:
            </label>
            <input
              type="text"
              id="input-blitz-corridor-val"
              class="form-input"
              placeholder="Ex: Corredor 1, Adega, Área do Alho"
              value="${initialCorridor}"
              required
              style="height: 48px; font-size: 1.05rem; font-weight: 800;"
            />
          </div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 4px;">
          <button type="button" id="btn-cancel-blitz-corridor" class="btn-secondary" style="flex: 1; height: 48px; justify-content: center; font-weight: 800; border-radius: 8px;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.4; height: 48px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 1rem; border-radius: 8px;">
            ➔ CONTINUAR
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  const corridorInput = document.getElementById('input-blitz-corridor-val');

  modal.querySelectorAll('.btn-quick-corridor').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.getAttribute('data-corridor');
      if (corridorInput && c) {
        corridorInput.value = c;
        modal.querySelectorAll('.btn-quick-corridor').forEach(b => {
          b.style.background = '';
          b.style.borderColor = '';
          b.style.color = '';
        });
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#34d399';
      }
    });
  });

  document.getElementById('modal-blitz-corridor-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-corridor')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('form-blitz-save-corridor')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const corridorVal = corridorInput?.value?.trim() || initialCorridor;
    closeModal();
    showToast(`Gravando corredor: ${corridorVal}...`, 'sync', 600);

    try {
      await updateProductCorridor(product.id, corridorVal);
      product.corridor = corridorVal;
      await saveProduct(product);
      showToast(`✓ Corredor salvo: ${corridorVal}`, 'success', 1000);
      triggerSyncNow().catch(err => console.warn('Sync error:', err));
    } catch (err) {
      console.warn('Erro ao salvar corredor:', err);
      product.corridor = corridorVal;
    }

    if (onComplete) {
      onComplete(product);
    } else {
      promptBlitzDateInputStep(product);
    }
  });
}

/**
 * 5. ETAPA 1: INFORMAR A DATA QUE ESTÁ PROCURANDO E DAR OK
 * O usuário escolhe ou digita a data de validade que está procurando e clica em OK.
 * O sistema então pesquisa o histórico completo dessa data para este produto.
 */
export function promptBlitzDateInputStep(product) {
  let modal = document.getElementById('modal-blitz-date-step');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-date-step';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const session = currentActiveBlitzSession;
  const targetDates = (session?.target_dates && session.target_dates.length > 0)
    ? session.target_dates
    : (session?.start_date ? [session.start_date] : [getTodayISO()]);

  const defaultDateISO = targetDates[0].includes('/') ? parseDateBRtoISO(targetDates[0]) : targetDates[0].split('T')[0];
  const prodSector = product.sector || session?.sector || 'MERCEARIA';
  const prodCorridor = product.corridor || 'Corredor 1';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-date-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      
      <!-- Cabeçalho do Produto -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 14px; display: flex; align-items: center; gap: 12px;">
        <div style="flex-shrink: 0;">
          ${renderProductPhotoHtml(product.image || product.photo_url, product.name, { size: 52, rounded: '8px' })}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 1rem; font-weight: 900; color: #f4f4f5; line-height: 1.35;">
            ➡️ ${product.name || 'PRODUTO SEM NOME'}
          </div>
          <div style="display: flex; flex-direction: column; gap: 3px; font-size: 0.78rem; color: #a1a1aa; margin-top: 6px;">
            <div>》 Código: <strong style="color: #fbbf24; font-family: monospace;">${product.barcode}</strong></div>
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <div>》 Setor: <strong style="color: #38bdf8;">${prodSector}</strong> | Corredor: <strong style="color: #10b981;">${prodCorridor}</strong></div>
              <button type="button" id="btn-quick-change-corridor" style="background: none; border: none; color: #fbbf24; font-size: 0.74rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 2px;">
                ✏️ Alterar
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Formulário: Colocar a data e dar OK -->
      <form id="form-blitz-date-step" style="display: flex; flex-direction: column; gap: 14px;">
        <div>
          <label for="input-blitz-check-date" style="font-size: 0.86rem; font-weight: 900; color: #fbbf24; text-transform: uppercase; margin-bottom: 8px; display: block;">
            📅 Qual data de validade você está procurando?
          </label>
          
          ${targetDates.length > 0 ? `
            <div style="margin-bottom: 8px;">
              <span style="font-size: 0.74rem; color: #a1a1aa; display: block; margin-bottom: 6px;">Toque rápido em uma das datas da blitz:</span>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${targetDates.map((tDate, idx) => {
                  const cleanISO = tDate.includes('/') ? parseDateBRtoISO(tDate) : tDate.split('T')[0];
                  const isFirst = idx === 0;
                  return `
                    <button type="button" class="btn-quick-target-date btn-secondary" data-date="${cleanISO}" style="min-height: 44px; padding: 8px 12px; font-size: 0.86rem; font-weight: 900; border-radius: 8px; ${isFirst ? 'background: rgba(245, 158, 11, 0.2); border-color: #fbbf24; color: #fef08a;' : ''}">
                      ${formatDateBR(cleanISO)}
                    </button>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}

          <div style="margin-top: 6px;">
            <label for="input-blitz-check-date" style="font-size: 0.74rem; color: #a1a1aa; display: block; margin-bottom: 4px;">
              Ou digite/selecione a data:
            </label>
            <input
              type="date"
              id="input-blitz-check-date"
              class="form-input"
              value="${defaultDateISO}"
              required
              style="height: 50px; font-size: 1.15rem; font-weight: 900; text-align: center; border-radius: 8px;"
            />
          </div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 4px;">
          <button type="button" id="btn-cancel-blitz-date" class="btn-secondary" style="flex: 1; height: 50px; justify-content: center; font-weight: 800; border-radius: 8px;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.5; height: 50px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 1.05rem; border-radius: 8px;">
            ➔ DAR OK / VERIFICAR
          </button>
        </div>
      </form>

    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  const dateInput = document.getElementById('input-blitz-check-date');

  modal.querySelectorAll('.btn-quick-target-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = btn.getAttribute('data-date');
      if (dateInput && d) {
        dateInput.value = d;
        triggerHaptic(20);
        modal.querySelectorAll('.btn-quick-target-date').forEach(b => {
          b.style.background = '';
          b.style.borderColor = '';
          b.style.color = '';
        });
        btn.style.background = 'rgba(245, 158, 11, 0.2)';
        btn.style.borderColor = '#fbbf24';
        btn.style.color = '#fef08a';
      }
    });
  });

  document.getElementById('modal-blitz-date-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-date')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // Botão para alterar corredor caso o usuário queira corrigir
  document.getElementById('btn-quick-change-corridor')?.addEventListener('click', () => {
    closeModal();
    promptSetProductCorridor(product, (updatedProd) => {
      promptBlitzDateInputStep(updatedProd);
    });
  });

  // AO DAR OK: Consulta o histórico da data e avisa se é a 1ª vez ou quantas tinham na anterior!
  document.getElementById('form-blitz-date-step')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chosenDateISO = dateInput?.value || defaultDateISO;
    closeModal();
    showToast('Consultando histórico da data...', 'sync', 500);

    promptBlitzQuantityAndHistoryStep(product, chosenDateISO);
  });
}

export const promptBlitzDateAndStatus = promptBlitzDateInputStep;

/**
 * 6. ETAPA 2: O SISTEMA CONSULTA O BANCO E INFORMA O HISTÓRICO DA DATA
 * - Informa se é o primeiro registro dessa data OU se já foi verificada antes e quantas quantidades tinha.
 * - Pergunta: "Quantas tem nesta blitz?"
 * - Grava os dados para que na próxima verificação informe quantas tinham na anterior sucessivamente!
 */
export async function promptBlitzQuantityAndHistoryStep(product, targetDateISO, blitzItem = null) {
  let modal = document.getElementById('modal-blitz-quantity-step');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-quantity-step';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const session = currentActiveBlitzSession;
  const prodSector = product.sector || session?.sector || 'MERCEARIA';
  const prodCorridor = product.corridor || (blitzItem?.corredor || blitzItem?.corridor) || 'Corredor 1';
  let productPhoto = product.image || product.photo_url || (blitzItem?.foto_url || '');

  // Se blitzItem não veio explicitamente, busca da sessão ativa para integridade total
  if (!blitzItem && session?.id && product?.barcode && targetDateISO) {
    try {
      const allItems = await getBlitzItens(session.id);
      blitzItem = allItems.find(it => 
        (String(it.ean).trim() === String(product.barcode).trim() || String(it.barcode || '').trim() === String(product.barcode).trim()) &&
        (it.data_validade === targetDateISO || it.requested_expiration_date === targetDateISO)
      ) || null;
    } catch (_) {}
  }

  // Se o produto ainda não tem foto em memória, consulta a tabela de fotos
  if (!productPhoto) {
    try {
      const storedPhoto = await getProductPhotoFromDb(product.id, product.barcode);
      if (storedPhoto) {
        productPhoto = storedPhoto;
        product.image = storedPhoto;
        product.photo_url = storedPhoto;
      }
    } catch (_) {}
  }

  // 1. PRIMEIRO: Consulta se o produto e validade já foram conferidos NESTA BLITZ ATUAL
  let currentBlitzRecord = null;
  try {
    currentBlitzRecord = await getCurrentBlitzConferenceRecord({
      currentBlitzId: session?.id,
      barcode: product.barcode,
      productId: product.id,
      expirationDate: targetDateISO
    });
  } catch (err) {
    console.warn('Erro ao consultar conferência na Blitz atual:', err);
  }

  // 2. SEGUNDO: Consulta se foi conferido em alguma BLITZ ANTERIOR FINALIZADA
  let lastRecord = null;
  try {
    lastRecord = await getPreviousFinalizedBlitzConference({
      currentBlitzId: session?.id,
      barcode: product.barcode,
      productId: product.id,
      expirationDate: targetDateISO
    });
  } catch (err) {
    console.warn('Erro ao consultar histórico de blitz anterior finalizada:', err);
  }

  const isAlreadyInCurrentBlitz = Boolean(currentBlitzRecord);
  const currentQuantity = currentBlitzRecord ? (Number(currentBlitzRecord.quantity != null ? currentBlitzRecord.quantity : currentBlitzRecord.total) || 0) : 0;

  const isFirstTime = !isAlreadyInCurrentBlitz && !lastRecord;
  const previousQuantity = lastRecord ? (Number(lastRecord.quantity != null ? lastRecord.quantity : lastRecord.total) || 0) : 0;
  const previousDateStr = lastRecord ? (lastRecord.blitzDate || (lastRecord.date ? formatDateBR(lastRecord.date) : 'Blitz anterior')) : '';

  const defaultLocs = ['DEPÓSITO', 'GELADEIRA', 'PRATELEIRA', 'PONTA DE GÔNDOLA', 'ORELHA', 'ILHA', 'CARRINHO NA FRENTE DE LOJA'];

  // Função para resgatar a contagem já existente por local (caso o usuário esteja revisando a mesma blitz)
  const getInitialQtyForLoc = (loc) => {
    if (isAlreadyInCurrentBlitz && currentBlitzRecord?.locations && Array.isArray(currentBlitzRecord.locations)) {
      const found = currentBlitzRecord.locations.find(l => String(l.location || '').trim().toUpperCase() === loc);
      return found ? (Number(found.quantity) || 0) : 0;
    }
    return 0;
  };

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-qty-backdrop"></div>
    <div class="modal-card" style="padding: 18px; max-width: 450px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <h3 style="font-size: 1.05rem; font-weight: 900; color: #10b981; margin: 0; display: flex; align-items: center; gap: 6px;">
          <span>📋</span> <span>CONFERÊNCIA DA DATA</span>
        </h3>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" id="btn-close-qty-step" class="btn-icon-control" style="font-size: 1.1rem; width: 36px; height: 36px;">✕</button>
        </div>
      </div>

      <!-- Resumo do Produto e Validade com Thumbnail Neutro Robusto -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 12px;">
        <div style="flex-shrink: 0;">
          ${renderProductPhotoHtml(productPhoto || product.image || product.photo_url, product.name, { size: 56, rounded: '8px' })}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.96rem; font-weight: 900; color: #f4f4f5; line-height: 1.35;">
            ${product.name || 'PRODUTO SEM NOME'}
          </div>
          <div style="display: flex; flex-direction: column; gap: 3px; font-size: 0.78rem; color: #a1a1aa; margin-top: 6px;">
            <div>》 Código: <strong style="color: #fbbf24; font-family: monospace;">${product.barcode}</strong></div>
            <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
              <span>》 Setor: <strong style="color: #38bdf8;">${prodSector}</strong> | Corredor: <strong style="color: #10b981;">${prodCorridor}</strong></span>
              <button type="button" id="btn-step-edit-corridor" style="background: none; border: none; color: #38bdf8; font-size: 0.75rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 0 4px;">✏️ Alterar</button>
            </div>
            <div style="margin-top: 4px; padding-top: 4px; border-top: 1px dashed #27272a; font-size: 0.88rem;">
              》 Validade em conferência: <strong style="color: #fbbf24; font-size: 1.05rem;">${formatDateBR(targetDateISO)}</strong>
            </div>
          </div>
        </div>
      </div>

      <!-- RESPOSTA DO SISTEMA SOBRE O HISTÓRICO DA DATA -->
      ${isAlreadyInCurrentBlitz ? `
        <!-- CENÁRIO 0: JÁ CONFERIDO NESTA BLITZ ATUAL -->
        <div style="background: rgba(14, 165, 233, 0.14); border: 1.5px solid #0284c7; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
          <div style="font-size: 0.95rem; font-weight: 900; color: #38bdf8; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
            <span>🔄 JÁ CONFERIDO NESTA BLITZ</span>
            <span style="font-size: 0.74rem; color: #bae6fd; font-weight: 700; background: rgba(2, 132, 199, 0.4); padding: 2px 6px; border-radius: 4px;">Sessão Atual</span>
          </div>
          <div style="font-size: 0.98rem; color: #f4f4f5; font-weight: 800; line-height: 1.4;">
            Quantidade já registrada: <span style="font-size: 1.35rem; font-weight: 900; color: #38bdf8;">${currentQuantity}</span> unidades
          </div>
          ${currentBlitzRecord.locations && currentBlitzRecord.locations.length > 0 ? `
            <div style="font-size: 0.76rem; color: #bae6fd; margin-top: 4px;">
              Locais registrados: ${currentBlitzRecord.locations.map(l => `${l.location}: ${l.quantity}`).join(' | ')}
            </div>
          ` : ''}
          <div style="font-size: 0.74rem; color: #94a3b8; margin-top: 4px;">
            💡 Os campos abaixo foram preenchidos com os locais salvos. Ajuste as quantidades e clique em Gravar para atualizar.
          </div>
        </div>
      ` : (isFirstTime ? `
        <!-- CENÁRIO 1: PRIMEIRO REGISTRO DESSA DATA -->
        <div style="background: rgba(16, 185, 129, 0.12); border: 1.5px solid #10b981; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
          <div style="font-size: 0.95rem; font-weight: 900; color: #34d399; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            <span>🆕</span> <span>PRIMEIRO REGISTRO DESTA DATA</span>
          </div>
          <div style="font-size: 0.84rem; color: #e4e4e7; line-height: 1.4;">
            Esta data de validade (<strong>${formatDateBR(targetDateISO)}</strong>) nunca foi verificada antes em blitzes anteriores finalizadas.
          </div>
        </div>
      ` : `
        <!-- CENÁRIO 2: JÁ VERIFICADA NA BLITZ ANTERIOR FINALIZADA -->
        <div style="background: rgba(245, 158, 11, 0.12); border: 1.5px solid #f59e0b; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
          <div style="font-size: 0.92rem; font-weight: 900; color: #fbbf24; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
            <span>📋 JÁ VERIFICADA NA BLITZ ANTERIOR</span>
            <span style="font-size: 0.76rem; color: #fef08a; font-weight: 700;">${previousDateStr}</span>
          </div>
          <div style="font-size: 0.98rem; color: #f4f4f5; font-weight: 800; line-height: 1.4;">
            Quantidade na blitz anterior: <span style="font-size: 1.35rem; font-weight: 900; color: #38bdf8;">${previousQuantity}</span> unidades
          </div>
          ${lastRecord.locations && lastRecord.locations.length > 0 ? `
            <div style="font-size: 0.75rem; color: #a1a1aa; margin-top: 4px;">
              Locais anteriores: ${lastRecord.locations.map(l => `${l.location}: ${l.quantity}`).join(' | ')}
            </div>
          ` : ''}
          ${lastRecord.result === 'NAO_TEM' ? `
            <div style="font-size: 0.78rem; color: #f87171; font-weight: 800; margin-top: 4px;">
              ⚠️ Na blitz anterior constava como NÃO TEM (0 un).
            </div>
          ` : ''}
        </div>
      `)}

      <!-- PERGUNTA: QUANTAS TEM NESTA BLITZ? -->
      <form id="form-blitz-quantity-step" style="display: flex; flex-direction: column; gap: 14px;">
        
        <!-- Opção de registrar direto como NÃO TEM -->
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px; text-align: center;">
          <div style="font-size: 0.8rem; color: #fca5a5; margin-bottom: 8px; font-weight: 700;">
            Se não houver nenhuma unidade desta validade na loja:
          </div>
          <button type="button" id="btn-blitz-step-nao-tem" class="btn-secondary" style="width: 100%; height: 48px; justify-content: center; background: rgba(239, 68, 68, 0.16); color: #ef4444; border: 1.5px solid #ef4444; font-weight: 900; font-size: 0.92rem; border-radius: 8px;">
            ❌ NÃO TEM NESTA BLITZ (0 UNIDADES)
          </button>
        </div>

        <!-- Se tiver unidades: Quantidades por local -->
        <div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <label style="font-size: 0.86rem; font-weight: 900; color: #fbbf24; text-transform: uppercase;">
              📦 Quantas tem nesta blitz?
            </label>
            <div style="font-size: 0.9rem; font-weight: 900; color: #cbd5e1;">
              Total: <span id="step-calc-total" style="color: #10b981; font-size: 1.25rem;">0</span> un
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px; max-height: 260px; overflow-y: auto; padding-right: 4px;">
            ${defaultLocs.map(loc => {
              const initVal = getInitialQtyForLoc(loc);
              return `
                <div style="display: flex; align-items: center; justify-content: space-between; background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 8px 10px;">
                  <span style="font-size: 0.82rem; font-weight: 800; color: #e4e4e7;">${loc}</span>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <button type="button" class="btn-step-qty btn-secondary" data-loc="${loc}" data-delta="-1" style="min-width: 44px; min-height: 44px; width: 44px; height: 44px; padding: 0; font-size: 1.25rem; font-weight: 900; justify-content: center; border-radius: 8px;">-</button>
                    <input
                      type="number"
                      class="input-loc-qty form-input"
                      data-loc="${loc}"
                      min="0"
                      step="1"
                      value="${initVal}"
                      style="width: 64px; height: 44px; text-align: center; font-size: 1.15rem; font-weight: 900; padding: 2px; border-radius: 8px;"
                    />
                    <button type="button" class="btn-step-qty btn-secondary" data-loc="${loc}" data-delta="1" style="min-width: 44px; min-height: 44px; width: 44px; height: 44px; padding: 0; font-size: 1.25rem; font-weight: 900; justify-content: center; border-radius: 8px;">+</button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- FOTO DO PRODUTO (OPCIONAL) -->
        <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid #27272a; border-radius: 8px; padding: 10px;">
          <label style="font-size: 0.8rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; margin-bottom: 6px; display: block;">
            📸 Foto do Produto (Gravada no Cadastro):
          </label>
          <div style="display: flex; align-items: center; gap: 10px;">
            <div id="step-photo-preview-box" style="width: 64px; height: 64px; border-radius: 8px; overflow: hidden; background: #09090b; border: 1px solid #3f3f46; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${productPhoto
                ? `<img src="${productPhoto}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" referrerpolicy="no-referrer" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><div class="photo-placeholder-neutral" style="display: none;"><span>📷 Sem foto</span></div>`
                : `<div class="photo-placeholder-neutral"><span>📷 Sem foto</span></div>`
              }
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-step-cam" class="btn-secondary" style="flex: 1; height: 40px; font-size: 0.8rem; font-weight: 800; justify-content: center; border-radius: 6px;">📷 Câmera</button>
                <button type="button" id="btn-step-gal" class="btn-secondary" style="flex: 1; height: 40px; font-size: 0.8rem; font-weight: 800; justify-content: center; border-radius: 6px;">🖼️ Galeria</button>
              </div>
              <button type="button" id="btn-step-del-photo" class="btn-secondary ${productPhoto ? '' : 'hidden'}" style="height: 32px; font-size: 0.74rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); justify-content: center; border-radius: 6px;">🗑️ Remover Foto</button>
              <input type="file" id="file-step-cam" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" class="hidden" />
              <input type="file" id="file-step-gal" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" class="hidden" />
            </div>
          </div>
        </div>

        <!-- BOTÕES FINAIS -->
        <div style="display: flex; gap: 10px; margin-top: 4px;">
          <button type="button" id="btn-cancel-qty-step" class="btn-secondary" style="flex: 1; height: 52px; justify-content: center; font-weight: 800; border-radius: 8px;">
            Voltar
          </button>
          <button type="submit" id="btn-submit-blitz-conference" class="btn-primary" style="flex: 1.6; height: 52px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 1.05rem; border-radius: 8px;">
            💾 GRAVAR CONFERÊNCIA
          </button>
        </div>

      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-qty-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-qty-step')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });
  document.getElementById('btn-cancel-qty-step')?.addEventListener('click', () => {
    closeModal();
    promptBlitzDateInputStep(product);
  });

  // Alterar corredor a partir da tela de conferência
  document.getElementById('btn-step-edit-corridor')?.addEventListener('click', () => {
    closeModal();
    promptSetProductCorridor(product, (updatedProd) => {
      promptBlitzQuantityAndHistoryStep(updatedProd, targetDateISO, blitzItem);
    });
  });

  // Cálculo automático do total ao vivo
  const totalSpan = document.getElementById('step-calc-total');
  const qtyInputs = modal.querySelectorAll('.input-loc-qty');

  const updateTotal = () => {
    let tot = 0;
    qtyInputs.forEach(inp => {
      const v = parseInt(inp.value, 10);
      if (!isNaN(v) && v > 0) tot += v;
    });
    if (totalSpan) totalSpan.textContent = tot;
    const submitBtn = document.getElementById('btn-submit-blitz-conference');
    if (submitBtn) {
      submitBtn.textContent = `💾 GRAVAR CONFERÊNCIA (${tot} un)`;
    }
    return tot;
  };

  // Inicializa o total com eventuais valores pré-carregados
  updateTotal();

  modal.querySelectorAll('.btn-step-qty').forEach(btn => {
    btn.addEventListener('click', () => {
      triggerHaptic(25);
      const loc = btn.getAttribute('data-loc');
      const delta = parseInt(btn.getAttribute('data-delta'), 10) || 0;
      const inp = modal.querySelector(`.input-loc-qty[data-loc="${loc}"]`);
      if (inp) {
        let current = parseInt(inp.value, 10) || 0;
        current = Math.max(0, current + delta);
        inp.value = current;
        updateTotal();
      }
    });
  });

  qtyInputs.forEach(inp => {
    inp.addEventListener('input', updateTotal);
    inp.addEventListener('change', updateTotal);
  });

  // Handlers de Foto
  const btnCam = document.getElementById('btn-step-cam');
  const btnGal = document.getElementById('btn-step-gal');
  const btnDel = document.getElementById('btn-step-del-photo');
  const fileCam = document.getElementById('file-step-cam');
  const fileGal = document.getElementById('file-step-gal');
  const photoBox = document.getElementById('step-photo-preview-box');

  btnCam?.addEventListener('click', () => fileCam?.click());
  btnGal?.addEventListener('click', () => fileGal?.click());

  const handlePhotoFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    showToast('Processando e compactando foto...', 'sync', 1000);
    try {
      const compressed = await compressImage(file, 800, 800, 0.75);
      if (!compressed || typeof compressed !== 'string' || compressed.length < 50) {
        throw new Error('Falha ao gerar imagem compactada');
      }
      productPhoto = compressed;
      if (photoBox) {
        photoBox.innerHTML = `<img src="${compressed}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" referrerpolicy="no-referrer" onerror="this.style.display='none'; if (this.nextElementSibling) this.nextElementSibling.style.display='flex';" /><div class="photo-placeholder-neutral" style="display: none;"><span>📷 Sem foto</span></div>`;
      }
      // Atualiza também o thumbnail do cabeçalho do modal
      const headerThumbImg = modal.querySelector('.blitz-prod-thumb-img');
      if (headerThumbImg) {
        headerThumbImg.src = compressed;
        headerThumbImg.style.display = 'block';
        const placeholder = headerThumbImg.nextElementSibling;
        if (placeholder) placeholder.style.display = 'none';
      }
      btnDel?.classList.remove('hidden');

      // Salva imediatamente no produto e na base de fotos
      try {
        product.image = compressed;
        product.photo_url = compressed;
        await saveProduct(product);
        await saveProductPhotoRecord({
          productId: product.id,
          barcode: product.barcode,
          photoBase64: compressed,
          expirationDate: targetDateISO,
          type: 'PRODUTO'
        });
        showToast('Foto do produto compactada e salva!', 'success', 900);
      } catch (saveErr) {
        console.warn('Aviso ao salvar foto no produto:', saveErr);
      }
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      showToast('Erro ao processar imagem da foto', 'warning');
    }
  };

  fileCam?.addEventListener('change', handlePhotoFile);
  fileGal?.addEventListener('change', handlePhotoFile);

  btnDel?.addEventListener('click', async () => {
    productPhoto = '';
    product.image = '';
    product.photo_url = '';
    try {
      await saveProduct(product);
    } catch (_) {}
    if (photoBox) {
      photoBox.innerHTML = `<div class="photo-placeholder-neutral"><span>📷 Sem foto</span></div>`;
    }
    const headerThumbImg = modal.querySelector('.blitz-prod-thumb-img');
    if (headerThumbImg) {
      headerThumbImg.style.display = 'none';
      const placeholder = headerThumbImg.nextElementSibling;
      if (placeholder) placeholder.style.display = 'flex';
    }
    btnDel?.classList.add('hidden');
    if (fileCam) fileCam.value = '';
    if (fileGal) fileGal.value = '';
  });

  // CASO 1: NÃO TEM NESTA BLITZ (0 UNIDADES)
  document.getElementById('btn-blitz-step-nao-tem')?.addEventListener('click', async () => {
    closeModal();
    showToast('Gravando NÃO TEM...', 'sync', 600);

    try {
      if (productPhoto) {
        product.image = productPhoto;
        product.photo_url = productPhoto;
        await saveProduct(product);
        await saveProductPhotoRecord({
          productId: product.id,
          barcode: product.barcode,
          photoBase64: productPhoto,
          expirationDate: targetDateISO,
          type: 'CONFERENCIA'
        });
      }

      await saveBlitzConferenceRecord({
        sessionId: session?.id,
        productId: product.id,
        barcode: product.barcode,
        sector: prodSector,
        corridor: prodCorridor,
        requestedDate: targetDateISO,
        previousQuantity: isAlreadyInCurrentBlitz ? currentQuantity : previousQuantity,
        newQuantity: 0,
        difference: 0 - (isAlreadyInCurrentBlitz ? currentQuantity : previousQuantity),
        result: 'NAO_TEM',
        locations: [],
        photo_proof: productPhoto || null,
        foto_url: productPhoto || null,
        userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
        userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
      });

      await updateProductStatus(product.id, 'VERIFICADO');
      product.status = 'VERIFICADO';
      triggerSyncNow().catch(err => console.warn('Sync error:', err));

      triggerHaptic(60);

      const comparisonMsg = isAlreadyInCurrentBlitz
        ? `<br><span style="font-size: 0.82rem; color: #cbd5e1;">Registro da Blitz atual atualizado para: <strong style="color: #ef4444;">0 un</strong></span>`
        : (!isFirstTime
          ? `<br><span style="font-size: 0.82rem; color: #cbd5e1;">Na blitz anterior: <strong style="color: #38bdf8;">${previousQuantity} un</strong> ➔ Nesta blitz: <strong style="color: #ef4444;">0 un</strong></span>`
          : `<br><span style="font-size: 0.82rem; color: #a1a1aa;">Primeiro registro desta validade como NÃO TEM.</span>`);

      showBlitzNextProductModal(
        product.name,
        `Validade <strong>${formatDateBR(targetDateISO)}</strong> gravada como <strong style="color: #ef4444;">NÃO TEM</strong>.${comparisonMsg}`,
        productPhoto || product.image || product.photo_url
      );
    } catch (err) {
      console.error('Erro ao salvar NÃO TEM:', err);
      showToast('Erro ao gravar conferência', 'warning');
      startBlitzScanning();
    }
  });

  // CASO 2: GRAVAR CONFERÊNCIA COM AS QUANTIDADES
  document.getElementById('form-blitz-quantity-step')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const totalQty = updateTotal();

    if (totalQty === 0) {
      promptConfirmDialog({
        title: 'Quantidade zero',
        message: 'A quantidade total é 0. Deseja registrar esta data como NÃO TEM na blitz?',
        confirmText: 'Sim, registrar NÃO TEM',
        cancelText: 'Cancelar',
        onConfirm: async () => {
          closeModal();
          try {
            if (productPhoto) {
              product.image = productPhoto;
              product.photo_url = productPhoto;
              await saveProduct(product);
              await saveProductPhotoRecord({
                productId: product.id,
                barcode: product.barcode,
                photoBase64: productPhoto,
                expirationDate: targetDateISO,
                type: 'CONFERENCIA'
              });
            }

            await saveBlitzConferenceRecord({
              sessionId: session?.id,
              productId: product.id,
              barcode: product.barcode,
              sector: prodSector,
              corridor: prodCorridor,
              requestedDate: targetDateISO,
              previousQuantity: isAlreadyInCurrentBlitz ? currentQuantity : previousQuantity,
              newQuantity: 0,
              difference: 0 - (isAlreadyInCurrentBlitz ? currentQuantity : previousQuantity),
              result: 'NAO_TEM',
              locations: [],
              photo_proof: productPhoto || null,
              foto_url: productPhoto || null,
              userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
              userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
            });
            await updateProductStatus(product.id, 'VERIFICADO');
            product.status = 'VERIFICADO';
            triggerSyncNow().catch(err => console.warn('Sync error:', err));
            showBlitzNextProductModal(
              product.name, 
              `Validade <strong>${formatDateBR(targetDateISO)}</strong> gravada como <strong style="color: #ef4444;">NÃO TEM</strong>.`,
              productPhoto || product.image || product.photo_url
            );
          } catch (err) {
            showToast('Erro ao gravar conferência', 'warning');
            startBlitzScanning();
          }
        }
      });
      return;
    }

    closeModal();
    showToast('Gravando conferência da blitz...', 'sync', 600);

    try {
      const locations = [];
      qtyInputs.forEach(inp => {
        const q = parseInt(inp.value, 10);
        if (!isNaN(q) && q > 0) {
          locations.push({
            location: inp.getAttribute('data-loc'),
            quantity: q
          });
        }
      });

      // 1. Atualiza produto e grava foto
      if (productPhoto) {
        product.image = productPhoto;
        product.photo_url = productPhoto;
        await saveProductPhotoRecord({
          productId: product.id,
          barcode: product.barcode,
          photoBase64: productPhoto,
          expirationDate: targetDateISO,
          type: 'PRODUTO'
        });
      }
      product.total_quantity = totalQty;
      product.status = 'VERIFICADO';
      product.is_blitz_import = false; // Promovido para cadastro verificado!
      product.last_expiration_date = targetDateISO;

      // Atribui quantidades locais aos campos do produto
      for (const item of locations) {
        if (item.location === 'DEPÓSITO') product.deposit_qty = item.quantity;
        else if (item.location === 'GELADEIRA') product.fridge_qty = item.quantity;
        else if (item.location === 'PRATELEIRA') product.shelf_qty = item.quantity;
        else if (item.location === 'PONTA DE GÔNDOLA') product.gondola_end_qty = item.quantity;
        else if (item.location === 'ORELHA') product.ear_qty = item.quantity;
        else if (item.location === 'ILHA') product.island_qty = item.quantity;
        else if (item.location === 'CARRINHO NA FRENTE DE LOJA') product.cart_qty = item.quantity;
      }

      await saveProduct(product);

      // 2. Salva validade em product_expirations
      try {
        await saveProductExpiration(product.id, targetDateISO);
      } catch (_) {}

      // 3. Salva conferência da Blitz com histórico gravado (previousQuantity vs newQuantity)
      await saveBlitzConferenceRecord({
        sessionId: session?.id,
        productId: product.id,
        barcode: product.barcode,
        sector: prodSector,
        corridor: prodCorridor,
        requestedDate: targetDateISO,
        previousQuantity: isAlreadyInCurrentBlitz ? currentQuantity : previousQuantity,
        newQuantity: totalQty,
        difference: totalQty - (isAlreadyInCurrentBlitz ? currentQuantity : previousQuantity),
        result: 'TEM',
        locations: locations.length > 0 ? locations : [{ location: prodCorridor, quantity: totalQty }],
        photo_proof: productPhoto || null,
        foto_url: productPhoto || null,
        userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
        userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
      });

      triggerSyncNow().catch(err => console.warn('Sync error:', err));

      triggerHaptic(60);

      let comparisonMsg = '';
      if (isAlreadyInCurrentBlitz) {
        comparisonMsg = `<br><span style="font-size: 0.82rem; color: #cbd5e1;">Contagem anterior nesta Blitz: <strong style="color: #94a3b8;">${currentQuantity} un</strong> ➔ Nova: <strong style="color: #10b981;">${totalQty} un</strong></span>`;
      } else if (!isFirstTime) {
        const diff = totalQty - previousQuantity;
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`;
        comparisonMsg = `<br><span style="font-size: 0.82rem; color: #cbd5e1;">Na blitz anterior: <strong style="color: #38bdf8;">${previousQuantity} un</strong> ➔ Nesta blitz: <strong style="color: #10b981;">${totalQty} un</strong> (${diffStr})</span>`;
      } else {
        comparisonMsg = `<br><span style="font-size: 0.82rem; color: #34d399;">Primeiro registro desta validade: <strong style="color: #10b981;">${totalQty} un</strong></span>`;
      }

      showBlitzNextProductModal(
        product.name,
        `Validade <strong>${formatDateBR(targetDateISO)}</strong> gravada com sucesso!${comparisonMsg}`,
        productPhoto || product.image || product.photo_url
      );
    } catch (err) {
      console.error('Erro ao salvar conferência completa:', err);
      showToast('Erro ao salvar conferência do produto', 'warning');
      startBlitzScanning();
    }
  });
}

export const promptCompleteRegistrationBlitz = (prod, targetDateISO) => promptBlitzQuantityAndHistoryStep(prod, targetDateISO);

/**
 * MODAL DE SUCESSO E TRANSIÇÃO PARA O PRÓXIMO PRODUTO
 */
export function showBlitzNextProductModal(productName, messageHtml, productPhoto = null) {
  let modal = document.getElementById('modal-blitz-next-product');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-next-product';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-next-prod-backdrop"></div>
    <div class="modal-card" style="padding: 24px; max-width: 400px; width: 100%; box-sizing: border-box; text-align: center;">
      <div style="display: flex; justify-content: center; margin-bottom: 10px;">
        ${productPhoto 
          ? renderProductPhotoHtml(productPhoto, productName, { size: 68, rounded: '10px' })
          : '<div style="font-size: 2.8rem;">✅</div>'
        }
      </div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #10b981; margin: 0 0 6px 0;">
        PRODUTO REGISTRADO!
      </h3>
      <div style="font-size: 0.9rem; color: #f4f4f5; font-weight: 800; margin-bottom: 6px;">
        ${productName}
      </div>
      <div style="font-size: 0.82rem; color: #a1a1aa; line-height: 1.4; margin-bottom: 20px;">
        ${messageHtml}
      </div>

      <div style="display: flex; flex-direction: column; gap: 10px;">
        <button type="button" id="btn-modal-bipar-proximo" class="btn-primary" style="height: 52px; font-size: 1.05rem; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; border-radius: 10px;">
          📷 BIPAR PRÓXIMO PRODUTO
        </button>
        <button type="button" id="btn-modal-ver-resumo" class="btn-secondary" style="height: 44px; font-size: 0.85rem; font-weight: 800; justify-content: center;">
          📋 Ver Painel da Blitz
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  triggerHaptic(40);

  document.getElementById('modal-next-prod-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-modal-bipar-proximo')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });
  document.getElementById('btn-modal-ver-resumo')?.addEventListener('click', () => {
    closeModal();
    openBlitzDashboardView();
  });
}

export const renderBlitzDashboard = openBlitzDashboardView;
if (typeof window !== 'undefined') {
  window.renderBlitzDashboard = openBlitzDashboardView;
  window.openBlitzDashboardView = openBlitzDashboardView;
}

/**
 * 5. VERIFICAÇÃO DAS DATAS DA BLITZ
 * Ao bipar o produto, o sistema analisa as datas cadastradas para aquele produto.
 * 6. SE A DATA PROCURADA ESTIVER CADASTRADA:
 *    Mostra dados do produto, DATA ENCONTRADA, quantidade cadastrada.
 *    Opções: [ CONFIRMAR ] [ EDITAR QUANTIDADE ]
 * 7. SE A DATA PROCURADA NÃO ESTIVER CADASTRADA:
 *    Mostra dados do produto, DATA NÃO ENCONTRADA.
 *    Opções: [ TEM ESSA DATA ] [ NÃO TEM ESSA DATA ]
 * 8. SE O USUÁRIO INFORMAR 'TEM':
 *    Abre tela para registrar validade, quantidade encontrada, localização, foto.
 * 9. SE O USUÁRIO INFORMAR 'NÃO TEM':
 *    Salva automaticamente que o produto NÃO possui aquela data.
 *    NÃO exige foto, quantidade, localização ou nova validade.
 * 10. PRODUTO VERIFICADO:
 *    Muda de status para 'VERIFICADO'.
 */
export async function showBlitzProductDatesVerification(product) {
  let modal = document.getElementById('modal-blitz-dates-verification');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-dates-verification';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const session = currentActiveBlitzSession;
  const targetDates = (session?.target_dates && session.target_dates.length > 0)
    ? session.target_dates
    : (session?.start_date ? [session.start_date] : [getTodayISO()]);

  // Busca validades cadastradas no banco para este produto
  let knownExpirations = [];
  try {
    knownExpirations = (await getProductExpirations(product.id)) || [];
  } catch (err) {
    console.warn('Erro ao buscar validades do produto:', err);
  }

  // Prepara informações de cada data procurada
  const dateEvaluations = [];
  for (const tDate of targetDates) {
    const cleanISO = tDate.includes('/') ? parseDateBRtoISO(tDate) : tDate.split('T')[0];

    // Verifica se essa data está cadastrada
    const matchingExp = knownExpirations.find(exp => {
      if (!exp.expiration_date) return false;
      const expISO = exp.expiration_date.includes('/') ? parseDateBRtoISO(exp.expiration_date) : exp.expiration_date.split('T')[0];
      return expISO === cleanISO;
    });

    let registeredQty = 0;
    if (matchingExp) {
      const conf = await getComprehensiveConferenceRecordForProductAndDate(product, cleanISO);
      registeredQty = conf ? (Number(conf.total) || 0) : (Number(matchingExp.quantity) || 0);
    }

    // Verifica se já foi conferida nesta sessão
    const existingBlitzItem = await getBlitzItemBySessionBarcodeAndDate(session?.id, product.barcode, cleanISO);

    dateEvaluations.push({
      dateISO: cleanISO,
      dateBR: formatDateBR(cleanISO),
      isRegistered: Boolean(matchingExp),
      registeredQty: registeredQty,
      alreadyConferido: existingBlitzItem || null,
      resolved: Boolean(existingBlitzItem)
    });
  }

  const prodSector = product.sector || session?.sector || 'MERCEARIA';
  const prodCorridor = product.corridor || 'Corredor 1';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-dates-backdrop"></div>
    <div class="modal-card" style="padding: 18px; max-width: 440px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      
      <!-- Cabeçalho do Produto -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 12px;">
        <div style="font-size: 1rem; font-weight: 900; color: #f4f4f5; line-height: 1.35;">
          ➡️ ${product.name || 'PRODUTO SEM NOME'}
        </div>
        <div style="display: flex; flex-direction: column; gap: 3px; font-size: 0.76rem; color: #a1a1aa; margin-top: 6px;">
          <div>》 Código: <strong style="color: #fbbf24; font-family: monospace;">${product.barcode}</strong></div>
          <div>》 Setor: <strong style="color: #38bdf8;">${prodSector}</strong></div>
          <div>》 Corredor: <strong style="color: #10b981;">${prodCorridor}</strong></div>
        </div>
      </div>

      <!-- CARDS DE CADA DATA PROCURADA -->
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${dateEvaluations.map((evalItem, idx) => {
          const safeKey = evalItem.dateISO.replace(/-/g, '_');
          if (evalItem.isRegistered) {
            // 6. SE A DATA PROCURADA ESTIVER CADASTRADA:
            return `
              <div class="blitz-date-card" id="date-card-${safeKey}" style="background: rgba(16, 185, 129, 0.07); border: 2px solid rgba(16, 185, 129, 0.45); border-radius: 12px; padding: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="font-size: 0.82rem; font-weight: 900; color: #10b981; display: flex; align-items: center; gap: 6px;">
                    <span>✅</span> <span>DATA ENCONTRADA</span>
                  </div>
                  <span style="font-size: 0.68rem; background: rgba(16, 185, 129, 0.2); color: #a7f3d0; padding: 2px 6px; border-radius: 4px; font-weight: 800;">CADASTRADA</span>
                </div>
                <div style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; margin-top: 4px;">
                  》 ${evalItem.dateBR}
                </div>
                <div style="font-size: 0.82rem; color: #cbd5e1; margin-top: 4px; font-weight: 700;">
                  Quantidade cadastrada: <strong style="color: #34d399; font-size: 0.95rem;">${formatNumber(evalItem.registeredQty)} unidades</strong>
                </div>

                <div id="date-actions-${safeKey}" style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 8px; margin-top: 10px;">
                  <button type="button" class="btn-primary btn-confirm-date" data-key="${safeKey}" data-date="${evalItem.dateISO}" data-qty="${evalItem.registeredQty}" style="height: 44px; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; font-size: 0.85rem;">
                    ✓ CONFIRMAR
                  </button>
                  <button type="button" class="btn-secondary btn-edit-qty-date" data-key="${safeKey}" data-date="${evalItem.dateISO}" data-qty="${evalItem.registeredQty}" style="height: 44px; font-weight: 800; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4); font-size: 0.8rem;">
                    ✏️ EDITAR QUANTIDADE
                  </button>
                </div>
                <div id="date-resolved-${safeKey}" class="${evalItem.resolved ? '' : 'hidden'}" style="margin-top: 8px;">
                  ${evalItem.alreadyConferido ? `
                    <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; padding: 6px 10px; border-radius: 6px; color: #a7f3d0; font-weight: 800; font-size: 0.78rem; text-align: center;">
                      ✓ CONFERIDO (${evalItem.alreadyConferido.result === 'TEM' ? `${evalItem.alreadyConferido.total_quantity} un` : 'NÃO TEM'})
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          } else {
            // 7. SE A DATA PROCURADA NÃO ESTIVER CADASTRADA:
            return `
              <div class="blitz-date-card" id="date-card-${safeKey}" style="background: rgba(245, 158, 11, 0.07); border: 2px solid rgba(245, 158, 11, 0.45); border-radius: 12px; padding: 12px;">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                  <div style="font-size: 0.82rem; font-weight: 900; color: #fbbf24; display: flex; align-items: center; gap: 6px;">
                    <span>⚠️</span> <span>DATA NÃO ENCONTRADA</span>
                  </div>
                  <span style="font-size: 0.68rem; background: rgba(245, 158, 11, 0.2); color: #fde68a; padding: 2px 6px; border-radius: 4px; font-weight: 800;">NÃO CADASTRADA</span>
                </div>
                <div style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; margin-top: 4px;">
                  》 ${evalItem.dateBR}
                </div>

                <div id="date-actions-${safeKey}" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
                  <button type="button" class="btn-primary btn-tem-date" data-key="${safeKey}" data-date="${evalItem.dateISO}" style="height: 46px; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; font-size: 0.85rem;">
                    ✅ TEM ESSA DATA
                  </button>
                  <button type="button" class="btn-secondary btn-nao-tem-date" data-key="${safeKey}" data-date="${evalItem.dateISO}" style="height: 46px; font-weight: 900; justify-content: center; color: #ef4444; border-color: rgba(239, 68, 68, 0.5); background: rgba(239, 68, 68, 0.1); font-size: 0.85rem;">
                    ❌ NÃO TEM ESSA DATA
                  </button>
                </div>
                <div id="date-resolved-${safeKey}" class="${evalItem.resolved ? '' : 'hidden'}" style="margin-top: 8px;">
                  ${evalItem.alreadyConferido ? `
                    <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; padding: 6px 10px; border-radius: 6px; color: #a7f3d0; font-weight: 800; font-size: 0.78rem; text-align: center;">
                      ✓ CONFERIDO (${evalItem.alreadyConferido.result === 'TEM' ? `${evalItem.alreadyConferido.total_quantity} un` : 'NÃO TEM'})
                    </div>
                  ` : ''}
                </div>
              </div>
            `;
          }
        }).join('')}
      </div>

      <!-- PAINEL DE SUCESSO (APÓS VERIFICAÇÃO) -->
      <div id="blitz-all-verified-box" class="hidden" style="background: rgba(16, 185, 129, 0.15); border: 2px solid #10b981; border-radius: 12px; padding: 14px; text-align: center; margin-top: 14px;">
        <div style="font-size: 1.15rem; font-weight: 900; color: #10b981;">
          🎉 PRODUTO VERIFICADO COM SUCESSO!
        </div>
        <div style="font-size: 0.8rem; color: #a7f3d0; margin-top: 4px;">
          Status atualizado para: <strong style="background: #10b981; color: #022c22; padding: 2px 8px; border-radius: 4px;">VERIFICADO</strong>
        </div>
        <button type="button" id="btn-blitz-next-product-bip" class="btn-primary" style="margin-top: 12px; width: 100%; height: 50px; font-size: 1.05rem; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; border-radius: 10px;">
          📷 BIPAR PRÓXIMO PRODUTO
        </button>
      </div>

      <div style="text-align: center; margin-top: 12px;">
        <button type="button" id="btn-close-dates-verif" style="background: none; border: none; color: #71717a; font-size: 0.8rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 4px;">
          Fechar e voltar
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-dates-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-dates-verif')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  const checkAllResolved = () => {
    const total = dateEvaluations.length;
    const resolvedCount = dateEvaluations.filter(e => e.resolved).length;
    if (resolvedCount >= total) {
      const successBox = document.getElementById('blitz-all-verified-box');
      if (successBox) successBox.classList.remove('hidden');
    }
  };

  document.getElementById('btn-blitz-next-product-bip')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // Ação: CONFIRMAR (Data cadastrada)
  modal.querySelectorAll('.btn-confirm-date').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-key');
      const targetDate = btn.getAttribute('data-date');
      const qty = Number(btn.getAttribute('data-qty')) || 0;

      showToast('Confirmando data...', 'sync', 600);

      try {
        await saveBlitzConferenceRecord({
          sessionId: session?.id,
          productId: product.id,
          barcode: product.barcode,
          sector: prodSector,
          requestedDate: targetDate,
          previousQuantity: qty,
          newQuantity: qty,
          result: 'TEM',
          locations: [{ location: prodCorridor, quantity: qty }],
          photo_proof: null,
          userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
          userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
        });

        // 10. PRODUTO VERIFICADO: Muda status para VERIFICADO
        await updateProductStatus(product.id, 'VERIFICADO');
        product.status = 'VERIFICADO';
        triggerSyncNow().catch(err => console.warn('Sync error:', err));

        // Atualiza card
        const actionsEl = document.getElementById(`date-actions-${key}`);
        const resolvedEl = document.getElementById(`date-resolved-${key}`);
        if (actionsEl) actionsEl.classList.add('hidden');
        if (resolvedEl) {
          resolvedEl.innerHTML = `
            <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; padding: 6px 10px; border-radius: 6px; color: #a7f3d0; font-weight: 800; font-size: 0.8rem; text-align: center;">
              ✓ DATA CONFIRMADA (${qty} un)
            </div>
          `;
          resolvedEl.classList.remove('hidden');
        }

        const evalItem = dateEvaluations.find(e => e.dateISO === targetDate);
        if (evalItem) evalItem.resolved = true;
        checkAllResolved();
        showToast('✓ Data confirmada!', 'success', 1000);
      } catch (err) {
        console.error('Erro ao confirmar data:', err);
        showToast('Erro ao salvar confirmação', 'warning');
      }
    });
  });

  // Ação: EDITAR QUANTIDADE (Data cadastrada)
  modal.querySelectorAll('.btn-edit-qty-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const targetDate = btn.getAttribute('data-date');
      const currentQty = Number(btn.getAttribute('data-qty')) || 0;

      promptEditQuantityForBlitz(product, targetDate, currentQty, async (newQty) => {
        try {
          await saveBlitzConferenceRecord({
            sessionId: session?.id,
            productId: product.id,
            barcode: product.barcode,
            sector: prodSector,
            requestedDate: targetDate,
            previousQuantity: currentQty,
            newQuantity: newQty,
            result: 'TEM',
            locations: [{ location: prodCorridor, quantity: newQty }],
            photo_proof: null,
            userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
            userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
          });

          await updateProductStatus(product.id, 'VERIFICADO');
          product.status = 'VERIFICADO';
          triggerSyncNow().catch(err => console.warn('Sync error:', err));

          const actionsEl = document.getElementById(`date-actions-${key}`);
          const resolvedEl = document.getElementById(`date-resolved-${key}`);
          if (actionsEl) actionsEl.classList.add('hidden');
          if (resolvedEl) {
            resolvedEl.innerHTML = `
              <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; padding: 6px 10px; border-radius: 6px; color: #a7f3d0; font-weight: 800; font-size: 0.8rem; text-align: center;">
                ✓ QUANTIDADE ATUALIZADA (${newQty} un)
              </div>
            `;
            resolvedEl.classList.remove('hidden');
          }

          const evalItem = dateEvaluations.find(e => e.dateISO === targetDate);
          if (evalItem) evalItem.resolved = true;
          checkAllResolved();
          showToast(`✓ Quantidade atualizada: ${newQty} un`, 'success', 1200);
        } catch (err) {
          console.error('Erro ao editar quantidade:', err);
          showToast('Erro ao salvar quantidade', 'warning');
        }
      });
    });
  });

  // Ação: TEM ESSA DATA (Data não cadastrada) -> 8. Abre tela para registrar validade, quantidade, localização e foto
  modal.querySelectorAll('.btn-tem-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-key');
      const targetDate = btn.getAttribute('data-date');

      promptRegisterBlitzTemDetails(product, targetDate, async ({ expirationDate, quantity, location, photo }) => {
        try {
          showToast('Salvando verificação...', 'sync', 800);

          // Salva a nova data no produto se não existir
          try {
            await saveProductExpiration(product.id, expirationDate);
          } catch (_) {}

          // Salva conferência da blitz
          await saveBlitzConferenceRecord({
            sessionId: session?.id,
            productId: product.id,
            barcode: product.barcode,
            sector: prodSector,
            requestedDate: expirationDate,
            previousQuantity: 0,
            newQuantity: quantity,
            result: 'TEM',
            locations: [{ location: location || prodCorridor, quantity: quantity }],
            photo_proof: photo || null,
            userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
            userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
          });

          // 10. Muda status para VERIFICADO
          await updateProductStatus(product.id, 'VERIFICADO');
          product.status = 'VERIFICADO';
          triggerSyncNow().catch(err => console.warn('Sync error:', err));

          const actionsEl = document.getElementById(`date-actions-${key}`);
          const resolvedEl = document.getElementById(`date-resolved-${key}`);
          if (actionsEl) actionsEl.classList.add('hidden');
          if (resolvedEl) {
            resolvedEl.innerHTML = `
              <div style="background: rgba(16, 185, 129, 0.2); border: 1px solid #10b981; padding: 6px 10px; border-radius: 6px; color: #a7f3d0; font-weight: 800; font-size: 0.8rem; text-align: center;">
                ✓ REGISTRADO: TEM (${quantity} un em ${location || prodCorridor})
              </div>
            `;
            resolvedEl.classList.remove('hidden');
          }

          const evalItem = dateEvaluations.find(e => e.dateISO === targetDate);
          if (evalItem) evalItem.resolved = true;
          checkAllResolved();
          showToast(`✓ Verificação salva: ${quantity} un`, 'success', 1200);
        } catch (err) {
          console.error('Erro ao salvar verificação TEM:', err);
          showToast('Erro ao registrar conferência', 'warning');
        }
      });
    });
  });

  // Ação: NÃO TEM ESSA DATA -> 9. Salva automaticamente que o produto NÃO possui aquela data.
  // NÃO exigir foto, quantidade, localização ou nova validade!
  modal.querySelectorAll('.btn-nao-tem-date').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.getAttribute('data-key');
      const targetDate = btn.getAttribute('data-date');

      showToast('Registrando NÃO TEM...', 'sync', 600);

      try {
        await saveBlitzConferenceRecord({
          sessionId: session?.id,
          productId: product.id,
          barcode: product.barcode,
          sector: prodSector,
          requestedDate: targetDate,
          previousQuantity: 0,
          newQuantity: 0,
          result: 'NAO_TEM',
          locations: [],
          photo_proof: null,
          userId: getCurrentUser()?.id || session?.responsible_user_id || session?.user_id || 'ana_luiza',
          userName: getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'
        });

        // 10. Muda status para VERIFICADO
        await updateProductStatus(product.id, 'VERIFICADO');
        product.status = 'VERIFICADO';
        triggerSyncNow().catch(err => console.warn('Sync error:', err));

        const actionsEl = document.getElementById(`date-actions-${key}`);
        const resolvedEl = document.getElementById(`date-resolved-${key}`);
        if (actionsEl) actionsEl.classList.add('hidden');
        if (resolvedEl) {
          resolvedEl.innerHTML = `
            <div style="background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; padding: 6px 10px; border-radius: 6px; color: #fca5a5; font-weight: 800; font-size: 0.8rem; text-align: center;">
              ❌ REGISTRADO: NÃO TEM
            </div>
          `;
          resolvedEl.classList.remove('hidden');
        }

        const evalItem = dateEvaluations.find(e => e.dateISO === targetDate);
        if (evalItem) evalItem.resolved = true;
        checkAllResolved();
        showToast(`✓ Registrado: NÃO TEM (${formatDateBR(targetDate)})`, 'info', 1200);
      } catch (err) {
        console.error('Erro ao salvar NÃO TEM:', err);
        showToast('Erro ao salvar NÃO TEM', 'warning');
      }
    });
  });

  // Checa se já estavam todos resolvidos ao abrir
  checkAllResolved();
}

/**
 * Modal rápido para editar a quantidade de uma data já cadastrada
 */
function promptEditQuantityForBlitz(product, dateISO, currentQty, onSave) {
  let modal = document.getElementById('modal-blitz-edit-qty');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-edit-qty';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-edit-qty-backdrop"></div>
    <div class="modal-card" style="padding: 18px; max-width: 380px; width: 100%; box-sizing: border-box;">
      <h3 style="font-size: 1rem; font-weight: 900; color: #f4f4f5; margin: 0 0 4px 0;">
        ✏️ EDITAR QUANTIDADE
      </h3>
      <div style="font-size: 0.82rem; color: #a1a1aa; margin-bottom: 12px;">
        Validade: <strong style="color: #fbbf24;">${formatDateBR(dateISO)}</strong>
      </div>

      <form id="form-blitz-edit-qty-val" style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <label for="input-edit-qty-number" style="font-size: 0.78rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            Nova quantidade encontrada:
          </label>
          <input
            type="number"
            id="input-edit-qty-number"
            class="form-input"
            min="0"
            step="1"
            value="${currentQty}"
            required
            autofocus
            style="height: 48px; font-size: 1.3rem; font-weight: 900; text-align: center; color: #10b981;"
          />
        </div>

        <div style="display: flex; gap: 8px;">
          <button type="button" id="btn-cancel-edit-qty" class="btn-secondary" style="flex: 1; height: 44px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.4; height: 44px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900;">
            💾 SALVAR
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-edit-qty-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-edit-qty')?.addEventListener('click', closeModal);

  document.getElementById('form-blitz-edit-qty-val')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const qtyInput = document.getElementById('input-edit-qty-number');
    const newQty = Number(qtyInput?.value) || 0;
    closeModal();
    if (onSave) onSave(newQty);
  });
}

/**
 * 8. SE O USUÁRIO INFORMAR 'TEM':
 * Abrir tela para registrar:
 * - Data de validade
 * - Quantidade encontrada
 * - Localização
 * - Foto
 * - Botão: [ SALVAR VERIFICAÇÃO ]
 */
function promptRegisterBlitzTemDetails(product, targetDateISO, onSave) {
  let modal = document.getElementById('modal-blitz-tem-details');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-tem-details';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  let proofPhoto = '';
  const defaultCorridor = product.corridor || 'Corredor 1';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-tem-details-backdrop"></div>
    <div class="modal-card" style="padding: 18px; max-width: 420px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <h3 style="font-size: 1.02rem; font-weight: 900; color: #10b981; margin: 0; display: flex; align-items: center; gap: 6px;">
          <span>✅</span> <span>REGISTRAR PRODUTO ENCONTRADO</span>
        </h3>
        <button type="button" id="btn-close-tem-details" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <div style="font-size: 0.86rem; font-weight: 800; color: #f4f4f5; margin-bottom: 12px; line-height: 1.3;">
        ${product.name}
      </div>

      <form id="form-blitz-tem-details" style="display: flex; flex-direction: column; gap: 12px;">
        <!-- Data de Validade -->
        <div>
          <label for="input-tem-expiration-date" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            📅 Data de Validade:
          </label>
          <input
            type="date"
            id="input-tem-expiration-date"
            class="form-input"
            value="${targetDateISO}"
            required
            style="height: 44px; font-weight: 800;"
          />
        </div>

        <!-- Quantidade Encontrada -->
        <div>
          <label for="input-tem-quantity" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            📦 Quantidade Encontrada (unidades):
          </label>
          <input
            type="number"
            id="input-tem-quantity"
            class="form-input"
            min="1"
            step="1"
            placeholder="Ex: 24"
            required
            style="height: 46px; font-size: 1.2rem; font-weight: 900; color: #10b981;"
          />
        </div>

        <!-- Localização -->
        <div>
          <label for="input-tem-location" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            📍 Localização:
          </label>
          <input
            type="text"
            id="input-tem-location"
            class="form-input"
            value="${defaultCorridor}"
            placeholder="Ex: Corredor 1, Gôndola, Ponta de gôndola"
            required
            style="height: 44px; font-weight: 800;"
          />
        </div>

        <!-- Foto -->
        <div>
          <label style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            📷 Foto (Opcional):
          </label>
          <div style="display: flex; align-items: center; gap: 10px; background: #18181c; padding: 8px; border-radius: 8px; border: 1px solid #27272a;">
            <div id="tem-photo-preview-box" style="width: 56px; height: 56px; border-radius: 6px; overflow: hidden; background: #09090b; border: 1px solid #3f3f46; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <span id="tem-no-photo" style="font-size: 0.65rem; color: #71717a; font-weight: 700;">SEM FOTO</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; flex: 1;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-tem-photo-cam" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.75rem; font-weight: 800;">📷 Câmera</button>
                <button type="button" id="btn-tem-photo-gal" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.75rem; font-weight: 800;">🖼️ Galeria</button>
              </div>
              <button type="button" id="btn-tem-photo-del" class="btn-secondary-mini hidden" style="height: 24px; font-size: 0.7rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">🗑️ Remover Foto</button>
              <input type="file" id="file-tem-cam" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" class="hidden" />
              <input type="file" id="file-tem-gal" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" class="hidden" />
            </div>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button type="button" id="btn-cancel-tem-details" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.4; height: 46px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 0.92rem;">
            💾 SALVAR VERIFICAÇÃO
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-tem-details-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-tem-details')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-tem-details')?.addEventListener('click', closeModal);

  const fileCam = document.getElementById('file-tem-cam');
  const fileGal = document.getElementById('file-tem-gal');
  const previewBox = document.getElementById('tem-photo-preview-box');
  const removeBtn = document.getElementById('btn-tem-photo-del');

  const handleImageFile = async (file) => {
    if (!file) return;
    try {
      showToast('Processando foto...', 'sync', 800);
      const compressed = await compressImage(file, 600, 600, 0.72);
      proofPhoto = compressed;
      if (previewBox) {
        previewBox.innerHTML = `<img src="${compressed}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" />`;
      }
      if (removeBtn) removeBtn.classList.remove('hidden');
      showToast('✓ Foto adicionada', 'success', 1000);
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
    }
  };

  document.getElementById('btn-tem-photo-cam')?.addEventListener('click', () => fileCam?.click());
  document.getElementById('btn-tem-photo-gal')?.addEventListener('click', () => fileGal?.click());

  fileCam?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleImageFile(e.target.files[0]);
  });
  fileGal?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleImageFile(e.target.files[0]);
  });

  removeBtn?.addEventListener('click', () => {
    proofPhoto = '';
    if (previewBox) previewBox.innerHTML = `<span id="tem-no-photo" style="font-size: 0.65rem; color: #71717a; font-weight: 700;">SEM FOTO</span>`;
    removeBtn.classList.add('hidden');
    if (fileCam) fileCam.value = '';
    if (fileGal) fileGal.value = '';
  });

  document.getElementById('form-blitz-tem-details')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const expDate = document.getElementById('input-tem-expiration-date')?.value?.trim();
    const qty = Number(document.getElementById('input-tem-quantity')?.value) || 0;
    const loc = document.getElementById('input-tem-location')?.value?.trim() || defaultCorridor;

    if (!expDate) {
      showToast('Informe a data de validade', 'warning');
      return;
    }
    if (qty <= 0) {
      showToast('Informe a quantidade encontrada', 'warning');
      return;
    }

    closeModal();
    if (onSave) {
      onSave({
        expirationDate: expDate,
        quantity: qty,
        location: loc,
        photo: proofPhoto || null
      });
    }
  });
}

// ----------------------------------------------------
// 10. TRATAMENTO DE PRODUTO NÃO CADASTRADO (NÃO TRAVA)
// ----------------------------------------------------

function promptUnregisteredProductBlitz(barcode) {
  let modal = document.getElementById('modal-blitz-unregistered');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-unregistered';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-unreg-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 400px; width: 100%; box-sizing: border-box;">
      <div style="font-size: 2.2rem; margin-bottom: 4px; text-align: center;">⚠️</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; text-align: center; margin: 0 0 6px 0;">
        PRODUTO NÃO CADASTRADO
      </h3>

      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; padding: 10px; margin-bottom: 14px; text-align: center;">
        <div style="font-size: 0.72rem; color: #a1a1aa; text-transform: uppercase; font-weight: 800;">Código de Barras:</div>
        <div style="font-size: 1.2rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">${barcode}</div>
      </div>

      <p style="font-size: 0.82rem; color: #a1a1aa; text-align: center; margin-bottom: 16px; line-height: 1.4;">
        Este código não está no cadastro, mas isso não precisa parar sua conferência. Como deseja prosseguir?
      </p>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-blitz-quick-register" class="btn-primary" style="height: 48px; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; font-size: 0.95rem;">
          ➕ CADASTRAR PRODUTO
        </button>

        <button type="button" id="btn-blitz-continue-unregistered" class="btn-secondary" style="height: 44px; font-weight: 800; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4); font-size: 0.88rem;">
          ➡️ CONTINUAR SEM CADASTRAR
        </button>

        <button type="button" id="btn-blitz-unreg-cancel" style="background: none; border: none; color: #71717a; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 6px;">
          Cancelar e Bipar Próximo
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-unreg-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-blitz-unreg-cancel')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // Opção: CADASTRAR PRODUTO
  document.getElementById('btn-blitz-quick-register')?.addEventListener('click', () => {
    closeModal();
    openBlitzQuickRegisterModal(barcode, {
      defaultSector: currentActiveBlitzSession?.sector || 'MERCEARIA'
    });
  });

  // Opção: CONTINUAR SEM CADASTRAR (Pergunta Setor e Corredor e salva como Produto Verificado)
  document.getElementById('btn-blitz-continue-unregistered')?.addEventListener('click', () => {
    closeModal();
    const activeBlitzSector = currentActiveBlitzSession?.sector;
    const effectiveSec = (activeBlitzSector && activeBlitzSector !== 'GERAL') ? activeBlitzSector : 'MERCEARIA';

    promptVerifiedProductLocationModal({
      barcode: String(barcode).trim(),
      defaultSector: effectiveSec,
      defaultCorridor: 'Corredor 1',
      onConfirm: async ({ sector, corridor, name, barcode: finalBarcode, image }) => {
        showToast('Guardando produto verificado...', 'sync', 1000);
        try {
          let savedProd = await getProductByBarcode(finalBarcode);
          if (!savedProd) {
            savedProd = await saveProduct({
              barcode: finalBarcode,
              name: name || `PRODUTO ${finalBarcode}`,
              sector: sector || effectiveSec,
              corridor: corridor || 'Corredor 1',
              image: image || null,
              is_verified_only: true
            });
            triggerSyncNow().catch(e => console.warn('Sync error:', e));
          }
          showBlitzProductDatesVerification(savedProd);
        } catch (e) {
          console.warn('Erro ao salvar produto verificado:', e);
          showBlitzProductDatesVerification({
            id: null,
            barcode: finalBarcode,
            name: name || `PRODUTO ${finalBarcode}`,
            sector: sector || effectiveSec,
            corridor: corridor || 'Corredor 1',
            image: image || null,
            is_verified_only: true
          });
        }
      },
      onCancel: () => {
        startBlitzScanning();
      }
    });
  });
}

/**
 * Modal rápido para perguntar Setor e Corredor de um produto verificado (sem cadastro completo ou sem código)
 */
export function promptVerifiedProductLocationModal({
  barcode = '',
  defaultSector = 'MERCEARIA',
  defaultCorridor = 'Corredor 1',
  defaultName = '',
  defaultImage = '',
  title = 'LOCALIZAÇÃO DO PRODUTO',
  subtitle = 'Informe o Setor e Corredor para registrar este produto verificado:',
  onConfirm,
  onCancel
}) {
  let modal = document.getElementById('modal-verified-loc-prompt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-verified-loc-prompt';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const generatedCode = barcode || `SCOD-${Date.now().toString().slice(-6)}`;
  let verifiedProdImage = defaultImage || '';
  const blitzSec = currentActiveBlitzSession?.sector;
  const initialSector = (blitzSec && blitzSec !== 'GERAL') ? blitzSec : defaultSector;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-verified-loc-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.3rem;">📍</span>
          <div>
            <h3 style="font-size: 1.02rem; font-weight: 900; color: #f4f4f5; margin: 0;">${title}</h3>
            <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; text-transform: uppercase;">Produto Verificado</span>
          </div>
        </div>
        <button type="button" id="btn-close-verified-loc-modal" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <p style="font-size: 0.82rem; color: #a1a1aa; margin-bottom: 14px; line-height: 1.4;">
        ${subtitle}
      </p>

      <form id="form-verified-location-modal" style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <label style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">Código:</label>
          <input type="text" id="verified-input-barcode" class="form-input" value="${generatedCode}" style="font-family: monospace; font-weight: 800; color: #fbbf24; background: #18181c;" readonly />
        </div>

        <div>
          <label style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">Nome / Descrição Breve (Opcional):</label>
          <input type="text" id="verified-input-name" class="form-input" value="${defaultName || ''}" placeholder="Ex: PRODUTO SEM CÓDIGO" style="text-transform: uppercase; font-weight: 700;" />
        </div>

        <!-- Foto do Produto (Opcional) -->
        <div>
          <label style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">Foto do Produto (Opcional):</label>
          <div style="display: flex; align-items: center; gap: 12px; background: #18181c; padding: 10px; border-radius: 8px; border: 1px solid #2a2a30;">
            <div id="verified-photo-preview-box" style="width: 64px; height: 64px; border-radius: 6px; overflow: hidden; background: #09090b; border: 1px solid #3f3f46; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${verifiedProdImage ? `<img src="${verifiedProdImage}" alt="Foto" style="width:100%;height:100%;object-fit:cover;" />` : `<span id="verified-no-photo" style="font-size: 0.65rem; color: #71717a; font-weight: 700;">SEM FOTO</span>`}
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-verified-photo-camera" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.75rem; font-weight: 800;">📷 Câmera</button>
                <button type="button" id="btn-verified-photo-gallery" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.75rem; font-weight: 800;">🖼️ Galeria</button>
              </div>
              <button type="button" id="btn-verified-photo-remove" class="btn-secondary-mini ${verifiedProdImage ? '' : 'hidden'}" style="height: 26px; font-size: 0.7rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); font-weight: 700;">🗑️ Remover Foto</button>
              <input type="file" id="file-camera-verified" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" class="hidden" />
              <input type="file" id="file-gallery-verified" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" class="hidden" />
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div>
            <label for="verified-select-sector" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
              <span>Setor:</span>
              ${(blitzSec && blitzSec !== 'GERAL') ? `<span style="color: #fbbf24; font-size: 0.68rem; font-weight: 900;">🔒 Blitz</span>` : ''}
            </label>
            <select id="verified-select-sector" class="form-select" style="font-weight: 800; height: 42px; color: #fbbf24;">
              ${SETORS.map(s => `<option value="${s}" ${s === initialSector ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="verified-select-corridor" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">Corredor:</label>
            <select id="verified-select-corridor" class="form-select" style="font-weight: 700; height: 42px;">
              ${CORRIDORS.map(c => `<option value="${c}" ${c === defaultCorridor ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button type="button" id="btn-cancel-verified-loc-modal" class="btn-secondary" style="flex: 1; height: 44px; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.4; height: 44px; background: #10b981; color: #022c22; font-weight: 900;">
            ✓ CONTINUAR
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-verified-loc-backdrop')?.addEventListener('click', () => {
    closeModal();
    if (onCancel) onCancel();
  });
  document.getElementById('btn-close-verified-loc-modal')?.addEventListener('click', () => {
    closeModal();
    if (onCancel) onCancel();
  });
  document.getElementById('btn-cancel-verified-loc-modal')?.addEventListener('click', () => {
    closeModal();
    if (onCancel) onCancel();
  });

  const fileCameraVer = document.getElementById('file-camera-verified');
  const fileGalleryVer = document.getElementById('file-gallery-verified');
  const previewBoxVer = document.getElementById('verified-photo-preview-box');
  const removeBtnVer = document.getElementById('btn-verified-photo-remove');

  const handleVerifiedImageFile = async (file) => {
    if (!file) return;
    try {
      showToast('Processando foto...', 'sync', 1000);
      const compressed = await compressImage(file, 600, 600, 0.72);
      verifiedProdImage = compressed;
      if (previewBoxVer) {
        previewBoxVer.innerHTML = `<img src="${compressed}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" />`;
      }
      if (removeBtnVer) removeBtnVer.classList.remove('hidden');
      showToast('✓ Foto adicionada', 'success', 1200);
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      showToast('Erro ao carregar imagem', 'warning');
    }
  };

  document.getElementById('btn-verified-photo-camera')?.addEventListener('click', () => {
    fileCameraVer?.click();
  });
  document.getElementById('btn-verified-photo-gallery')?.addEventListener('click', () => {
    fileGalleryVer?.click();
  });

  fileCameraVer?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleVerifiedImageFile(e.target.files[0]);
    }
  });
  fileGalleryVer?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleVerifiedImageFile(e.target.files[0]);
    }
  });

  removeBtnVer?.addEventListener('click', () => {
    verifiedProdImage = '';
    if (previewBoxVer) {
      previewBoxVer.innerHTML = `<span id="verified-no-photo" style="font-size: 0.65rem; color: #71717a; font-weight: 700;">SEM FOTO</span>`;
    }
    removeBtnVer.classList.add('hidden');
    if (fileCameraVer) fileCameraVer.value = '';
    if (fileGalleryVer) fileGalleryVer.value = '';
    showToast('Foto removida', 'info', 1000);
  });

  document.getElementById('form-verified-location-modal')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const finalBarcode = document.getElementById('verified-input-barcode')?.value?.trim() || generatedCode;
    const nameInput = document.getElementById('verified-input-name')?.value?.trim();
    const chosenSector = document.getElementById('verified-select-sector')?.value || 'MERCEARIA';
    const chosenCorridor = document.getElementById('verified-select-corridor')?.value || 'Corredor 1';
    closeModal();
    if (onConfirm) {
      onConfirm({
        barcode: finalBarcode,
        name: nameInput || `PRODUTO ${finalBarcode}`,
        sector: chosenSector,
        corridor: chosenCorridor,
        image: verifiedProdImage || null
      });
    }
  });
}

// Modal de Cadastro Rápido de Produto
export function openBlitzQuickRegisterModal(barcode, options = {}) {
  let modal = document.getElementById('modal-blitz-quick-form');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-quick-form';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  let quickProdImage = '';
  const blitzSec = currentActiveBlitzSession?.sector;
  const initialSector = (blitzSec && blitzSec !== 'GERAL') ? blitzSec : (options.defaultSector || 'MERCEARIA');

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-quick-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 430px; width: 100%; box-sizing: border-box; max-height: 92vh; overflow-y: auto;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0; display: flex; align-items: center; gap: 6px;">
          ⚡ CADASTRO RÁPIDO DO PRODUTO
        </h3>
        <button type="button" id="btn-close-quick-reg" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <form id="form-blitz-quick-reg" style="display: flex; flex-direction: column; gap: 10px;">
        <div class="form-group">
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">CÓDIGO DE BARRAS:</label>
          <input type="text" id="quick-prod-barcode" class="form-input" value="${barcode}" readonly style="background: #18181c; color: #fbbf24; font-weight: 800; font-family: monospace;" />
        </div>

        <div class="form-group">
          <label for="quick-prod-name" style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">NOME DO PRODUTO:</label>
          <input type="text" id="quick-prod-name" class="form-input" placeholder="Ex: BISCOITO RANCHEIRO 90G" required autofocus style="text-transform: uppercase;" />
        </div>

        <!-- Fotografia do Produto -->
        <div class="form-group" style="margin-bottom: 2px;">
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; display: block; margin-bottom: 6px;">
            FOTO DO PRODUTO (OPCIONAL):
          </label>
          <div style="display: flex; align-items: center; gap: 12px; background: #18181c; padding: 10px; border-radius: 8px; border: 1px solid #2a2a30;">
            <div id="quick-photo-preview-box" style="width: 64px; height: 64px; border-radius: 6px; overflow: hidden; background: #09090b; border: 1px solid #3f3f46; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <span id="quick-no-photo" style="font-size: 0.65rem; color: #71717a; font-weight: 700;">SEM FOTO</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-quick-photo-camera" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.76rem; font-weight: 800;">
                  📷 Câmera
                </button>
                <button type="button" id="btn-quick-photo-gallery" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.76rem; font-weight: 800;">
                  🖼️ Galeria
                </button>
              </div>
              <button type="button" id="btn-quick-photo-remove" class="btn-secondary-mini hidden" style="height: 26px; font-size: 0.7rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); font-weight: 700;">
                🗑️ Remover Foto
              </button>
              <input type="file" id="file-camera-quick" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" class="hidden" />
              <input type="file" id="file-gallery-quick" accept="image/*,image/jpeg,image/png,image/webp,image/heic,image/heif" class="hidden" />
            </div>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div class="form-group">
            <label for="quick-prod-sector" style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; display: flex; justify-content: space-between; align-items: center;">
              <span>SETOR:</span>
              ${(blitzSec && blitzSec !== 'GERAL') ? `<span style="color: #fbbf24; font-size: 0.68rem; font-weight: 900;">🔒 Blitz</span>` : ''}
            </label>
            <select id="quick-prod-sector" class="form-input" style="color: #fbbf24; font-weight: 800;">
              ${SETORS.map(s => `<option value="${s}" ${s === initialSector ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>

          <div class="form-group">
            <label for="quick-prod-corridor" style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">CORREDOR:</label>
            <select id="quick-prod-corridor" class="form-input">
              ${CORRIDORS.map(c => `<option value="${c}">${c}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button type="button" id="btn-cancel-quick-reg" class="btn-secondary" style="flex: 1; height: 44px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.2; height: 44px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900;">
            ✓ SALVAR E CONFERIR
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-quick-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-quick-reg')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-quick-reg')?.addEventListener('click', () => {
    closeModal();
    if (options.onCancel) {
      options.onCancel();
    } else {
      startBlitzScanning();
    }
  });

  const fileCameraQuick = document.getElementById('file-camera-quick');
  const fileGalleryQuick = document.getElementById('file-gallery-quick');
  const previewBoxQuick = document.getElementById('quick-photo-preview-box');
  const removeBtnQuick = document.getElementById('btn-quick-photo-remove');

  const handleQuickImageFile = async (file) => {
    if (!file) return;
    try {
      showToast('Processando foto...', 'sync', 1000);
      const compressed = await compressImage(file, 600, 600, 0.72);
      quickProdImage = compressed;
      if (previewBoxQuick) {
        previewBoxQuick.innerHTML = `<img src="${compressed}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" />`;
      }
      if (removeBtnQuick) removeBtnQuick.classList.remove('hidden');
      showToast('✓ Foto adicionada', 'success', 1200);
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      showToast('Erro ao carregar imagem', 'warning');
    }
  };

  document.getElementById('btn-quick-photo-camera')?.addEventListener('click', () => {
    fileCameraQuick?.click();
  });
  document.getElementById('btn-quick-photo-gallery')?.addEventListener('click', () => {
    fileGalleryQuick?.click();
  });

  fileCameraQuick?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleQuickImageFile(e.target.files[0]);
    }
  });
  fileGalleryQuick?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleQuickImageFile(e.target.files[0]);
    }
  });

  removeBtnQuick?.addEventListener('click', () => {
    quickProdImage = '';
    if (previewBoxQuick) {
      previewBoxQuick.innerHTML = `<span id="quick-no-photo" style="font-size: 0.65rem; color: #71717a; font-weight: 700;">SEM FOTO</span>`;
    }
    removeBtnQuick.classList.add('hidden');
    if (fileCameraQuick) fileCameraQuick.value = '';
    if (fileGalleryQuick) fileGalleryQuick.value = '';
    showToast('Foto removida', 'info', 1000);
  });

  document.getElementById('form-blitz-quick-reg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('quick-prod-name')?.value.trim().toUpperCase();
    const sector = document.getElementById('quick-prod-sector')?.value || 'MERCEARIA';
    const corridor = document.getElementById('quick-prod-corridor')?.value || 'Corredor 1';

    if (!name) {
      showToast('Informe o nome do produto', 'warning');
      return;
    }

    try {
      showToast('Cadastrando produto...', 'sync', 1000);
      const savedProd = await saveProduct({
        barcode: barcode,
        name: name,
        sector: sector,
        corridor: corridor,
        image: quickProdImage || null
      });

      closeModal();
      showToast(`✓ Produto cadastrado: ${name}`, 'success', 1500);
      triggerSyncNow().catch(e => console.warn('Sync error:', e));

      if (options.onSuccess) {
        options.onSuccess(savedProd);
      } else if (getActiveBlitz()) {
        // Continua direto para a verificação de datas na blitz
        showBlitzProductDatesVerification(savedProd);
      } else {
        openConferenceForProduct(savedProd);
      }
    } catch (err) {
      console.error('Erro ao salvar produto rápido:', err);
      showToast('Erro ao cadastrar produto', 'warning');
    }
  });
}

// ----------------------------------------------------
// 5. QUAL A DATA SOLICITADA? (MANUAL DO PAPEL)
// ----------------------------------------------------

export async function promptRequestedExpirationDate(product) {
  let modal = document.getElementById('modal-blitz-date-prompt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-date-prompt';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // Busca validades já cadastradas no banco deste produto se existirem
  let knownExpirations = [];
  if (product && product.id) {
    try {
      knownExpirations = (await getProductExpirations(product.id)) || [];
    } catch (err) {
      console.warn('Erro ao buscar validades do produto:', err);
    }
  }

  // Busca histórico de conferências anteriores para este produto ou código
  let pastBlitzItems = [];
  try {
    if (product?.id) {
      pastBlitzItems = await getAllBlitzItemsForProduct(product.id);
    } else if (product?.barcode) {
      pastBlitzItems = await getAllBlitzItemsForBarcode(product.barcode);
    }
  } catch (err) {
    console.warn('Erro ao buscar blitz anteriores:', err);
  }

  // Agrupa datas conhecidas (cadastradas + encontradas no histórico semanal)
  const dateMap = new Map();
  knownExpirations.forEach(exp => {
    if (exp.expiration_date) {
      dateMap.set(exp.expiration_date, {
        iso: exp.expiration_date,
        lastQty: null,
        lastDate: null,
        result: null
      });
    }
  });

  pastBlitzItems.forEach(item => {
    const d = item.requested_expiration_date;
    if (d) {
      const existing = dateMap.get(d) || { iso: d, lastQty: null, lastDate: null, result: null };
      dateMap.set(d, existing);
    }
  });

  // Carrega histórico completo para cada validade existente no banco
  for (const [d, info] of dateMap.entries()) {
    try {
      const conf = await getComprehensiveConferenceRecordForProductAndDate(product, d);
      if (conf) {
        info.lastQty = Number(conf.total) || 0;
        info.lastDate = conf.date ? formatDateBR(conf.date.split('T')[0]) : null;
        info.result = conf.result;
        info.userName = conf.userName;
      }
    } catch (_) {}
  }

  // Data padrão inicial: Início da Blitz ativa ou Hoje
  const defaultDateISO = currentActiveBlitzSession?.start_date || getTodayISO();

  // Chips de validades já cadastradas com histórico de quantidades anteriores
  let knownChipsHtml = '';
  if (dateMap.size > 0) {
    const chipsList = Array.from(dateMap.values());
    const chips = chipsList.map(info => {
      const dateBR = formatDateBR(info.iso);
      let subText = '';
      if (info.lastQty !== null && info.lastQty !== undefined) {
        subText = info.lastQty > 0
          ? `<span style="font-size: 0.74rem; color: #34d399; font-weight: 800;">(Tinha ${info.lastQty} un${info.lastDate ? ` em ${info.lastDate}` : ''})</span>`
          : `<span style="font-size: 0.74rem; color: #f87171; font-weight: 800;">(0 un / Não tem${info.lastDate ? ` em ${info.lastDate}` : ''})</span>`;
      }
      return `
        <button type="button" class="btn-known-chip btn-secondary" data-iso="${info.iso}" style="padding: 10px 12px; font-size: 0.88rem; font-weight: 800; border-color: rgba(16, 185, 129, 0.4); color: #10b981; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; background: rgba(16, 185, 129, 0.05);">
          <span>📅 <strong>${dateBR}</strong></span>
          ${subText}
        </button>
      `;
    }).join('');

    knownChipsHtml = `
      <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 10px; padding: 10px;">
        <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; text-transform: uppercase; margin-bottom: 6px;">
          ⚡ Validades já registradas deste produto (Toque para usar):
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          ${chips}
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-date-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 430px; width: 100%; box-sizing: border-box;">
      
      <!-- Cabeçalho do Produto -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 12px;">
        <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; text-transform: uppercase;">
          📦 PRODUTO BIPADO:
        </div>
        <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 2px 0 0 0; line-height: 1.3;">
          ${product.name}
        </h3>
        <div style="font-size: 0.76rem; color: #fbbf24; font-weight: 800; margin-top: 4px;">
          Código: ${product.barcode}
        </div>
      </div>

      <!-- Pergunta Principal: QUAL A DATA SOLICITADA? -->
      <form id="form-blitz-requested-date" style="display: flex; flex-direction: column; gap: 12px;">
        <div style="text-align: center;">
          <div style="font-size: 1.4rem; margin-bottom: 2px;">📅</div>
          <div style="font-size: 1.05rem; font-weight: 900; color: #fef08a; display: block;">
            QUAL A DATA SOLICITADA?
          </div>
          <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">
            Olhe no papel físico e escolha no calendário:
          </div>
        </div>

        <!-- BOX DO CALENDÁRIO TOUCH (NÃO PRECISA DIGITAR) -->
        <div style="background: #18181c; border: 2px solid #f59e0b; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; box-shadow: 0 4px 14px rgba(245, 158, 11, 0.15);">
          
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 0.74rem; font-weight: 800; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.5px;">
              📆 CALENDÁRIO NA TELA:
            </span>
            <span style="font-size: 0.7rem; color: #10b981; font-weight: 700;">
              Toque no campo ou botão
            </span>
          </div>

          <!-- INPUT DE DATA COM CALENDÁRIO NATIVO DA TELA -->
          <div style="position: relative; width: 100%;">
            <input
              type="date"
              id="input-requested-date-picker"
              class="form-input form-input-lg"
              value="${defaultDateISO}"
              required
              style="width: 100%; height: 56px; font-size: 1.35rem; font-weight: 900; text-align: center; color: #fef08a; background: #121214; border: 1px solid #3f3f46; border-radius: 8px; color-scheme: dark; cursor: pointer; box-sizing: border-box; padding: 0 12px;"
            />
          </div>

          <!-- FEEDBACK VISUAL EM FORMATO BRASILEIRO (DD/MM/AAAA) -->
          <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: rgba(16, 185, 129, 0.1); border-radius: 6px; border: 1px dashed rgba(16, 185, 129, 0.35);">
            <span style="font-size: 0.75rem; color: #a1a1aa; font-weight: 700;">Validade Selecionada:</span>
            <span id="requested-date-display-br" style="font-size: 1.2rem; font-weight: 900; color: #10b981; letter-spacing: 0.5px;">
              ${formatDateBR(defaultDateISO)}
            </span>
          </div>

          <!-- BOTÃO DESTACADO PARA ABRIR O CALENDÁRIO -->
          <button type="button" id="btn-open-picker-explicit" style="width: 100%; height: 44px; background: #27272a; border: 1px solid #f59e0b; border-radius: 8px; color: #fbbf24; font-size: 0.88rem; font-weight: 900; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px;">
            📅 ABRIR CALENDÁRIO
          </button>
        </div>

        <!-- FEEDBACK EM TEMPO REAL DA CONFERÊNCIA ANTERIOR DESTA DATA -->
        <div id="live-date-conference-feedback"></div>

        ${knownChipsHtml}

        <!-- ATALHOS RÁPIDOS DE DIAS -->
        <div>
          <div style="font-size: 0.68rem; color: #71717a; font-weight: 700; text-transform: uppercase; margin-bottom: 4px; text-align: center;">
            Atalhos rápidos:
          </div>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
            <button type="button" class="btn-secondary btn-quick-date" data-days="0" style="padding: 7px 2px; font-size: 0.74rem; font-weight: 800; justify-content: center;">Hoje</button>
            <button type="button" class="btn-secondary btn-quick-date" data-days="7" style="padding: 7px 2px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+7 dias</button>
            <button type="button" class="btn-secondary btn-quick-date" data-days="15" style="padding: 7px 2px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+15 dias</button>
            <button type="button" class="btn-secondary btn-quick-date" data-days="30" style="padding: 7px 2px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+30 dias</button>
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <button type="button" id="btn-cancel-req-date" class="btn-secondary" style="flex: 1; height: 48px; justify-content: center; font-size: 0.9rem; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" id="btn-confirm-req-date" class="btn-primary" style="flex: 1.3; height: 48px; justify-content: center; background: #f59e0b; color: #000; font-weight: 900; font-size: 0.98rem;">
            CONTINUAR ➔
          </button>
        </div>
      </form>

    </div>
  `;

  modal.classList.add('open');

  const pickerInput = document.getElementById('input-requested-date-picker');
  const displayBr = document.getElementById('requested-date-display-br');

  // Função para verificar e exibir em tempo real o histórico da data selecionada
  const checkAndDisplayDateHistory = async (isoVal, shouldSpeak = false) => {
    const feedbackEl = document.getElementById('live-date-conference-feedback');
    if (!feedbackEl) return;
    if (!isoVal) {
      feedbackEl.innerHTML = '';
      return;
    }
    const conf = await getComprehensiveConferenceRecordForProductAndDate(product, isoVal);
    if (conf) {
      const confDateBR = conf.date ? formatDateBR(conf.date.split('T')[0]) : '';
      const confTime = conf.date && conf.date.includes('T')
        ? new Date(conf.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '';
      const dateFormatted = formatDateBR(isoVal);
      const prevQty = Number(conf.total) || 0;
      const prodName = product.name || conf.productName || `PRODUTO ${product.barcode}`;
      const qtyText = prevQty > 0 ? `${formatNumber(prevQty)} unidades` : '0 unidades (NÃO TEM)';

      feedbackEl.innerHTML = `
        <div style="background: rgba(30, 58, 138, 0.4); border: 2px solid #3b82f6; border-radius: 10px; padding: 12px; margin-top: 4px; text-align: left; box-shadow: 0 4px 14px rgba(59, 130, 246, 0.2);">
          <div style="font-size: 0.72rem; color: #60a5fa; font-weight: 900; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span>📢</span> <span>CONFERÊNCIA ANTERIOR NO BANCO:</span>
            </div>
          </div>
          <div style="font-size: 0.88rem; font-weight: 800; color: #f0f9ff; margin-top: 6px; line-height: 1.4;">
            O produto <span style="color: #fef08a;">${prodName}</span> foi conferido para essa data (<strong>${dateFormatted}</strong>) no dia <strong>${confDateBR}</strong>${confTime ? ` às ${confTime}` : ''} e tinha <strong style="color: ${prevQty > 0 ? '#34d399' : '#f87171'};">${qtyText}</strong>.
          </div>
          ${conf.locations && conf.locations.length > 0 ? `
            <div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;">
              ${conf.locations.filter(l => Number(l.quantity) > 0).map(l => `<span style="background: rgba(59, 130, 246, 0.25); border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; color: #bfdbfe;">${l.location}: <strong>${formatNumber(l.quantity)} un</strong></span>`).join(' ')}
            </div>
          ` : ''}
        </div>
      `;
    } else {
      feedbackEl.innerHTML = `
        <div style="background: rgba(39, 39, 42, 0.4); border: 1px dashed #3f3f46; border-radius: 8px; padding: 8px 10px; margin-top: 4px; text-align: left; display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.82rem;">✨</span>
          <span style="font-size: 0.74rem; color: #a1a1aa;">Primeira conferência registrada para esta data (${formatDateBR(isoVal)}).</span>
        </div>
      `;
    }
  };

  const updateDate = (isoVal, shouldSpeak = false) => {
    if (!isoVal) return;
    if (pickerInput) pickerInput.value = isoVal;
    if (displayBr) displayBr.textContent = formatDateBR(isoVal);
    checkAndDisplayDateHistory(isoVal, shouldSpeak);
  };

  const triggerCalendar = () => {
    if (!pickerInput) return;
    try {
      if (typeof pickerInput.showPicker === 'function') {
        pickerInput.showPicker();
        return;
      }
    } catch (e) {}
    pickerInput.focus();
    pickerInput.click();
  };

  // Eventos para abrir o calendário
  document.getElementById('btn-open-picker-explicit')?.addEventListener('click', triggerCalendar);
  pickerInput?.addEventListener('click', triggerCalendar);

  // Mudança de data no calendário
  pickerInput?.addEventListener('input', (e) => updateDate(e.target.value, false));
  pickerInput?.addEventListener('change', (e) => updateDate(e.target.value, false));

  // Atalhos de dias
  modal.querySelectorAll('.btn-quick-date').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.getAttribute('data-days') || '0', 10);
      const d = new Date();
      d.setDate(d.getDate() + days);
      const iso = d.toISOString().split('T')[0];
      updateDate(iso, false);
    });
  });

  // Chips de datas já cadastradas
  modal.querySelectorAll('.btn-known-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const iso = btn.getAttribute('data-iso');
      if (iso) updateDate(iso, true);
    });
  });

  // Checa a data padrão inicial assim que o modal abre
  checkAndDisplayDateHistory(defaultDateISO, false);

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-date-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-req-date')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('form-blitz-requested-date')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chosenISO = pickerInput?.value?.trim();
    if (!chosenISO) {
      showToast('Selecione uma data no calendário', 'warning');
      triggerCalendar();
      return;
    }

    closeModal();

    // 13. EVITAR DUPLICIDADE ACIDENTAL
    await checkDuplicityAndPromptDecision(product, chosenISO);
  });
}

// ----------------------------------------------------
// 13. VERIFICA DUPLICIDADE ACIDENTAL (MESMO CÓDIGO + MESMA DATA)
// ----------------------------------------------------

async function checkDuplicityAndPromptDecision(product, requestedDateISO) {
  if (!currentActiveBlitzSession) return;

  // Verifica se já foi conferido exatamente esse código e essa data nesta mesma blitz
  const existingItem = await getBlitzItemBySessionBarcodeAndDate(
    currentActiveBlitzSession.id,
    product.barcode,
    requestedDateISO
  );

  if (existingItem) {
    showDuplicityWarningModal({
      product,
      requestedDate: requestedDateISO,
      existingItem
    });
    return;
  }

  // Se não é duplicidade, segue direto para a pergunta TEM / NÃO TEM
  await showHasOrNotDecisionModal({
    product,
    requestedDate: requestedDateISO,
    existingItem: null
  });
}

// Modal de Aviso de Duplicidade
function showDuplicityWarningModal({ product, requestedDate, existingItem }) {
  let modal = document.getElementById('modal-blitz-duplicity');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-duplicity';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const isTem = existingItem.result === 'TEM';
  const qtyStr = isTem ? `${formatNumber(existingItem.total_quantity)} unidades` : '0 unidades (NÃO TEM)';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-duplicity-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      <div style="font-size: 2.2rem; margin-bottom: 4px; text-align: center;">⚠️</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #fbbf24; text-align: center; margin: 0 0 6px 0;">
        ESTE PRODUTO JÁ FOI CONFERIDO
      </h3>

      <div style="background: #18181c; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 8px; padding: 12px; margin-bottom: 14px;">
        <div style="font-size: 0.88rem; font-weight: 900; color: #f4f4f5;">${product.name}</div>
        <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">Cód: ${product.barcode}</div>
        <div style="font-size: 0.82rem; color: #fbbf24; font-weight: 800; margin-top: 6px;">
          Validade solicitada: ${formatDateBR(requestedDate)}
        </div>
        <div style="font-size: 0.88rem; font-weight: 900; color: ${isTem ? '#10b981' : '#ef4444'}; margin-top: 4px;">
          Resultado anterior: ${isTem ? '🟢 TEM' : '🔴 NÃO TEM'} (${qtyStr})
        </div>
      </div>

      <p style="font-size: 0.82rem; color: #a1a1aa; text-align: center; margin-bottom: 16px;">
        Você já registrou esta mesma validade nesta blitz. O que deseja fazer?
      </p>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <button type="button" id="btn-duplicity-redo" class="btn-secondary" style="height: 48px; font-weight: 900; justify-content: center; color: #fbbf24; border-color: #f59e0b;">
          🔄 REFAZER
        </button>
        <button type="button" id="btn-duplicity-next" class="btn-primary" style="height: 48px; font-weight: 900; justify-content: center; background: #10b981; color: #022c22;">
          ➡️ PRÓXIMO
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-duplicity-backdrop')?.addEventListener('click', closeModal);

  document.getElementById('btn-duplicity-next')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-duplicity-redo')?.addEventListener('click', async () => {
    closeModal();
    await showHasOrNotDecisionModal({
      product,
      requestedDate,
      existingItem // Passa para substituir/atualizar
    });
  });
}

// ----------------------------------------------------
// 6. PERGUNTAR SE TEM (TEM OU NÃO TEM) COM HISTÓRICO ANTERIOR
// ----------------------------------------------------

async function showHasOrNotDecisionModal({ product, requestedDate, existingItem = null }) {
  let modal = document.getElementById('modal-blitz-has-or-not');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-has-or-not';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // 1. Busca conferência anterior dessa MESMA validade (no banco de dados de blitz, inventário ou cadastro)
  const confRecord = await getComprehensiveConferenceRecordForProductAndDate(
    product,
    requestedDate,
    existingItem?.id || null
  );

  let historyBannerHtml = '';

  if (confRecord) {
    const confDate = confRecord.date ? formatDateBR(confRecord.date.split('T')[0]) : '';
    const confTime = confRecord.date && confRecord.date.includes('T')
      ? new Date(confRecord.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';
    const prevQty = Number(confRecord.total) || 0;
    const prevUser = confRecord.userName || 'Conferente';
    const prodName = product.name || confRecord.productName || `PRODUTO ${product.barcode}`;
    const dateFormatted = formatDateBR(requestedDate);
    const qtyText = prevQty > 0 ? `${formatNumber(prevQty)} unidades` : '0 unidades (NÃO TEM)';

    let locsSummary = '';
    if (confRecord.locations && confRecord.locations.length > 0) {
      locsSummary = confRecord.locations
        .filter(l => Number(l.quantity) > 0)
        .map(l => `<span style="background: rgba(59, 130, 246, 0.25); border: 1px solid rgba(59, 130, 246, 0.4); padding: 2px 7px; border-radius: 4px; font-size: 0.74rem;">${l.location}: <strong>${formatNumber(l.quantity)} un</strong></span>`)
        .join(' ');
    }

    historyBannerHtml = `
      <div style="background: rgba(30, 58, 138, 0.4); border: 2px solid #3b82f6; border-radius: 12px; padding: 12px; margin-bottom: 14px; text-align: left; box-shadow: 0 4px 16px rgba(59, 130, 246, 0.2);">
        <div style="font-size: 0.72rem; color: #60a5fa; font-weight: 900; text-transform: uppercase; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 5px;">
            <span>🕒</span> <span>HISTÓRICO DA CONFERÊNCIA ANTERIOR:</span>
          </div>
        </div>
        <div style="font-size: 0.92rem; font-weight: 800; color: #f0f9ff; margin-top: 6px; line-height: 1.45;">
          O produto <span style="color: #fef08a;">${prodName}</span> foi conferido para a validade <strong>${dateFormatted}</strong> no dia <strong>${confDate}</strong>${confTime ? ` às ${confTime}` : ''} e tinha <strong style="color: ${prevQty > 0 ? '#34d399' : '#f87171'};">${qtyText}</strong>.
        </div>
        ${locsSummary ? `
          <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px;">
            ${locsSummary}
          </div>
        ` : ''}
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 6px;">
          Origem: <strong>${confRecord.source === 'blitz' ? '⚡ Blitz Semanal' : '📋 Inventário / Cadastro'}</strong> | Registrado por: <strong>${prevUser}</strong>
        </div>
      </div>
    `;
  } else {
    historyBannerHtml = `
      <div style="background: rgba(39, 39, 42, 0.45); border: 1px solid #3f3f46; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; text-align: left; display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 0.85rem;">✨</span>
        <span style="font-size: 0.78rem; color: #a1a1aa;">Primeira conferência registrada para esta data de validade (${formatDateBR(requestedDate)}).</span>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-hon-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      
      <!-- Detalhes do Produto e Validade Solicitada -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 12px;">
        <h3 style="font-size: 1rem; font-weight: 900; color: #f4f4f5; margin: 0 0 2px 0; line-height: 1.3;">
          ${product.name}
        </h3>
        <div style="font-size: 0.74rem; color: #a1a1aa;">
          Código: <strong>${product.barcode}</strong>
        </div>
      </div>

      <!-- Validade Solicitada Destaque -->
      <div style="background: rgba(245, 158, 11, 0.12); border: 2px solid rgba(245, 158, 11, 0.5); border-radius: 10px; padding: 10px; text-align: center; margin-bottom: 12px;">
        <div style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; text-transform: uppercase;">
          VALIDADE SOLICITADA NO PAPEL:
        </div>
        <div style="font-size: 1.4rem; font-weight: 900; color: #fef08a; margin-top: 2px;">
          ${formatDateBR(requestedDate)}
        </div>
      </div>

      <!-- Informação do Histórico Anterior -->
      ${historyBannerHtml}

      <!-- Pergunta Crucial -->
      <div style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; text-align: center; margin-bottom: 16px;">
        O PRODUTO POSSUI ESSA VALIDADE?
      </div>

      <!-- Dois Botões Grandes: TEM ou NÃO TEM -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px;">
        <button type="button" id="btn-blitz-nao-tem" class="btn-secondary" style="
          height: 64px;
          border: 2px solid rgba(239, 68, 68, 0.6);
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
          font-size: 1.15rem;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 10px;
          cursor: pointer;
        ">
          <span>❌</span>
          <span>NÃO TEM</span>
        </button>

        <button type="button" id="btn-blitz-tem" class="btn-primary" style="
          height: 64px;
          background: #10b981;
          color: #022c22;
          font-size: 1.15rem;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border-radius: 10px;
          cursor: pointer;
        ">
          <span>✅</span>
          <span>TEM</span>
        </button>
      </div>

      <div style="text-align: center; margin-top: 8px;">
        <button type="button" id="btn-blitz-hon-cancel" style="background: none; border: none; color: #71717a; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 4px;">
          Voltar ao Scanner
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-hon-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-blitz-hon-cancel')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // 7. SE NÃO TEM: Salva automaticamente sem perguntas adicionais
  document.getElementById('btn-blitz-nao-tem')?.addEventListener('click', async () => {
    closeModal();
    await saveBlitzNaoTemConference(product, requestedDate, existingItem);
  });

  // 8. SE TEM: Pergunta localização e quantidades
  document.getElementById('btn-blitz-tem')?.addEventListener('click', () => {
    closeModal();
    showBlitzLocationsAndQuantitiesModal(product, requestedDate, existingItem);
  });
}

// ----------------------------------------------------
// 7. SE NÃO TEM: SALVAMENTO AUTOMÁTICO IMEDIATO
// ----------------------------------------------------

async function saveBlitzNaoTemConference(product, requestedDate, existingItem = null) {
  if (!currentActiveBlitzSession) return;

  try {
    showToast('Salvando NÃO TEM...', 'sync', 800);

    const now = new Date();
    const confDate = formatDateBR(now.toISOString().split('T')[0]);
    const confTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const activeSector = (currentActiveBlitzSession?.sector && currentActiveBlitzSession.sector !== 'GERAL')
      ? currentActiveBlitzSession.sector
      : (product.sector || 'GERAL');

    await saveBlitzConferenceRecord({
      id: existingItem?.id || null,
      sessionId: currentActiveBlitzSession.id,
      productId: product.id || null,
      barcode: product.barcode,
      sector: activeSector,
      requestedDate: requestedDate,
      previousQuantity: existingItem ? Number(existingItem.total_quantity) || 0 : 0,
      newQuantity: 0,
      result: 'NAO_TEM',
      locations: [],
      userId: getCurrentUser()?.id || currentActiveBlitzSession.responsible_user_id || currentActiveBlitzSession.user_id || 'ana_luiza',
      userName: getCurrentUser()?.name || currentActiveBlitzSession.responsible_user_name || currentActiveBlitzSession.user_name || 'Ana Luiza',
      responsible_user_id: getCurrentUser()?.id || currentActiveBlitzSession.responsible_user_id || currentActiveBlitzSession.user_id || 'ana_luiza',
      responsible_user_name: getCurrentUser()?.name || currentActiveBlitzSession.responsible_user_name || currentActiveBlitzSession.user_name || 'Ana Luiza'
    });

    triggerSyncNow().catch(e => console.warn('Sync error:', e));

    // Exibe tela de sucesso e disponibiliza imediatamente: 📷 PRÓXIMO PRODUTO
    showConferenceSuccessModal({
      product,
      requestedDate,
      result: 'NAO_TEM',
      totalQuantity: 0,
      confDate,
      confTime
    });
  } catch (err) {
    console.error('Erro ao salvar NÃO TEM:', err);
    showToast('Erro ao registrar conferência', 'warning');
  }
}

// ----------------------------------------------------
// 8. SE TEM: REGISTRO DA QUANTIDADE E ONDE ENCONTROU
// ----------------------------------------------------

function showBlitzLocationsAndQuantitiesModal(product, requestedDate, existingItem = null) {
  let modal = document.getElementById('modal-blitz-locations');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-locations';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // Preenche valores anteriores se existirem (para caso de refazer)
  const locMap = {};
  if (existingItem && Array.isArray(existingItem.locations)) {
    existingItem.locations.forEach(l => {
      locMap[l.location] = Number(l.quantity) || 0;
    });
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-locs-backdrop"></div>
    <div class="modal-card" style="padding: 18px; max-width: 440px; width: 100%; box-sizing: border-box; max-height: 90vh; display: flex; flex-direction: column;">
      
      <!-- Cabeçalho -->
      <div style="border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 10px;">
        <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; text-transform: uppercase;">
          ✅ PRODUTO ENCONTRADO (TEM)
        </div>
        <h3 style="font-size: 0.98rem; font-weight: 900; color: #f4f4f5; margin: 2px 0 0 0; line-height: 1.3;">
          ${product.name}
        </h3>
        <div style="font-size: 0.78rem; color: #fbbf24; font-weight: 800; margin-top: 2px;">
          Validade: ${formatDateBR(requestedDate)}
        </div>
      </div>

      <div style="font-size: 0.9rem; font-weight: 900; color: #fef08a; display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
        <span>📦</span>
        <span>ONDE ENCONTROU?</span>
      </div>

      <!-- Formulário de Locais -->
      <form id="form-blitz-locations-count" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px;">
        
        <!-- Área de Venda (Em destaque) -->
        <div class="loc-input-row" style="background: #18181c; border: 1px solid #3f3f46; border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between;">
          <label for="loc-qty-venda" style="font-size: 0.88rem; font-weight: 800; color: #f4f4f5;">
            🛒 Área de Venda:
          </label>
          <input
            type="number"
            id="loc-qty-venda"
            class="form-input loc-qty-input"
            data-loc="Área de venda"
            min="0"
            value="${locMap['Área de venda'] || ''}"
            placeholder="0"
            autofocus
            style="width: 100px; height: 38px; text-align: center; font-size: 1.1rem; font-weight: 900; color: #10b981;"
          />
        </div>

        <!-- Depósito (Em destaque) -->
        <div class="loc-input-row" style="background: #18181c; border: 1px solid #3f3f46; border-radius: 8px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between;">
          <label for="loc-qty-deposito" style="font-size: 0.88rem; font-weight: 800; color: #f4f4f5;">
            🏢 Depósito:
          </label>
          <input
            type="number"
            id="loc-qty-deposito"
            class="form-input loc-qty-input"
            data-loc="Depósito"
            min="0"
            value="${locMap['Depósito'] || ''}"
            placeholder="0"
            style="width: 100px; height: 38px; text-align: center; font-size: 1.1rem; font-weight: 900; color: #10b981;"
          />
        </div>

        <!-- Outras Localizações Rápidas -->
        ${BLITZ_LOCATIONS.filter(l => l !== 'Área de venda' && l !== 'Depósito').map((loc, idx) => `
          <div class="loc-input-row" style="background: #141416; border: 1px solid #27272a; border-radius: 8px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between;">
            <label for="loc-qty-${idx}" style="font-size: 0.8rem; font-weight: 700; color: #a1a1aa;">
              ${loc}:
            </label>
            <input
              type="number"
              id="loc-qty-${idx}"
              class="form-input loc-qty-input"
              data-loc="${loc}"
              min="0"
              value="${locMap[loc] || ''}"
              placeholder="0"
              style="width: 90px; height: 34px; text-align: center; font-size: 0.95rem; font-weight: 800;"
            />
          </div>
        `).join('')}

      </form>

      <!-- Banner de Total Calculado em Tempo Real -->
      <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 8px; padding: 10px; text-align: center; margin: 10px 0 8px 0;">
        <div style="font-size: 0.72rem; color: #86efac; font-weight: 800; text-transform: uppercase;">
          QUANTIDADE TOTAL ENCONTRADA:
        </div>
        <div id="blitz-loc-total-display" style="font-size: 1.45rem; font-weight: 900; color: #10b981; margin-top: 2px;">
          TOTAL: 0 UNIDADES
        </div>
      </div>

      <!-- Botões de Ação -->
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-cancel-blitz-locs" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center;">
          Cancelar
        </button>
        <button type="button" id="btn-confirm-blitz-locs" class="btn-primary" style="flex: 1.3; height: 46px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900; font-size: 0.95rem;">
          ✓ SALVAR CONFERÊNCIA
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');

  const totalDisplay = document.getElementById('blitz-loc-total-display');
  const qtyInputs = modal.querySelectorAll('.loc-qty-input');

  const updateTotal = () => {
    let sum = 0;
    qtyInputs.forEach(inp => {
      const v = Number(inp.value) || 0;
      if (v > 0) sum += v;
    });
    if (totalDisplay) {
      totalDisplay.textContent = `TOTAL: ${formatNumber(sum)} UNIDADES`;
    }
    return sum;
  };

  qtyInputs.forEach(inp => {
    inp.addEventListener('input', updateTotal);
  });

  updateTotal();

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-locs-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-locs')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-confirm-blitz-locs')?.addEventListener('click', async () => {
    const total = updateTotal();
    if (total <= 0) {
      showToast('Informe ao menos 1 unidade em alguma localização', 'warning');
      return;
    }

    const locationsArray = [];
    qtyInputs.forEach(inp => {
      const q = Number(inp.value) || 0;
      const l = inp.getAttribute('data-loc');
      if (q > 0 && l) {
        locationsArray.push({ location: l, quantity: q });
      }
    });

    closeModal();
    await saveBlitzTemConference(product, requestedDate, total, locationsArray, existingItem);
  });
}

// Salva conferência com TEM e suas localizações
async function saveBlitzTemConference(product, requestedDate, totalQuantity, locationsArray, existingItem = null) {
  if (!currentActiveBlitzSession) return;

  try {
    showToast('Salvando conferência...', 'sync', 800);

    const now = new Date();
    const confDate = formatDateBR(now.toISOString().split('T')[0]);
    const confTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const activeSector = (currentActiveBlitzSession?.sector && currentActiveBlitzSession.sector !== 'GERAL')
      ? currentActiveBlitzSession.sector
      : (product.sector || 'GERAL');

    await saveBlitzConferenceRecord({
      id: existingItem?.id || null,
      sessionId: currentActiveBlitzSession.id,
      productId: product.id || null,
      barcode: product.barcode,
      sector: activeSector,
      requestedDate: requestedDate,
      previousQuantity: existingItem ? Number(existingItem.total_quantity) || 0 : 0,
      newQuantity: totalQuantity,
      result: 'TEM',
      locations: locationsArray,
      userId: getCurrentUser()?.id || currentActiveBlitzSession.responsible_user_id || currentActiveBlitzSession.user_id || 'ana_luiza',
      userName: getCurrentUser()?.name || currentActiveBlitzSession.responsible_user_name || currentActiveBlitzSession.user_name || 'Ana Luiza',
      responsible_user_id: getCurrentUser()?.id || currentActiveBlitzSession.responsible_user_id || currentActiveBlitzSession.user_id || 'ana_luiza',
      responsible_user_name: getCurrentUser()?.name || currentActiveBlitzSession.responsible_user_name || currentActiveBlitzSession.user_name || 'Ana Luiza'
    });

    triggerSyncNow().catch(e => console.warn('Sync error:', e));

    // Exibe tela de sucesso e disponibiliza imediatamente: 📷 PRÓXIMO PRODUTO
    showConferenceSuccessModal({
      product,
      requestedDate,
      result: 'TEM',
      totalQuantity,
      confDate,
      confTime
    });
  } catch (err) {
    console.error('Erro ao salvar conferência TEM:', err);
    showToast('Erro ao registrar conferência', 'warning');
  }
}

// ----------------------------------------------------
// TELA DE SUCESSO: ✅ CONFERÊNCIA REGISTRADA + 📷 PRÓXIMO
// ----------------------------------------------------

function showConferenceSuccessModal({ product, requestedDate, result, totalQuantity, confDate, confTime }) {
  let modal = document.getElementById('modal-blitz-success');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-success';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const isTem = result === 'TEM';
  const resultTag = isTem
    ? `<span style="color: #10b981; font-weight: 900;">🟢 TEM (${formatNumber(totalQuantity)} unidades)</span>`
    : `<span style="color: #ef4444; font-weight: 900;">🔴 NÃO TEM (0 unidades)</span>`;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-success-backdrop"></div>
    <div class="modal-card" style="padding: 22px; max-width: 420px; width: 100%; box-sizing: border-box; text-align: center;">
      
      <div style="width: 56px; height: 56px; border-radius: 50%; background: ${isTem ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; border: 2px solid ${isTem ? '#10b981' : '#ef4444'}; display: flex; align-items: center; justify-content: center; margin: 0 auto 10px auto; font-size: 1.8rem;">
        ${isTem ? '✓' : '✕'}
      </div>

      <h3 style="font-size: 1.25rem; font-weight: 900; color: #f4f4f5; margin: 0 0 4px 0;">
        CONFERÊNCIA REGISTRADA
      </h3>

      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin: 12px 0 16px 0; text-align: left;">
        <div style="font-size: 0.88rem; font-weight: 800; color: #f4f4f5;">${product.name}</div>
        <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">Cód: ${product.barcode}</div>
        <div style="font-size: 0.82rem; color: #fbbf24; font-weight: 800; margin-top: 6px;">
          Validade solicitada: ${formatDateBR(requestedDate)}
        </div>
        <div style="font-size: 0.88rem; margin-top: 4px;">
          Resultado: ${resultTag}
        </div>
        <div style="font-size: 0.72rem; color: #71717a; margin-top: 6px; border-top: 1px dashed #27272a; padding-top: 4px;">
          Conferido em ${confDate} às ${confTime}
        </div>
      </div>

      <!-- BOTÃO PRINCIPAL: 📷 PRÓXIMO PRODUTO -->
      <button type="button" id="btn-blitz-next-product" class="btn-primary" style="
        height: 56px;
        font-size: 1.1rem;
        font-weight: 900;
        justify-content: center;
        background: #10b981;
        color: #022c22;
        border-radius: 10px;
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        box-shadow: 0 4px 14px rgba(16, 185, 129, 0.3);
        cursor: pointer;
      ">
        <span style="font-size: 1.4rem;">📷</span>
        <span>PRÓXIMO PRODUTO</span>
      </button>

      <div style="margin-top: 10px;">
        <button type="button" id="btn-blitz-go-dashboard" style="background: none; border: none; color: #38bdf8; font-size: 0.82rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 4px;">
          📋 Ver Resumo da Blitz
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-success-backdrop')?.addEventListener('click', closeModal);

  // Ao clicar em PRÓXIMO PRODUTO, já abre a câmera imediatamente para o próximo item do papel
  document.getElementById('btn-blitz-next-product')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-blitz-go-dashboard')?.addEventListener('click', () => {
    closeModal();
    openBlitzDashboardView();
  });
}

// ----------------------------------------------------
// 15. FINALIZAR BLITZ & RESUMO (AUTO-ZEROS E CONFIRMAÇÃO)
// ----------------------------------------------------

export async function finishActiveBlitzSession(sessionId = null) {
  const id = sessionId || currentActiveBlitzSession?.id;
  if (!id) return;

  const session = await getBlitzSessionById(id) || currentActiveBlitzSession;
  const metrics = await calculateBlitzPaceMetrics(id);

  const activeUser = getCurrentUser();
  const effectiveUserName = activeUser?.name || session.responsible_user_name || session.user_name || 'Ana Luiza';
  const effectiveUserId = activeUser?.id || session.responsible_user_id || session.user_id || 'ana_luiza';

  if (metrics.pendentes > 0) {
    promptConfirmFinishBlitzModal(session, metrics, async () => {
      try {
        showToast('Finalizando e zerando pendências...', 'sync', 1500);
        const finalStats = await finalizeBlitzWithAutoZeros(id, effectiveUserName);
        const updated = await getBlitzSessionById(id);
        setActiveBlitz(null);
        triggerSyncNow().catch(e => console.warn('Sync error:', e));

        showBlitzFinishedSummaryModal(updated || session, finalStats);
      } catch (err) {
        console.error('Erro ao finalizar blitz com auto-zeros:', err);
        showToast('Erro ao finalizar sessão da Blitz', 'warning');
      }
    });
  } else {
    const confirmed = await promptConfirmDialog(
      '🏁 FINALIZAR BLITZ?',
      `Todos os ${metrics.total} itens foram conferidos! Deseja concluir a Blitz e arquivá-la no histórico oficial?`
    );
    if (!confirmed) return;

    try {
      showToast('Finalizando Blitz...', 'sync', 1000);
      const updated = await finishBlitzSession(id, effectiveUserId, effectiveUserName);
      const items = await getBlitzItemsBySessionId(id);
      setActiveBlitz(null);
      triggerSyncNow().catch(e => console.warn('Sync error:', e));

      showBlitzFinishedSummaryModal(updated || session, {
        total: items.length,
        conferidos: items.length,
        autoZerados: 0,
        comQtd: items.filter(i => (Number(i.total_quantity) || 0) > 0).length,
        zerados: items.filter(i => (Number(i.total_quantity) || 0) === 0).length
      });
    } catch (err) {
      console.error('Erro ao finalizar blitz:', err);
      showToast('Erro ao finalizar sessão da Blitz', 'warning');
    }
  }
}

/**
 * Modal de Confirmação de Finalização com Auto-Zeros (Item 13)
 */
export function promptConfirmFinishBlitzModal(session, metrics, onConfirm) {
  let modal = document.getElementById('modal-confirm-finish-blitz');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-confirm-finish-blitz';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-confirm-finish-backdrop"></div>
    <div class="modal-card" style="padding: 22px; max-width: 440px; width: 100%; box-sizing: border-box; text-align: center;">
      <div style="font-size: 2.2rem; margin-bottom: 4px;">⚠️</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #fbbf24; margin: 0 0 6px 0;">
        SÓ PARA CONFIRMAR:
      </h3>
      <div style="font-size: 0.86rem; color: #f4f4f5; margin-bottom: 14px; line-height: 1.4;">
        Você está prestes a finalizar esta Blitz.
      </div>

      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 14px; text-align: left; display: flex; flex-direction: column; gap: 6px;">
        <div style="font-size: 0.88rem; color: #f4f4f5; font-weight: 800;">
          📋 <strong>${metrics.total}</strong> itens na lista
        </div>
        <div style="font-size: 0.88rem; color: #34d399; font-weight: 800;">
          ✅ <strong>${metrics.conferidos}</strong> conferidos
        </div>
        <div style="font-size: 0.88rem; color: #f87171; font-weight: 800;">
          ⏳ <strong>${metrics.pendentes}</strong> ainda pendentes
        </div>
      </div>

      <div style="background: rgba(239, 68, 68, 0.1); border: 1px dashed rgba(239, 68, 68, 0.35); border-radius: 8px; padding: 10px; font-size: 0.78rem; color: #fca5a5; margin-bottom: 16px; line-height: 1.4;">
        Esses <strong>${metrics.pendentes}</strong> itens serão registrados automaticamente como <strong>0 unidades</strong> (não encontrados na Blitz oficial).
        <div style="margin-top: 4px; font-weight: 800; color: #fef08a;">Quer finalizar?</div>
      </div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-cancel-confirm-finish" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center; font-weight: 800;">
          Cancelar
        </button>
        <button type="button" id="btn-do-confirm-finish" class="btn-primary" style="flex: 1.3; height: 46px; justify-content: center; background: #ef4444; color: #fff; font-weight: 900; font-size: 0.95rem;">
          🏁 Finalizar Blitz
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-confirm-finish-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-confirm-finish')?.addEventListener('click', closeModal);
  document.getElementById('btn-do-confirm-finish')?.addEventListener('click', () => {
    closeModal();
    if (onConfirm) onConfirm();
  });
}

// Modal com Resumo da Blitz Finalizada
export function showBlitzFinishedSummaryModal(session, statsOrItems) {
  let modal = document.getElementById('modal-blitz-finished-summary');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-finished-summary';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  let totalCount = 0;
  let temCount = 0;
  let zeroCount = 0;
  let autoZeroCount = 0;

  if (Array.isArray(statsOrItems)) {
    totalCount = statsOrItems.length;
    statsOrItems.forEach(it => {
      if (it.result === 'TEM' || (Number(it.total_quantity) || 0) > 0) {
        temCount++;
      } else {
        zeroCount++;
      }
    });
  } else if (statsOrItems && typeof statsOrItems === 'object') {
    totalCount = statsOrItems.total || 0;
    temCount = statsOrItems.comQtd || 0;
    zeroCount = statsOrItems.zerados || 0;
    autoZeroCount = statsOrItems.autoZerados || 0;
  }

  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-summary-backdrop"></div>
    <div class="modal-card" style="padding: 22px; max-width: 440px; width: 100%; box-sizing: border-box; text-align: center;">
      
      <div style="font-size: 2.2rem; margin-bottom: 4px;">🏁</div>
      <h3 style="font-size: 1.25rem; font-weight: 900; color: #f4f4f5; margin: 0 0 2px 0;">
        BLITZ FINALIZADA COM SUCESSO
      </h3>
      <div style="font-size: 0.88rem; font-weight: 800; color: #fbbf24; margin-bottom: 14px;">
        Período: ${periodLabel}
      </div>

      <!-- Resumo Numérico -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 12px;">
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 10px 6px;">
          <div style="font-size: 0.65rem; color: #a1a1aa; font-weight: 800;">TOTAL</div>
          <div style="font-size: 1.35rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">${totalCount}</div>
        </div>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 6px;">
          <div style="font-size: 0.65rem; color: #10b981; font-weight: 800;">🟢 TEM (>0)</div>
          <div style="font-size: 1.35rem; font-weight: 900; color: #10b981; margin-top: 2px;">${temCount}</div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px 6px;">
          <div style="font-size: 0.65rem; color: #ef4444; font-weight: 800;">🔴 ZERO (=0)</div>
          <div style="font-size: 1.35rem; font-weight: 900; color: #ef4444; margin-top: 2px;">${zeroCount}</div>
        </div>
      </div>

      ${autoZeroCount > 0 ? `
        <div style="background: rgba(245, 158, 11, 0.1); border: 1px dashed rgba(245, 158, 11, 0.3); border-radius: 6px; padding: 6px 10px; font-size: 0.74rem; color: #fef08a; margin-bottom: 14px;">
          ℹ️ ${autoZeroCount} item(ns) pendente(s) foram zerados automaticamente pelo sistema.
        </div>
      ` : ''}

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-summary-export-wa" class="btn-primary" style="height: 48px; font-weight: 900; justify-content: center; background: #25d366; color: #000; font-size: 0.95rem;">
          💬 EXPORTAR NO WHATSAPP
        </button>
        <button type="button" id="btn-summary-view-what-changed" class="btn-secondary" style="height: 44px; font-weight: 800; justify-content: center; font-size: 0.88rem; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
          📊 O Que Mudou (Comparação)
        </button>
        <button type="button" id="btn-summary-close-all" class="btn-secondary" style="height: 44px; font-weight: 800; justify-content: center; font-size: 0.88rem;">
          ✓ Concluir e Voltar ao Início
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-summary-backdrop')?.addEventListener('click', closeModal);

  document.getElementById('btn-summary-export-wa')?.addEventListener('click', async () => {
    const items = await getBlitzItemsBySessionId(session.id);
    const formatted = await formatBlitzSessionWhatsApp(session, items);
    openWhatsAppExportModal(formatted, `Blitz ${periodLabel}`);
  });

  document.getElementById('btn-summary-view-what-changed')?.addEventListener('click', () => {
    closeModal();
    openWhatChangedModal(session.id);
  });

  document.getElementById('btn-summary-close-all')?.addEventListener('click', () => {
    closeModal();
    showView('view-dashboard');
  });
}

/**
 * Modal de Reabertura de Blitz com Justificativa Obrigatória (Item 13)
 */
export function promptReopenBlitzModal(session) {
  let modal = document.getElementById('modal-reopen-blitz');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-reopen-blitz';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-reopen-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      <h3 style="font-size: 1.05rem; font-weight: 900; color: #fbbf24; margin: 0 0 4px 0; display: flex; align-items: center; gap: 6px;">
        🔓 REABRIR BLITZ
      </h3>
      <div style="font-size: 0.82rem; color: #a1a1aa; margin-bottom: 12px;">
        ${periodLabel} (${session.sector || 'GERAL'})
      </div>

      <div style="background: rgba(245, 158, 11, 0.1); border: 1px dashed rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px; font-size: 0.76rem; color: #fef08a; line-height: 1.4; margin-bottom: 12px;">
        ⚠️ <strong>Atenção:</strong> A reabertura de uma Blitz oficial é auditada. A data, hora, responsável e o motivo serão registrados permanentemente.
      </div>

      <form id="form-reopen-blitz-action" style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            Quem está reabrindo:
          </label>
          <input
            type="text"
            id="input-reopen-user"
            class="form-input"
            value="${getCurrentUser()?.name || session.responsible_user_name || session.user_name || 'Ana Luiza'}"
            required
            style="height: 42px; font-weight: 800; color: #f4f4f5;"
          />
        </div>

        <div>
          <label style="font-size: 0.74rem; font-weight: 800; color: #ef4444; text-transform: uppercase; margin-bottom: 4px; display: block;">
            Motivo da reabertura (Obrigatório):
          </label>
          <textarea
            id="textarea-reopen-reason"
            class="form-input"
            rows="3"
            placeholder="Ex: Novos produtos chegaram na gôndola após o fechamento"
            required
            style="font-size: 0.84rem; resize: vertical;"
          ></textarea>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button type="button" id="btn-cancel-reopen" class="btn-secondary" style="flex: 1; height: 44px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.3; height: 44px; justify-content: center; background: #fbbf24; color: #000; font-weight: 900;">
            🔓 Reabrir Blitz
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-reopen-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-reopen')?.addEventListener('click', closeModal);

  document.getElementById('form-reopen-blitz-action')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const userName = document.getElementById('input-reopen-user')?.value?.trim() || getCurrentUser()?.name || 'Ana Luiza';
    const reason = document.getElementById('textarea-reopen-reason')?.value?.trim();

    if (!reason || reason.length < 5) {
      showToast('Por favor, informe uma justificativa válida para reabertura', 'warning');
      return;
    }

    try {
      showToast('Reabrindo Blitz...', 'sync', 1000);
      const reopened = await reopenBlitzRecord(session.id, userName, reason);
      closeModal();
      setActiveBlitz(reopened || session);
      triggerSyncNow().catch(err => console.warn('Sync error:', err));
      showToast('✓ Blitz reaberta com sucesso!', 'success', 2000);
      openBlitzDashboardView();
    } catch (err) {
      console.error('Erro ao reabrir blitz:', err);
      showToast('Erro ao reabrir Blitz', 'warning');
    }
  });
}

/**
 * Modal de Correção Auditada de Quantidade de Item (Item 12)
 */
export async function promptCorrectBlitzItemQuantity(item, session, onSaved) {
  let modal = document.getElementById('modal-correct-blitz-item');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-correct-blitz-item';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const prod = item.product_id ? await getProductById(item.product_id) : await getProductByBarcode(item.barcode);
  const prodName = prod?.name || `PRODUTO ${item.barcode}`;
  const currentQty = Number(item.total_quantity || item.quantidade) || 0;
  const targetDate = item.requested_expiration_date || item.data_validade;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-correct-item-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0 0 4px 0; display: flex; align-items: center; gap: 6px;">
        ✏️ CORREÇÃO DE ITEM CONFERIDO
      </h3>
      <div style="font-size: 0.82rem; color: #a1a1aa; margin-bottom: 12px;">
        Conferência oficial auditada
      </div>

      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 0.88rem; font-weight: 800; color: #f4f4f5;">${prodName}</div>
        <div style="font-size: 0.74rem; color: #fbbf24; font-weight: 800; margin-top: 2px;">
          Validade: ${formatDateBR(targetDate)} • Cód: ${item.barcode}
        </div>
        <div style="font-size: 0.78rem; color: #a1a1aa; margin-top: 4px;">
          Quantidade atual registrada: <strong style="color: ${currentQty > 0 ? '#34d399' : '#f87171'};">${currentQty} un</strong>
        </div>
      </div>

      <form id="form-correct-blitz-item-action" style="display: flex; flex-direction: column; gap: 10px;">
        <div>
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            Nova Quantidade Encontrada:
          </label>
          <input
            type="number"
            id="input-correct-qty-val"
            class="form-input"
            min="0"
            step="1"
            value="${currentQty}"
            required
            autofocus
            style="height: 48px; font-size: 1.3rem; font-weight: 900; text-align: center; color: #10b981;"
          />
        </div>

        <div>
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 4px; display: block;">
            Quem está corrigindo:
          </label>
          <input
            type="text"
            id="input-correct-user"
            class="form-input"
            value="${getCurrentUser()?.name || session?.responsible_user_name || session?.user_name || 'Ana Luiza'}"
            required
            style="height: 40px; font-weight: 800;"
          />
        </div>

        <div>
          <label style="font-size: 0.74rem; font-weight: 800; color: #ef4444; text-transform: uppercase; margin-bottom: 4px; display: block;">
            Motivo da alteração (Obrigatório):
          </label>
          <textarea
            id="textarea-correct-reason"
            class="form-input"
            rows="2"
            placeholder="Ex: Erro de digitação / Mais unidades encontradas no fundo da gôndola"
            required
            style="font-size: 0.84rem; resize: vertical;"
          ></textarea>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button type="button" id="btn-cancel-correct-item" class="btn-secondary" style="flex: 1; height: 44px; justify-content: center; font-weight: 800;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1.3; height: 44px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900;">
            💾 Salvar Correção
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-correct-item-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-correct-item')?.addEventListener('click', closeModal);

  document.getElementById('form-correct-blitz-item-action')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newQty = Number(document.getElementById('input-correct-qty-val')?.value) || 0;
    const userName = document.getElementById('input-correct-user')?.value?.trim() || getCurrentUser()?.name || 'Ana Luiza';
    const reason = document.getElementById('textarea-correct-reason')?.value?.trim();

    if (!reason || reason.length < 3) {
      showToast('Por favor, informe o motivo da correção', 'warning');
      return;
    }

    try {
      showToast('Gravando correção auditada...', 'sync', 1000);
      const confId = item.conferencia_id || item.id;
      await correctConferenceQuantity(confId, newQty, reason, userName);

      closeModal();
      triggerSyncNow().catch(err => console.warn('Sync error:', err));
      showToast('✓ Quantidade corrigida com sucesso!', 'success', 2000);

      if (onSaved) {
        onSaved();
      } else if (currentActiveBlitzSession) {
        openBlitzDashboardView();
      }
    } catch (err) {
      console.error('Erro ao corrigir quantidade:', err);
      showToast('Erro ao salvar correção', 'warning');
    }
  });
}

/**
 * Modal "O que Mudou?" - Comparação com a Blitz Anterior (Item 14)
 */
export async function openWhatChangedModal(sessionId) {
  let modal = document.getElementById('modal-what-changed-blitz');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-what-changed-blitz';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-what-changed-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 500px; width: 100%; box-sizing: border-box; max-height: 90vh; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <div>
          <h3 style="font-size: 1.05rem; font-weight: 900; color: #fbbf24; margin: 0; display: flex; align-items: center; gap: 6px;">
            📊 O QUE MUDOU?
          </h3>
          <span style="font-size: 0.72rem; color: #a1a1aa;">Comparação com a Blitz anterior</span>
        </div>
        <button type="button" id="btn-close-what-changed" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div id="what-changed-content-area" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;">
        <div style="text-align: center; padding: 30px; color: #71717a;">Carregando análise comparativa...</div>
      </div>

      <div style="margin-top: 12px;">
        <button type="button" id="btn-dismiss-what-changed" class="btn-secondary" style="width: 100%; height: 44px; justify-content: center; font-weight: 800;">
          Fechar
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-what-changed-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-what-changed')?.addEventListener('click', closeModal);
  document.getElementById('btn-dismiss-what-changed')?.addEventListener('click', closeModal);

  try {
    const analysis = await getWhatChangedAnalysis(sessionId);
    const contentArea = document.getElementById('what-changed-content-area');
    if (!contentArea) return;

    if (!analysis.hasPrevious) {
      const novosList = analysis.novos || [];
      contentArea.innerHTML = `
        <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 8px; padding: 14px; text-align: center; color: #93c5fd; font-size: 0.86rem; line-height: 1.4; margin-bottom: 8px;">
          ✨ <strong>Primeira Blitz deste setor!</strong><br>
          Não há blitz anterior para comparação de diferença. Todos os ${novosList.length} itens registrados são novos nesta blitz e servem de marco referencial.
        </div>
        ${novosList.length > 0 ? `
          <div style="background: rgba(192, 132, 252, 0.08); border: 1px solid rgba(192, 132, 252, 0.3); border-radius: 8px; padding: 10px;">
            <div style="font-size: 0.74rem; font-weight: 900; color: #c084fc; text-transform: uppercase; margin-bottom: 6px;">
              🆕 PRODUTOS REGISTRADOS NESTA BLITZ (${novosList.length})
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto;">
              ${novosList.map(it => `
                <div style="background: #18181c; padding: 6px 8px; border-radius: 4px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                  <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
                    <span style="color: #f4f4f5;">${it.name}</span>
                    <span style="display: block; font-size: 0.68rem; color: #a1a1aa; font-family: monospace;">${it.barcode || ''}</span>
                  </div>
                  <span style="color: #c084fc; font-weight: 800;">${it.currentQty} un</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      `;
      return;
    }

    const { aumentaram, diminuiram, zeraram, voltaram, novos } = analysis;

    contentArea.innerHTML = `
      <!-- Cards de Resumo -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 6px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #34d399; font-weight: 800;">🔺 AUMENTARAM</div>
          <div style="font-size: 1.2rem; font-weight: 900; color: #34d399;">${aumentaram.length}</div>
        </div>
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 6px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #fbbf24; font-weight: 800;">🔻 DIMINUÍRAM</div>
          <div style="font-size: 1.2rem; font-weight: 900; color: #fbbf24;">${diminuiram.length}</div>
        </div>
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 6px; padding: 8px; text-align: center;">
          <div style="font-size: 0.65rem; color: #ef4444; font-weight: 800;">0️⃣ ZERARAM</div>
          <div style="font-size: 1.2rem; font-weight: 900; color: #ef4444;">${zeraram.length}</div>
        </div>
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 6px; padding: 8px; text-align: center; grid-column: span 1.5;">
          <div style="font-size: 0.65rem; color: #38bdf8; font-weight: 800;">🟢 VOLTARAM A TER</div>
          <div style="font-size: 1.2rem; font-weight: 900; color: #38bdf8;">${voltaram.length}</div>
        </div>
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 6px; padding: 8px; text-align: center; grid-column: span 1.5;">
          <div style="font-size: 0.65rem; color: #c084fc; font-weight: 800;">🆕 PRODUTOS NOVOS</div>
          <div style="font-size: 1.2rem; font-weight: 900; color: #c084fc;">${novos.length}</div>
        </div>
      </div>

      <!-- Seção: Voltaram a Ter -->
      ${voltaram.length > 0 ? `
        <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 10px;">
          <div style="font-size: 0.74rem; font-weight: 900; color: #38bdf8; text-transform: uppercase; margin-bottom: 6px;">
            ⚠️ VOLTARAM A TER (Tinham 0 na anterior)
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${voltaram.map(it => `
              <div style="background: #18181c; padding: 6px 8px; border-radius: 4px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">${it.name}</span>
                <span style="color: #38bdf8; font-weight: 800;">0 ➔ <strong>${it.currentQty} un</strong></span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Seção: Zeraram -->
      ${zeraram.length > 0 ? `
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px;">
          <div style="font-size: 0.74rem; font-weight: 900; color: #ef4444; text-transform: uppercase; margin-bottom: 6px;">
            🔴 ZERARAM (Tinham estoque e agora estão zerados)
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${zeraram.map(it => `
              <div style="background: #18181c; padding: 6px 8px; border-radius: 4px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">${it.name}</span>
                <span style="color: #ef4444; font-weight: 800;">${it.prevQty} un ➔ <strong>0 un</strong></span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Seção: Aumentaram -->
      ${aumentaram.length > 0 ? `
        <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px;">
          <div style="font-size: 0.74rem; font-weight: 900; color: #10b981; text-transform: uppercase; margin-bottom: 6px;">
            🔺 AUMENTARAM DE QUANTIDADE
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${aumentaram.map(it => `
              <div style="background: #18181c; padding: 6px 8px; border-radius: 4px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">${it.name}</span>
                <span style="color: #10b981; font-weight: 800;">${it.prevQty} ➔ <strong>${it.currentQty} un</strong> (+${it.diff})</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Seção: Diminuíram -->
      ${diminuiram.length > 0 ? `
        <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 10px;">
          <div style="font-size: 0.74rem; font-weight: 900; color: #fbbf24; text-transform: uppercase; margin-bottom: 6px;">
            🔻 DIMINUÍRAM DE QUANTIDADE
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${diminuiram.map(it => `
              <div style="background: #18181c; padding: 6px 8px; border-radius: 4px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">${it.name}</span>
                <span style="color: #fbbf24; font-weight: 800;">${it.prevQty} ➔ <strong>${it.currentQty} un</strong> (${it.diff})</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Seção: Produtos Novos -->
      ${novos.length > 0 ? `
        <div style="background: rgba(192, 132, 252, 0.08); border: 1px solid rgba(192, 132, 252, 0.3); border-radius: 8px; padding: 10px;">
          <div style="font-size: 0.74rem; font-weight: 900; color: #c084fc; text-transform: uppercase; margin-bottom: 6px;">
            🆕 PRODUTOS NOVOS NESTA BLITZ
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            ${novos.map(it => `
              <div style="background: #18181c; padding: 6px 8px; border-radius: 4px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center;">
                <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">
                  <span style="color: #f4f4f5;">${it.name}</span>
                  <span style="display: block; font-size: 0.68rem; color: #a1a1aa; font-family: monospace;">${it.barcode || ''}</span>
                </div>
                <span style="color: #c084fc; font-weight: 800;">Conferido: <strong>${it.currentQty} un</strong></span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } catch (err) {
    console.error('Erro ao carregar análise de mudanças:', err);
    showToast('Erro ao analisar mudanças', 'warning');
  }
}

/**
 * Modal "Produtos Exportados da Blitz" (Item 16)
 * Produtos que vieram da Blitz sem corredor, sem foto, etc.
 */
export async function openExportedBlitzProductsModal(sessionId) {
  let modal = document.getElementById('modal-exported-blitz-products');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-exported-blitz-products';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-exported-prods-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 480px; width: 100%; box-sizing: border-box; max-height: 90vh; display: flex; flex-direction: column;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <div>
          <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0; display: flex; align-items: center; gap: 6px;">
            📋 PRODUTOS EXPORTADOS DA BLITZ
          </h3>
          <span style="font-size: 0.72rem; color: #fbbf24;">Cadastro complementar (corredor, fotos)</span>
        </div>
        <button type="button" id="btn-close-exported-prods" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div style="background: rgba(245, 158, 11, 0.1); border: 1px dashed rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px; font-size: 0.76rem; color: #fef08a; line-height: 1.4; margin-bottom: 12px;">
        💡 Produtos que foram importados pela Blitz e ainda precisam ter seu corredor definitivo ou foto complementados.
      </div>

      <div id="exported-prods-list-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
        <div style="text-align: center; padding: 30px; color: #71717a;">Carregando produtos...</div>
      </div>

      <div style="margin-top: 12px;">
        <button type="button" id="btn-dismiss-exported-prods" class="btn-secondary" style="width: 100%; height: 44px; justify-content: center; font-weight: 800;">
          Fechar
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-exported-prods-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-exported-prods')?.addEventListener('click', closeModal);
  document.getElementById('btn-dismiss-exported-prods')?.addEventListener('click', closeModal);

  try {
    const sessionItems = await getSessionBlitzItems(sessionId);
    const container = document.getElementById('exported-prods-list-container');
    if (!container) return;

    if (sessionItems.length === 0) {
      container.innerHTML = '<div style="text-align: center; color: #71717a; padding: 30px;">Nenhum produto nesta Blitz.</div>';
      return;
    }

    const cards = await Promise.all(sessionItems.map(async (it) => {
      const prod = it.product_id ? await getProductById(it.product_id) : await getProductByBarcode(it.barcode);
      const prodName = prod?.name || `PRODUTO ${it.barcode}`;
      const hasCorridor = Boolean(prod?.corridor && prod.corridor.trim() !== '');
      const hasPhoto = Boolean(prod?.image && prod.image.trim() !== '');

      return `
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 0.84rem; font-weight: 800; color: #f4f4f5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${prodName}
            </div>
            <div style="font-size: 0.72rem; color: #a1a1aa; margin-top: 2px;">
              Cód: ${it.barcode} • Validade: ${formatDateBR(it.data_validade)}
            </div>
            <div style="display: flex; gap: 6px; margin-top: 4px;">
              <span style="font-size: 0.65rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: ${hasCorridor ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${hasCorridor ? '#34d399' : '#f87171'};">
                ${hasCorridor ? `📍 ${prod.corridor}` : '📍 Sem corredor'}
              </span>
              <span style="font-size: 0.65rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: ${hasPhoto ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${hasPhoto ? '#34d399' : '#f87171'};">
                ${hasPhoto ? '📷 Com foto' : '📷 Sem foto'}
              </span>
            </div>
          </div>
          ${!hasCorridor && prod ? `
            <button type="button" class="btn-set-corridor-fast btn-secondary" data-prod-id="${prod.id}" style="height: 34px; font-size: 0.74rem; font-weight: 800; padding: 0 8px; white-space: nowrap; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
              + Corredor
            </button>
          ` : ''}
        </div>
      `;
    }));

    container.innerHTML = cards.join('');

    container.querySelectorAll('.btn-set-corridor-fast').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pId = btn.getAttribute('data-prod-id');
        const p = await getProductById(pId);
        if (p) {
          promptSetProductCorridor(p, () => {
            openExportedBlitzProductsModal(sessionId);
          });
        }
      });
    });
  } catch (err) {
    console.error('Erro ao carregar produtos exportados:', err);
    showToast('Erro ao carregar produtos', 'warning');
  }
}

// Cancela a sessão da Blitz
export async function cancelActiveBlitzSession(sessionId = null) {
  const id = sessionId || currentActiveBlitzSession?.id;
  if (!id) return;

  const confirmed = await promptConfirmDialog(
    '⚠️ CANCELAR ESTA BLITZ?',
    'A sessão será cancelada. Os itens já conferidos permanecerão registrados no histórico de dados.'
  );

  if (!confirmed) return;

  try {
    await cancelBlitzSession(id);
    setActiveBlitz(null);
    showToast('Blitz cancelada.', 'info', 2000);
    showView('view-dashboard');
  } catch (err) {
    console.error('Erro ao cancelar blitz:', err);
    showToast('Erro ao cancelar sessão', 'warning');
  }
}

// ----------------------------------------------------
// 11. HISTÓRICO GERAL DE BLITZ E POR PRODUTO
// ----------------------------------------------------

export async function openBlitzHistoryView() {
  const container = document.getElementById('view-blitz-history');
  if (!container) return;

  const sessions = await getAllBlitzSessions();

  container.innerHTML = `
    <header class="app-top-bar">
      <button type="button" id="btn-blitz-history-back" class="btn-back">← Voltar</button>
      <span class="top-bar-title">HISTÓRICO DA BLITZ</span>
      <button type="button" id="btn-history-new-blitz" class="btn-primary" style="padding: 4px 10px; font-size: 0.76rem; font-weight: 900; background: #f59e0b; color: #000;">
        ➕ Nova Blitz
      </button>
    </header>

    <main style="padding: 12px; max-width: 640px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px;">
      
      <!-- Abas de Navegação -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: #121214; padding: 4px; border-radius: 8px; border: 1px solid #27272a;">
        <button type="button" id="tab-history-sessions" class="history-tab-btn active" style="padding: 8px; font-size: 0.78rem; font-weight: 800; border: none; border-radius: 6px; background: #27272a; color: #f4f4f5; cursor: pointer;">
          📁 SESSÕES (${sessions.length})
        </button>
        <button type="button" id="tab-history-products" class="history-tab-btn" style="padding: 8px; font-size: 0.78rem; font-weight: 800; border: none; border-radius: 6px; background: transparent; color: #a1a1aa; cursor: pointer;">
          📜 POR PRODUTO
        </button>
      </div>

      <!-- PAINEL 1: SESSÕES -->
      <div id="panel-history-sessions" style="display: flex; flex-direction: column; gap: 8px;">
        <div id="blitz-history-sessions-list" style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Renderizado via renderBlitzHistorySessions -->
        </div>
      </div>

      <!-- PAINEL 2: HISTÓRICO POR PRODUTO -->
      <div id="panel-history-products" class="hidden" style="display: flex; flex-direction: column; gap: 10px;">
        <div class="form-group" style="margin-bottom: 2px;">
          <input
            type="text"
            id="input-search-product-blitz-history"
            class="form-input"
            placeholder="🔍 Buscar produto por nome ou código..."
            style="height: 44px; font-size: 0.9rem;"
          />
        </div>

        <div id="blitz-product-history-results" style="display: flex; flex-direction: column; gap: 6px;">
          <div style="text-align: center; padding: 30px; color: #71717a; font-size: 0.85rem;">
            Digite acima para pesquisar o histórico de qualquer produto na blitz.
          </div>
        </div>
      </div>

    </main>
  `;

  showView('view-blitz-history');

  document.getElementById('btn-blitz-history-back')?.addEventListener('click', () => {
    if (currentActiveBlitzSession) {
      openBlitzDashboardView();
    } else {
      showView('view-dashboard');
    }
  });

  document.getElementById('btn-history-new-blitz')?.addEventListener('click', () => {
    promptStartBlitz();
  });

  // Alternância de abas
  const tabSessions = document.getElementById('tab-history-sessions');
  const tabProducts = document.getElementById('tab-history-products');
  const panelSessions = document.getElementById('panel-history-sessions');
  const panelProducts = document.getElementById('panel-history-products');

  tabSessions?.addEventListener('click', () => {
    tabSessions.style.background = '#27272a';
    tabSessions.style.color = '#f4f4f5';
    tabProducts.style.background = 'transparent';
    tabProducts.style.color = '#a1a1aa';
    panelSessions?.classList.remove('hidden');
    panelProducts?.classList.add('hidden');
  });

  tabProducts?.addEventListener('click', () => {
    tabProducts.style.background = '#27272a';
    tabProducts.style.color = '#f4f4f5';
    tabSessions.style.background = 'transparent';
    tabSessions.style.color = '#a1a1aa';
    panelProducts?.classList.remove('hidden');
    panelSessions?.classList.add('hidden');
  });

  // Busca por produto
  const searchProdInput = document.getElementById('input-search-product-blitz-history');
  searchProdInput?.addEventListener('input', async (e) => {
    const q = e.target.value.trim().toLowerCase();
    await renderProductHistorySearchResults(q);
  });

  await renderBlitzHistorySessions(sessions);
}

// Renderiza a lista de sessões no histórico
async function renderBlitzHistorySessions(sessions) {
  const container = document.getElementById('blitz-history-sessions-list');
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #71717a; font-size: 0.85rem;">
        Nenhuma sessão de Blitz realizada ainda.
      </div>
    `;
    return;
  }

  const htmlPromises = sessions.map(async (s) => {
    const items = await getBlitzItemsBySessionId(s.id);
    let temCount = 0;
    let naoTemCount = 0;
    let units = 0;

    items.forEach(it => {
      if (it.result === 'TEM') {
        temCount++;
        units += Number(it.total_quantity) || 0;
      } else {
        naoTemCount++;
      }
    });

    const isOngoing = s.status === 'em_andamento';
    const isCanceled = s.status === 'cancelada';
    let periodLabel = s.period_label;
    if (!periodLabel || periodLabel.includes('--/--/----') || periodLabel === 'Geral') {
      if (s.start_date && s.end_date) {
        periodLabel = `${formatDateBR(s.start_date)} → ${formatDateBR(s.end_date)}`;
      } else {
        periodLabel = 'Período não informado';
      }
    }
    const startedAtFormatted = new Date(s.started_at).toLocaleString('pt-BR');

    const respName = s.responsible_user_name || s.user_name || 'Ana Luiza';
    const respUser = getUserById(s.responsible_user_id || s.user_id);
    const respBadgeHtml = respUser ? `
      <span style="background: ${respUser.badgeColor || 'rgba(168, 85, 247, 0.2)'}; color: ${respUser.textColor || '#c084fc'}; font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 9999px; border: 1px solid ${respUser.color || '#a855f7'}44; display: inline-flex; align-items: center; gap: 4px;">
        <span>${respUser.icon || '👤'}</span>
        <span>${respName}</span>
      </span>
    ` : `<strong style="color: #d4d4d8;">${respName}</strong>`;

    return `
      <div style="
        background: #121214;
        border: 1px solid ${isOngoing ? '#f59e0b' : '#27272a'};
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; font-size: 0.68rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
              🏷️ ${s.sector || 'GERAL'}
            </span>
            <div style="font-size: 0.92rem; font-weight: 900; color: #f4f4f5;">
              📅 ${periodLabel}
            </div>
          </div>
          <span style="
            font-size: 0.68rem;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 9999px;
            background: ${isOngoing ? 'rgba(245, 158, 11, 0.2)' : isCanceled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'};
            color: ${isOngoing ? '#fbbf24' : isCanceled ? '#f87171' : '#34d399'};
            white-space: nowrap;
          ">
            ${isOngoing ? 'EM ANDAMENTO' : isCanceled ? 'CANCELADA' : 'FINALIZADA'}
          </span>
        </div>

        <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.74rem; color: #a1a1aa; flex-wrap: wrap; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #71717a;">Responsável:</span>
            ${respBadgeHtml}
          </div>
          <span style="color: #71717a;">Iniciada em: <strong style="color: #a1a1aa;">${startedAtFormatted}</strong></span>
        </div>
        ${s.finalized_by ? `
          <div style="font-size: 0.7rem; color: #10b981; display: flex; align-items: center; gap: 4px;">
            <span>✓ Finalizada por: <strong>${s.finalized_by}</strong></span>
          </div>
        ` : ''}

        <div style="display: flex; gap: 8px; background: #18181c; padding: 6px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 800;">
          <span style="color: #f4f4f5;">Total: <strong>${items.length}</strong></span>
          <span style="color: #10b981;">• TEM: <strong>${temCount}</strong> (${formatNumber(units)} un)</span>
          <span style="color: #ef4444;">• NÃO TEM: <strong>${naoTemCount}</strong></span>
        </div>

        <div style="display: flex; gap: 6px; margin-top: 2px;">
          ${isOngoing ? `
            <button type="button" class="btn-resume-history-session btn-primary" data-id="${s.id}" style="flex: 1; height: 34px; font-size: 0.76rem; font-weight: 900; background: #f59e0b; color: #000; justify-content: center;">
              ▶ Retomar Blitz
            </button>
          ` : `
            <button type="button" class="btn-view-history-detail btn-secondary" data-id="${s.id}" style="flex: 1; height: 34px; font-size: 0.76rem; font-weight: 800; justify-content: center;">
              👁️ Ver Detalhes
            </button>
          `}
          <button type="button" class="btn-export-wa-history btn-secondary" data-id="${s.id}" style="height: 34px; font-size: 0.76rem; font-weight: 800; color: #25d366; border-color: rgba(37, 211, 102, 0.4); justify-content: center; padding: 0 10px;">
            💬 WhatsApp
          </button>
        </div>
      </div>
    `;
  });

  const cards = await Promise.all(htmlPromises);
  container.innerHTML = cards.join('');

  // Listeners
  container.querySelectorAll('.btn-resume-history-session').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const sess = await getBlitzSessionById(id);
      if (sess) {
        setActiveBlitz(sess);
        openBlitzDashboardView();
      }
    });
  });

  container.querySelectorAll('.btn-export-wa-history').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const sess = await getBlitzSessionById(id);
      if (sess) {
        const items = await getBlitzItemsBySessionId(id);
        const formatted = await formatBlitzSessionWhatsApp(sess, items);
        openWhatsAppExportModal(formatted, `Blitz ${sess.period_label}`);
      }
    });
  });

  container.querySelectorAll('.btn-view-history-detail').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const sess = await getBlitzSessionById(id);
      if (sess) {
        openBlitzSessionDetailModal(sess);
      }
    });
  });
}

// Modal de detalhes de uma sessão histórica
async function openBlitzSessionDetailModal(session) {
  let modal = document.getElementById('modal-blitz-history-detail');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-history-detail';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const items = await getBlitzItemsBySessionId(session.id);
  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;

  const respName = session.responsible_user_name || session.user_name || 'Ana Luiza';
  const respUser = getUserById(session.responsible_user_id || session.user_id);
  const respBadgeHtml = respUser ? `
    <span style="background: ${respUser.badgeColor || 'rgba(168, 85, 247, 0.2)'}; color: ${respUser.textColor || '#c084fc'}; font-size: 0.74rem; font-weight: 800; padding: 2px 8px; border-radius: 9999px; border: 1px solid ${respUser.color || '#a855f7'}44; display: inline-flex; align-items: center; gap: 4px;">
      <span>${respUser.icon || '👤'}</span>
      <span>${respName}</span>
    </span>
  ` : `<strong style="color: #d4d4d8;">${respName}</strong>`;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-detail-backdrop"></div>
    <div class="modal-card" style="padding: 16px; max-width: 460px; width: 100%; box-sizing: border-box; max-height: 85vh; display: flex; flex-direction: column;">
      
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 10px;">
        <div>
          <h3 style="font-size: 0.98rem; font-weight: 900; color: #f4f4f5; margin: 0;">
            DETALHES DA BLITZ
          </h3>
          <span style="font-size: 0.74rem; color: #fbbf24; font-weight: 800;">
            ${periodLabel} (${items.length} itens)
          </span>
        </div>
        <button type="button" id="btn-close-blitz-detail" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <!-- Resumo de Auditoria da Sessão -->
      <div style="background: #141418; border: 1px solid #27272a; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; font-size: 0.74rem; display: flex; flex-direction: column; gap: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #71717a;">Responsável:</span>
          <div>${respBadgeHtml}</div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #71717a;">Setor:</span>
          <span style="color: #fbbf24; font-weight: 800;">🏷️ ${session.sector || 'GERAL'}</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="color: #71717a;">Status:</span>
          <span style="color: ${session.status === 'finalizada' ? '#34d399' : '#fbbf24'}; font-weight: 800;">
            ${session.status?.toUpperCase() || 'EM ANDAMENTO'}
          </span>
        </div>
        ${session.finalized_by ? `
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #71717a;">Finalizada por:</span>
            <span style="color: #10b981; font-weight: 800;">✓ ${session.finalized_by}</span>
          </div>
        ` : ''}
      </div>

      <div id="modal-blitz-detail-items" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px;">
        <!-- Renderizado dinamicamente -->
      </div>

      <div style="display: flex; gap: 8px; margin-top: 10px;">
        <button type="button" id="btn-detail-wa-export" class="btn-primary" style="flex: 1; height: 40px; font-weight: 800; background: #25d366; color: #000; justify-content: center; font-size: 0.85rem;">
          💬 WhatsApp
        </button>
        <button type="button" id="btn-detail-close" class="btn-secondary" style="flex: 1; height: 40px; font-weight: 800; justify-content: center; font-size: 0.85rem;">
          Fechar
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');
  const closeModal = () => modal.classList.remove('open');

  document.getElementById('modal-blitz-detail-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-detail')?.addEventListener('click', closeModal);
  document.getElementById('btn-detail-close')?.addEventListener('click', closeModal);

  document.getElementById('btn-detail-wa-export')?.addEventListener('click', async () => {
    const formatted = await formatBlitzSessionWhatsApp(session, items);
    openWhatsAppExportModal(formatted, `Blitz ${periodLabel}`);
  });

  const listEl = document.getElementById('modal-blitz-detail-items');
  if (listEl) {
    if (items.length === 0) {
      listEl.innerHTML = '<div style="text-align: center; color: #71717a; padding: 20px;">Nenhum item nesta conferência.</div>';
    } else {
      const pCards = items.map(async (it) => {
        const prod = it.product_id ? await getProductById(it.product_id) : null;
        const name = prod?.name || `PRODUTO ${it.barcode}`;
        const isTem = it.result === 'TEM';
        const dateBR = it.requested_expiration_date ? formatDateBR(it.requested_expiration_date) : '--/--/----';
        return `
          <div style="background: #18181c; border: 1px solid #27272a; border-radius: 6px; padding: 8px; display: flex; justify-content: space-between; align-items: center;">
            <div style="min-width: 0; flex: 1;">
              <div style="font-size: 0.82rem; font-weight: 800; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div>
              <div style="font-size: 0.7rem; color: #a1a1aa;">Val: ${dateBR} • Cód: ${it.barcode}</div>
            </div>
            <div style="text-align: right; flex-shrink: 0; margin-left: 8px;">
              <span style="font-size: 0.88rem; font-weight: 900; color: ${isTem ? '#10b981' : '#ef4444'};">
                ${isTem ? `TEM (${it.total_quantity} un)` : 'NÃO TEM'}
              </span>
            </div>
          </div>
        `;
      });
      listEl.innerHTML = (await Promise.all(pCards)).join('');
    }
  }
}

// Busca e renderiza histórico por produto
async function renderProductHistorySearchResults(query) {
  const container = document.getElementById('blitz-product-history-results');
  if (!container) return;

  if (!query || query.length < 2) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #71717a; font-size: 0.85rem;">
        Digite ao menos 2 caracteres para pesquisar.
      </div>
    `;
    return;
  }

  const allItems = await getAllBlitzItems();
  const matching = [];

  for (const item of allItems) {
    const prod = item.product_id ? await getProductById(item.product_id) : null;
    const name = (prod?.name || '').toLowerCase();
    const barcode = String(item.barcode || '').toLowerCase();

    if (name.includes(query) || barcode.includes(query)) {
      matching.push({ item, prodName: prod?.name || `Cód: ${item.barcode}` });
    }
  }

  if (matching.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #71717a; font-size: 0.85rem;">
        Nenhum registro encontrado para "${query}".
      </div>
    `;
    return;
  }

  // Ordena por conferência mais recente
  matching.sort((a, b) => new Date(b.item.checked_at || 0) - new Date(a.item.checked_at || 0));

  container.innerHTML = matching.map(({ item, prodName }) => {
    const isTem = item.result === 'TEM';
    const dateFormatted = item.requested_expiration_date ? formatDateBR(item.requested_expiration_date) : '--/--/----';
    const checkedAt = new Date(item.checked_at).toLocaleString('pt-BR');

    return `
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 8px 10px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.84rem; font-weight: 800; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${prodName}
          </div>
          <div style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; margin-top: 1px;">
            Validade Solicitada: ${dateFormatted}
          </div>
          <div style="font-size: 0.68rem; color: #71717a; margin-top: 2px;">
            ${item.barcode} • em ${checkedAt}
          </div>
        </div>
        <div style="text-align: right; flex-shrink: 0;">
          <span style="font-size: 0.95rem; font-weight: 900; color: ${isTem ? '#10b981' : '#ef4444'};">
            ${isTem ? `TEM (${formatNumber(item.total_quantity)} un)` : 'NÃO TEM (0 un)'}
          </span>
        </div>
      </div>
    `;
  }).join('');
}

// ----------------------------------------------------
// 12. RELATÓRIO PROFISSIONAL PARA O WHATSAPP
// ----------------------------------------------------

export async function formatBlitzSessionWhatsApp(session, items) {
  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;
  const startDate = new Date(session.started_at).toLocaleString('pt-BR');
  const finishDate = session.finished_at ? new Date(session.finished_at).toLocaleString('pt-BR') : 'Em andamento';

  let countTem = 0;
  let countNaoTem = 0;
  let totalQty = 0;

  const temLines = [];
  const naoTemLines = [];

  for (const item of items) {
    const prod = item.product_id ? await getProductById(item.product_id) : null;
    const prodName = prod?.name || `PRODUTO (Cód: ${item.barcode})`;
    const dateFormatted = item.requested_expiration_date ? formatDateBR(item.requested_expiration_date) : '--/--/----';

    if (item.result === 'TEM') {
      countTem++;
      totalQty += Number(item.total_quantity) || 0;
      temLines.push(`• *${prodName}*\n  Validade: ${dateFormatted} | Qtd: *${formatNumber(item.total_quantity)} un*\n  Cód: ${item.barcode}`);
    } else {
      countNaoTem++;
      naoTemLines.push(`• *${prodName}*\n  Validade: ${dateFormatted} | *NÃO TEM (0 un)*\n  Cód: ${item.barcode}`);
    }
  }

  const respName = session.responsible_user_name || session.user_name || 'Ana Luiza';

  let text = `📋 *RELATÓRIO DA BLITZ POR PERÍODO*\n`;
  text += `🏷️ Setor: *${session.sector || 'GERAL'}*\n`;
  text += `📅 Período: *${periodLabel}*\n`;
  text += `Responsável: *${respName}*\n`;
  if (session.finalized_by) {
    text += `Finalizada por: *${session.finalized_by}*\n`;
  }
  text += `Início: ${startDate}\n`;
  text += `Término: ${finishDate}\n`;
  text += `Status: *${session.status?.toUpperCase()}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📊 *RESUMO GERAL:*\n`;
  text += `• Total de Conferências: *${items.length}*\n`;
  text += `• 🟢 TEM (Encontrados): *${countTem}* (${formatNumber(totalQty)} unidades)\n`;
  text += `• 🔴 NÃO TEM (Em falta): *${countNaoTem}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (temLines.length > 0) {
    text += `✅ *PRODUTOS ENCONTRADOS (TEM):*\n\n`;
    text += temLines.join('\n\n') + '\n\n';
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (naoTemLines.length > 0) {
    text += `❌ *PRODUTOS EM FALTA (NÃO TEM):*\n\n`;
    text += naoTemLines.join('\n\n') + '\n\n';
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  text += `*Controladoria - ${respName}*\n`;
  text += `Enviado em: ${new Date().toLocaleString('pt-BR')}`;

  return text;
}
