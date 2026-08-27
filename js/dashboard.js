// Dashboard Inteligente para Controladoria - Ana Luiza
import { getGreeting, getFormattedFullDate, formatNumber, formatDateBR } from './utils.js';
import { getDashboardMetrics, getActiveSession, clearActiveSession, getProductById } from './db.js';
import { showView, showToast } from './ui.js';
import { openConferenceForProduct, openCorridorAuditView } from './inventory.js';

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
}
