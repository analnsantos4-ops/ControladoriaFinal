// Dashboard Inteligente para Controladoria - Ana Luiza
import { getGreeting, getFormattedFullDate, formatNumber, formatDateBR } from './utils.js';
import { getDashboardMetrics, getActiveSession, clearActiveSession, getProductById } from './db.js';
import { showView, showToast } from './ui.js';
import { openConferenceForProduct, openCorridorAuditView } from './inventory.js';
import { getWeeklyRoutineStatus } from './blitz_engine.js';
import { openBlitzDashboardView, promptStartBlitz } from './blitz.js';

export async function renderDashboard() {
  // 1. Saudação e Data
  const greetingEl = document.getElementById('dashboard-greeting');
  const dateEl = document.getElementById('dashboard-date');

  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl) dateEl.textContent = `Hoje é ${getFormattedFullDate()}.`;

  // 2. Busca Métricas
  const metrics = await getDashboardMetrics();

  // 3. Mensagem Automática Inteligente com Ícone Refinado e Status Visual
  const msgEl = document.getElementById('dashboard-smart-msg');
  if (msgEl) {
    const status = metrics.smartStatus || 'ok';
    msgEl.className = `dash-smart-message smart-theme-${status}`;

    let iconSvg = '';
    let badgeClass = '';
    if (status === 'danger') {
      badgeClass = 'red-badge';
      iconSvg = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
    } else if (status === 'warning') {
      badgeClass = 'orange-badge';
      iconSvg = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
    } else if (status === 'info') {
      badgeClass = 'blue-badge';
      iconSvg = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    } else {
      badgeClass = 'green-badge';
      iconSvg = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    }

    msgEl.innerHTML = `
      <div class="smart-msg-badge-icon ${badgeClass}">
        ${iconSvg}
      </div>
      <div class="smart-msg-text-col">
        <div class="smart-msg-header-title">${metrics.smartTitle || 'Atenção'}</div>
        <div class="smart-msg-description">${metrics.smartText || metrics.smartMessage}</div>
      </div>
    `;
  }

  // 4. Cartões de Métricas
  const elExpiredProds = document.getElementById('metric-expired-prods');
  const elExpiredUnits = document.getElementById('metric-expired-units');
  const el15dProds = document.getElementById('metric-15d-prods');
  const el15dUnits = document.getElementById('metric-15d-units');
  const elTotalProds = document.getElementById('metric-total-prods');
  const elTotalUnits = document.getElementById('metric-total-units-val');

  if (elExpiredProds) elExpiredProds.textContent = `${metrics.expired.productsCount} ${metrics.expired.productsCount === 1 ? 'produto' : 'produtos'}`;
  if (elExpiredUnits) elExpiredUnits.textContent = `${formatNumber(metrics.expired.unitsCount)} unidades`;

  if (el15dProds) el15dProds.textContent = `${metrics.upTo15Days.productsCount} ${metrics.upTo15Days.productsCount === 1 ? 'produto' : 'produtos'}`;
  if (el15dUnits) el15dUnits.textContent = `${formatNumber(metrics.upTo15Days.unitsCount)} unidades`;

  if (elTotalProds) elTotalProds.textContent = `${metrics.totalProductsCount} ${metrics.totalProductsCount === 1 ? 'produto' : 'produtos'}`;
  if (elTotalUnits) elTotalUnits.textContent = `${formatNumber(metrics.totalUnitsCount || metrics.totalAllUnits || 0)} unidades`;

  // 5. Sessão Ativa de Conferência (com opção de fechar/encerrar)
  const sessionBanner = document.getElementById('dashboard-active-session-banner');
  const activeSession = getActiveSession();

  if (sessionBanner) {
    if (activeSession) {
      sessionBanner.innerHTML = `
        <div class="active-session-card">
          <div class="session-main-header">
            <div class="session-info">
              <span class="session-badge">EM ANDAMENTO</span>
              <h4 class="session-title">${activeSession.sector} · ${activeSession.corridor}</h4>
            </div>
            <button type="button" class="btn-dismiss-session" id="btn-dismiss-session" title="Fechar e encerrar sessão" aria-label="Fechar">
              ✕
            </button>
          </div>
          <div class="session-actions-row">
            <button type="button" class="btn-resume-session" id="btn-resume-session">
              CONTINUAR CONFERÊNCIA →
            </button>
            <button type="button" class="btn-cancel-session-text" id="btn-cancel-session-text">
              Encerrar Sessão
            </button>
          </div>
        </div>
      `;
      sessionBanner.classList.remove('hidden');

      document.getElementById('btn-resume-session')?.addEventListener('click', () => {
        openCorridorAuditView(activeSession.sector, activeSession.corridor);
      });

      const handleDismiss = () => {
        clearActiveSession();
        sessionBanner.innerHTML = '';
        sessionBanner.classList.add('hidden');
        showToast('Sessão encerrada.', 'normal', 1200);
      };

      document.getElementById('btn-dismiss-session')?.addEventListener('click', handleDismiss);
      document.getElementById('btn-cancel-session-text')?.addEventListener('click', handleDismiss);
    } else {
      sessionBanner.innerHTML = '';
      sessionBanner.classList.add('hidden');
    }
  }

  // 6. Próximos Vencimentos
  const upcomingContainer = document.getElementById('dashboard-upcoming-list');
  if (upcomingContainer) {
    if (metrics.upcomingExpirations.length === 0) {
      upcomingContainer.innerHTML = `<div class="empty-upcoming-msg">Nenhum vencimento crítico nos próximos 60 dias.</div>`;
    } else {
      upcomingContainer.innerHTML = metrics.upcomingExpirations
        .map((item) => {
          let urgencyClass = 'badge-upcoming';
          let tagText = `${item.daysUntil} dias`;
          if (item.daysUntil < 0) {
            urgencyClass = 'badge-expired';
            tagText = 'VENCIDO';
          } else if (item.daysUntil <= 15) {
            urgencyClass = 'badge-urgent';
            tagText = item.daysUntil === 0 ? 'HOJE' : `${item.daysUntil} dias`;
          }

          return `
          <div class="upcoming-product-card" data-prodid="${item.productId}" data-expid="${item.expirationId}">
            <div class="upcoming-thumb-col">
              ${
                item.image
                  ? `<img src="${item.image}" alt="" class="upcoming-thumb-img" />`
                  : `<div class="photo-placeholder-mini">FOTO</div>`
              }
            </div>
            <div class="upcoming-info-col">
              <h4 class="upcoming-name">${item.name}</h4>
              <div class="upcoming-meta-row">
                <span class="upcoming-date-label">📅 ${formatDateBR(item.expirationDate)}</span>
                <span class="upcoming-days-tag ${urgencyClass}">${tagText}</span>
              </div>
              <div class="upcoming-stock-row">
                <span class="upcoming-loc">${item.sector} · ${item.corridor}</span>
                <span class="upcoming-units"><strong>${formatNumber(item.units)}</strong> un</span>
              </div>
            </div>
          </div>
        `;
        })
        .join('');

      upcomingContainer.querySelectorAll('.upcoming-product-card').forEach((card) => {
        card.addEventListener('click', async () => {
          const prodId = card.getAttribute('data-prodid');
          const expId = card.getAttribute('data-expid');
          const prod = await getProductById(prodId);
          if (prod) {
            openConferenceForProduct(prod, expId);
          }
        });
      });
    }
  }

  // 7. Painel "Como está minha semana?" e Prioridade Inteligente (Item 5, 10, 11)
  const routineContainer = document.getElementById('dashboard-weekly-routine-section');
  if (routineContainer) {
    await renderWeeklyRoutine(routineContainer);
  }
}

