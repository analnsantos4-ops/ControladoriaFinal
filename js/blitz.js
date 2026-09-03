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
  getAllBlitzItemsForProductAndDate,
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
  BLITZ_LOCATIONS,
  SETORS,
  CORRIDORS,
  formatDateBR,
  formatNumber,
  parseDateBRtoISO,
  getTodayISO,
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

  const periodLabel = currentActiveBlitzSession.period_label || 'Geral';
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
            <span style="font-size: 0.78rem; color: #fbbf24; font-weight: 800;">
              Período: ${periodLabel}
            </span>
          </div>
          <div style="font-size: 0.72rem; color: #a1a1aa; margin-top: 2px;">
            Por ${currentActiveBlitzSession.user_name || 'Ana Luiza'} • Iniciada às ${startedAtTime}
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
          BLITZ ATIVA: ${periodLabel}
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
// 1. INICIAR BLITZ: SOLICITA APENAS O PERÍODO
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

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-active-blitz-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      <div style="font-size: 2rem; margin-bottom: 4px; text-align: center;">🔍</div>
      <h3 style="font-size: 1.15rem; font-weight: 900; color: #f4f4f5; text-align: center; margin: 0 0 6px 0;">
        BLITZ ATIVA EM ANDAMENTO
      </h3>
      <div style="background: #18181c; border: 1px solid #2a2a30; border-radius: 8px; padding: 12px; margin-bottom: 14px; text-align: center;">
        <div style="font-size: 0.72rem; color: #a1a1aa; text-transform: uppercase; font-weight: 800;">Período da Blitz:</div>
        <div style="font-size: 1.15rem; font-weight: 900; color: #fbbf24; margin-top: 2px;">
          ${periodLabel}
        </div>
        <div style="font-size: 0.72rem; color: #71717a; margin-top: 4px;">
          Iniciada em ${startedAt} por ${currentActiveBlitzSession.user_name || 'Ana Luiza'}
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-dialog-resume-blitz" class="btn-primary" style="height: 48px; font-weight: 900; font-size: 0.95rem; justify-content: center; background: #f59e0b; color: #000;">
          ▶ CONTINUAR ESTA BLITZ
        </button>
        <button type="button" id="btn-dialog-finish-blitz" class="btn-secondary" style="height: 44px; font-weight: 800; font-size: 0.88rem; justify-content: center; color: #10b981; border-color: rgba(16, 185, 129, 0.4);">
          ✅ FINALIZAR BLITZ
        </button>
        <button type="button" id="btn-dialog-new-blitz" class="btn-secondary" style="height: 40px; font-weight: 700; font-size: 0.82rem; justify-content: center; color: #a1a1aa;">
          ➕ Iniciar Outra Blitz (Novo Período)
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

  document.getElementById('btn-dialog-finish-blitz')?.addEventListener('click', async () => {
    closeModal();
    await finishActiveBlitzSession(currentActiveBlitzSession?.id);
  });

  document.getElementById('btn-dialog-new-blitz')?.addEventListener('click', async () => {
    closeModal();
    showStartBlitzModal();
  });
}

