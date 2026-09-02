// ====================================================
// MÓDULO BLITZ SEMANAL COM HISTÓRICO E ATUALIZAÇÃO AUTOMÁTICA
// Controladoria - Ana Luiza
// ====================================================
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
  getBlitzItemBySessionProductAndDate,
  getLastBlitzItemForProductAndDate,
  getAllBlitzItemsForProductAndDate,
  getLastBlitzItemForProduct,
  getAllBlitzItemsForProduct,
  getAllBlitzItems,
  saveBlitzConferenceRecord,
  getProductByBarcode,
  getProductById,
  saveProduct,
  saveProductExpiration,
  getProductExpirations,
  getLatestCountsForExpiration,
  getExpirationByProductAndDate
} from './db.js';
import {
  BLITZ_SECTORS,
  BLITZ_LOCATIONS,
  BLITZ_TYPES,
  CORRIDORS,
  getSuggestedBlitzType,
  formatDateBR,
  formatNumber,
  parseDateBRtoISO,
  getTodayISO,
  formatTimeAgoDynamic,
  formatDateWithWeekday,
  compressImage
} from './utils.js';
import { showView, showToast, promptConfirmDialog } from './ui.js';
import { startCameraScanner, stopCameraScanner } from './scanner.js';
import { openWhatsAppExportModal } from './whatsapp.js';
import { triggerSyncNow } from './sync.js';

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

// Atualiza o indicador visual da Blitz no topo do app e no scanner
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

  const sectorObj = BLITZ_SECTORS.find(s => s.id === currentActiveBlitzSession.blitz_type || s.label.toUpperCase() === currentActiveBlitzSession.sector) || {
    label: currentActiveBlitzSession.sector || 'MERCEARIA',
    icon: '📋'
  };

  const bannerHtml = `
    <div style="
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.16) 0%, rgba(217, 119, 6, 0.22) 100%);
      border: 1px solid rgba(245, 158, 11, 0.45);
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    ">
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span style="font-size: 1.4rem; flex-shrink: 0;">${sectorObj.icon}</span>
        <div style="min-width: 0;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="background: #f59e0b; color: #000; font-size: 0.65rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">
              BLITZ ATIVA
            </span>
            <span style="font-size: 0.76rem; color: #fbbf24; font-weight: 800;">
              SETOR: ${sectorObj.label.toUpperCase()}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: #a1a1aa; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            Por ${currentActiveBlitzSession.user_name || 'Ana Luiza'} • Iniciada às ${new Date(currentActiveBlitzSession.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center;">
        <button type="button" id="btn-dash-resume-blitz" class="btn-primary" style="padding: 6px 12px; font-size: 0.76rem; font-weight: 900; background: #f59e0b; color: #000; border-radius: 6px; white-space: nowrap;">
          🔎 Continuar
        </button>
        <button type="button" id="btn-dash-cancel-blitz" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; padding: 5px 8px; border-radius: 6px; font-size: 0.74rem; font-weight: 800; cursor: pointer; white-space: nowrap;" title="Cancelar esta Blitz">
          ✕ Cancelar
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
    document.getElementById('btn-dash-cancel-blitz')?.addEventListener('click', async () => {
      await cancelActiveBlitzSession(currentActiveBlitzSession?.id);
    });
  }

  if (scannerBar) {
    scannerBar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 1.1rem;">${sectorObj.icon}</span>
        <span style="font-size: 0.74rem; font-weight: 900; color: #fbbf24; text-transform: uppercase;">
          MODO BLITZ: SETOR ${sectorObj.label.toUpperCase()}
        </span>
      </div>
      <div style="display: flex; gap: 6px; align-items: center;">
        <button type="button" id="btn-scanner-blitz-dash" style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: #fef08a; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">
          📊 Resumo
        </button>
        <button type="button" id="btn-scanner-blitz-cancel" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;" title="Cancelar Blitz">
          ✕ Cancelar
        </button>
      </div>
    `;
    scannerBar.classList.remove('hidden');
    document.getElementById('btn-scanner-blitz-dash')?.addEventListener('click', () => {
      openBlitzDashboardView();
    });
    document.getElementById('btn-scanner-blitz-cancel')?.addEventListener('click', async () => {
      await cancelActiveBlitzSession(currentActiveBlitzSession?.id);
    });
  }
}

// ----------------------------------------------------
// 1. INÍCIO DA BLITZ: SELEÇÃO DE SETOR
// ----------------------------------------------------

export async function promptStartBlitz() {
  if (currentActiveBlitzSession) {
    // Já existe uma Blitz em andamento
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

  const sectorObj = BLITZ_SECTORS.find(s => s.id === currentActiveBlitzSession.blitz_type || s.label.toUpperCase() === currentActiveBlitzSession.sector) || {
    label: currentActiveBlitzSession.sector || 'MERCEARIA',
    icon: '📋'
  };

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-active-blitz-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 400px; width: 100%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
        <span style="font-size: 1.8rem;">${sectorObj.icon}</span>
        <div>
          <h3 style="font-size: 1.1rem; font-weight: 900; color: #f4f4f5; margin: 0;">BLITZ EM ANDAMENTO</h3>
          <span style="font-size: 0.76rem; color: #fbbf24; font-weight: 800;">Setor: ${sectorObj.label.toUpperCase()}</span>
        </div>
      </div>

      <p style="font-size: 0.85rem; color: #a1a1aa; margin-bottom: 16px; line-height: 1.4;">
        Você já possui uma Blitz semanal em andamento para este setor. O que deseja fazer?
      </p>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-dialog-resume-blitz" class="btn-primary" style="height: 46px; font-weight: 900; background: #10b981; color: #022c22; justify-content: center; font-size: 0.95rem;">
          🔎 CONTINUAR BIPANDO PRODUTOS
        </button>
        <button type="button" id="btn-dialog-view-blitz-dash" class="btn-secondary" style="height: 42px; font-weight: 800; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
          📊 Ver Resumo da Sessão
        </button>
        <button type="button" id="btn-dialog-new-blitz" class="btn-secondary" style="height: 42px; font-weight: 800; justify-content: center; color: #38bdf8;">
          ➕ Iniciar Nova Blitz em Outro Setor
        </button>
        <button type="button" id="btn-dialog-abort-blitz" class="btn-secondary" style="height: 42px; font-weight: 800; justify-content: center; color: #ef4444; border-color: rgba(239, 68, 68, 0.4);">
          🛑 CANCELAR ESTA BLITZ
        </button>
        <button type="button" id="btn-dialog-cancel-blitz" class="btn-secondary" style="height: 38px; font-weight: 700; justify-content: center; color: #71717a; margin-top: 4px;">
          Fechar
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-active-blitz-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-dialog-cancel-blitz')?.addEventListener('click', closeModal);

  document.getElementById('btn-dialog-resume-blitz')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-dialog-view-blitz-dash')?.addEventListener('click', () => {
    closeModal();
    openBlitzDashboardView();
  });

  document.getElementById('btn-dialog-new-blitz')?.addEventListener('click', () => {
    closeModal();
    showStartBlitzModal();
  });

  document.getElementById('btn-dialog-abort-blitz')?.addEventListener('click', async () => {
    closeModal();
    await cancelActiveBlitzSession(currentActiveBlitzSession?.id);
  });
}

// Modal de Pergunta: 🏷️ QUAL SETOR?
export function showStartBlitzModal() {
  let modal = document.getElementById('modal-start-blitz');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-start-blitz';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const suggested = getSuggestedBlitzType();

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-start-blitz-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box;">
      
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.6rem;">🔎</span>
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; margin: 0;">INICIAR BLITZ SEMANAL</h3>
            <span style="font-size: 0.74rem; color: #a1a1aa;">Conferência física periódica • Ana Luiza</span>
          </div>
        </div>
        <button type="button" id="btn-close-start-blitz" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <!-- Caixa explicativa com o cronograma oficial de Ana Luiza -->
      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; font-size: 0.78rem; line-height: 1.45; color: #fef08a;">
        <div style="font-weight: 900; color: #fbbf24; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          <span>📅</span> <span>CRONOGRAMA DE BLITZ (ANA LUIZA):</span>
        </div>
        <div style="color: #e4e4e7; margin-left: 2px;">• <strong>Segunda a Quarta:</strong> Mercearia</div>
        <div style="color: #e4e4e7; margin-left: 2px;">• <strong>Quinta-feira:</strong> Bazar</div>
        <div style="color: #e4e4e7; margin-left: 2px;">• <strong>Sexta e Sábado:</strong> Bebidas</div>
        <div style="font-size: 0.72rem; color: #a1a1aa; margin-top: 6px; font-style: italic;">
          * O setor de hoje já está destacado abaixo. Você pode alterar para outro setor a qualquer momento se desejar.
        </div>
      </div>

      <!-- Lista dos 6 Setores Exigidos com destaque do dia -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
        ${BLITZ_SECTORS.map((s) => {
          const isSug = s.id === suggested;
          return `
            <button type="button" class="btn-sector-select" data-sector-id="${s.id}" data-sector-name="${s.label}" style="
              background: #18181c;
              border: 1.5px solid ${isSug ? '#f59e0b' : '#27272a'};
              border-radius: 8px;
              padding: 10px 8px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 2px;
              cursor: pointer;
              transition: all 0.15s ease;
              position: relative;
              min-height: 72px;
            ">
              ${isSug ? `<span style="position: absolute; top: 4px; right: 4px; background: #f59e0b; color: #000; font-size: 0.58rem; font-weight: 900; padding: 1px 5px; border-radius: 3px;">HOJE</span>` : ''}
              <span style="font-size: 1.5rem;">${s.icon}</span>
              <span style="font-size: 0.88rem; font-weight: 900; color: #f4f4f5;">${s.label}</span>
              <span style="font-size: 0.65rem; color: ${isSug ? '#fbbf24' : '#71717a'}; font-weight: 700;">${s.schedule || ''}</span>
            </button>
          `;
        }).join('')}
      </div>

      <div style="display: flex; justify-content: flex-end;">
        <button type="button" id="btn-cancel-start-blitz" class="btn-secondary" style="height: 38px; width: 100%; justify-content: center;">
          Cancelar
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-start-blitz-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-start-blitz')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-start-blitz')?.addEventListener('click', closeModal);

  // Clique nos setores
  modal.querySelectorAll('.btn-sector-select').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const sectorId = btn.getAttribute('data-sector-id');
      const sectorName = btn.getAttribute('data-sector-name');
      closeModal();
      await startNewBlitzSession(sectorId, sectorName);
    });
  });
}

