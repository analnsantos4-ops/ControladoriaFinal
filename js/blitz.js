// Módulo da Blitz Semanal para Controladoria - Ana Luiza
import {
  initDB,
  createBlitzSession,
  getActiveBlitzSession,
  getBlitzSessionById,
  finishBlitzSession,
  cancelBlitzSession,
  getAllBlitzSessions,
  saveBlitzItem,
  getBlitzItemsBySessionId,
  getBlitzItemBySessionAndProduct,
  getLastBlitzItemForProduct,
  getProductByBarcode,
  getProductById,
  saveProductExpiration,
  getProductExpirations
} from './db.js';
import { BLITZ_TYPES, getSuggestedBlitzType, formatDateBR, formatNumber, parseDateBRtoISO, getTodayISO } from './utils.js';
import { showView, showToast, promptConfirmDialog } from './ui.js';
import { startCameraScanner, stopCameraScanner } from './scanner.js';
import { openNewProductView } from './products.js';
import { openConferenceForProduct, setBlitzConferenceContext } from './inventory.js';
import { openWhatsAppExportModal } from './whatsapp.js';
import { triggerSyncNow } from './sync.js';

let currentActiveBlitzSession = null;
let blitzPendingProductContext = null;

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

// Inicializa e restaura sessão ativa se houver
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

// Finaliza a sessão ativa de Blitz com confirmação, persistência e atualização geral da UI
export function finishActiveBlitzSession(sessionId = null) {
  const targetId = sessionId || currentActiveBlitzSession?.id;

  promptConfirmDialog({
    title: 'Finalizar Blitz Semanal',
    message: 'Deseja finalizar a sessão da Blitz Semanal com os itens conferidos? Os registros serão salvos e o status será marcado como <strong>Finalizada</strong>.',
    confirmText: '✓ FINALIZAR BLITZ',
    cancelText: 'VOLTAR',
    confirmStyle: 'primary',
    icon: '🏁',
    onConfirm: async () => {
      try {
        showToast('Finalizando Blitz...', 'info', 1500);
        await finishBlitzSession(targetId);
        setActiveBlitz(null);
        updateBlitzTopBarIndicator();
        triggerSyncNow().catch(e => console.warn('Sync blitz finish error:', e));
        showToast('✓ Blitz Semanal finalizada com sucesso!', 'success', 2500);

        const currentView = document.querySelector('.app-view.active')?.id;
        if (currentView === 'view-blitz-dashboard' || currentView === 'view-scanner') {
          showView('view-dashboard');
        } else if (currentView === 'view-blitz-history') {
          await openBlitzHistoryView();
        }
        window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
      } catch (e) {
        console.error('Erro ao finalizar Blitz:', e);
        showToast('Erro ao finalizar Blitz', 'warning');
      }
    }
  });
}

// Cancela a sessão ativa de Blitz com confirmação e persistência imediata
export function cancelActiveBlitzSession(sessionId = null) {
  const targetId = sessionId || currentActiveBlitzSession?.id;

  promptConfirmDialog({
    title: 'Cancelar Blitz Semanal',
    message: 'Tem certeza que deseja cancelar esta sessão de Blitz? O status da sessão será alterado para <strong>Cancelada</strong>.',
    confirmText: '✕ SIM, CANCELAR BLITZ',
    cancelText: 'NÃO CANCELAR',
    confirmStyle: 'danger',
    icon: '⚠️',
    onConfirm: async () => {
      try {
        showToast('Cancelando Blitz...', 'info', 1500);
        await cancelBlitzSession(targetId);
        setActiveBlitz(null);
        updateBlitzTopBarIndicator();
        triggerSyncNow().catch(e => console.warn('Sync blitz cancel error:', e));
        showToast('✓ Sessão de Blitz cancelada com sucesso.', 'success', 2500);

        const currentView = document.querySelector('.app-view.active')?.id;
        if (currentView === 'view-blitz-dashboard' || currentView === 'view-scanner') {
          showView('view-dashboard');
        } else if (currentView === 'view-blitz-history') {
          await openBlitzHistoryView();
        }
        window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
      } catch (e) {
        console.error('Erro ao cancelar Blitz:', e);
        showToast('Erro ao cancelar Blitz', 'warning');
      }
    }
  });
}

