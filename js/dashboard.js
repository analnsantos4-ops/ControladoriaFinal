// Dashboard Inteligente para Controladoria - Ana Luiza
import { getGreeting, getFormattedFullDate, formatNumber, formatDateBR } from './utils.js';
import { getDashboardMetrics, getActiveSession, getProductById } from './db.js';
import { showView } from './ui.js';
import { openConferenceForProduct, openCorridorAuditView } from './inventory.js';

export async function renderDashboard() {
  // 1. Saudação e Data
  const greetingEl = document.getElementById('dashboard-greeting');
  const dateEl = document.getElementById('dashboard-date');

  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl) dateEl.textContent = `Hoje é ${getFormattedFullDate()}.`;

  // 2. Busca Métricas
  const metrics = await getDashboardMetrics();

  // 3. Mensagem Automática Inteligente
  const msgEl = document.getElementById('dashboard-smart-msg');
  if (msgEl) {
    msgEl.innerHTML = `<span class="msg-icon">💡</span> <span class="msg-text">${metrics.smartMessage}</span>`;
  }

  // 4. Cartões de Métricas
  const elExpiredProds = document.getElementById('metric-expired-prods');
  const elExpiredUnits = document.getElementById('metric-expired-units');
  const el15dProds = document.getElementById('metric-15d-prods');
  const el15dUnits = document.getElementById('metric-15d-units');
  const el30dProds = document.getElementById('metric-30d-prods');
  const el30dUnits = document.getElementById('metric-30d-units');
  const elTotalProds = document.getElementById('metric-total-prods');

  if (elExpiredProds) elExpiredProds.textContent = `${metrics.expired.productsCount} ${metrics.expired.productsCount === 1 ? 'produto' : 'produtos'}`;
  if (elExpiredUnits) elExpiredUnits.textContent = `${formatNumber(metrics.expired.unitsCount)} unidades`;

  if (el15dProds) el15dProds.textContent = `${metrics.upTo15Days.productsCount} ${metrics.upTo15Days.productsCount === 1 ? 'produto' : 'produtos'}`;
  if (el15dUnits) el15dUnits.textContent = `${formatNumber(metrics.upTo15Days.unitsCount)} unidades`;

  if (el30dProds) el30dProds.textContent = `${metrics.upTo30Days.productsCount} ${metrics.upTo30Days.productsCount === 1 ? 'produto' : 'produtos'}`;
  if (el30dUnits) el30dUnits.textContent = `${formatNumber(metrics.upTo30Days.unitsCount)} unidades`;

  if (elTotalProds) elTotalProds.textContent = `${metrics.totalProductsCount} ${metrics.totalProductsCount === 1 ? 'produto' : 'produtos'}`;

  // 5. Sessão Ativa de Conferência (se houver)
  const sessionBanner = document.getElementById('dashboard-active-session-banner');
  const activeSession = getActiveSession();

  if (sessionBanner) {
    if (activeSession) {
      sessionBanner.innerHTML = `
        <div class="active-session-card">
          <div class="session-info">
            <span class="session-badge">EM ANDAMENTO</span>
            <h4 class="session-title">${activeSession.sector} · ${activeSession.corridor}</h4>
          </div>
          <button type="button" class="btn-resume-session" id="btn-resume-session">
            CONTINUAR CONFERÊNCIA →
          </button>
        </div>
      `;
      sessionBanner.classList.remove('hidden');

      document.getElementById('btn-resume-session')?.addEventListener('click', () => {
        openCorridorAuditView(activeSession.sector, activeSession.corridor);
      });
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
            tagText = `${item.daysUntil} dias`;
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