// Cria a nova sessão da Blitz e leva direto para o Scanner
export async function startNewBlitzSession(sectorId, sectorName = null) {
  try {
    const sName = sectorName || BLITZ_SECTORS.find(s => s.id === sectorId)?.label || 'MERCEARIA';
    showToast(`Iniciando Blitz: ${sName}...`, 'sync', 1000);

    const session = await createBlitzSession({
      blitz_type: sectorId,
      sector: sName.toUpperCase(),
      user_name: 'Ana Luiza'
    });

    setActiveBlitz(session);
    showToast(`🔎 Blitz iniciada: Setor ${sName}`, 'success', 2000);
    triggerSyncNow().catch(e => console.warn('Sync blitz session error:', e));

    // Abre diretamente o scanner no modo Blitz
    startBlitzScanning();
  } catch (err) {
    console.error('Erro ao iniciar Blitz:', err);
    showToast('Erro ao criar sessão da Blitz', 'warning');
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

// Finaliza a sessão ativa da Blitz
export async function finishActiveBlitzSession(sessionId = null) {
  const id = sessionId || currentActiveBlitzSession?.id;
  if (!id) return;

  const confirmed = await promptConfirmDialog(
    '🏁 FINALIZAR BLITZ SEMANAL?',
    'Deseja concluir esta conferência? O histórico de contagens será preservado e você poderá gerar o relatório para o WhatsApp.'
  );

  if (!confirmed) return;

  try {
    showToast('Finalizando Blitz...', 'sync', 1000);
    await finishBlitzSession(id);
    setActiveBlitz(null);
    showToast('✓ Blitz semanal finalizada com sucesso!', 'success', 2500);
    triggerSyncNow().catch(e => console.warn('Sync error:', e));
    await openBlitzHistoryView();
  } catch (err) {
    console.error('Erro ao finalizar blitz:', err);
    showToast('Erro ao finalizar sessão da Blitz', 'warning');
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
// 2. LEITURA DE CÓDIGO DE BARRAS NA BLITZ
// ----------------------------------------------------

export async function handleBlitzBarcodeScanned(cleanBarcode) {
  if (!currentActiveBlitzSession) {
    return false;
  }

  showToast(`Código: ${cleanBarcode}`, 'info', 800);

  // 1. Verifica se o produto existe no banco
  const product = await getProductByBarcode(cleanBarcode);

  if (!product) {
    // PRODUTO NÃO CADASTRADO NO SISTEMA
    promptRegisterNewProductForBlitz(cleanBarcode);
    return true;
  }

  // 2. PRODUTO JÁ CADASTRADO: Pergunta qual data você está procurando
  promptRequestedExpirationDate(product);
  return true;
}

// ----------------------------------------------------
// 3. PRODUTO CADASTRADO: QUAL DATA VOCÊ ESTÁ PROCURANDO?
// ----------------------------------------------------

async function promptRequestedExpirationDate(product) {
  let modal = document.getElementById('modal-blitz-date-prompt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-date-prompt';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const today = getTodayISO();
  const expirations = await getProductExpirations(product.id);

  // Ordena validades da mais próxima para a mais distante
  expirations.sort((a, b) => new Date(a.expiration_date) - new Date(b.expiration_date));

  let existingDatesHtml = '';
  if (expirations.length > 0) {
    existingDatesHtml = `
      <div style="margin-bottom: 14px;">
        <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase; margin-bottom: 6px; display: block;">
          Validades Cadastradas (toque para escolher):
        </label>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto;">
          ${expirations.map((exp) => `
            <button type="button" class="btn-pick-existing-date" data-date="${exp.expiration_date}" style="
              background: #18181c;
              border: 1px solid rgba(245, 158, 11, 0.4);
              border-radius: 6px;
              padding: 6px 10px;
              color: #fef08a;
              font-size: 0.8rem;
              font-weight: 800;
              cursor: pointer;
              display: flex;
              align-items: center;
              gap: 4px;
            ">
              <span>📅 ${formatDateBR(exp.expiration_date)}</span>
              <small style="color: #a1a1aa; font-size: 0.7rem;">(${exp.current_total_quantity || 0} un)</small>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-date-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      
      <!-- Cabeçalho do Produto -->
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; border-bottom: 1px solid #27272a; padding-bottom: 10px;">
        <div style="width: 44px; height: 44px; border-radius: 8px; background: #09090b; border: 1px solid #27272a; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
          ${product.image ? `<img src="${product.image}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 1.3rem;">📦</span>`}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 0.72rem; color: #10b981; font-weight: 800; text-transform: uppercase;">
            📦 PRODUTO ENCONTRADO
          </div>
          <h3 style="font-size: 0.95rem; font-weight: 900; color: #f4f4f5; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${product.name}
          </h3>
          <div style="font-size: 0.72rem; color: #a1a1aa; margin-top: 1px;">
            Cód: <strong>${product.barcode}</strong> • Setor: ${product.sector || currentActiveBlitzSession?.sector}
          </div>
        </div>
        <button type="button" id="btn-close-blitz-date" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <div style="font-size: 0.88rem; font-weight: 800; color: #fef08a; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
        <span>📅</span>
        <span>QUAL DATA VOCÊ ESTÁ PROCURANDO?</span>
      </div>

      ${existingDatesHtml}

      <div class="form-group" style="margin-bottom: 12px;">
        <label for="input-blitz-req-date" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa;">
          DIGITAR OUTRA DATA:
        </label>
        <input
          type="date"
          id="input-blitz-req-date"
          class="form-input form-input-lg"
          value="${expirations[0]?.expiration_date || today}"
          style="font-size: 1.1rem; font-weight: 800; text-align: center; border-color: #f59e0b; height: 46px;"
          required
        />
      </div>

      <!-- Atalhos Rápidos -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 16px;">
        <button type="button" class="btn-quick-date btn-secondary" data-days="0" style="padding: 6px; font-size: 0.74rem; font-weight: 800; justify-content: center;">Hoje</button>
        <button type="button" class="btn-quick-date btn-secondary" data-days="15" style="padding: 6px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+15 Dias</button>
        <button type="button" class="btn-quick-date btn-secondary" data-days="30" style="padding: 6px; font-size: 0.74rem; font-weight: 800; justify-content: center;">+30 Dias</button>
      </div>

      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-cancel-blitz-date" class="btn-secondary" style="flex: 1; height: 44px; justify-content: center;">
          Cancelar
        </button>
        <button type="button" id="btn-confirm-blitz-date" class="btn-primary" style="flex: 1; height: 44px; justify-content: center; background: #f59e0b; color: #000; font-weight: 900;">
          CONTINUAR ➔
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const dateInput = document.getElementById('input-blitz-req-date');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-date-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-date')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-date')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // Atalhos de datas cadastradas
  modal.querySelectorAll('.btn-pick-existing-date').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pickedDate = btn.getAttribute('data-date');
      closeModal();
      await processBlitzProduct(product.barcode, pickedDate);
    });
  });

  // Atalhos +15 / +30
  modal.querySelectorAll('.btn-quick-date').forEach((btn) => {
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
    await processBlitzProduct(product.barcode, selectedDate);
  });
}

// ----------------------------------------------------
// 4. CONSULTA HISTÓRICO & TELA DE DECISÃO (TEM OU NÃO TEM)
// ----------------------------------------------------

export async function processBlitzProduct(barcode, requestedDate) {
  if (!currentActiveBlitzSession) return;

  const product = await getProductByBarcode(barcode);
  if (!product) {
    promptRegisterNewProductForBlitz(barcode);
    return;
  }

  // 1. Busca última conferência da Blitz para essa combinação específica (PRODUTO + DATA)
  const lastBlitzItemForDate = await getLastBlitzItemForProductAndDate(product.id, requestedDate);

  // 2. Busca se essa validade já existia no estoque cadastrado
  const expRecord = await getExpirationByProductAndDate(product.id, requestedDate);

  // 3. Determina quantidade anterior registrada
  let previousQuantity = 0;
  if (lastBlitzItemForDate) {
    previousQuantity = Number(lastBlitzItemForDate.total_quantity) || 0;
  } else if (expRecord) {
    previousQuantity = Number(expRecord.current_total_quantity) || 0;
  }

  // 4. Busca histórico completo de contagens anteriores dessa combinação
  const historyItems = await getAllBlitzItemsForProductAndDate(product.id, requestedDate);

  showBlitzProductDecisionModal({
    product,
    requestedDate,
    lastBlitzItem: lastBlitzItemForDate,
    expRecord,
    previousQuantity,
    historyItems
  });
}

// Modal de Decisão da Blitz: TEM ou NÃO TEM
function showBlitzProductDecisionModal({
  product,
  requestedDate,
  lastBlitzItem,
  expRecord,
  previousQuantity,
  historyItems
}) {
  let modal = document.getElementById('modal-blitz-decision');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-decision';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // Monta card de ÚLTIMA CONFERÊNCIA
  let lastConferenceCardHtml = '';
  if (lastBlitzItem) {
    const isTem = lastBlitzItem.result === 'TEM';
    const dateWithWeekday = formatDateWithWeekday(lastBlitzItem.checked_at);
    const timeAgoStr = formatTimeAgoDynamic(lastBlitzItem.checked_at);

    lastConferenceCardHtml = `
      <div style="background: #18181c; border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
          <span style="font-size: 0.72rem; color: #a1a1aa; font-weight: 800; text-transform: uppercase;">
            🔄 ÚLTIMA CONFERÊNCIA:
          </span>
          <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800;">
            ${timeAgoStr}
          </span>
        </div>
        <div style="font-size: 0.78rem; color: #f4f4f5; font-weight: 700; margin-bottom: 4px;">
          ${dateWithWeekday}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 4px; border-top: 1px dashed #27272a;">
          <span style="font-size: 0.74rem; color: #71717a;">Resultado:</span>
          <span style="font-size: 0.88rem; font-weight: 900; color: ${isTem ? '#10b981' : '#ef4444'};">
            ${isTem ? `🟢 TEM (${formatNumber(lastBlitzItem.total_quantity)} un)` : `🔴 NÃO TEM (0 un)`}
          </span>
        </div>
        ${!isTem ? `
          <div style="font-size: 0.72rem; color: #f87171; font-style: italic; margin-top: 4px;">
            "Na última conferência esta validade NÃO foi encontrada."
          </div>
        ` : ''}
      </div>
    `;
  } else if (expRecord) {
    lastConferenceCardHtml = `
      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 0.72rem; color: #38bdf8; font-weight: 800; text-transform: uppercase; margin-bottom: 2px;">
          ℹ️ VALIDADE JÁ CADASTRADA NO ESTOQUE
        </div>
        <div style="font-size: 0.8rem; color: #a1a1aa;">
          Primeira vez conferida na Blitz. Estoque atual no sistema: <strong style="color: #f4f4f5;">${formatNumber(previousQuantity)} un</strong>
        </div>
      </div>
    `;
  } else {
    lastConferenceCardHtml = `
      <div style="background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 0.75rem; color: #fbbf24; font-weight: 800; text-transform: uppercase; margin-bottom: 2px;">
          ⚠️ ESSA DATA AINDA NÃO ESTÁ CADASTRADA
        </div>
        <div style="font-size: 0.78rem; color: #fef08a;">
          Esta validade ainda não constava no cadastro do produto. Você encontrou fisicamente essa data na loja?
        </div>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-decision-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box;">
      
      <!-- Cabeçalho do Produto -->
      <div style="display: flex; gap: 10px; align-items: center; margin-bottom: 12px; border-bottom: 1px solid #27272a; padding-bottom: 10px;">
        <div style="width: 48px; height: 48px; border-radius: 8px; background: #09090b; border: 1px solid #27272a; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
          ${product.image ? `<img src="${product.image}" style="width: 100%; height: 100%; object-fit: cover;" />` : `<span style="font-size: 1.4rem;">📦</span>`}
        </div>
        <div style="flex: 1; min-width: 0;">
          <h3 style="font-size: 0.96rem; font-weight: 900; color: #f4f4f5; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${product.name}
          </h3>
          <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">
            Cód: <strong>${product.barcode}</strong> • Corredor: ${product.corridor || '01'}
          </div>
        </div>
      </div>

      <!-- Validade Solicitada -->
      <div style="background: rgba(245, 158, 11, 0.1); border: 2px solid rgba(245, 158, 11, 0.45); border-radius: 8px; padding: 8px 12px; text-align: center; margin-bottom: 12px;">
        <div style="font-size: 0.7rem; color: #fbbf24; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;">
          VALIDADE SENDO CONFERIDA:
        </div>
        <div style="font-size: 1.35rem; font-weight: 900; color: #fef08a; margin-top: 2px;">
          ${formatDateBR(requestedDate)}
        </div>
      </div>

      ${lastConferenceCardHtml}

      <div style="font-size: 0.88rem; font-weight: 900; color: #f4f4f5; text-align: center; margin-bottom: 14px;">
        ESSA DATA TEM PRODUTO FISICAMENTE AGORA?
      </div>

      <!-- Botões de Decisão -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
        <button type="button" id="btn-blitz-decision-nao-tem" class="btn-secondary" style="
          height: 56px;
          border-color: rgba(239, 68, 68, 0.5);
          background: rgba(239, 68, 68, 0.12);
          color: #ef4444;
          font-size: 1rem;
          font-weight: 900;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          cursor: pointer;
        ">
          <span>🔴 NÃO TEM</span>
          <span style="font-size: 0.68rem; font-weight: 700; opacity: 0.9;">(Zerar Estoque Físico)</span>
        </button>

        <button type="button" id="btn-blitz-decision-tem" class="btn-primary" style="
          height: 56px;
          background: #10b981;
          color: #022c22;
          font-size: 1rem;
          font-weight: 900;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          cursor: pointer;
        ">
          <span>🟢 TEM</span>
          <span style="font-size: 0.68rem; font-weight: 800; opacity: 0.9;">(Contar Locais)</span>
        </button>
      </div>

      <!-- Botão Ver Histórico -->
      <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 6px;">
        <button type="button" id="btn-blitz-view-history" class="btn-secondary" style="height: 38px; font-size: 0.78rem; font-weight: 800; justify-content: center; color: #38bdf8;">
          📜 VER HISTÓRICO COMPLETO (${historyItems.length} conferências)
        </button>
        <button type="button" id="btn-blitz-decision-cancel" style="background: none; border: none; color: #71717a; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 4px;">
          Voltar ao Scanner
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

  // Botão 🔴 NÃO TEM: Grava automaticamente quantidade 0 e volta ao scanner
  document.getElementById('btn-blitz-decision-nao-tem')?.addEventListener('click', async () => {
    closeModal();
    await handleBlitzNaoTemSelection({
      product,
      requestedDate,
      previousQuantity,
      isNewExpiration: !expRecord
    });
  });

  // Botão 🟢 TEM: Pergunta localização e quantidade
  document.getElementById('btn-blitz-decision-tem')?.addEventListener('click', () => {
    closeModal();
    showBlitzLocationCountModal({
      product,
      requestedDate,
      previousQuantity,
      isNewExpiration: !expRecord
    });
  });

  // Botão 📜 VER HISTÓRICO COMPLETO
  document.getElementById('btn-blitz-view-history')?.addEventListener('click', () => {
    showBlitzProductHistoryModal({
      product,
      requestedDate,
      historyItems
    });
  });
}

// ----------------------------------------------------
// 5. FLUXO: 🔴 NÃO TEM (ZERAR ESTOQUE FÍSICO COM HISTÓRICO)
// ----------------------------------------------------

async function handleBlitzNaoTemSelection({ product, requestedDate, previousQuantity, isNewExpiration }) {
  if (!currentActiveBlitzSession) return;

  try {
    showToast('Registrando NÃO TEM...', 'sync', 1000);

    await saveBlitzConferenceRecord({
      sessionId: currentActiveBlitzSession.id,
      productId: product.id,
      barcode: product.barcode,
      sector: currentActiveBlitzSession.sector,
      requestedDate: requestedDate,
      previousQuantity: previousQuantity,
      newQuantity: 0,
      result: 'NAO_TEM',
      locations: [],
      userName: currentActiveBlitzSession.user_name || 'Ana Luiza',
      isNewExpiration: isNewExpiration
    });

    const diff = 0 - previousQuantity;
    const diffStr = diff !== 0 ? ` (Diferença: ${diff} un)` : '';

    showToast(`✅ CONFERÊNCIA REGISTRADA: NÃO TEM (0 un)${diffStr}`, 'success', 2500);
    triggerSyncNow().catch(e => console.warn('Sync blitz item error:', e));

    // Retorna imediatamente ao scanner para o próximo produto sem cliques extras
    startBlitzScanning();
  } catch (err) {
    console.error('Erro ao registrar NÃO TEM na Blitz:', err);
    showToast('Erro ao registrar conferência', 'warning');
  }
}

// ----------------------------------------------------
// 6. FLUXO: 🟢 TEM (SELEÇÃO DE LOCAIS E SOMA AUTOMÁTICA)
// ----------------------------------------------------

function showBlitzLocationCountModal({
  product,
  requestedDate,
  previousQuantity,
  isNewExpiration
}) {
  let modal = document.getElementById('modal-blitz-location-count');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-location-count';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  // Estado local das contagens por local
  const locationCounts = {};
  BLITZ_LOCATIONS.forEach(loc => {
    locationCounts[loc] = 0;
  });

  // Locais mais comuns abertos por padrão
  const defaultOpenLocations = ['Área de venda', 'Depósito'];

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-loc-backdrop"></div>
    <div class="modal-card" style="padding: 16px; max-width: 480px; width: 100%; box-sizing: border-box; max-height: 92vh; display: flex; flex-direction: column;">
      
      <!-- Cabeçalho -->
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 10px;">
        <div style="min-width: 0; flex: 1;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 0.68rem; font-weight: 900; background: #10b981; color: #022c22; padding: 2px 6px; border-radius: 4px;">
              🟢 TEM
            </span>
            <span style="font-size: 0.78rem; font-weight: 800; color: #fbbf24;">
              Val: ${formatDateBR(requestedDate)}
            </span>
          </div>
          <h3 style="font-size: 0.92rem; font-weight: 900; color: #f4f4f5; margin: 4px 0 0 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${product.name}
          </h3>
        </div>
        <button type="button" id="btn-close-blitz-loc" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div style="font-size: 0.82rem; font-weight: 800; color: #a1a1aa; margin-bottom: 8px;">
        📍 ONDE O PRODUTO ESTÁ? (Informe a quantidade de cada local)
      </div>

      <!-- Lista de Locais com Inputs Numéricos Confortáveis para Mobile -->
      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; margin-bottom: 12px;">
        ${BLITZ_LOCATIONS.map((locName) => {
          const isCommon = defaultOpenLocations.includes(locName);
          return `
            <div class="blitz-loc-row" data-location="${locName}" style="
              background: #18181c;
              border: 1px solid #27272a;
              border-radius: 8px;
              padding: 8px 10px;
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 8px;
            ">
              <span style="font-size: 0.85rem; font-weight: 800; color: ${isCommon ? '#f4f4f5' : '#a1a1aa'};">
                ${locName}
              </span>
              <div style="display: flex; align-items: center; gap: 6px;">
                <input
                  type="number"
                  inputmode="numeric"
                  pattern="[0-9]*"
                  class="blitz-loc-input"
                  data-location="${locName}"
                  min="0"
                  placeholder="0"
                  value=""
                  style="
                    width: 90px;
                    height: 40px;
                    background: #09090b;
                    border: 1px solid #3f3f46;
                    border-radius: 6px;
                    color: #10b981;
                    font-size: 1.1rem;
                    font-weight: 900;
                    text-align: center;
                    padding: 0;
                  "
                />
                <span style="font-size: 0.72rem; color: #71717a; font-weight: 700;">un</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>

      <!-- Resumo da Contagem e Comparativo com a Conferência Anterior -->
      <div style="background: #121214; border: 1px solid #27272a; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;">
          <span style="font-size: 0.78rem; font-weight: 800; color: #a1a1aa;">TOTAL ENCONTRADO:</span>
          <span id="blitz-loc-total-display" style="font-size: 1.4rem; font-weight: 900; color: #10b981;">
            0 <small style="font-size: 0.8rem; color: #a1a1aa;">unidades</small>
          </span>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; padding-top: 6px; border-top: 1px solid #27272a; text-align: center; font-size: 0.74rem;">
          <div>
            <span style="color: #71717a; display: block;">Anterior:</span>
            <strong style="color: #f4f4f5; font-size: 0.88rem;">${formatNumber(previousQuantity)} un</strong>
          </div>
          <div>
            <span style="color: #71717a; display: block;">Nova Contagem:</span>
            <strong id="blitz-loc-new-count" style="color: #10b981; font-size: 0.88rem;">0 un</strong>
          </div>
          <div>
            <span style="color: #71717a; display: block;">Diferença:</span>
            <strong id="blitz-loc-difference" style="color: #a1a1aa; font-size: 0.88rem;">${previousQuantity > 0 ? `-${previousQuantity}` : '0'} un</strong>
          </div>
        </div>
      </div>

      <!-- Botão de Confirmação -->
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-cancel-blitz-loc" class="btn-secondary" style="height: 48px; flex: 1; justify-content: center;">
          Cancelar
        </button>
        <button type="button" id="btn-save-blitz-loc" class="btn-primary" style="height: 48px; flex: 2; justify-content: center; background: #10b981; color: #022c22; font-size: 0.95rem; font-weight: 900;">
          ✓ CONFIRMAR E SALVAR
        </button>
      </div>

    </div>
  `;

  modal.classList.add('open');

  const updateTotalCalc = () => {
    let sum = 0;
    modal.querySelectorAll('.blitz-loc-input').forEach(inp => {
      const val = parseInt(inp.value, 10);
      if (!isNaN(val) && val > 0) {
        sum += val;
      }
    });

    const diff = sum - previousQuantity;
    const totalDisplay = document.getElementById('blitz-loc-total-display');
    const newCountDisplay = document.getElementById('blitz-loc-new-count');
    const diffDisplay = document.getElementById('blitz-loc-difference');

    if (totalDisplay) totalDisplay.innerHTML = `${formatNumber(sum)} <small style="font-size: 0.8rem; color: #a1a1aa;">unidades</small>`;
    if (newCountDisplay) newCountDisplay.textContent = `${formatNumber(sum)} un`;

    if (diffDisplay) {
      if (diff > 0) {
        diffDisplay.style.color = '#10b981';
        diffDisplay.textContent = `+${formatNumber(diff)} un`;
      } else if (diff < 0) {
        diffDisplay.style.color = '#ef4444';
        diffDisplay.textContent = `${formatNumber(diff)} un`;
      } else {
        diffDisplay.style.color = '#38bdf8';
        diffDisplay.textContent = `0 un (igual)`;
      }
    }
  };

  modal.querySelectorAll('.blitz-loc-input').forEach(inp => {
    inp.addEventListener('input', updateTotalCalc);
  });

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-loc-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-loc')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-blitz-loc')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('btn-save-blitz-loc')?.addEventListener('click', async () => {
    const locationsPayload = [];
    let totalQty = 0;

    modal.querySelectorAll('.blitz-loc-input').forEach(inp => {
      const locName = inp.getAttribute('data-location');
      const val = parseInt(inp.value, 10);
      if (!isNaN(val) && val > 0) {
        locationsPayload.push({
          location: locName,
          quantity: val
        });
        totalQty += val;
      }
    });

    if (totalQty <= 0) {
      const zeroConfirmed = await promptConfirmDialog(
        '⚠️ QUANTIDADE ZERADA?',
        'Você não digitou nenhuma quantidade nos locais. Se o produto não está presente, ele será registrado como NÃO TEM. Confirmar?'
      );
      if (!zeroConfirmed) return;

      closeModal();
      await handleBlitzNaoTemSelection({
        product,
        requestedDate,
        previousQuantity,
        isNewExpiration
      });
      return;
    }

    try {
      closeModal();
      showToast('Salvando conferência...', 'sync', 1000);

      await saveBlitzConferenceRecord({
        sessionId: currentActiveBlitzSession.id,
        productId: product.id,
        barcode: product.barcode,
        sector: currentActiveBlitzSession.sector,
        requestedDate: requestedDate,
        previousQuantity: previousQuantity,
        newQuantity: totalQty,
        result: 'TEM',
        locations: locationsPayload,
        userName: currentActiveBlitzSession.user_name || 'Ana Luiza',
        isNewExpiration: isNewExpiration
      });

      const diff = totalQty - previousQuantity;
      const diffStr = diff > 0 ? ` (+${diff} un)` : diff < 0 ? ` (${diff} un)` : ' (=)';

      showToast(`✅ CONFERÊNCIA REGISTRADA: ${product.name} • ${formatNumber(totalQty)} un${diffStr}`, 'success', 2500);
      triggerSyncNow().catch(e => console.warn('Sync error:', e));

      // Retorna imediatamente ao scanner para o próximo produto
      startBlitzScanning();
    } catch (err) {
      console.error('Erro ao salvar conferência da Blitz:', err);
      showToast('Erro ao salvar conferência', 'warning');
    }
  });
}

// ----------------------------------------------------
// 7. MODAL: 📜 VER HISTÓRICO COMPLETO DESTA VALIDADE
// ----------------------------------------------------

function showBlitzProductHistoryModal({ product, requestedDate, historyItems }) {
  let modal = document.getElementById('modal-blitz-history-detail');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-history-detail';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  let listHtml = '';
  if (historyItems.length === 0) {
    listHtml = `
      <div style="text-align: center; padding: 24px; color: #71717a; font-size: 0.85rem;">
        Nenhuma conferência de Blitz anterior registrada para esta data.
      </div>
    `;
  } else {
    listHtml = historyItems.map((item) => {
      const isTem = item.result === 'TEM';
      const dateWeekday = formatDateWithWeekday(item.checked_at);
      const timeAgo = formatTimeAgoDynamic(item.checked_at);
      const diff = item.difference !== undefined ? Number(item.difference) : 0;
      const diffLabel = diff > 0 ? `+${diff}` : `${diff}`;

      const locsStr = item.locations && item.locations.length > 0
        ? item.locations.map(l => `${l.location}: ${l.quantity} un`).join(' • ')
        : '';

      return `
        <div style="
          background: #18181c;
          border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};
          border-radius: 8px;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        ">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 0.7rem; font-weight: 900; background: ${isTem ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${isTem ? '#10b981' : '#ef4444'}; padding: 2px 6px; border-radius: 4px;">
                ${isTem ? '✓ TEM' : '✕ NÃO TEM'}
              </span>
              <span style="font-size: 0.74rem; color: #a1a1aa; font-weight: 700;">
                ${dateWeekday}
              </span>
            </div>
            <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800;">
              ${timeAgo}
            </span>
          </div>

          <div style="display: flex; align-items: baseline; justify-content: space-between; margin-top: 2px;">
            <span style="font-size: 0.72rem; color: #71717a;">
              Por ${item.user_name || 'Ana Luiza'} • Setor ${item.sector || 'MERCEARIA'}
            </span>
            <div style="text-align: right;">
              <span style="font-size: 1.05rem; font-weight: 900; color: ${isTem ? '#10b981' : '#ef4444'};">
                ${isTem ? `${formatNumber(item.total_quantity)} un` : '0 un'}
              </span>
              ${item.previous_quantity !== undefined ? `
                <small style="font-size: 0.68rem; color: ${diff >= 0 ? '#34d399' : '#f87171'}; margin-left: 4px; font-weight: 800;">
                  (${diffLabel} un)
                </small>
              ` : ''}
            </div>
          </div>

          ${locsStr ? `
            <div style="font-size: 0.7rem; color: #a1a1aa; background: #121214; padding: 4px 6px; border-radius: 4px; margin-top: 2px;">
              📍 ${locsStr}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-history-backdrop"></div>
    <div class="modal-card" style="padding: 16px; max-width: 440px; width: 100%; box-sizing: border-box; max-height: 85vh; display: flex; flex-direction: column;">
      
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 10px;">
        <div>
          <h3 style="font-size: 0.95rem; font-weight: 900; color: #f4f4f5; margin: 0;">
            📜 HISTÓRICO DESTA VALIDADE
          </h3>
          <span style="font-size: 0.74rem; color: #fbbf24; font-weight: 800;">
            ${product.name} • ${formatDateBR(requestedDate)}
          </span>
        </div>
        <button type="button" id="btn-close-blitz-history-detail" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <div style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 2px; margin-bottom: 10px;">
        ${listHtml}
      </div>

      <button type="button" id="btn-back-from-history" class="btn-secondary" style="height: 40px; justify-content: center; width: 100%;">
        Voltar para Conferência
      </button>

    </div>
  `;

  modal.classList.add('open');

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-history-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-blitz-history-detail')?.addEventListener('click', closeModal);
  document.getElementById('btn-back-from-history')?.addEventListener('click', closeModal);
}

// ----------------------------------------------------
// 8. PRODUTO NÃO CADASTRADO NO SISTEMA
// ----------------------------------------------------

function promptRegisterNewProductForBlitz(barcode) {
  let modal = document.getElementById('modal-blitz-unregistered');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-unregistered';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const currentSector = currentActiveBlitzSession?.sector || 'MERCEARIA';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-unreg-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 400px; width: 100%; box-sizing: border-box;">
      
      <div style="font-size: 2.2rem; margin-bottom: 4px; text-align: center;">⚠️</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; text-align: center; margin: 0 0 6px 0;">
        PRODUTO NÃO CADASTRADO
      </h3>
      
      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; padding: 10px; margin-bottom: 14px; text-align: center;">
        <div style="font-size: 0.72rem; color: #a1a1aa; text-transform: uppercase; font-weight: 800;">Código de Barras Bipado:</div>
        <div style="font-size: 1.15rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">${barcode}</div>
        <div style="font-size: 0.72rem; color: #71717a; margin-top: 2px;">Setor da Blitz: ${currentSector}</div>
      </div>

      <p style="font-size: 0.84rem; color: #a1a1aa; text-align: center; margin-bottom: 16px; line-height: 1.35;">
        Este item não existe na base de dados. O que você deseja fazer?
      </p>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-blitz-quick-register" class="btn-primary" style="height: 46px; font-weight: 900; justify-content: center; background: #10b981; color: #022c22; font-size: 0.95rem;">
          🟢 CADASTRO RÁPIDO
        </button>

        <button type="button" id="btn-blitz-verify-later" class="btn-secondary" style="height: 42px; font-weight: 800; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4); font-size: 0.85rem;">
          🟡 REGISTRAR PARA VERIFICAR DEPOIS
        </button>

        <button type="button" id="btn-blitz-unreg-cancel" style="background: none; border: none; color: #71717a; font-size: 0.78rem; font-weight: 700; cursor: pointer; text-decoration: underline; padding: 6px;">
          Voltar ao Scanner
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

  // Opção 1: CADASTRO RÁPIDO
  document.getElementById('btn-blitz-quick-register')?.addEventListener('click', () => {
    closeModal();
    openBlitzQuickRegisterModal(barcode);
  });

  // Opção 2: REGISTRAR PARA VERIFICAR DEPOIS
  document.getElementById('btn-blitz-verify-later')?.addEventListener('click', async () => {
    closeModal();
    await recordBlitzItemUnidentified(barcode);
  });
}

// Modal de Cadastro Rápido de Produto na Blitz
function openBlitzQuickRegisterModal(barcode) {
  let modal = document.getElementById('modal-blitz-quick-form');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-quick-form';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const currentSector = currentActiveBlitzSession?.sector || 'MERCEARIA';
  let quickProdImage = '';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-quick-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">
          ⚡ CADASTRO RÁPIDO NA BLITZ
        </h3>
        <button type="button" id="btn-close-quick-reg" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <form id="form-blitz-quick-reg" style="display: flex; flex-direction: column; gap: 10px;">
        <!-- Fotografia do Produto -->
        <div class="form-group" style="margin-bottom: 2px;">
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa; display: block; margin-bottom: 4px;">FOTOGRAFIA DO PRODUTO (OPCIONAL):</label>
          <div style="display: flex; gap: 10px; align-items: center; background: #141416; padding: 8px; border-radius: 8px; border: 1px solid #27272a;">
            <div id="quick-photo-preview-box" style="width: 64px; height: 64px; border-radius: 6px; overflow: hidden; background: #09090b; border: 1px solid #3f3f46; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: #71717a; font-size: 0.65rem; font-weight: 800; text-align: center;">
                <span style="font-size: 1.1rem; margin-bottom: 2px;">📷</span>SEM FOTO
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-quick-photo-camera" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.76rem; font-weight: 800; justify-content: center;">
                  📷 Câmera
                </button>
                <button type="button" id="btn-quick-photo-gallery" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.76rem; font-weight: 800; justify-content: center;">
                  🖼️ Galeria
                </button>
              </div>
              <button type="button" id="btn-quick-photo-remove" class="btn-secondary-mini" style="height: 26px; font-size: 0.7rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3); display: none; justify-content: center;">
                🗑️ Remover Foto
              </button>
              <input type="file" id="file-quick-camera" accept="image/*" capture="environment" class="hidden" />
              <input type="file" id="file-quick-gallery" accept="image/*" class="hidden" />
            </div>
          </div>
        </div>

        <div class="form-group">
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">CÓDIGO DE BARRAS:</label>
          <input type="text" id="quick-prod-barcode" class="form-input" value="${barcode}" readonly style="background: #18181c; color: #fbbf24; font-weight: 800;" />
        </div>

        <div class="form-group">
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">SETOR DA BLITZ:</label>
          <input type="text" id="quick-prod-sector" class="form-input" value="${currentSector}" readonly style="background: #18181c; color: #10b981; font-weight: 800;" />
        </div>

        <div class="form-group">
          <label for="quick-prod-name" style="font-size: 0.74rem; font-weight: 800; color: #f4f4f5;">NOME DO PRODUTO: *</label>
          <input
            type="text"
            id="quick-prod-name"
            class="form-input form-input-lg"
            placeholder="Ex: CAFÉ PILÃO 500G"
            style="text-transform: uppercase; font-weight: 800;"
            required
            autocomplete="off"
          />
        </div>

        <div class="form-group">
          <label for="quick-prod-corridor" style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">CORREDOR / LOCAL:</label>
          <select
            id="quick-prod-corridor"
            class="form-select"
            style="font-weight: 800; background: #18181c; color: #f4f4f5; height: 44px; border-color: #27272a;"
          >
            ${CORRIDORS.map((c) => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button type="button" id="btn-cancel-quick-reg" class="btn-secondary" style="height: 44px; flex: 1; justify-content: center;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="height: 44px; flex: 1.5; justify-content: center; background: #10b981; color: #022c22; font-weight: 900;">
            SALVAR E CONTINUAR ➔
          </button>
        </div>
      </form>

    </div>
  `;

  modal.classList.add('open');

  const nameInput = document.getElementById('quick-prod-name');
  setTimeout(() => nameInput?.focus(), 150);

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-quick-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-close-quick-reg')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-quick-reg')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  // Gestão de Fotografia
  const updatePhotoPreview = () => {
    const box = document.getElementById('quick-photo-preview-box');
    const removeBtn = document.getElementById('btn-quick-photo-remove');
    if (!box) return;
    if (quickProdImage) {
      box.innerHTML = `<img src="${quickProdImage}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" />`;
      if (removeBtn) removeBtn.style.display = 'flex';
    } else {
      box.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: #71717a; font-size: 0.65rem; font-weight: 800; text-align: center;"><span style="font-size: 1.1rem; margin-bottom: 2px;">📷</span>SEM FOTO</div>`;
      if (removeBtn) removeBtn.style.display = 'none';
    }
  };

  const handlePhotoFile = async (file) => {
    if (!file) return;
    try {
      showToast('Comprimindo foto...', 'sync', 800);
      const compressed = await compressImage(file, 600, 600, 0.72);
      quickProdImage = compressed;
      updatePhotoPreview();
      showToast('✓ Foto adicionada!', 'success', 1200);
    } catch (err) {
      console.error('Erro ao processar imagem:', err);
      showToast('Erro ao carregar foto', 'warning');
    }
  };

  document.getElementById('btn-quick-photo-camera')?.addEventListener('click', () => {
    document.getElementById('file-quick-camera')?.click();
  });

  document.getElementById('btn-quick-photo-gallery')?.addEventListener('click', () => {
    document.getElementById('file-quick-gallery')?.click();
  });

  document.getElementById('file-quick-camera')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoFile(file);
  });

  document.getElementById('file-quick-gallery')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handlePhotoFile(file);
  });

  document.getElementById('btn-quick-photo-remove')?.addEventListener('click', () => {
    quickProdImage = '';
    updatePhotoPreview();
    const cInput = document.getElementById('file-quick-camera');
    const gInput = document.getElementById('file-quick-gallery');
    if (cInput) cInput.value = '';
    if (gInput) gInput.value = '';
  });

  document.getElementById('form-blitz-quick-reg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput?.value.trim().toUpperCase();
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
        sector: currentSector,
        corridor: corridor,
        image: quickProdImage
      });

      closeModal();
      showToast(`✓ Produto cadastrado: ${name}`, 'success', 1500);
      triggerSyncNow().catch(e => console.warn('Sync error:', e));

      // Continua direto no fluxo da blitz sem voltar para o início!
      promptRequestedExpirationDate(savedProd);
    } catch (err) {
      console.error('Erro ao salvar produto rápido na Blitz:', err);
      showToast('Erro ao cadastrar produto', 'warning');
    }
  });
}