// Modal para informar apenas o Período da Blitz
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

  const defaultStart = formatDateBR(today.toISOString().split('T')[0]);
  const defaultEnd = formatDateBR(next30.toISOString().split('T')[0]);

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-start-blitz-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 100%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 10px; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.4rem;">🔍</span>
          <h3 style="font-size: 1.1rem; font-weight: 900; color: #f4f4f5; margin: 0;">
            INICIAR BLITZ
          </h3>
        </div>
        <button type="button" id="btn-close-start-blitz" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 8px; padding: 10px; margin-bottom: 14px;">
        <div style="font-size: 0.78rem; color: #fef08a; line-height: 1.4;">
          <strong>Conferência com Listagem Física:</strong><br>
          Informe o período da blitz que consta no papel que você recebeu. O sistema registrará os seus bips para esse período.
        </div>
      </div>

      <form id="form-start-blitz-period" style="display: flex; flex-direction: column; gap: 12px;">
        <div class="form-group" style="margin-bottom: 0;">
          <label for="input-blitz-start-date" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase;">
            📅 Data Inicial (DD/MM/AAAA):
          </label>
          <input
            type="text"
            id="input-blitz-start-date"
            class="form-input form-input-lg"
            placeholder="01/09/2026"
            value="${defaultStart}"
            maxlength="10"
            inputmode="numeric"
            required
            style="font-size: 1.1rem; font-weight: 800; text-align: center; border-color: #f59e0b; height: 46px;"
          />
        </div>

        <div class="form-group" style="margin-bottom: 0;">
          <label for="input-blitz-end-date" style="font-size: 0.76rem; font-weight: 800; color: #a1a1aa; text-transform: uppercase;">
            📅 Data Final (DD/MM/AAAA):
          </label>
          <input
            type="text"
            id="input-blitz-end-date"
            class="form-input form-input-lg"
            placeholder="01/10/2026"
            value="${defaultEnd}"
            maxlength="10"
            inputmode="numeric"
            required
            style="font-size: 1.1rem; font-weight: 800; text-align: center; border-color: #f59e0b; height: 46px;"
          />
        </div>

        <!-- Atalhos Rápidos -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 2px;">
          <button type="button" class="btn-quick-period btn-secondary" data-preset="month" style="padding: 6px; font-size: 0.72rem; font-weight: 800; justify-content: center;">Este Mês</button>
          <button type="button" class="btn-quick-period btn-secondary" data-preset="30d" style="padding: 6px; font-size: 0.72rem; font-weight: 800; justify-content: center;">+30 Dias</button>
          <button type="button" class="btn-quick-period btn-secondary" data-preset="next_month" style="padding: 6px; font-size: 0.72rem; font-weight: 800; justify-content: center;">Próximo Mês</button>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 8px;">
          <button type="button" id="btn-cancel-start-blitz" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center;">
            Cancelar
          </button>
          <button type="submit" id="btn-confirm-start-blitz" class="btn-primary" style="flex: 1; height: 46px; justify-content: center; background: #f59e0b; color: #000; font-weight: 900; font-size: 0.95rem;">
            🚀 INICIAR BLITZ
          </button>
        </div>
      </form>
    </div>
  `;

  modal.classList.add('open');

  const startInput = document.getElementById('input-blitz-start-date');
  const endInput = document.getElementById('input-blitz-end-date');

  // Máscara de data DD/MM/AAAA
  const applyDateMask = (input) => {
    input?.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 8) val = val.substring(0, 8);
      if (val.length >= 5) {
        val = val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4);
      } else if (val.length >= 3) {
        val = val.substring(0, 2) + '/' + val.substring(2);
      }
      e.target.value = val;
    });
  };

  applyDateMask(startInput);
  applyDateMask(endInput);

  // Presets de período
  modal.querySelectorAll('.btn-quick-period').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const now = new Date();
      if (preset === 'month') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        if (startInput) startInput.value = formatDateBR(firstDay.toISOString().split('T')[0]);
        if (endInput) endInput.value = formatDateBR(lastDay.toISOString().split('T')[0]);
      } else if (preset === '30d') {
        const end = new Date(now);
        end.setDate(end.getDate() + 30);
        if (startInput) startInput.value = formatDateBR(now.toISOString().split('T')[0]);
        if (endInput) endInput.value = formatDateBR(end.toISOString().split('T')[0]);
      } else if (preset === 'next_month') {
        const firstDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 2, 0);
        if (startInput) startInput.value = formatDateBR(firstDay.toISOString().split('T')[0]);
        if (endInput) endInput.value = formatDateBR(lastDay.toISOString().split('T')[0]);
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

    if (!sDateRaw || sDateRaw.length < 8) {
      showToast('Informe a data inicial válida (DD/MM/AAAA)', 'warning');
      startInput?.focus();
      return;
    }
    if (!eDateRaw || eDateRaw.length < 8) {
      showToast('Informe a data final válida (DD/MM/AAAA)', 'warning');
      endInput?.focus();
      return;
    }

    closeModal();
    await startNewBlitzSession(sDateRaw, eDateRaw);
  });
}

// Inicia a sessão com as datas informadas e abre a tela da Blitz
export async function startNewBlitzSession(startDateBR, endDateBR) {
  try {
    const sDateISO = parseDateBRtoISO(startDateBR);
    const eDateISO = parseDateBRtoISO(endDateBR);
    const periodLabel = `${formatDateBR(sDateISO)} → ${formatDateBR(eDateISO)}`;

    showToast(`Iniciando Blitz: ${periodLabel}...`, 'sync', 1000);

    const session = await createBlitzSession({
      blitz_type: 'periodo',
      sector: 'GERAL',
      start_date: sDateISO,
      end_date: eDateISO,
      period_label: periodLabel,
      user_name: 'Ana Luiza'
    });

    setActiveBlitz(session);
    showToast(`✓ Blitz iniciada: ${periodLabel}`, 'success', 2000);
    triggerSyncNow().catch(e => console.warn('Sync error:', e));

    // Abre diretamente a tela principal da Blitz
    openBlitzDashboardView();
  } catch (err) {
    console.error('Erro ao iniciar Blitz:', err);
    showToast('Erro ao criar sessão da Blitz', 'warning');
  }
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

  const items = await getBlitzItemsBySessionId(session.id);

  // Estatísticas: Somente o necessário (Conferidos, TEM, NÃO TEM)
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

  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;

  const container = document.getElementById('view-blitz-dashboard');
  if (!container) return;

  container.innerHTML = `
    <header class="app-top-bar">
      <button type="button" id="btn-blitz-dash-back" class="btn-back">← Início</button>
      <span class="top-bar-title">BLITZ ATIVA</span>
      <button type="button" id="btn-blitz-dash-history" class="btn-icon-link" style="color: #38bdf8;">Histórico</button>
    </header>

    <main style="padding: 12px; max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px;">
      
      <!-- Card da Blitz Ativa -->
      <div style="background: #121214; border: 1px solid rgba(245, 158, 11, 0.45); border-radius: 12px; padding: 14px; display: flex; flex-direction: column; gap: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 1.6rem;">🔍</span>
            <div>
              <h2 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">
                BLITZ ATIVA
              </h2>
              <div style="font-size: 0.88rem; font-weight: 800; color: #fbbf24; margin-top: 2px;">
                📅 Período: ${periodLabel}
              </div>
            </div>
          </div>
          <span style="background: rgba(245, 158, 11, 0.18); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); font-size: 0.7rem; font-weight: 900; padding: 3px 8px; border-radius: 9999px;">
            EM ANDAMENTO
          </span>
        </div>

        <div style="font-size: 0.72rem; color: #a1a1aa; border-top: 1px dashed #27272a; padding-top: 6px; margin-top: 4px;">
          Responsável: <strong>${session.user_name || 'Ana Luiza'}</strong> • Iniciada às ${new Date(session.started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      <!-- BOTÃO GIGANTE: 📷 BIPAR PRODUTO -->
      <button type="button" id="btn-blitz-big-scan" class="btn-primary" style="
        height: 60px;
        font-size: 1.15rem;
        font-weight: 900;
        justify-content: center;
        background: #10b981;
        color: #022c22;
        border-radius: 12px;
        box-shadow: 0 4px 16px rgba(16, 185, 129, 0.3);
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
      ">
        <span style="font-size: 1.5rem;">📷</span>
        <span>BIPAR PRODUTO</span>
      </button>

      <!-- Entrada Manual Rápida de Código de Barras -->
      <form id="form-blitz-manual-bip" style="display: flex; gap: 6px;">
        <input
          type="text"
          id="input-blitz-manual-code"
          class="form-input"
          placeholder="Ou digite o código de barras..."
          style="height: 42px; font-size: 0.88rem; flex: 1;"
        />
        <button type="submit" class="btn-secondary" style="height: 42px; font-weight: 800; font-size: 0.82rem; padding: 0 14px; white-space: nowrap;">
          ➔ Bipar
        </button>
      </form>

      <!-- CONTADORES DA BLITZ: Rápido e Focado -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 10px; text-align: center;">
          <div style="font-size: 0.7rem; color: #a1a1aa; font-weight: 800; text-transform: uppercase;">Conferidos</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">
            ${items.length}
          </div>
        </div>

        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 10px; padding: 10px; text-align: center;">
          <div style="font-size: 0.7rem; color: #10b981; font-weight: 800; text-transform: uppercase;">🟢 TEM</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #10b981; margin-top: 2px;">
            ${countTem}
          </div>
          <div style="font-size: 0.65rem; color: #a7f3d0; font-weight: 700;">
            ${formatNumber(totalUnits)} un
          </div>
        </div>

        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 10px; padding: 10px; text-align: center;">
          <div style="font-size: 0.7rem; color: #ef4444; font-weight: 800; text-transform: uppercase;">🔴 NÃO TEM</div>
          <div style="font-size: 1.45rem; font-weight: 900; color: #ef4444; margin-top: 2px;">
            ${countNaoTem}
          </div>
          <div style="font-size: 0.65rem; color: #fca5a5; font-weight: 700;">
            0 un
          </div>
        </div>
      </div>

      <!-- BOTÃO PARA FINALIZAR BLITZ -->
      <div style="display: flex; gap: 8px;">
        <button type="button" id="btn-blitz-export-wa-active" class="btn-secondary" style="flex: 1; height: 44px; font-size: 0.85rem; font-weight: 800; justify-content: center; color: #25d366; border-color: rgba(37, 211, 102, 0.4);">
          💬 WhatsApp
        </button>
        <button type="button" id="btn-blitz-finish-session" class="btn-primary" style="flex: 1.2; height: 44px; font-size: 0.88rem; font-weight: 900; justify-content: center; background: #f59e0b; color: #000;">
          ✅ FINALIZAR BLITZ
        </button>
      </div>

      <!-- LISTA DE ITENS CONFERIDOS -->
      <div style="background: #121214; border: 1px solid #27272a; border-radius: 10px; padding: 12px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <span style="font-size: 0.8rem; font-weight: 900; color: #f4f4f5; text-transform: uppercase;">
            ÚLTIMOS CONFERIDOS (${items.length})
          </span>
          <span style="font-size: 0.7rem; color: #71717a;">Ordem decrescente</span>
        </div>

        <div id="blitz-session-items-list" style="display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto;">
          <!-- Itens renderizados -->
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

  await renderBlitzSessionItemsList(items);
}

// Renderiza a lista simplificada de itens da Blitz
async function renderBlitzSessionItemsList(items) {
  const container = document.getElementById('blitz-session-items-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #71717a; font-size: 0.84rem;">
        Nenhum produto conferido ainda.<br>
        Clique em <strong>📷 BIPAR PRODUTO</strong> para iniciar.
      </div>
    `;
    return;
  }

  // Ordena os itens mais recentes primeiro
  const sorted = [...items].sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0));

  const htmlPromises = sorted.map(async (item) => {
    const isTem = item.result === 'TEM';
    const prod = item.product_id ? await getProductById(item.product_id) : null;
    const name = prod?.name || (item.product_id ? `Produto Cadastrado` : `PRODUTO NÃO CADASTRADO`);
    const dateFormatted = item.requested_expiration_date ? formatDateBR(item.requested_expiration_date) : '--/--/----';
    const timeFormatted = item.checked_at
      ? new Date(item.checked_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '';

    return `
      <div style="
        background: #18181c;
        border: 1px solid ${isTem ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'};
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
              Validade: ${dateFormatted}
            </span>
          </div>
          <div style="font-size: 0.84rem; font-weight: 800; color: #f4f4f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${name}
          </div>
          <div style="font-size: 0.7rem; color: #71717a; margin-top: 1px;">
            Cód: ${item.barcode} • às ${timeFormatted}
          </div>
        </div>

        <div style="text-align: right; flex-shrink: 0;">
          <span style="font-size: 1.05rem; font-weight: 900; color: ${isTem ? '#10b981' : '#ef4444'};">
            ${isTem ? `${formatNumber(item.total_quantity)} un` : '0 un'}
          </span>
        </div>
      </div>
    `;
  });

  const cards = await Promise.all(htmlPromises);
  container.innerHTML = cards.join('');
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
// 4. APÓS O BIP: IDENTIFICAÇÃO E DATA SOLICITADA
// ----------------------------------------------------

export async function handleBlitzBarcodeScanned(cleanBarcode) {
  if (!currentActiveBlitzSession) {
    return false;
  }

  // Para o scanner temporariamente enquanto a pergunta está na tela
  stopCameraScanner();
  showToast(`Código: ${cleanBarcode}`, 'info', 800);

  // 1. Pesquisa se o produto está cadastrado no banco
  const product = await getProductByBarcode(cleanBarcode);

  if (!product) {
    // 10. PRODUTO NÃO CADASTRADO: Não trava a blitz!
    promptUnregisteredProductBlitz(cleanBarcode);
    return true;
  }

  // 5. PRODUTO CADASTRADO: Pergunta a DATA SOLICITADA que está no papel
  promptRequestedExpirationDate(product);
  return true;
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
    openBlitzQuickRegisterModal(barcode);
  });

  // Opção: CONTINUAR SEM CADASTRAR (Guarda código, data solicitada, hora, etc.)
  document.getElementById('btn-blitz-continue-unregistered')?.addEventListener('click', () => {
    closeModal();
    const provisionalProduct = {
      id: null,
      barcode: barcode,
      name: `PRODUTO NÃO CADASTRADO (${barcode})`,
      sector: 'GERAL',
      corridor: '01'
    };
    promptRequestedExpirationDate(provisionalProduct);
  });
}

// Modal de Cadastro Rápido de Produto
function openBlitzQuickRegisterModal(barcode) {
  let modal = document.getElementById('modal-blitz-quick-form');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-quick-form';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  let quickProdImage = '';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-quick-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 8px; margin-bottom: 12px;">
        <h3 style="font-size: 1.05rem; font-weight: 900; color: #f4f4f5; margin: 0;">
          ⚡ CADASTRO RÁPIDO DO PRODUTO
        </h3>
        <button type="button" id="btn-close-quick-reg" class="btn-icon-control" style="font-size: 1rem; width: 30px; height: 30px;">✕</button>
      </div>

      <form id="form-blitz-quick-reg" style="display: flex; flex-direction: column; gap: 10px;">
        <div class="form-group">
          <label style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">CÓDIGO DE BARRAS:</label>
          <input type="text" id="quick-prod-barcode" class="form-input" value="${barcode}" readonly style="background: #18181c; color: #fbbf24; font-weight: 800;" />
        </div>

        <div class="form-group">
          <label for="quick-prod-name" style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">NOME DO PRODUTO:</label>
          <input type="text" id="quick-prod-name" class="form-input" placeholder="Ex: BISCOITO RANCHEIRO 90G" required autofocus style="text-transform: uppercase;" />
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div class="form-group">
            <label for="quick-prod-sector" style="font-size: 0.74rem; font-weight: 800; color: #a1a1aa;">SETOR:</label>
            <select id="quick-prod-sector" class="form-input">
              ${SETORS.map(s => `<option value="${s}">${s}</option>`).join('')}
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
          <button type="button" id="btn-cancel-quick-reg" class="btn-secondary" style="flex: 1; height: 44px; justify-content: center;">
            Cancelar
          </button>
          <button type="submit" class="btn-primary" style="flex: 1; height: 44px; justify-content: center; background: #10b981; color: #022c22; font-weight: 900;">
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
    startBlitzScanning();
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
        corridor: corridor
      });

      closeModal();
      showToast(`✓ Produto cadastrado: ${name}`, 'success', 1500);
      triggerSyncNow().catch(e => console.warn('Sync error:', e));

      // Continua direto para a data solicitada
      promptRequestedExpirationDate(savedProd);
    } catch (err) {
      console.error('Erro ao salvar produto rápido:', err);
      showToast('Erro ao cadastrar produto', 'warning');
    }
  });
}

// ----------------------------------------------------
// 5. QUAL A DATA SOLICITADA? (MANUAL DO PAPEL)
// ----------------------------------------------------

export function promptRequestedExpirationDate(product) {
  let modal = document.getElementById('modal-blitz-date-prompt');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-date-prompt';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-date-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      
      <!-- Cabeçalho do Produto -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
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
      <form id="form-blitz-requested-date" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="text-align: center; margin-bottom: 4px;">
          <div style="font-size: 1.3rem; margin-bottom: 2px;">📅</div>
          <label for="input-requested-date" style="font-size: 0.95rem; font-weight: 900; color: #fef08a; display: block;">
            QUAL A DATA SOLICITADA?
          </label>
          <div style="font-size: 0.74rem; color: #a1a1aa; margin-top: 2px;">
            Olhe no papel físico e digite a validade solicitada:
          </div>
        </div>

        <div class="form-group" style="margin-bottom: 4px;">
          <input
            type="text"
            id="input-requested-date"
            class="form-input form-input-lg"
            placeholder="04/09/2026"
            maxlength="10"
            inputmode="numeric"
            required
            autofocus
            style="font-size: 1.35rem; font-weight: 900; text-align: center; border-color: #f59e0b; height: 52px; letter-spacing: 1px; color: #fef08a;"
          />
        </div>

        <div style="display: flex; gap: 8px; margin-top: 6px;">
          <button type="button" id="btn-cancel-req-date" class="btn-secondary" style="flex: 1; height: 46px; justify-content: center;">
            Cancelar
          </button>
          <button type="submit" id="btn-confirm-req-date" class="btn-primary" style="flex: 1.3; height: 46px; justify-content: center; background: #f59e0b; color: #000; font-weight: 900; font-size: 0.95rem;">
            CONTINUAR ➔
          </button>
        </div>
      </form>

    </div>
  `;

  modal.classList.add('open');
  const dateInput = document.getElementById('input-requested-date');
  setTimeout(() => dateInput?.focus(), 100);

  // Máscara DD/MM/AAAA
  dateInput?.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.substring(0, 8);
    if (val.length >= 5) {
      val = val.substring(0, 2) + '/' + val.substring(2, 4) + '/' + val.substring(4);
    } else if (val.length >= 3) {
      val = val.substring(0, 2) + '/' + val.substring(2);
    }
    e.target.value = val;
  });

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('modal-blitz-date-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-req-date')?.addEventListener('click', () => {
    closeModal();
    startBlitzScanning();
  });

  document.getElementById('form-blitz-requested-date')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawDate = dateInput?.value?.trim();
    if (!rawDate || rawDate.length < 8) {
      showToast('Digite a data solicitada válida (DD/MM/AAAA)', 'warning');
      dateInput?.focus();
      return;
    }

    const isoDate = parseDateBRtoISO(rawDate);
    closeModal();

    // 13. EVITAR DUPLICIDADE ACIDENTAL
    await checkDuplicityAndPromptDecision(product, isoDate);
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
  showHasOrNotDecisionModal({
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

  document.getElementById('btn-duplicity-redo')?.addEventListener('click', () => {
    closeModal();
    showHasOrNotDecisionModal({
      product,
      requestedDate,
      existingItem // Passa para substituir/atualizar
    });
  });
}

// ----------------------------------------------------
// 6. PERGUNTAR SE TEM (TEM OU NÃO TEM)
// ----------------------------------------------------

function showHasOrNotDecisionModal({ product, requestedDate, existingItem = null }) {
  let modal = document.getElementById('modal-blitz-has-or-not');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-has-or-not';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-hon-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 420px; width: 100%; box-sizing: border-box;">
      
      <!-- Detalhes do Produto e Validade Solicitada -->
      <div style="background: #18181c; border: 1px solid #27272a; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
        <h3 style="font-size: 1rem; font-weight: 900; color: #f4f4f5; margin: 0 0 2px 0; line-height: 1.3;">
          ${product.name}
        </h3>
        <div style="font-size: 0.74rem; color: #a1a1aa;">
          Código: <strong>${product.barcode}</strong>
        </div>
      </div>

      <!-- Validade Solicitada Destaque -->
      <div style="background: rgba(245, 158, 11, 0.12); border: 2px solid rgba(245, 158, 11, 0.5); border-radius: 10px; padding: 10px; text-align: center; margin-bottom: 14px;">
        <div style="font-size: 0.72rem; color: #fbbf24; font-weight: 800; text-transform: uppercase;">
          VALIDADE SOLICITADA NO PAPEL:
        </div>
        <div style="font-size: 1.4rem; font-weight: 900; color: #fef08a; margin-top: 2px;">
          ${formatDateBR(requestedDate)}
        </div>
      </div>

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

    await saveBlitzConferenceRecord({
      id: existingItem?.id || null,
      sessionId: currentActiveBlitzSession.id,
      productId: product.id || null,
      barcode: product.barcode,
      sector: product.sector || 'GERAL',
      requestedDate: requestedDate,
      previousQuantity: existingItem ? Number(existingItem.total_quantity) || 0 : 0,
      newQuantity: 0,
      result: 'NAO_TEM',
      locations: [],
      userName: currentActiveBlitzSession.user_name || 'Ana Luiza'
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

    await saveBlitzConferenceRecord({
      id: existingItem?.id || null,
      sessionId: currentActiveBlitzSession.id,
      productId: product.id || null,
      barcode: product.barcode,
      sector: product.sector || 'GERAL',
      requestedDate: requestedDate,
      previousQuantity: existingItem ? Number(existingItem.total_quantity) || 0 : 0,
      newQuantity: totalQuantity,
      result: 'TEM',
      locations: locationsArray,
      userName: currentActiveBlitzSession.user_name || 'Ana Luiza'
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
// 15. FINALIZAR BLITZ & RESUMO
// ----------------------------------------------------

export async function finishActiveBlitzSession(sessionId = null) {
  const id = sessionId || currentActiveBlitzSession?.id;
  if (!id) return;

  const session = await getBlitzSessionById(id) || currentActiveBlitzSession;
  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;

  const confirmed = await promptConfirmDialog(
    '🏁 FINALIZAR BLITZ?',
    `Deseja concluir a Blitz do período ${periodLabel}? Todos os registros serão salvos no histórico.`
  );

  if (!confirmed) return;

  try {
    showToast('Finalizando Blitz...', 'sync', 1000);
    const updated = await finishBlitzSession(id);
    const items = await getBlitzItemsBySessionId(id);

    setActiveBlitz(null);
    triggerSyncNow().catch(e => console.warn('Sync error:', e));

    // Exibe o Resumo da Blitz Finalizada
    showBlitzFinishedSummaryModal(updated || session, items);
  } catch (err) {
    console.error('Erro ao finalizar blitz:', err);
    showToast('Erro ao finalizar sessão da Blitz', 'warning');
  }
}

// Modal com Resumo da Blitz Finalizada
function showBlitzFinishedSummaryModal(session, items) {
  let modal = document.getElementById('modal-blitz-finished-summary');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-blitz-finished-summary';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

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

  const periodLabel = session.period_label || `${formatDateBR(session.start_date)} → ${formatDateBR(session.end_date)}`;

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-blitz-summary-backdrop"></div>
    <div class="modal-card" style="padding: 22px; max-width: 440px; width: 100%; box-sizing: border-box; text-align: center;">
      
      <div style="font-size: 2.2rem; margin-bottom: 4px;">🏁</div>
      <h3 style="font-size: 1.25rem; font-weight: 900; color: #f4f4f5; margin: 0 0 2px 0;">
        BLITZ FINALIZADA
      </h3>
      <div style="font-size: 0.88rem; font-weight: 800; color: #fbbf24; margin-bottom: 14px;">
        Período: ${periodLabel}
      </div>

      <!-- Resumo Numérico -->
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 16px;">
        <div style="background: #18181c; border: 1px solid #27272a; border-radius: 8px; padding: 10px 6px;">
          <div style="font-size: 0.65rem; color: #a1a1aa; font-weight: 800;">TOTAL</div>
          <div style="font-size: 1.35rem; font-weight: 900; color: #f4f4f5; margin-top: 2px;">${items.length}</div>
        </div>
        <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 10px 6px;">
          <div style="font-size: 0.65rem; color: #10b981; font-weight: 800;">🟢 TEM</div>
          <div style="font-size: 1.35rem; font-weight: 900; color: #10b981; margin-top: 2px;">${countTem}</div>
          <div style="font-size: 0.62rem; color: #a7f3d0; font-weight: 700;">${formatNumber(totalUnits)} un</div>
        </div>
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 8px; padding: 10px 6px;">
          <div style="font-size: 0.65rem; color: #ef4444; font-weight: 800;">🔴 NÃO TEM</div>
          <div style="font-size: 1.35rem; font-weight: 900; color: #ef4444; margin-top: 2px;">${countNaoTem}</div>
        </div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 8px;">
        <button type="button" id="btn-summary-export-wa" class="btn-primary" style="height: 48px; font-weight: 900; justify-content: center; background: #25d366; color: #000; font-size: 0.95rem;">
          💬 EXPORTAR NO WHATSAPP
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
    const formatted = await formatBlitzSessionWhatsApp(session, items);
    openWhatsAppExportModal(formatted, `Blitz ${periodLabel}`);
  });

  document.getElementById('btn-summary-close-all')?.addEventListener('click', () => {
    closeModal();
    showView('view-dashboard');
  });
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
    const periodLabel = s.period_label || `${formatDateBR(s.start_date)} → ${formatDateBR(s.end_date)}`;
    const startedAtFormatted = new Date(s.started_at).toLocaleString('pt-BR');

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
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 0.92rem; font-weight: 900; color: #f4f4f5;">
            📅 ${periodLabel}
          </div>
          <span style="
            font-size: 0.68rem;
            font-weight: 800;
            padding: 2px 8px;
            border-radius: 9999px;
            background: ${isOngoing ? 'rgba(245, 158, 11, 0.2)' : isCanceled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'};
            color: ${isOngoing ? '#fbbf24' : isCanceled ? '#f87171' : '#34d399'};
          ">
            ${isOngoing ? 'EM ANDAMENTO' : isCanceled ? 'CANCELADA' : 'FINALIZADA'}
          </span>
        </div>

        <div style="font-size: 0.72rem; color: #a1a1aa;">
          Iniciada em ${startedAtFormatted} por ${s.user_name || 'Ana Luiza'}
        </div>

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

  let text = `📋 *RELATÓRIO DA BLITZ POR PERÍODO*\n`;
  text += `📅 Período: *${periodLabel}*\n`;
  text += `Responsável: *${session.user_name || 'Ana Luiza'}*\n`;
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

  text += `*Controladoria - Ana Luiza*\n`;
  text += `Enviado em: ${new Date().toLocaleString('pt-BR')}`;

  return text;
}