// Atualiza o indicador visual da Blitz no topo do Scanner e Dashboard
export function updateBlitzTopBarIndicator() {
  const banner = document.getElementById('scanner-blitz-indicator-bar');
  const dashBanner = document.getElementById('dashboard-active-blitz-banner');

  if (currentActiveBlitzSession) {
    const typeInfo = BLITZ_TYPES.find(t => t.id === currentActiveBlitzSession.blitz_type) || {
      label: currentActiveBlitzSession.blitz_type?.toUpperCase(),
      icon: '📋'
    };

    if (banner) {
      banner.classList.remove('hidden');
      banner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 6px; flex-wrap: wrap;">
          <span style="display: flex; align-items: center; gap: 6px; font-weight: 800; color: #fbbf24; font-size: 0.78rem;">
            <span>${typeInfo.icon}</span>
            <span>BLITZ: <strong>${typeInfo.label.toUpperCase()}</strong></span>
          </span>
          <div style="display: flex; gap: 6px;">
            <button type="button" id="btn-scanner-view-blitz" style="background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">
              📊 Painel
            </button>
            <button type="button" id="btn-scanner-cancel-blitz" style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #fca5a5; padding: 3px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; cursor: pointer;">
              ✕ Cancelar Blitz
            </button>
          </div>
        </div>`;
      document.getElementById('btn-scanner-view-blitz')?.addEventListener('click', () => {
        stopCameraScanner();
        openBlitzDashboardView();
      });
      document.getElementById('btn-scanner-cancel-blitz')?.addEventListener('click', () => {
        cancelActiveBlitzSession();
      });
    }

    if (dashBanner) {
      dashBanner.classList.remove('hidden');
      dashBanner.innerHTML = `
        <div class="active-session-card" style="border-color: rgba(245, 158, 11, 0.4); background: rgba(245, 158, 11, 0.08);">
          <div class="session-info-left">
            <span class="session-icon" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24;">${typeInfo.icon}</span>
            <div class="session-texts">
              <span class="session-title" style="color: #fbbf24;">BLITZ SEMANAL EM ANDAMENTO</span>
              <span class="session-sub">Tipo: <strong>${typeInfo.label.toUpperCase()}</strong> • Iniciada em ${new Date(currentActiveBlitzSession.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
          <div class="session-actions-row" style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn-resume-session" id="btn-dash-resume-blitz" style="background: #f59e0b; color: #000; font-weight: 900;">
              📷 CONTINUAR BIPANDO
            </button>
            <button type="button" class="btn-cancel-session-text" id="btn-dash-open-blitz-panel" style="font-weight: 800;">
              PAINEL
            </button>
            <button type="button" class="btn-cancel-session-text" id="btn-dash-cancel-blitz" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.4); font-weight: 800;">
              ✕ CANCELAR
            </button>
          </div>
        </div>`;

      document.getElementById('btn-dash-resume-blitz')?.addEventListener('click', () => {
        startBlitzScanning();
      });

      document.getElementById('btn-dash-open-blitz-panel')?.addEventListener('click', () => {
        openBlitzDashboardView();
      });

      document.getElementById('btn-dash-cancel-blitz')?.addEventListener('click', () => {
        cancelActiveBlitzSession();
      });
    }
  } else {
    if (banner) banner.classList.add('hidden');
    if (dashBanner) dashBanner.classList.add('hidden');
  }
}

// Abre o Modal Inicial para Escolher o Tipo da Blitz ou Gerenciar Sessão
export async function promptStartBlitz() {
  const active = await getActiveBlitzSession();
  if (active) {
    setActiveBlitz(active);
    openBlitzDashboardView();
    return;
  }

  showStartBlitzModal();
}

// Modal de Seleção do Tipo de Blitz
export function showStartBlitzModal() {
  let modal = document.getElementById('modal-blitz-start');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-start';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const suggested = getSuggestedBlitzType();

  const typesHtml = BLITZ_TYPES.map(t => {
    const isSuggested = t.id === suggested;
    return `
      <button type="button" class="blitz-type-select-btn ${isSuggested ? 'suggested' : ''}" data-type-id="${t.id}" style="
        background: #18181c;
        border: 2px solid ${isSuggested ? '#10b981' : '#2a2a30'};
        border-radius: 10px;
        padding: 12px 14px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        text-align: left;
        cursor: pointer;
        position: relative;
        box-sizing: border-box;
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="font-size: 1.6rem;">${t.icon}</span>
          <div>
            <div style="font-weight: 900; font-size: 0.95rem; color: #f4f4f5; display: flex; align-items: center; gap: 6px;">
              <span>${t.label.toUpperCase()}</span>
              ${isSuggested ? `<span style="background: #064e3b; color: #34d399; font-size: 0.65rem; font-weight: 800; padding: 1px 6px; border-radius: 4px;">SUGESTÃO DE HOJE</span>` : ''}
            </div>
            <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">
              ${t.desc}
            </div>
          </div>
        </div>
        <span style="color: ${isSuggested ? '#10b981' : '#71717a'}; font-size: 1.2rem; font-weight: 800;">➔</span>
      </button>
    `;
  }).join('');

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-start-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.5rem;">📋</span>
          <div>
            <h3 style="font-size: 1.1rem; font-weight: 900; color: #f4f4f5; margin: 0;">INICIAR BLITZ SEMANAL</h3>
            <span style="font-size: 0.74rem; color: #a1a1aa;">Selecione o setor da conferência</span>
          </div>
        </div>
        <button type="button" id="btn-close-blitz-start-modal" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
        ${typesHtml}
      </div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-blitz-view-history" class="btn-secondary" style="flex: 1; font-size: 0.82rem; justify-content: center;">
          📜 Histórico de Sessões
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-start-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-start-modal')?.addEventListener('click', closeModal);

  document.querySelectorAll('.blitz-type-select-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const typeId = btn.getAttribute('data-type-id');
      closeModal();
      await startNewBlitzSession(typeId);
    });
  });

  document.getElementById('btn-blitz-view-history')?.addEventListener('click', () => {
    closeModal();
    openBlitzHistoryView();
  });
}

// Inicia uma nova sessão de Blitz
export async function startNewBlitzSession(blitzType) {
  showToast('Iniciando Blitz Semanal...', 'info', 1500);
  try {
    const session = await createBlitzSession({ blitz_type: blitzType });
    setActiveBlitz(session);
    showToast(`✓ Blitz ${session.blitz_type.toUpperCase()} iniciada!`, 'success', 2000);
    triggerSyncNow().catch(e => console.warn('Sync blitz session error:', e));
    startBlitzScanning();
  } catch (e) {
    console.error('Erro ao iniciar Blitz:', e);
    showToast('Erro ao iniciar Blitz', 'warning');
  }
}

// Abre a câmera e prepara o scanner no Modo Blitz
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
// FLUXO DO SCANNER NA BLITZ (DATA INDIVIDUAL POR PRODUTO)
// ----------------------------------------------------

export async function handleBlitzBarcodeScanned(cleanBarcode) {
  if (!currentActiveBlitzSession) {
    return false; // Não está em Blitz, continua fluxo normal
  }

  showToast(`Código: ${cleanBarcode}`, 'info', 800);

  // Solicita a DATA DE VALIDADE ESPECÍFICA para este produto
  promptRequestedExpirationDate(cleanBarcode);
  return true;
}

// Modal para digitar/selecionar a data solicitada do produto
function promptRequestedExpirationDate(barcode) {
  let modal = document.getElementById('modal-blitz-date-prompt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-date-prompt';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const today = getTodayISO();

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-date-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 400px; width: 100%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.4rem;">📅</span>
          <div>
            <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">DATA PROCURADA</h3>
            <span style="font-size: 0.74rem; color: #fbbf24; font-weight: 700;">Código: ${barcode}</span>
          </div>
        </div>
        <button type="button" id="btn-close-blitz-date" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <p style="font-size: 0.8rem; color: #a1a1aa; margin-bottom: 12px; line-height: 1.35;">
        Informe a data de validade que você está procurando nesta conferência:
      </p>

      <div class="form-group" style="margin-bottom: 12px;">
        <label for="input-blitz-req-date" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa;">DATA DE VALIDADE:</label>
        <input
          type="date"
          id="input-blitz-req-date"
          class="form-input form-input-lg"
          value="${today}"
          style="font-size: 1.1rem; font-weight: 800; text-align: center; border-color: #f59e0b;"
          required
        />
      </div>

      <!-- Atalhos Rápidos de Datas -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 16px;">
        <button type="button" class="btn-quick-date btn-secondary" data-days="0" style="padding: 4px; font-size: 0.74rem; font-weight: 800; justify-content: center;">Hoje</button>
        <button type="button" class="btn-quick-date btn-secondary" data-days="15" style="padding: 4px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+15 Dias</button>
        <button type="button" class="btn-quick-date btn-secondary" data-days="30" style="padding: 4px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+30 Dias</button>
      </div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-cancel-blitz-date" class="btn-secondary" style="flex: 1; justify-content: center;">Cancelar</button>
        <button type="button" id="btn-confirm-blitz-date" class="btn-primary" style="flex: 1; justify-content: center; background: #f59e0b; color: #000; font-weight: 900;">
          CONTINUAR ➔
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const dateInput = document.getElementById('input-blitz-req-date');
  setTimeout(() => dateInput?.focus(), 150);

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-date-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-date')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-date')?.addEventListener('click', closeModal);

  // Botões de atalho de datas
  modal.querySelectorAll('.btn-quick-date').forEach(btn => {
    btn.addEventListener('click', () => {
      const days = Number(btn.getAttribute('data-days')) || 0;
      const d = new Date();
      d.setDate(d.getDate() + days);
      const iso = d.toISOString().split('T')[0];
      if (dateInput) dateInput.value = iso;
    });
  });

  document.getElementById('btn-confirm-blitz-date')?.addEventListener('click', async () => {
    const selectedDate = dateInput?.value || today;
    closeModal();
    await processBlitzProduct(barcode, selectedDate);
  });
}

// Processa o produto com a data solicitada (Verifica se existe, exibe histórico e pergunta TEM ou NÃO TEM)
export async function processBlitzProduct(barcode, requestedDate) {
  if (!currentActiveBlitzSession) return;

  const product = await getProductByBarcode(barcode);

  if (!product) {
    // PRODUTO NÃO CADASTRADO NO SISTEMA
    promptRegisterNewProductForBlitz(barcode, requestedDate);
    return;
  }

  // PRODUTO EXISTENTE: Busca histórico da última Blitz
  const lastBlitz = await getLastBlitzItemForProduct(product.id);
  const currentSessionItem = await getBlitzItemBySessionAndProduct(currentActiveBlitzSession.id, product.id);

  showBlitzProductDecisionModal({
    product,
    requestedDate,
    lastBlitz,
    currentSessionItem
  });
}

// Modal de Produto Não Cadastrado para a Blitz
function promptRegisterNewProductForBlitz(barcode, requestedDate) {
  let modal = document.getElementById('modal-blitz-unregistered');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-unregistered';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const typeInfo = BLITZ_TYPES.find(t => t.id === currentActiveBlitzSession?.blitz_type) || { sector: 'MERCEARIA' };

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-unregistered-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 400px; width: 100%; box-sizing: border-box;">
      <div style="font-size: 2.2rem; margin-bottom: 6px; text-align: center;">📦</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; text-align: center; margin: 0 0 6px 0;">PRODUTO NÃO CADASTRADO</h3>
      <p style="font-size: 0.85rem; color: #a1a1aa; text-align: center; margin-bottom: 14px; line-height: 1.4;">
        O código <strong>${barcode}</strong> ainda não está cadastrado no sistema.<br>
        Deseja cadastrá-lo agora na Blitz?
      </p>

      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; padding: 10px; margin-bottom: 16px; font-size: 0.78rem;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <span style="color: #71717a;">Setor Sugerido:</span>
          <strong style="color: #10b981;">${typeInfo.sector}</strong>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #71717a;">Validade Solicitada:</span>
          <strong style="color: #fbbf24;">${formatDateBR(requestedDate)}</strong>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-blitz-register-now" class="btn-primary" style="height: 44px; font-size: 0.92rem; font-weight: 900; justify-content: center; background: #10b981; color: #022c22;">
          ➕ CADASTRAR PRODUTO NA BLITZ
        </button>
        <button type="button" id="btn-blitz-register-cancel" class="btn-secondary" style="height: 38px; justify-content: center;">
          Voltar ao Scanner
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-unregistered-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-blitz-register-cancel')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-blitz-register-now')?.addEventListener('click', () => {
    closeModal();
    // Abre formulário de novo produto com setor e data pré-preenchidos e contexto da Blitz
    openNewProductView(barcode, typeInfo.sector, requestedDate, {
      sessionId: currentActiveBlitzSession.id,
      requestedDate: requestedDate
    });
  });
}

// Modal de Decisão da Blitz: TEM ou NÃO TEM (com histórico exibido)
function showBlitzProductDecisionModal({ product, requestedDate, lastBlitz, currentSessionItem }) {
  let modal = document.getElementById('modal-blitz-decision');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-decision';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // Prepara texto do histórico da última Blitz
  let historyBadgeHtml = '';
  if (lastBlitz) {
    const isTem = lastBlitz.result === 'TEM';
    const dateFormatted = new Date(lastBlitz.checked_at).toLocaleDateString('pt-BR');
    historyBadgeHtml = `
      <div style="background: ${isTem ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)'}; border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}; border-radius: 6px; padding: 6px 10px; margin-bottom: 12px; font-size: 0.74rem;">
        <span style="color: #71717a;">Última Blitz (${dateFormatted}):</span>
        <strong style="color: ${isTem ? '#10b981' : '#ef4444'}; margin-left: 4px;">
          ${isTem ? `✓ TEM (${formatNumber(lastBlitz.total_quantity)} un)` : '✕ NÃO TEM'}
        </strong>
      </div>
    `;
  } else {
    historyBadgeHtml = `
      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 6px; padding: 6px 10px; margin-bottom: 12px; font-size: 0.74rem; color: #71717a;">
        ℹ️ Primeira vez que este produto é conferido na Blitz.
      </div>
    `;
  }

  let sessionWarningHtml = '';
  if (currentSessionItem) {
    sessionWarningHtml = `
      <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 6px; padding: 6px 8px; margin-bottom: 10px; font-size: 0.72rem; color: #fbbf24; font-weight: 700;">
        ⚠️ Já conferido nesta sessão como <strong>${currentSessionItem.result}</strong> (${formatNumber(currentSessionItem.total_quantity)} un). Registrar novamente substituirá o valor.
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-decision-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      
      <!-- Cabeçalho do Produto -->
      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #27272a; padding-bottom: 10px;">
        <div style="width: 48px; height: 48px; border-radius: 8px; background: #09090b; border: 1px solid #27272a; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
          ${product.image ? `<img src="${product.image}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 1.4rem;">📦</span>`}
        </div>
        <div style="flex: 1; min-width: 0;">
          <h3 style="font-size: 0.95rem; font-weight: 900; color: #f4f4f5; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${product.name}
          </h3>
          <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">
            Cód: <strong>${product.barcode}</strong> • ${product.corridor || 'CORREDOR 01'}
          </div>
        </div>
      </div>

      <!-- Data Solicitada em Destaque -->
      <div style="background: rgba(245, 158, 11, 0.1); border: 2px solid rgba(245, 158, 11, 0.4); border-radius: 8px; padding: 10px; text-align: center; margin-bottom: 12px;">
        <div style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">Validade Solicitada Procurada:</div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #fef08a; margin-top: 2px;">${formatDateBR(requestedDate)}</div>
      </div>

      ${sessionWarningHtml}
      ${historyBadgeHtml}

      <div style="font-size: 0.85rem; font-weight: 800; color: #f4f4f5; text-align: center; margin-bottom: 14px;">
        O produto com esta validade foi encontrado?
      </div>

      <!-- Botões de Decisão: TEM ou NÃO TEM -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <button type="button" id="btn-blitz-nao-tem" class="btn-secondary" style="
          height: 52px;
          border-color: rgba(239, 68, 68, 0.5);
          background: rgba(239, 68, 68, 0.1);
          color: #ef4444;
          font-size: 0.95rem;
          font-weight: 900;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
        ">
          <span>✕ NÃO TEM</span>
          <span style="font-size: 0.65rem; font-weight: 700; opacity: 0.8;">(Produto em Falta)</span>
        </button>

        <button type="button" id="btn-blitz-tem" class="btn-primary" style="
          height: 52px;
          background: #10b981;
          color: #022c22;
          font-size: 0.95rem;
          font-weight: 900;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
        ">
          <span>✓ TEM</span>
          <span style="font-size: 0.65rem; font-weight: 800; opacity: 0.9;">(Conferir Quantidade)</span>
        </button>
      </div>

      <div style="margin-top: 14px; text-align: center;">
        <button type="button" id="btn-blitz-decision-cancel" style="background: none; border: none; color: #71717a; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline;">
          Cancelar e Voltar ao Scanner
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-decision-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-blitz-decision-cancel')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // SE NÃO TEM: Grava diretamente e retorna ao scanner
  document.getElementById('btn-blitz-nao-tem')?.addEventListener('click', async () => {
    closeModal();
    await recordBlitzItemNaoTem(product, requestedDate, currentSessionItem?.id);
  });

  // SE TEM: Abre tela de conferência para contagem dos locais
  document.getElementById('btn-blitz-tem')?.addEventListener('click', async () => {
    closeModal();
    await startBlitzConferenceForProduct(product, requestedDate);
  });
}

// Gravação de item NÃO TEM
async function recordBlitzItemNaoTem(product, requestedDate, existingItemId = null) {
  if (!currentActiveBlitzSession) return;

  try {
    showToast('Registrando NÃO TEM...', 'sync', 1000);

    const saved = await saveBlitzItem({
      id: existingItemId || null,
      blitz_session_id: currentActiveBlitzSession.id,
      product_id: product.id,
      barcode: product.barcode,
      requested_expiration_date: requestedDate,
      result: 'NAO_TEM',
      conference_id: null,
      total_quantity: 0
    });

    showToast(`✓ NÃO TEM: ${product.name}`, 'success', 2000);
    triggerSyncNow().catch(e => console.warn('Sync blitz item error:', e));

    // Volta imediatamente para o scanner da Blitz
    startBlitzScanning();
  } catch (err) {
    console.error('Erro ao registrar item da Blitz:', err);
    showToast('Erro ao salvar item da Blitz', 'warning');
  }
}

// Abre a conferência para contagem do produto na Blitz
async function startBlitzConferenceForProduct(product, requestedDate) {
  if (!currentActiveBlitzSession || !product || !requestedDate) return;

  const expirations = await getProductExpirations(product.id);
  const targetExp = expirations.find((e) => e.expiration_date === requestedDate);

  // Configura contexto da Blitz no módulo de inventário
  setBlitzConferenceContext({
    sessionId: currentActiveBlitzSession.id,
    productId: product.id,
    barcode: product.barcode,
    requestedDate: requestedDate
  });

  // Abre conferência passando o identificador da data (sem salvar no banco de dados ainda)
  const targetExpIdentifier = targetExp?.id || requestedDate;
  await openConferenceForProduct(product, targetExpIdentifier);
}

// ----------------------------------------------------
// TELA DO PAINEL DA BLITZ (DASHBOARD DA SESSÃO)
// ----------------------------------------------------

export async function openBlitzDashboardView() {
  if (!currentActiveBlitzSession) {
    promptStartBlitz();
    return;
  }

  const session = await getBlitzSessionById(currentActiveBlitzSession.id) || currentActiveBlitzSession;
  currentActiveBlitzSession = session;

  const typeInfo = BLITZ_TYPES.find(t => t.id === session.blitz_type) || {
    label: session.blitz_type?.toUpperCase(),
    icon: '📋',
    sector: 'MERCEARIA'
  };

  const items = await getBlitzItemsBySessionId(session.id);

  // Calcula estatísticas
  let countTem = 0;
  let countNaoTem = 0;
  let totalUnits = 0;

  items.forEach(it => {
    if (it.result === 'TEM') {
      countTem++;
      totalUnits += Number(it.total_quantity) || 0;
    } else {
      countNaoTem++;
    }
  });

  // Carrega produtos correspondentes para exibir nomes
  const container = document.getElementById('view-blitz-dashboard');
  if (!container) return;

  container.innerHTML = `
    <header class="app-top-bar">
      <button type="button" id="btn-blitz-dash-back" class="btn-back">← Início</button>
      <span class="top-bar-title">BLITZ: ${typeInfo.label.toUpperCase()}</span>
      <button type="button" id="btn-blitz-dash-history" class="btn-icon-link" style="color: #38bdf8;">Histórico</button>
    </header>

    <main style="padding: 12px; max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px;">
      
      <!-- Card da Sessão Ativa -->
      <div style="background: #121214; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.6rem;">${typeInfo.icon}</span>
            <div>
              <h2 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">BLITZ SEMANAL - ${typeInfo.label.toUpperCase()}</h2>
              <span style="font-size: 0.74rem; color: #a1a1aa;">Iniciada em ${new Date(session.started_at).toLocaleString('pt-BR')}</span>
            </div>
          </div>
          <span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 0.72rem; font-weight: 800; padding: 2px 8px; border-radius: 9999px;">
            EM ANDAMENTO
          </span>
        </div>

        <!-- Grade de Métricas da Blitz -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 4px;">
          <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 8px; text-align: center;">
            <div style="font-size: 0.68rem; color: #a1a1aa; font-weight: 800;">TOTAL ITENS</div>
            <div style="font-size: 1.3rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">${items.length}</div>
          </div>
          <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 8px; text-align: center;">
            <div style="font-size: 0.68rem; color: #10b981; font-weight: 800;">✓ TEM</div>
            <div style="font-size: 1.3rem; font-weight: 900; color: #10b981; margin-top: 2px;">${countTem} <small style="font-size: 0.75rem; font-weight: 700; color: #a7f3d0;">(${formatNumber(totalUnits)} un)</small></div>
          </div>
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 8px; text-align: center;">
            <div style="font-size: 0.68rem; color: #ef4444; font-weight: 800;">✕ NÃO TEM</div>
            <div style="font-size: 1.3rem; font-weight: 900; color: #ef4444; margin-top: 2px;">${countNaoTem}</div>
          </div>
        </div>
      </div>

      <!-- Botão Gigante de Ação: Bipar Próximo -->
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-blitz-continue-scan" class="btn-primary btn-hero-action" style="flex: 1; height: 50px; font-size: 1.05rem; justify-content: center; background: #10b981; color: #022c22;">
          📷 BIPAR PRODUTO NA BLITZ
        </button>
      </div>

      <!-- Ações da Sessão -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" id="btn-blitz-export-wa" class="btn-secondary" style="height: 40px; font-size: 0.82rem; justify-content: center; color: #25d366; border-color: rgba(37, 211, 102, 0.4);">
          💬 Exportar no WhatsApp
        </button>
        <button type="button" id="btn-blitz-finish" class="btn-secondary" style="height: 40px; font-size: 0.82rem; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
          🏁 Finalizar Sessão
        </button>
      </div>

      <!-- Lista de Itens Conferidos na Sessão -->
      <div style="background: #121214; border: 1px solid #2a2a30; border-radius: 10px; padding: 12px; margin-top: 2px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <h3 style="font-size: 0.85rem; font-weight: 900; color: #f4f4f5; margin: 0; text-transform: uppercase;">
            ITENS CONFERIDOS (${items.length})
          </h3>
          
          <!-- Filtro de Status -->
          <div style="display: flex; gap: 4px;">
            <button type="button" class="btn-blitz-filter-tab active" data-filter="all" style="background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">Todos</button>
            <button type="button" class="btn-blitz-filter-tab" data-filter="TEM" style="background: #18181c; border: 1px solid #2a2a30; color: #10b981; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">TEM</button>
            <button type="button" class="btn-blitz-filter-tab" data-filter="NAO_TEM" style="background: #18181c; border: 1px solid #2a2a30; color: #ef4444; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">NÃO TEM</button>
          </div>
        </div>

        <div id="blitz-session-items-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 480px; overflow-y: auto;">
          <!-- Preenchido via renderBlitzSessionItems -->
        </div>
      </div>

      <!-- Cancelar Sessão -->
      <div style="text-align: center; margin-top: 6px;">
        <button type="button" id="btn-blitz-cancel" style="background: none; border: none; color: #ef4444; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline;">
          Cancelar esta Blitz
        </button>
      </div>

    </main>
  `;

  showView('view-blitz-dashboard');

  // Listeners
  document.getElementById('btn-blitz-dash-back')?.addEventListener('click', () => {
    showView('view-dashboard');
  });

  document.getElementById('btn-blitz-dash-history')?.addEventListener('click', () => {
    openBlitzHistoryView();
  });

  document.getElementById('btn-blitz-continue-scan')?.addEventListener('click', () => {
    startBlitzScanning();
  });

  document.getElementById('btn-blitz-export-wa')?.addEventListener('click', async () => {
    const formatted = await formatBlitzSessionWhatsApp(session, items);
    openWhatsAppExportModal(formatted, `Blitz ${typeInfo.label}`);
  });

  document.getElementById('btn-blitz-finish')?.addEventListener('click', async () => {
    await finishActiveBlitzSession(session.id);
  });

  document.getElementById('btn-blitz-cancel')?.addEventListener('click', async () => {
    await cancelActiveBlitzSession(session.id);
  });

  // Filtros de Itens
  document.querySelectorAll('.btn-blitz-filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.btn-blitz-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.getAttribute('data-filter');
      renderBlitzSessionItems(items, filter);
    });
  });

  await renderBlitzSessionItems(items, 'all');
}