async function renderWeeklyRoutine(container) {
  try {
    const data = await getWeeklyRoutineStatus();
    const { currentCycle, cyclesProgress, delayedBlitz, priorityAlert } = data;

    let priorityHtml = '';
    if (priorityAlert) {
      priorityHtml = `
        <div style="
          background: rgba(239, 68, 68, 0.12);
          border: 1.5px solid rgba(239, 68, 68, 0.45);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 12px;
        ">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <span style="font-size: 1.4rem; line-height: 1;">🚨</span>
            <div style="flex: 1;">
              <h4 style="font-size: 0.92rem; font-weight: 900; color: #ef4444; margin: 0 0 4px 0;">
                ${priorityAlert.title}
              </h4>
              <div style="font-size: 0.8rem; color: #f4f4f5; line-height: 1.35; margin-bottom: 6px;">
                ${priorityAlert.message}
              </div>
              <div style="font-size: 0.76rem; color: #fca5a5; background: rgba(239, 68, 68, 0.15); padding: 6px 8px; border-radius: 6px; margin-bottom: 8px;">
                💡 <strong>${priorityAlert.suggestion}</strong>
              </div>
              <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" id="btn-routine-resolve-delay" class="btn-primary" style="height: 36px; padding: 0 12px; font-size: 0.78rem; font-weight: 800; background: #ef4444; color: #fff;">
                  Resolver ${priorityAlert.delayedCycle.label}
                </button>
                <button type="button" id="btn-routine-open-today" class="btn-secondary" style="height: 36px; padding: 0 12px; font-size: 0.78rem; font-weight: 800; color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">
                  Ver ${priorityAlert.currentCycle.label}
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const cyclesCardsHtml = cyclesProgress.map(c => {
      const isCurrent = c.isCurrent;
      const borderStyle = isCurrent ? 'border: 1.5px solid #f59e0b; background: #1a1a1f;' : 'border: 1px solid #27272a; background: #141417;';
      const currentBadge = isCurrent ? '<span style="background: #f59e0b; color: #000; font-size: 0.62rem; font-weight: 900; padding: 2px 6px; border-radius: 4px; text-transform: uppercase;">HOJE</span>' : '';

      return `
        <div style="${borderStyle} border-radius: 8px; padding: 10px; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 1.05rem;">${c.icon}</span>
              <strong style="font-size: 0.86rem; color: #f4f4f5;">${c.label}</strong>
              ${currentBadge}
            </div>
            <span style="font-size: 0.72rem; color: #a1a1aa; font-weight: 700;">${c.daysLabel}</span>
          </div>

          <div style="margin: 6px 0;">
            <div style="background: #27272a; height: 7px; border-radius: 4px; overflow: hidden;">
              <div style="background: ${c.isFinished ? '#10b981' : (c.badgeClass === 'red-badge' ? '#ef4444' : '#f59e0b')}; width: ${c.percent}%; height: 100%; transition: width 0.3s ease;"></div>
            </div>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #a1a1aa;">
            <span>${c.statusText}</span>
            <span style="font-weight: 800; color: ${c.isFinished ? '#10b981' : '#f4f4f5'};">${c.percent}%</span>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      ${priorityHtml}
      <div style="
        background: #18181c;
        border: 1px solid #2a2a30;
        border-radius: 10px;
        padding: 12px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 1rem;">📊</span>
            <h4 style="font-size: 0.86rem; font-weight: 900; color: #f4f4f5; margin: 0; text-transform: uppercase; letter-spacing: 0.5px;">
              COMO ESTÁ MINHA SEMANA?
            </h4>
          </div>
          <button type="button" id="btn-routine-open-blitz-dash" style="background: none; border: none; color: #fbbf24; font-size: 0.74rem; font-weight: 800; cursor: pointer; padding: 2px 6px;">
            Abrir Painel Blitz →
          </button>
        </div>

        <div style="margin-bottom: 8px;">
          ${cyclesCardsHtml}
        </div>

        <div style="background: #111113; border: 1px dashed #3f3f46; border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; font-size: 0.76rem;">
          <div>
            <span style="color: #a1a1aa;">Setor sugerido para hoje:</span>
            <strong style="color: #fbbf24; margin-left: 4px;">${currentCycle.label}</strong>
          </div>
          <button type="button" id="btn-routine-quick-blitz" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 4px; font-weight: 800; font-size: 0.7rem; padding: 4px 8px; cursor: pointer;">
            ${currentCycle.isRestDay ? 'Ver Histórico' : 'Iniciar / Continuar'}
          </button>
        </div>
      </div>
    `;

    // Event listeners
    document.getElementById('btn-routine-resolve-delay')?.addEventListener('click', () => {
      openBlitzDashboardView();
    });

    document.getElementById('btn-routine-open-today')?.addEventListener('click', () => {
      promptStartBlitz();
    });

    document.getElementById('btn-routine-open-blitz-dash')?.addEventListener('click', () => {
      openBlitzDashboardView();
    });

    document.getElementById('btn-routine-quick-blitz')?.addEventListener('click', () => {
      openBlitzDashboardView();
    });

  } catch (e) {
    console.warn('Aviso ao renderizar rotina semanal:', e);
    container.innerHTML = '';
  }
}