// Registra produto para verificar depois (NÃO IDENTIFICADO)
async function recordBlitzItemUnidentified(barcode) {
  if (!currentActiveBlitzSession) return;

  try {
    showToast('Registrando para verificação...', 'sync', 1000);

    await saveBlitzItem({
      blitz_session_id: currentActiveBlitzSession.id,
      product_id: null,
      barcode: barcode,
      sector: currentActiveBlitzSession.sector,
      requested_expiration_date: '',
      previous_quantity: 0,
      total_quantity: 0,
      difference: 0,
      result: 'NAO_IDENTIFICADO',
      locations: [],
      user_name: currentActiveBlitzSession.user_name || 'Ana Luiza'
    });

    showToast(`🟡 Registrado para verificar depois: ${barcode}`, 'info', 2000);
    triggerSyncNow().catch(e => console.warn('Sync blitz item error:', e));

    // Volta imediatamente ao scanner para o próximo produto
    startBlitzScanning();
  } catch (err) {
    console.error('Erro ao registrar item não identificado:', err);
    showToast('Erro ao salvar registro', 'warning');
  }
}

// ----------------------------------------------------
// 9. PAINEL DA BLITZ (DASHBOARD DA SESSÃO ATIVA)
// ----------------------------------------------------

export async function openBlitzDashboardView() {
  if (!currentActiveBlitzSession) {
    promptStartBlitz();
    return;
  }

  const session = await getBlitzSessionById(currentActiveBlitzSession.id) || currentActiveBlitzSession;
  currentActiveBlitzSession = session;

  const sectorObj = BLITZ_SECTORS.find(s => s.id === session.blitz_type || s.label.toUpperCase() === session.sector) || {
    label: session.sector || 'MERCEARIA',
    icon: '📋'
  };

  const items = await getBlitzItemsBySessionId(session.id);

  // Estatísticas
  let countTem = 0;
  let countNaoTem = 0;
  let countUnidentified = 0;
  let totalUnits = 0;

  items.forEach(it => {
    if (it.result === 'TEM') {
      countTem++;
      totalUnits += Number(it.total_quantity) || 0;
    } else if (it.result === 'NAO_TEM') {
      countNaoTem++;
    } else {
      countUnidentified++;
    }
  });

  const container = document.getElementById('view-blitz-dashboard');
  if (!container) return;

  container.innerHTML = `
    <header class="app-top-bar">
      <button type="button" id="btn-blitz-dash-back" class="btn-back">← Início</button>
      <span class="top-bar-title">BLITZ: ${sectorObj.label.toUpperCase()}</span>
      <button type="button" id="btn-blitz-dash-history" class="btn-icon-link" style="color: #38bdf8;">Histórico</button>
    </header>

    <main style="padding: 12px; max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 10px;">
      
      <!-- Card da Sessão Ativa -->
      <div style="background: #121214; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.6rem;">${sectorObj.icon}</span>
            <div>
              <h2 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">
                SETOR: ${sectorObj.label.toUpperCase()}
              </h2>
              <span style="font-size: 0.72rem; color: #a1a1aa;">
                Iniciada em ${new Date(session.started_at).toLocaleString('pt-BR')} • Por ${session.user_name || 'Ana Luiza'}
              </span>
            </div>
          </div>
          <span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 9999px;">
            EM ANDAMENTO
          </span>
        </div>

        <!-- Grade de Métricas -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 4px;">
          <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 8px 4px; text-align: center;">
            <div style="font-size: 0.64rem; color: #a1a1aa; font-weight: 800;">TOTAL</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">${items.length}</div>
          </div>
          <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 8px 4px; text-align: center;">
            <div style="font-size: 0.64rem; color: #10b981; font-weight: 800;">✓ TEM</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: #10b981; margin-top: 2px;">${countTem}</div>
            <div style="font-size: 0.62rem; color: #a7f3d0; font-weight: 700;">${formatNumber(totalUnits)} un</div>
          </div>
          <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 8px 4px; text-align: center;">
            <div style="font-size: 0.64rem; color: #ef4444; font-weight: 800;">✕ NÃO TEM</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: #ef4444; margin-top: 2px;">${countNaoTem}</div>
          </div>
          <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 8px; padding: 8px 4px; text-align: center;">
            <div style="font-size: 0.64rem; color: #fbbf24; font-weight: 800;">⚠️ VERIFICAR</div>
            <div style="font-size: 1.25rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">${countUnidentified}</div>
          </div>
        </div>
      </div>

      <!-- Botão Gigante de Ação: Bipar Próximo -->
      <button type="button" id="btn-blitz-continue-scan" class="btn-primary btn-hero-action" style="height: 52px; font-size: 1.05rem; justify-content: center; background: #10b981; color: #022c22; font-weight: 900;">
        📷 BIPAR PRODUTO NA BLITZ
      </button>

      <!-- Ações da Sessão -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <button type="button" id="btn-blitz-export-wa" class="btn-secondary" style="height: 42px; font-size: 0.82rem; justify-content: center; color: #25d366; border-color: rgba(37, 211, 102, 0.4); font-weight: 800;">
          💬 Exportar no WhatsApp
        </button>
        <button type="button" id="btn-blitz-finish" class="btn-secondary" style="height: 42px; font-size: 0.82rem; justify-content: center; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4); font-weight: 800;">
          🏁 Finalizar Sessão
        </button>
      </div>

      <!-- Lista de Itens Conferidos na Sessão -->
      <div style="background: #121214; border: 1px solid #2a2a30; border-radius: 10px; padding: 12px; margin-top: 2px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <h3 style="font-size: 0.82rem; font-weight: 900; color: #f4f4f5; margin: 0; text-transform: uppercase;">
            CONFERÊNCIAS (${items.length})
          </h3>
          
          <!-- Filtro de Status -->
          <div style="display: flex; gap: 4px; overflow-x: auto;">
            <button type="button" class="btn-blitz-filter-tab active" data-filter="all" style="background: #27272a; border: 1px solid #3f3f46; color: #f4f4f5; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">Todos</button>
            <button type="button" class="btn-blitz-filter-tab" data-filter="TEM" style="background: #18181c; border: 1px solid #2a2a30; color: #10b981; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">TEM</button>
            <button type="button" class="btn-blitz-filter-tab" data-filter="NAO_TEM" style="background: #18181c; border: 1px solid #2a2a30; color: #ef4444; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">NÃO TEM</button>
            <button type="button" class="btn-blitz-filter-tab" data-filter="NAO_IDENTIFICADO" style="background: #18181c; border: 1px solid #2a2a30; color: #fbbf24; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; cursor: pointer;">Verificar</button>
          </div>
        </div>

        <div id="blitz-session-items-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 480px; overflow-y: auto;">
          <!-- Renderizado via renderBlitzSessionItems -->
        </div>
      </div>

      <!-- Cancelar Sessão -->
      <div style="text-align: center; margin-top: 10px; margin-bottom: 20px;">
        <button type="button" id="btn-blitz-cancel" class="btn-secondary" style="height: 42px; width: 100%; border-color: rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.82rem; font-weight: 800; justify-content: center; background: rgba(239, 68, 68, 0.08);">
          🛑 Cancelar esta Blitz
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
    openWhatsAppExportModal(formatted, `Blitz ${sectorObj.label}`);
  });

  document.getElementById('btn-blitz-finish')?.addEventListener('click', async () => {
    await finishActiveBlitzSession(session.id);
  });

  document.getElementById('btn-blitz-cancel')?.addEventListener('click', async () => {
    await cancelActiveBlitzSession(session.id);
  });

  // Abas de filtro
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
    if (filter === 'all') return true;
    return it.result === filter;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #71717a; font-size: 0.85rem;">
        Nenhum item encontrado para este filtro.
      </div>`;
    return;
  }

  const htmlPromises = filtered.map(async (item) => {
    const prod = item.product_id ? await getProductById(item.product_id) : null;
    const isTem = item.result === 'TEM';
    const isNaoTem = item.result === 'NAO_TEM';
    const isUnreg = item.result === 'NAO_IDENTIFICADO';
    const name = prod?.name || (isUnreg ? `PRODUTO NÃO CADASTRADO` : `PRODUTO ${item.barcode}`);
    const timeFormatted = new Date(item.checked_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const diff = item.difference !== undefined ? Number(item.difference) : 0;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

    return `
      <div class="blitz-item-card" data-barcode="${item.barcode}" data-date="${item.requested_expiration_date}" style="
        background: #18181c;
        border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.3)' : isNaoTem ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.4)'};
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
              background: ${isTem ? 'rgba(16, 185, 129, 0.15)' : isNaoTem ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.2)'};
              color: ${isTem ? '#10b981' : isNaoTem ? '#ef4444' : '#fbbf24'};
            ">
              ${isTem ? '✓ TEM' : isNaoTem ? '✕ NÃO TEM' : '⚠️ NÃO IDENTIFICADO'}
            </span>
            ${item.requested_expiration_date ? `
              <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800;">
                Val: ${formatDateBR(item.requested_expiration_date)}
              </span>
            ` : ''}
          </div>
          <div style="font-size: 0.84rem; font-weight: 800; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${name}
          </div>
          <div style="font-size: 0.7rem; color: #71717a; margin-top: 1px;">
            ${item.barcode} • às ${timeFormatted}
            ${item.previous_quantity !== undefined && !isUnreg ? ` • Ant: ${item.previous_quantity} un` : ''}
          </div>
        </div>

        <div style="text-align: right; flex-shrink: 0;">
          ${isTem ? `
            <div style="font-size: 1.05rem; font-weight: 900; color: #10b981;">
              ${formatNumber(item.total_quantity)} <small style="font-size: 0.7rem; font-weight: 700; color: #a1a1aa;">un</small>
            </div>
            <div style="font-size: 0.68rem; font-weight: 800; color: ${diff >= 0 ? '#34d399' : '#f87171'};">
              ${diffStr} un
            </div>
          ` : isNaoTem ? `
            <div style="font-size: 0.82rem; font-weight: 800; color: #ef4444;">
              0 un
            </div>
            <div style="font-size: 0.68rem; font-weight: 800; color: #f87171;">
              ${diffStr} un
            </div>
          ` : `
            <div style="font-size: 0.74rem; font-weight: 800; color: #fbbf24;">
              Verificar
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
// 10. HISTÓRICO GERAL DE BLITZ E CONSULTAS POR PRODUTO
// ----------------------------------------------------

export async function openBlitzHistoryView() {
  const container = document.getElementById('view-blitz-history');
  if (!container) return;

  const sessions = await getAllBlitzSessions();
  const allBlitzItems = await getAllBlitzItems();

  container.innerHTML = `
    <header class="app-top-bar">
      <button type="button" id="btn-blitz-history-back" class="btn-back">← Voltar</button>
      <span class="top-bar-title">HISTÓRICO DA BLITZ</span>
      <button type="button" id="btn-history-new-blitz" class="btn-primary" style="padding: 4px 10px; font-size: 0.76rem; font-weight: 900; background: #f59e0b; color: #000;">
        ➕ Nova Blitz
      </button>
    </header>

    <main style="padding: 12px; max-width: 680px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px;">
      
      <!-- Abas de Navegação do Histórico -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; background: #121214; padding: 4px; border-radius: 8px; border: 1px solid #27272a;">
        <button type="button" id="tab-history-sessions" class="history-tab-btn active" style="padding: 8px; font-size: 0.78rem; font-weight: 800; border: none; border-radius: 6px; background: #27272a; color: #f4f4f5; cursor: pointer;">
          📁 SESSÕES REALIZADAS (${sessions.length})
        </button>
        <button type="button" id="tab-history-products" class="history-tab-btn" style="padding: 8px; font-size: 0.78rem; font-weight: 800; border: none; border-radius: 6px; background: transparent; color: #a1a1aa; cursor: pointer;">
          📜 HISTÓRICO POR PRODUTO
        </button>
      </div>

      <!-- PAINEL 1: SESSÕES REALIZADAS -->
      <div id="panel-history-sessions" style="display: flex; flex-direction: column; gap: 8px;">
        <div id="blitz-history-sessions-list" style="display: flex; flex-direction: column; gap: 8px;">
          <!-- Renderizado via renderBlitzHistoryList -->
        </div>
      </div>

      <!-- PAINEL 2: HISTÓRICO POR PRODUTO + VALIDADE (PESQUISA EM TEMPO REAL) -->
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
            Digite acima para pesquisar o histórico de qualquer produto.
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
    tabSessions.classList.add('active');
    tabSessions.style.background = '#27272a';
    tabSessions.style.color = '#f4f4f5';
    tabProducts.classList.remove('active');
    tabProducts.style.background = 'transparent';
    tabProducts.style.color = '#a1a1aa';
    panelSessions?.classList.remove('hidden');
    panelProducts?.classList.add('hidden');
  });

  tabProducts?.addEventListener('click', () => {
    tabProducts.classList.add('active');
    tabProducts.style.background = '#27272a';
    tabProducts.style.color = '#f4f4f5';
    tabSessions.classList.remove('active');
    tabSessions.style.background = 'transparent';
    tabSessions.style.color = '#a1a1aa';
    panelProducts?.classList.remove('hidden');
    panelSessions?.classList.add('hidden');
  });

  // Renderiza Sessões
  renderBlitzHistoryList(sessions);

  // Busca de histórico por produto
  const searchInput = document.getElementById('input-search-product-blitz-history');
  searchInput?.addEventListener('input', () => {
    const term = searchInput.value.trim().toLowerCase();
    renderProductHistorySearch(allBlitzItems, term);
  });
}

// Renderiza lista de sessões no histórico
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
    const sectorObj = BLITZ_SECTORS.find(s => s.id === session.blitz_type || s.label.toUpperCase() === session.sector) || {
      label: session.sector || 'MERCEARIA',
      icon: '📋'
    };

    let countTem = 0;
    let countNaoTem = 0;
    let totalQty = 0;
    items.forEach(it => {
      if (it.result === 'TEM') {
        countTem++;
        totalQty += Number(it.total_quantity) || 0;
      } else if (it.result === 'NAO_TEM') {
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
            <span style="font-size: 1.4rem;">${sectorObj.icon}</span>
            <div>
              <div style="font-size: 0.92rem; font-weight: 900; color: #f4f4f5;">
                SETOR ${sectorObj.label.toUpperCase()}
              </div>
              <div style="font-size: 0.72rem; color: #a1a1aa;">
                ${new Date(session.started_at).toLocaleString('pt-BR')} • Por ${session.user_name || 'Ana Luiza'}
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
            <button type="button" class="btn-resume-history-session btn-primary" data-id="${session.id}" style="flex: 1; height: 36px; font-size: 0.78rem; justify-content: center; background: #f59e0b; color: #000; font-weight: 800;">
              Continuar Sessão
            </button>
            <button type="button" class="btn-cancel-history-session btn-secondary" data-id="${session.id}" style="height: 36px; font-size: 0.78rem; justify-content: center; color: #ef4444; border-color: rgba(239, 68, 68, 0.4); padding: 0 10px; font-weight: 800;">
              ✕ Cancelar
            </button>
          ` : `
            <button type="button" class="btn-export-history-session btn-secondary" data-id="${session.id}" style="flex: 1; height: 36px; font-size: 0.78rem; justify-content: center; color: #25d366; font-weight: 800; border-color: rgba(37, 211, 102, 0.4);">
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

// Renderiza busca de histórico por produto
async function renderProductHistorySearch(allItems, term) {
  const container = document.getElementById('blitz-product-history-results');
  if (!container) return;

  if (!term || term.length < 2) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #71717a; font-size: 0.85rem;">
        Digite pelo menos 2 caracteres para pesquisar.
      </div>`;
    return;
  }

  // Agrupa conferências por chave: barcode + requested_expiration_date
  const matchingItems = allItems.filter(it => {
    return (it.barcode && it.barcode.toLowerCase().includes(term)) ||
           (it.notes && it.notes.toLowerCase().includes(term));
  });

  // Também busca produtos cujo nome coincida
  const { getAllProducts } = await import('./db.js');
  const allProducts = await getAllProducts();
  const matchedProdIds = new Set(
    allProducts.filter(p => p.name && p.name.toLowerCase().includes(term)).map(p => p.id)
  );

  const combined = allItems.filter(it => {
    return matchingItems.includes(it) || (it.product_id && matchedProdIds.has(it.product_id));
  });

  if (combined.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 30px; color: #71717a; font-size: 0.85rem;">
        Nenhum registro de conferência encontrado para "${term}".
      </div>`;
    return;
  }

  combined.sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0));

  const prodMap = new Map();
  allProducts.forEach(p => prodMap.set(p.id, p));

  const html = combined.slice(0, 50).map(item => {
    const prod = item.product_id ? prodMap.get(item.product_id) : null;
    const name = prod?.name || `CÓDIGO: ${item.barcode}`;
    const isTem = item.result === 'TEM';
    const isNaoTem = item.result === 'NAO_TEM';
    const dateFormatted = item.requested_expiration_date ? formatDateBR(item.requested_expiration_date) : '--/--/----';
    const checkedAtFormatted = new Date(item.checked_at).toLocaleDateString('pt-BR');
    const diff = item.difference !== undefined ? Number(item.difference) : 0;
    const diffStr = diff > 0 ? `+${diff}` : `${diff}`;

    return `
      <div style="
        background: #18181c;
        border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.3)' : isNaoTem ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.3)'};
        border-radius: 8px;
        padding: 10px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      ">
        <div style="flex: 1; min-width: 0;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span style="font-size: 0.65rem; font-weight: 900; background: ${isTem ? 'rgba(16, 185, 129, 0.15)' : isNaoTem ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${isTem ? '#10b981' : isNaoTem ? '#ef4444' : '#fbbf24'}; padding: 2px 6px; border-radius: 4px;">
              ${isTem ? '✓ TEM' : isNaoTem ? '✕ NÃO TEM' : '⚠️ NÃO IDENTIFICADO'}
            </span>
            <span style="font-size: 0.72rem; color: #fbbf24; font-weight: 800;">
              Val: ${dateFormatted}
            </span>
          </div>
          <div style="font-size: 0.85rem; font-weight: 800; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${name}
          </div>
          <div style="font-size: 0.7rem; color: #71717a; margin-top: 1px;">
            Cód: ${item.barcode} • Conferido em ${checkedAtFormatted} por ${item.user_name || 'Ana Luiza'}
          </div>
        </div>

        <div style="text-align: right; flex-shrink: 0;">
          <div style="font-size: 1.05rem; font-weight: 900; color: ${isTem ? '#10b981' : isNaoTem ? '#ef4444' : '#fbbf24'};">
            ${isTem ? `${formatNumber(item.total_quantity)} un` : isNaoTem ? '0 un' : '---'}
          </div>
          ${item.previous_quantity !== undefined && !isNaoTem ? `
            <div style="font-size: 0.68rem; color: #a1a1aa;">
              Ant: ${item.previous_quantity} (${diffStr})
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}

// ----------------------------------------------------
// 11. FORMATAÇÃO DE RELATÓRIO PARA O WHATSAPP
// ----------------------------------------------------

export async function formatBlitzSessionWhatsApp(session, items) {
  const sectorObj = BLITZ_SECTORS.find(s => s.id === session.blitz_type || s.label.toUpperCase() === session.sector) || {
    label: session.sector || 'MERCEARIA',
    icon: '📋'
  };

  const startDate = new Date(session.started_at).toLocaleString('pt-BR');
  const finishDate = session.finished_at ? new Date(session.finished_at).toLocaleString('pt-BR') : 'Em andamento';

  let countTem = 0;
  let countNaoTem = 0;
  let countUnidentified = 0;
  let totalQty = 0;

  const temLines = [];
  const naoTemLines = [];
  const unregLines = [];

  for (const item of items) {
    const prod = item.product_id ? await getProductById(item.product_id) : null;
    const prodName = prod?.name || `CÓD: ${item.barcode}`;
    const dateFormatted = item.requested_expiration_date ? formatDateBR(item.requested_expiration_date) : '--/--/----';
    const prevStr = item.previous_quantity !== undefined ? ` (Anterior: ${item.previous_quantity} un)` : '';
    const diffStr = item.difference !== undefined ? (item.difference > 0 ? ` [Dif: +${item.difference}]` : ` [Dif: ${item.difference}]`) : '';

    if (item.result === 'TEM') {
      countTem++;
      totalQty += Number(item.total_quantity) || 0;
      temLines.push(`• *${prodName}*\n  Validade: ${dateFormatted} | Qtd Atual: *${formatNumber(item.total_quantity)} un*${diffStr}${prevStr}\n  Cód: ${item.barcode}`);
    } else if (item.result === 'NAO_TEM') {
      countNaoTem++;
      naoTemLines.push(`• *${prodName}*\n  Validade: ${dateFormatted} | *EM FALTA (0 un)*${prevStr}\n  Cód: ${item.barcode}`);
    } else {
      countUnidentified++;
      unregLines.push(`• *Código: ${item.barcode}*\n  Item não cadastrado na loja (Verificar depois)`);
    }
  }

  let text = `📋 *RELATÓRIO DA BLITZ SEMANAL*\n`;
  text += `Setor: *${sectorObj.label.toUpperCase()}* ${sectorObj.icon}\n`;
  text += `Responsável: *${session.user_name || 'Ana Luiza'}*\n`;
  text += `Início: ${startDate}\n`;
  text += `Término: ${finishDate}\n`;
  text += `Status: *${session.status?.toUpperCase()}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📊 *RESUMO GERAL:*\n`;
  text += `• Total de Conferências: *${items.length}*\n`;
  text += `• Produtos Encontrados (TEM): *${countTem}* (${formatNumber(totalQty)} unidades)\n`;
  text += `• Produtos em Falta (NÃO TEM): *${countNaoTem}*\n`;
  if (countUnidentified > 0) {
    text += `• Produtos para Verificar: *${countUnidentified}*\n`;
  }
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

  if (unregLines.length > 0) {
    text += `⚠️ *PRODUTOS NÃO IDENTIFICADOS (VERIFICAR DEPOIS):*\n\n`;
    text += unregLines.join('\n\n') + '\n\n';
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  }

  text += `*Controladoria - Ana Luiza*\n`;
  text += `Enviado em: ${new Date().toLocaleString('pt-BR')}`;

  return text;
}