// Renderiza a lista de itens da sessão atual
async function renderBlitzSessionItems(items, filter = 'all') {
  const container = document.getElementById('blitz-session-items-list');
  if (!container) return;

  const filtered = items.filter(it => {
    if (filter === 'TEM') return it.result === 'TEM';
    if (filter === 'NAO_TEM') return it.result === 'NAO_TEM';
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #71717a; font-size: 0.85rem;">
        Nenhum item encontrado para este filtro.
      </div>`;
    return;
  }

  // Carrega produtos em paralelo para montar cards com nome
  const htmlPromises = filtered.map(async (item) => {
    const prod = await getProductById(item.product_id);
    const isTem = item.result === 'TEM';
    const name = prod?.name || `PRODUTO ${item.barcode}`;
    const timeFormatted = new Date(item.checked_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    return `
      <div class="blitz-item-card" data-barcode="${item.barcode}" data-date="${item.requested_expiration_date}" style="
        background: #18181c;
        border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)'};
        border-radius: 8px;
        padding: 8px 10px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      ">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span style="
              font-size: 0.65rem;
              font-weight: 900;
              padding: 2px 6px;
              border-radius: 4px;
              background: ${isTem ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)'};
              color: ${isTem ? '#10b981' : '#ef4444'};
            ">
              ${isTem ? '✓ TEM' : '✕ NÃO TEM'}
            </span>
            <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800;">
              Val: ${formatDateBR(item.requested_expiration_date)}
            </span>
          </div>
          <div style="font-size: 0.82rem; font-weight: 800; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${name}
          </div>
          <div style="font-size: 0.7rem; color: #71717a; margin-top: 1px;">
            ${item.barcode} • às ${timeFormatted}
          </div>
        </div>

        <div style="text-align: right; flex-shrink: 0;">
          ${isTem ? `
            <div style="font-size: 1.05rem; font-weight: 900; color: #10b981;">
              ${formatNumber(item.total_quantity)} <small style="font-size: 0.7rem; font-weight: 700; color: #a1a1aa;">un</small>
            </div>
          ` : `
            <div style="font-size: 0.8rem; font-weight: 800; color: #ef4444;">
              EM FALTA
            </div>
          `}
        </div>
      </div>
    `;
  });

  const cards = await Promise.all(htmlPromises);
  container.innerHTML = cards.join('');
}

// ----------------------------------------------------
// TELA DE HISTÓRICO DE SESSÕES DE BLITZ
// ----------------------------------------------------

export async function openBlitzHistoryView() {
  const container = document.getElementById('view-blitz-history');
  if (!container) return;

  const sessions = await getAllBlitzSessions();

  container.innerHTML = `
    <header class="app-top-bar">
      <button type="button" id="btn-blitz-history-back" class="btn-back">← Voltar</button>
      <span class="top-bar-title">HISTÓRICO DA BLITZ</span>
      <div style="width: 50px;"></div>
    </header>

    <main style="padding: 12px; max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <span style="font-size: 0.82rem; color: #a1a1aa; font-weight: 800;">SESSÕES REALIZADAS (${sessions.length})</span>
        <button type="button" id="btn-history-new-blitz" class="btn-secondary" style="font-size: 0.78rem; color: #10b981; border-color: rgba(16, 185, 129, 0.4); padding: 4px 8px;">
          ➕ Nova Blitz
        </button>
      </div>

      <div id="blitz-history-sessions-list" style="display: flex; flex-direction: column; gap: 8px;">
        <!-- Preenchido via renderBlitzHistoryList -->
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

  renderBlitzHistoryList(sessions);
}

async function renderBlitzHistoryList(sessions) {
  const container = document.getElementById('blitz-history-sessions-list');
  if (!container) return;

  if (sessions.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #71717a; font-size: 0.9rem;">
        Nenhuma sessão de Blitz realizada até o momento.
      </div>`;
    return;
  }

  const htmlPromises = sessions.map(async (session) => {
    const items = await getBlitzItemsBySessionId(session.id);
    const typeInfo = BLITZ_TYPES.find(t => t.id === session.blitz_type) || {
      label: session.blitz_type?.toUpperCase(),
      icon: '📋'
    };

    let countTem = 0;
    let countNaoTem = 0;
    let totalQty = 0;
    items.forEach(it => {
      if (it.result === 'TEM') {
        countTem++;
        totalQty += Number(it.total_quantity) || 0;
      } else {
        countNaoTem++;
      }
    });

    const isRunning = session.status === 'em_andamento';
    const isFinished = session.status === 'finalizada';

    const statusBadge = isRunning
      ? `<span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">EM ANDAMENTO</span>`
      : isFinished
      ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">FINALIZADA</span>`
      : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; font-size: 0.68rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">CANCELADA</span>`;

    return `
      <div class="blitz-history-card" style="
        background: #121214;
        border: 1px solid #2a2a30;
        border-radius: 10px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.4rem;">${typeInfo.icon}</span>
            <div>
              <div style="font-size: 0.92rem; font-weight: 900; color: #f4f4f5;">
                BLITZ ${typeInfo.label.toUpperCase()}
              </div>
              <div style="font-size: 0.72rem; color: #a1a1aa;">
                ${new Date(session.started_at).toLocaleString('pt-BR')}
              </div>
            </div>
          </div>
          ${statusBadge}
        </div>

        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; background: #18181c; padding: 6px; border-radius: 6px; font-size: 0.72rem; text-align: center;">
          <div><span style="color: #71717a;">Total:</span> <strong>${items.length} itens</strong></div>
          <div><span style="color: #10b981;">TEM:</span> <strong>${countTem} (${formatNumber(totalQty)} un)</strong></div>
          <div><span style="color: #ef4444;">NÃO TEM:</span> <strong>${countNaoTem}</strong></div>
        </div>

        <div style="display: flex; gap: 6px; margin-top: 2px;">
          ${isRunning ? `
            <button type="button" class="btn-resume-history-session btn-primary" data-id="${session.id}" style="flex: 1; height: 34px; font-size: 0.78rem; justify-content: center; background: #f59e0b; color: #000; font-weight: 800;">
              Continuar Sessão
            </button>
            <button type="button" class="btn-cancel-history-session btn-secondary" data-id="${session.id}" style="height: 34px; font-size: 0.78rem; justify-content: center; color: #ef4444; border-color: rgba(239, 68, 68, 0.4); padding: 0 10px; font-weight: 800;">
              ✕ Cancelar
            </button>
          ` : `
            <button type="button" class="btn-export-history-session btn-secondary" data-id="${session.id}" style="flex: 1; height: 34px; font-size: 0.78rem; justify-content: center; color: #25d366; font-weight: 800;">
              💬 Exportar WhatsApp
            </button>
          `}
        </div>
      </div>
    `;
  });

  const cards = await Promise.all(htmlPromises);
  container.innerHTML = cards.join('');

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

  container.querySelectorAll('.btn-cancel-history-session').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const canceled = await cancelActiveBlitzSession(id);
      if (canceled) {
        await openBlitzHistoryView();
      }
    });
  });

  container.querySelectorAll('.btn-export-history-session').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-id');
      const sess = await getBlitzSessionById(id);
      if (sess) {
        const items = await getBlitzItemsBySessionId(sess.id);
        const formatted = await formatBlitzSessionWhatsApp(sess, items);
        openWhatsAppExportModal(formatted, `Histórico Blitz`);
      }
    });
  });
}

// ----------------------------------------------------
// FORMATAÇÃO DO RELATÓRIO DA BLITZ PARA WHATSAPP
// ----------------------------------------------------

export async function formatBlitzSessionWhatsApp(session, items) {
  const typeInfo = BLITZ_TYPES.find(t => t.id === session.blitz_type) || {
    label: session.blitz_type?.toUpperCase(),
    icon: '📋'
  };

  const startDate = new Date(session.started_at).toLocaleString('pt-BR');
  const finishDate = session.finished_at ? new Date(session.finished_at).toLocaleString('pt-BR') : 'Em andamento';

  let countTem = 0;
  let countNaoTem = 0;
  let totalQty = 0;

  const temLines = [];
  const naoTemLines = [];

  for (const item of items) {
    const prod = await getProductById(item.product_id);
    const prodName = prod?.name || `CÓD: ${item.barcode}`;
    const dateFormatted = formatDateBR(item.requested_expiration_date);

    if (item.result === 'TEM') {
      countTem++;
      totalQty += Number(item.total_quantity) || 0;
      temLines.push(`• *${prodName}*\n  Validade: ${dateFormatted} | Qtd: *${formatNumber(item.total_quantity)} un* (Cód: ${item.barcode})`);
    } else {
      countNaoTem++;
      naoTemLines.push(`• *${prodName}*\n  Validade: ${dateFormatted} | *EM FALTA* (Cód: ${item.barcode})`);
    }
  }

  let text = `📋 *RELATÓRIO DA BLITZ SEMANAL*\n`;
  text += `Setor: *${typeInfo.label.toUpperCase()}* ${typeInfo.icon}\n`;
  text += `Início: ${startDate}\n`;
  text += `Status: *${session.status?.toUpperCase()}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📊 *RESUMO GERAL:*\n`;
  text += `• Total de Produtos Conferidos: *${items.length}*\n`;
  text += `• Itens Encontrados (TEM): *${countTem}* (${formatNumber(totalQty)} un no total)\n`;
  text += `• Itens em Falta (NÃO TEM): *${countNaoTem}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (temLines.length > 0) {
    text += `✅ *PRODUTOS ENCONTRADOS (TEM):*\n\n`;
    text += temLines.join('\n\n') + '\n\n';
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  if (naoTemLines.length > 0) {
    text += `❌ *PRODUTOS NÃO ENCONTRADOS / EM FALTA (NÃO TEM):*\n\n`;
    text += naoTemLines.join('\n\n') + '\n\n';
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  text += `*Controladoria - Ana Luiza*\n`;
  text += `Enviado em: ${new Date().toLocaleString('pt-BR')}`;

  return text;
}
