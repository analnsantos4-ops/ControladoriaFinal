// Importa Estilos Globais
import '../style.css';

// Orquestrador Principal do Aplicativo Controladoria - Ana Luiza
import { isAuthenticated, verifyCode, logout } from './auth.js';
import { initDB, getProductByBarcode, getProductById, searchProducts, getAllProducts, getProductExpirations, getLatestCountsForExpiration, clearAllDatabaseData, toggleExpirationTriaged } from './db.js';
import { initSyncEngine, registerSyncStatusListener, wipeSupabaseCloudData, triggerSyncNow, checkSupabaseHealth, syncAllLocalDataToSupabase, SUPABASE_SETUP_SQL, getSyncStatus } from './sync.js';
import { showView, showToast, setupButtonFeedbacks, openPhotoModal, getActiveView } from './ui.js';
import { startCameraScanner, stopCameraScanner, toggleTorch, switchCamera, toggleCameraZoom, scanBarcodeFromImageFile } from './scanner.js';
import { renderDashboard } from './dashboard.js';
import { openNewProductView, saveNewProduct, handleProductImageFile, openProductDetailView, updateNewProductTotalCalculation, populateSectorAndCorridorSelects } from './products.js';
import { openConferenceForProduct, confirmConference, openCorridorAuditView, loadCorridorAuditProducts, exportCurrentCorridorWhatsApp } from './inventory.js';
import { SETORS, CORRIDORS, formatDateBR, formatNumber, getDaysUntilExpiration } from './utils.js';
import { openWhatsAppImportModal, formatMultipleProductsWhatsApp, openWhatsAppExportModal } from './whatsapp.js';

let torchState = false;

// Inicialização da Aplicação
async function initApp() {
  setupButtonFeedbacks();

  // Inicializa Banco IndexedDB
  try {
    await initDB();
  } catch (e) {
    console.error('Falha ao inicializar IndexedDB:', e);
  }

  // Inicializa motor de sincronização Supabase
  initSyncEngine();
  registerSyncStatusListener((status) => {
    const badge = document.getElementById('sync-status-badge');
    if (badge) {
      badge.textContent = status.label;
      badge.className = `sync-badge ${status.className}`;
      badge.title = status.lastError ? `Detalhes: ${status.lastError} (Toque para tentar novamente)` : 'Toque para sincronizar com a nuvem';
    }
  });

  // Listener para sincronização manual ao tocar no badge de status
  document.getElementById('sync-status-badge')?.addEventListener('click', async () => {
    showToast('↻ Sincronizando com a Nuvem Supabase...', 'info', 2000);
    try {
      await triggerSyncNow();
      showToast('✓ Sincronização concluída!', 'success', 2000);
      await renderDashboard();
    } catch (e) {
      showToast('⚠ Erro ao sincronizar.', 'warning');
    }
  });

  // Limpa caches antigos do navegador
  if ('caches' in window) {
    caches.keys().then((names) => {
      names.forEach((name) => {
        if (!name.includes('v3.0.0')) {
          caches.delete(name);
        }
      });
    });
  }

  // Registra Service Worker se disponível
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
        console.log('Service Worker registrado com sucesso');
      })
      .catch((err) => console.warn('Service Worker registration failed:', err));
  }

  // Verifica Autenticação
  if (isAuthenticated()) {
    showDashboardView();
  } else {
    showLoginView();
  }

  // Configura todos os Event Listeners da Interface
  setupEventListeners();
}

// Configura Tela de Login
function showLoginView() {
  const pinInput = document.getElementById('login-pin-input');
  if (pinInput) {
    pinInput.value = '';
    pinInput.focus();
  }
  const errorMsg = document.getElementById('login-error-msg');
  if (errorMsg) errorMsg.classList.add('hidden');

  showView('view-login');
}

// Configura Tela de Dashboard
async function showDashboardView() {
  await renderDashboard();
  showView('view-dashboard');
}

// Configuração dos Event Listeners
function setupEventListeners() {
  // --------------------------------------------------
  // 1. LOGIN
  // --------------------------------------------------
  const loginForm = document.getElementById('form-login');
  const pinInput = document.getElementById('login-pin-input');
  const loginError = document.getElementById('login-error-msg');

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const code = pinInput ? pinInput.value : '';
      if (verifyCode(code)) {
        if (loginError) loginError.classList.add('hidden');
        showDashboardView();
        showToast('✓ Bem-vinda, Ana Luiza!', 'success', 2000);
      } else {
        if (loginError) {
          loginError.textContent = '⚠ Código incorreto.';
          loginError.classList.remove('hidden');
        }
        if (pinInput) {
          pinInput.value = '';
          pinInput.focus();
        }
      }
    });
  }

  // Teclado virtual numérico na tela de login
  document.querySelectorAll('.btn-numpad').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (pinInput) {
        if (val === 'clear') {
          pinInput.value = '';
        } else if (val === 'backspace') {
          pinInput.value = pinInput.value.slice(0, -1);
        } else if (pinInput.value.length < 4) {
          pinInput.value += val;
        }
      }
    });
  });

  // Logout
  document.getElementById('btn-header-logout')?.addEventListener('click', () => {
    logout();
    showLoginView();
    showToast('Sessão encerrada', 'info', 1500);
  });

  // --------------------------------------------------
  // 2. DASHBOARD - AÇÕES RÁPIDAS
  // --------------------------------------------------
  // [ 📷 CONFERIR ] - Botão Principal
  document.getElementById('btn-dash-scan')?.addEventListener('click', () => {
    openScannerView();
  });

  // [ 🔎 CONSULTAR ]
  document.getElementById('btn-dash-search')?.addEventListener('click', () => {
    openSearchView();
  });

  // [ ⚠ VENCIMENTOS ]
  document.getElementById('btn-dash-expirations')?.addEventListener('click', () => {
    openExpirationsView();
  });

  // [ 💬 IMPORTAR DO WHATSAPP ]
  document.getElementById('btn-dash-wa-import')?.addEventListener('click', () => {
    openWhatsAppImportModal();
  });

  // [ 🏢 CONFERIR POR CORREDOR ]
  document.getElementById('btn-dash-corridor')?.addEventListener('click', () => {
    openCorridorAuditView();
  });

  // [ 🗑️ ZERAR BASE DE DADOS COM CONFIRMAÇÃO DE SENHA 2002 ]
  const wipeModal = document.getElementById('modal-wipe-confirm');
  const wipePinInput = document.getElementById('input-wipe-pin');
  const wipePinError = document.getElementById('wipe-pin-error');
  const btnDashWipe = document.getElementById('btn-dash-wipe-db');
  const btnCancelWipe = document.getElementById('btn-cancel-wipe');
  const btnConfirmWipe = document.getElementById('btn-confirm-wipe');
  const wipeBackdrop = document.getElementById('modal-wipe-backdrop');

  btnDashWipe?.addEventListener('click', () => {
    if (wipeModal) {
      if (wipePinInput) wipePinInput.value = '';
      if (wipePinError) wipePinError.style.display = 'none';
      wipeModal.classList.add('open');
      setTimeout(() => wipePinInput?.focus(), 150);
    }
  });

  const closeWipeModal = () => {
    wipeModal?.classList.remove('open');
    if (wipePinInput) wipePinInput.value = '';
    if (wipePinError) wipePinError.style.display = 'none';
  };

  btnCancelWipe?.addEventListener('click', closeWipeModal);
  wipeBackdrop?.addEventListener('click', closeWipeModal);

  btnConfirmWipe?.addEventListener('click', async () => {
    const pin = wipePinInput?.value?.trim();
    if (pin !== '2002') {
      if (wipePinError) {
        wipePinError.style.display = 'block';
        wipePinError.textContent = 'Senha incorreta! Digite 2002.';
      }
      if (wipePinInput) {
        wipePinInput.value = '';
        wipePinInput.focus();
      }
      return;
    }

    closeWipeModal();
    showToast('Zerando banco de dados local e nuvem...', 'info', 3000);

    try {
      await clearAllDatabaseData();
      await wipeSupabaseCloudData();
      
      // Limpa dados de cache locais
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem('auth_user', 'Ana Luiza');
      localStorage.setItem('test_products_cleared_v1', 'true');

      await renderDashboard();
      showToast('✓ Banco de dados 100% zerado!', 'success', 3000);
    } catch (e) {
      console.error(e);
      showToast('Erro ao zerar base de dados.', 'error');
    }
  });

  wipePinInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnConfirmWipe?.click();
    }
  });

  // --------------------------------------------------
  // MODAL DE CONFIGURAÇÃO / DIAGNÓSTICO DO SUPABASE
  // --------------------------------------------------
  const supabaseModal = document.getElementById('modal-supabase-setup');
  const btnDashSupabaseDiag = document.getElementById('btn-dash-supabase-diag');
  const btnCloseSupabaseModal = document.getElementById('btn-close-supabase-modal');
  const supabaseBackdrop = document.getElementById('modal-supabase-backdrop');
  const btnCopySupabaseSql = document.getElementById('btn-copy-supabase-sql');
  const btnTestSupabaseSync = document.getElementById('btn-test-supabase-sync');
  const supabaseSqlDisplay = document.getElementById('supabase-sql-code-display');
  const diagBadge = document.getElementById('supabase-diag-badge');
  const diagMsg = document.getElementById('supabase-diag-msg');

  if (supabaseSqlDisplay) {
    supabaseSqlDisplay.value = SUPABASE_SETUP_SQL;
  }

  async function openSupabaseDiagModal() {
    if (!supabaseModal) return;
    supabaseModal.classList.add('open');
    if (diagBadge) {
      diagBadge.textContent = 'Testando...';
      diagBadge.className = 'sync-badge status-syncing';
    }
    if (diagMsg) {
      diagMsg.textContent = 'Verificando permissões com o Supabase...';
      diagMsg.style.color = '#a1a1aa';
    }

    const health = await checkSupabaseHealth();
    updateSupabaseDiagUI(health);
  }

  function updateSupabaseDiagUI(health) {
    if (!diagBadge || !diagMsg) return;
    if (health.connected) {
      diagBadge.textContent = '✓ Conectado';
      diagBadge.className = 'sync-badge status-online';
      diagMsg.style.color = '#10b981';
      diagMsg.innerHTML = '✓ Conexão estabelecida com sucesso! Tabelas liberadas para sincronização.';
    } else if (health.code === '42501' || health.message?.includes('permission denied') || health.message?.includes('42501')) {
      diagBadge.textContent = '⚠ Permissão Bloqueada (42501)';
      diagBadge.className = 'sync-badge status-offline';
      diagMsg.style.color = '#f97316';
      diagMsg.innerHTML = `⚠️ <strong>Permissão Negada no Supabase (Erro 42501)</strong><br>O banco recusou o acesso da chave anônima. Execute o <strong>Script SQL</strong> abaixo no <strong>SQL Editor</strong> do painel Supabase para liberar.`;
    } else {
      diagBadge.textContent = `⚠ ${health.code || 'Erro'}`;
      diagBadge.className = 'sync-badge status-offline';
      diagMsg.style.color = '#ef4444';
      diagMsg.innerHTML = `Falha: ${health.message || 'Verifique sua conexão'}`;
    }
  }

  const closeSupabaseModal = () => {
    supabaseModal?.classList.remove('open');
  };

  btnDashSupabaseDiag?.addEventListener('click', openSupabaseDiagModal);
  btnCloseSupabaseModal?.addEventListener('click', closeSupabaseModal);
  supabaseBackdrop?.addEventListener('click', closeSupabaseModal);

  // Copiar SQL
  btnCopySupabaseSql?.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
      } else if (supabaseSqlDisplay) {
        supabaseSqlDisplay.select();
        document.execCommand('copy');
      }
      btnCopySupabaseSql.textContent = '✓ SCRIPT SQL COPIADO!';
      btnCopySupabaseSql.style.background = '#059669';
      showToast('✓ Script SQL copiado para a área de transferência!', 'success', 2500);
      setTimeout(() => {
        if (btnCopySupabaseSql) {
          btnCopySupabaseSql.textContent = '📋 COPIAR SCRIPT SQL COMPLETO';
          btnCopySupabaseSql.style.background = '#10b981';
        }
      }, 3000);
    } catch (err) {
      showToast('Selecione e copie o texto da caixa abaixo.', 'info');
    }
  });

  // Testar Conexão & Sincronizar
  btnTestSupabaseSync?.addEventListener('click', async () => {
    btnTestSupabaseSync.textContent = '↻ Testando conexão...';
    btnTestSupabaseSync.disabled = true;

    try {
      const health = await checkSupabaseHealth();
      updateSupabaseDiagUI(health);

      if (health.connected) {
        showToast('✓ Conexão OK! Sincronizando produtos locais...', 'info', 2000);
        const syncResult = await syncAllLocalDataToSupabase();
        await triggerSyncNow();
        await renderDashboard();
        
        if (syncResult && syncResult.syncedCount > 0) {
          showToast(`🎉 Sucesso! ${syncResult.syncedCount} produto(s) sincronizados com o Supabase!`, 'success', 4000);
        } else {
          showToast('✓ Supabase conectado e sincronizado!', 'success', 3000);
        }
      } else {
        showToast('⚠ Permissão ainda bloqueada. Execute o script no SQL Editor do Supabase.', 'warning', 4000);
      }
    } catch (e) {
      showToast('Erro ao testar conexão com Supabase.', 'error');
    } finally {
      btnTestSupabaseSync.textContent = '🔄 Testar Conexão & Sincronizar Agora';
      btnTestSupabaseSync.disabled = false;
    }
  });

  // Badge de status no topo: abre modal ou dispara sincronização
  document.getElementById('sync-status-badge')?.addEventListener('click', async () => {
    const currentStatus = getSyncStatus();
    if (currentStatus.lastError || currentStatus.lastErrorCode) {
      openSupabaseDiagModal();
    } else {
      showToast('↻ Sincronizando com a Nuvem Supabase...', 'info', 2000);
      try {
        await triggerSyncNow();
        const health = await checkSupabaseHealth();
        if (health.connected) {
          showToast('✓ Sincronização concluída!', 'success', 2000);
        } else {
          openSupabaseDiagModal();
        }
        await renderDashboard();
      } catch (e) {
        openSupabaseDiagModal();
      }
    }
  });

  // Botões de Exportação WhatsApp nos Headers
  document.getElementById('btn-expirations-wa-export')?.addEventListener('click', async () => {
    await exportCurrentExpirationsWhatsApp();
  });

  document.getElementById('btn-corridor-wa-export')?.addEventListener('click', async () => {
    const secSelect = document.getElementById('corridor-audit-sector-select');
    const corSelect = document.getElementById('corridor-audit-corridor-select');
    const sector = secSelect ? secSelect.value : 'MERCEARIA';
    const corridor = corSelect ? corSelect.value : 'CORREDOR 01';
    await exportCurrentCorridorWhatsApp(sector, corridor);
  });

  // Listener para atualização de Dashboard
  window.addEventListener('refresh-dashboard-trigger', async () => {
    await renderDashboard();
  });

  // Cartões de métricas clicáveis para filtrar vencimentos
  document.getElementById('card-metric-expired')?.addEventListener('click', () => {
    openExpirationsView('EXPIRED');
  });
  document.getElementById('card-metric-15d')?.addEventListener('click', () => {
    openExpirationsView('15_DAYS');
  });
  document.getElementById('card-metric-total')?.addEventListener('click', () => {
    openSearchView();
  });
  document.getElementById('card-metric-units')?.addEventListener('click', () => {
    openSearchView();
  });

  // --------------------------------------------------
  // 3. SCANNER
  // --------------------------------------------------
  document.getElementById('btn-scanner-back')?.addEventListener('click', () => {
    stopCameraScanner();
    showDashboardView();
  });

  document.getElementById('btn-scanner-torch')?.addEventListener('click', async () => {
    torchState = !torchState;
    const ok = await toggleTorch(torchState);
    if (!ok) torchState = !torchState;
  });

  document.getElementById('btn-scanner-zoom')?.addEventListener('click', async () => {
    await toggleCameraZoom();
  });

  document.getElementById('btn-scanner-switch')?.addEventListener('click', async () => {
    await switchCamera('scanner-reader-box', onBarcodeDetected);
  });

  // Upload ou Foto de Código de Barras
  const scannerFileInput = document.getElementById('scanner-file-input');
  document.getElementById('btn-scanner-photo')?.addEventListener('click', () => {
    scannerFileInput?.click();
  });
  document.getElementById('btn-scanner-photo-link')?.addEventListener('click', () => {
    scannerFileInput?.click();
  });

  scannerFileInput?.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      await scanBarcodeFromImageFile(file, onBarcodeDetected);
      scannerFileInput.value = '';
    }
  });

  // Busca manual no scanner
  const formManualBarcode = document.getElementById('form-manual-barcode');
  if (formManualBarcode) {
    formManualBarcode.addEventListener('submit', async (e) => {
      e.preventDefault();
      const codeInput = document.getElementById('manual-barcode-input');
      const code = codeInput ? codeInput.value.trim() : '';
      if (code) {
        stopCameraScanner();
        await onBarcodeDetected(code);
      }
    });
  }

  // --------------------------------------------------
  // 4. CONFERÊNCIA
  // --------------------------------------------------
  document.getElementById('btn-conf-back')?.addEventListener('click', () => {
    showDashboardView();
  });

  document.getElementById('btn-conf-confirm')?.addEventListener('click', () => {
    confirmConference();
  });

  // --------------------------------------------------
  // 5. NOVO PRODUTO
  // --------------------------------------------------
  document.getElementById('btn-new-prod-back')?.addEventListener('click', () => {
    showDashboardView();
  });

  document.getElementById('btn-new-prod-save')?.addEventListener('click', () => {
    saveNewProduct();
  });

  // Input de fotos para novo produto
  const fileCameraNew = document.getElementById('file-camera-new');
  const fileGalleryNew = document.getElementById('file-gallery-new');

  document.getElementById('btn-new-photo-camera')?.addEventListener('click', () => {
    fileCameraNew?.click();
  });
  document.getElementById('btn-new-photo-gallery')?.addEventListener('click', () => {
    fileGalleryNew?.click();
  });

  fileCameraNew?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProductImageFile(e.target.files[0], false);
    }
  });
  fileGalleryNew?.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleProductImageFile(e.target.files[0], false);
    }
  });

  // Inputs de contagem na tela de novo produto
  document.querySelectorAll('.new-count-input').forEach((input) => {
    input.addEventListener('input', () => {
      updateNewProductTotalCalculation();
    });
  });

  // --------------------------------------------------
  // 6. CONFERÊNCIA POR CORREDOR
  // --------------------------------------------------
  document.getElementById('btn-corridor-audit-back')?.addEventListener('click', () => {
    showDashboardView();
  });

  document.getElementById('corridor-audit-sector-select')?.addEventListener('change', (e) => {
    const sec = e.target.value;
    const cor = document.getElementById('corridor-audit-corridor-select')?.value || 'CORREDOR 01';
    loadCorridorAuditProducts(sec, cor);
  });

  document.getElementById('corridor-audit-corridor-select')?.addEventListener('change', (e) => {
    const cor = e.target.value;
    const sec = document.getElementById('corridor-audit-sector-select')?.value || 'MERCEARIA';
    loadCorridorAuditProducts(sec, cor);
  });

  // --------------------------------------------------
  // 7. CONSULTA / BUSCA
  // --------------------------------------------------
  document.getElementById('btn-search-back')?.addEventListener('click', () => {
    showDashboardView();
  });

  const searchInput = document.getElementById('search-query-input');
  const searchSectorSelect = document.getElementById('search-sector-filter');
  const searchCorridorSelect = document.getElementById('search-corridor-filter');

  const executeSearch = async () => {
    const query = searchInput ? searchInput.value : '';
    const sector = searchSectorSelect ? searchSectorSelect.value : 'TODOS';
    const corridor = searchCorridorSelect ? searchCorridorSelect.value : 'TODOS';
    await renderSearchResults(query, sector, corridor);
  };

  searchInput?.addEventListener('input', executeSearch);
  searchSectorSelect?.addEventListener('change', executeSearch);
  searchCorridorSelect?.addEventListener('change', executeSearch);

  // --------------------------------------------------
  // 8. TELA DE VENCIMENTOS
  // --------------------------------------------------
  document.getElementById('btn-exp-back')?.addEventListener('click', () => {
    showDashboardView();
  });

  document.querySelectorAll('.btn-exp-filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.btn-exp-filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const filterType = tab.getAttribute('data-filter');
      renderExpirationsList(filterType);
    });
  });

  // Custom Event Listeners
  window.addEventListener('start-scanner-trigger', () => {
    openScannerView();
  });

  window.addEventListener('refresh-dashboard-trigger', () => {
    renderDashboard();
  });
}

// ----------------------------------------------------
// FLUXO DO SCANNER E DETECÇÃO DE CÓDIGO
// ----------------------------------------------------
export async function openScannerView() {
  showView('view-scanner');
  const manualInput = document.getElementById('manual-barcode-input');
  if (manualInput) manualInput.value = '';

  const res = await startCameraScanner('scanner-reader-box', onBarcodeDetected);
  if (!res.success) {
    showToast(res.error || 'Câmera não disponível', 'warning');
    manualInput?.focus();
  }
}

// Callback executado imediatamente após o bip
export async function onBarcodeDetected(barcode) {
  if (!barcode) return;
  const cleanCode = barcode.trim();

  // 1. Pesquisa no IndexedDB primeiro (Ultra rápido / offline)
  showToast(`Bipado: ${cleanCode}`, 'info', 1000);
  const existingProduct = await getProductByBarcode(cleanCode);

  if (existingProduct) {
    // SIM → ABRIR PRODUTO PARA CONFERÊNCIA
    openConferenceForProduct(existingProduct);
  } else {
    // NÃO → CADASTRAR PRODUTO COM CÓDIGO PREENCHIDO
    openNewProductView(cleanCode);
  }
}

// ----------------------------------------------------
// TELA DE CONSULTA / BUSCA
// ----------------------------------------------------
export async function openSearchView() {
  populateSearchFilters();
  const searchInput = document.getElementById('search-query-input');
  if (searchInput) searchInput.value = '';
  await renderSearchResults('', 'TODOS', 'TODOS');
  showView('view-search');
}

function populateSearchFilters() {
  const secEl = document.getElementById('search-sector-filter');
  const corEl = document.getElementById('search-corridor-filter');

  if (secEl) {
    secEl.innerHTML = `<option value="TODOS">TODOS OS SETORES</option>` + SETORS.map((s) => `<option value="${s}">${s}</option>`).join('');
  }
  if (corEl) {
    corEl.innerHTML = `<option value="TODOS">TODOS OS CORREDORES</option>` + CORRIDORS.map((c) => `<option value="${c}">${c}</option>`).join('');
  }
}

async function renderSearchResults(query, sector, corridor) {
  const results = await searchProducts(query, sector, corridor);
  const container = document.getElementById('search-results-list');
  const countDisplay = document.getElementById('search-results-count');

  if (countDisplay) {
    countDisplay.textContent = `${results.length} ${results.length === 1 ? 'produto encontrado' : 'produtos encontrados'}`;
  }

  if (!container) return;

  if (results.length === 0) {
    container.innerHTML = `
      <div class="empty-search-card">
        <p>Nenhum produto encontrado para os filtros selecionados.</p>
        <button type="button" class="btn-primary-mini" id="btn-search-add-new">+ Cadastrar Novo Produto</button>
      </div>
    `;
    document.getElementById('btn-search-add-new')?.addEventListener('click', () => {
      openNewProductView();
    });
    return;
  }

  // Calcula estoque ativo e triado de cada produto para exibição rica na busca
  const cardsHtml = await Promise.all(
    results.map(async (p) => {
      let activeStock = 0;
      let triagedStock = 0;
      let hasExps = false;
      try {
        const exps = await getProductExpirations(p.id);
        hasExps = exps.length > 0;
        for (const exp of exps) {
          const counts = await getLatestCountsForExpiration(exp.id);
          const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';
          if (isTriaged) {
            triagedStock += counts.total || 0;
          } else {
            activeStock += counts.total || 0;
          }
        }
      } catch (_) {}

      if (!hasExps && Number(p.total_quantity) > 0) {
        activeStock = Number(p.total_quantity);
      }

      let stockTagHtml = '';
      if (activeStock === 0 && triagedStock > 0) {
        stockTagHtml = `<span class="loc-badge" style="background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4); font-weight: 800;">📦 RETIRADO P/ TRIAGEM (${formatNumber(triagedStock)} un)</span>`;
      } else {
        stockTagHtml = `<span class="loc-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); font-weight: 800;">🟢 ${formatNumber(activeStock)} un na loja</span>`;
        if (triagedStock > 0) {
          stockTagHtml += ` <span class="loc-badge" style="background: rgba(234, 179, 8, 0.12); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.3); font-weight: 700; font-size: 0.68rem;">+${formatNumber(triagedStock)} triados</span>`;
        }
      }

      return `
        <div class="search-result-card" data-prodid="${p.id}">
          <div class="search-thumb-col">
            ${
              p.image
                ? `<img src="${p.image}" alt="" class="compact-prod-thumb" />`
                : `<div class="photo-placeholder-mini">FOTO</div>`
            }
          </div>
          <div class="search-info-col">
            <h4 class="search-prod-name">${p.name}</h4>
            <span class="search-barcode">${p.barcode}</span>
            <div class="search-loc-tags">
              <span class="loc-badge sector">${p.sector}</span>
              <span class="loc-badge corridor">${p.corridor}</span>
              ${stockTagHtml}
            </div>
          </div>
          <div class="search-action-col">
            <button type="button" class="btn-search-view" data-prodid="${p.id}">Ver</button>
          </div>
        </div>
      `;
    })
  );

  container.innerHTML = cardsHtml.join('');

  container.querySelectorAll('.search-result-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const prodId = card.getAttribute('data-prodid');
      openProductDetailView(prodId);
    });
  });
}

// ----------------------------------------------------
// TELA DE VENCIMENTOS
// ----------------------------------------------------
export async function openExpirationsView(initialFilter = 'ALL') {
  document.querySelectorAll('.btn-exp-filter-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.getAttribute('data-filter') === initialFilter);
  });
  await renderExpirationsList(initialFilter);
  showView('view-expirations');
}

async function renderExpirationsList(filterType = 'ALL') {
  const products = await getAllProducts();
  const container = document.getElementById('expirations-list-container');
  if (!container) return;

  const productMap = {};
  products.forEach((p) => (productMap[p.id] = p));

  const items = [];

  for (const p of products) {
    const exps = await getProductExpirations(p.id);
    for (const exp of exps) {
      const latest = await getLatestCountsForExpiration(exp.id);
      const days = getDaysUntilExpiration(exp.expiration_date);
      const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';

      let category = 'OK';
      if (days < 0) category = 'EXPIRED';
      else if (days <= 15) category = '15_DAYS';
      else if (days <= 30) category = '30_DAYS';

      let include = false;
      if (filterType === 'ALL') {
        // Na aba Todos, exibimos todos os produtos ativos (não triados)
        include = !isTriaged;
      } else if (filterType === 'EXPIRED') {
        // Apenas vencidos que AINDA NÃO foram retirados para triagem
        include = category === 'EXPIRED' && !isTriaged;
      } else if (filterType === '15_DAYS') {
        include = (category === 'EXPIRED' || category === '15_DAYS') && !isTriaged;
      } else if (filterType === '30_DAYS') {
        include = (category === 'EXPIRED' || category === '15_DAYS' || category === '30_DAYS') && !isTriaged;
      } else if (filterType === 'TRIAGED') {
        // Histórico de todos que foram marcados como retirados para triagem
        include = isTriaged;
      }

      if (include) {
        items.push({
          product: p,
          expiration: exp,
          daysUntil: days,
          category,
          isTriaged,
          units: latest.total
        });
      }
    }
  }

  // Ordena por dias até vencer (mais críticos primeiro)
  items.sort((a, b) => a.daysUntil - b.daysUntil);

  if (items.length === 0) {
    let emptyMsg = 'Nenhum produto encontrado neste filtro.';
    if (filterType === 'ALL') emptyMsg = 'Nenhum produto cadastrado com validade ativa.';
    if (filterType === 'EXPIRED') emptyMsg = '🎉 Nenhum produto vencido pendente no momento!';
    if (filterType === '15_DAYS') emptyMsg = 'Nenhum produto com vencimento nos próximos 15 dias.';
    if (filterType === '30_DAYS') emptyMsg = 'Nenhum produto com vencimento nos próximos 30 dias.';
    if (filterType === 'TRIAGED') emptyMsg = 'Nenhum produto em triagem no momento.';
    container.innerHTML = `<div class="empty-exp-state">${emptyMsg}</div>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      let badgeClass = 'tag-normal';
      let tagText = `${item.daysUntil} dias`;

      let cardStatusClass = 'status-ok';
      if (item.isTriaged) {
        badgeClass = 'tag-triaged';
        cardStatusClass = 'status-triaged';
        tagText = '📦 EM TRIAGEM (RETIRADO)';
      } else if (item.daysUntil < 0) {
        badgeClass = 'tag-expired';
        cardStatusClass = 'status-expired';
        tagText = `🔴 VENCIDO HÁ ${Math.abs(item.daysUntil)} DIAS`;
      } else if (item.daysUntil <= 15) {
        badgeClass = 'tag-urgent';
        cardStatusClass = 'status-15-days';
        tagText = item.daysUntil === 0 ? '🟠 VENCE HOJE' : `🟠 VENCE EM ${item.daysUntil} DIAS`;
      } else if (item.daysUntil <= 30) {
        badgeClass = 'tag-warning';
        cardStatusClass = 'status-30-days';
        tagText = `🟡 VENCE EM ${item.daysUntil} DIAS`;
      }

      return `
      <div class="exp-alert-card ${cardStatusClass}" id="exp-card-${item.expiration.id}" data-prodid="${item.product.id}" data-expid="${item.expiration.id}">
        <div class="exp-alert-top-row">
          <div class="exp-alert-thumb-col">
            ${
              item.product.image
                ? `<img src="${item.product.image}" alt="" class="compact-prod-thumb" />`
                : `<div class="photo-placeholder-mini">FOTO</div>`
            }
          </div>
          <div class="exp-alert-info-col">
            <h4 class="exp-alert-name">${item.product.name}</h4>
            <div class="exp-alert-meta">
              <span class="exp-alert-date">📅 ${formatDateBR(item.expiration.expiration_date)}</span>
              <span class="exp-badge ${badgeClass}">${tagText}</span>
            </div>
            <div class="exp-alert-loc-row">
              <span>${item.product.sector} · ${item.product.corridor}</span>
              <span>Estoque: <strong>${formatNumber(item.units)} un</strong></span>
            </div>
          </div>
          <div class="exp-alert-action-col">
            <button type="button" class="btn-audit-item">Conferir</button>
          </div>
        </div>

        <div class="exp-triage-container" onclick="event.stopPropagation()">
          <label class="exp-triage-checkbox-label">
            <input type="checkbox" class="exp-triage-checkbox" data-expid="${item.expiration.id}" ${item.isTriaged ? 'checked' : ''} />
            <span class="exp-triage-custom-check"></span>
            <span class="exp-triage-text">
              ${item.isTriaged ? '✓ Retirado para triagem (clique para restaurar ao estoque)' : '📦 Marcar: Retirado para triagem'}
            </span>
          </label>
        </div>
      </div>
    `;
    })
    .join('');

  // Listener no card para abrir conferência
  container.querySelectorAll('.exp-alert-card').forEach((card) => {
    card.addEventListener('click', async (e) => {
      // Se clicou dentro de um botão ou checkbox, não abre conferência
      if (e.target.closest('.exp-triage-container') || e.target.closest('button')) return;
      const prodId = card.getAttribute('data-prodid');
      const expId = card.getAttribute('data-expid');
      const prod = await getProductById(prodId);
      if (prod) {
        openConferenceForProduct(prod, expId);
      }
    });
  });

  // Botão conferir específico
  container.querySelectorAll('.btn-audit-item').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const card = btn.closest('.exp-alert-card');
      const prodId = card?.getAttribute('data-prodid');
      const expId = card?.getAttribute('data-expid');
      const prod = await getProductById(prodId);
      if (prod) {
        openConferenceForProduct(prod, expId);
      }
    });
  });

  // Listener no checkbox de triagem com atualização imediata
  container.querySelectorAll('.exp-triage-checkbox').forEach((checkbox) => {
    checkbox.addEventListener('change', async (e) => {
      e.stopPropagation();
      const expId = e.target.getAttribute('data-expid');
      const isChecked = e.target.checked;
      const cardEl = document.getElementById(`exp-card-${expId}`);

      if (cardEl && filterType !== 'TRIAGED' && isChecked) {
        // Efeito visual imediato de saída do item
        cardEl.style.opacity = '0.4';
        cardEl.style.transform = 'scale(0.96)';
        cardEl.style.transition = 'all 0.25s ease';
      }

      try {
        await toggleExpirationTriaged(expId, isChecked);
        triggerSyncNow().catch((err) => console.warn('Sync background error:', err));
        
        if (isChecked) {
          showToast('✓ Produto enviado para a Triagem!', 'success', 2200);
        } else {
          showToast('✓ Produto retornado ao estoque ativo!', 'info', 2000);
        }
        
        // Re-renderiza a lista de vencimentos mantendo a aba atual
        await renderExpirationsList(filterType);
        // Atualiza métricas do dashboard
        await renderDashboard();
      } catch (err) {
        console.error('Erro ao atualizar triagem:', err);
        showToast('Erro ao atualizar status de triagem', 'warning');
        await renderExpirationsList(filterType);
      }
    });
  });
}

// Exporta todos os itens de vencimentos exibidos para o WhatsApp
async function exportCurrentExpirationsWhatsApp() {
  const activeTab = document.querySelector('.btn-exp-filter-tab.active');
  const filterType = activeTab ? activeTab.getAttribute('data-filter') : 'ALL';

  const products = await getAllProducts();
  const exportItems = [];

  for (const p of products) {
    const exps = await getProductExpirations(p.id);
    for (const exp of exps) {
      const latest = await getLatestCountsForExpiration(exp.id);
      const days = getDaysUntilExpiration(exp.expiration_date);
      const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';

      let category = 'OK';
      if (days < 0) category = 'EXPIRED';
      else if (days <= 15) category = '15_DAYS';
      else if (days <= 30) category = '30_DAYS';

      let include = false;
      if (filterType === 'ALL') include = !isTriaged;
      else if (filterType === 'EXPIRED' && category === 'EXPIRED' && !isTriaged) include = true;
      else if (filterType === '15_DAYS' && (category === 'EXPIRED' || category === '15_DAYS') && !isTriaged) include = true;
      else if (filterType === '30_DAYS' && (category === 'EXPIRED' || category === '15_DAYS' || category === '30_DAYS') && !isTriaged) include = true;
      else if (filterType === 'TRIAGED' && isTriaged) include = true;

      if (include) {
        exportItems.push({
          name: p.name,
          barcode: p.barcode,
          expirationDateBR: formatDateBR(exp.expiration_date),
          quantity: latest.total,
          daysUntil: days
        });
      }
    }
  }

  if (exportItems.length === 0) {
    showToast('Nenhum item na lista para exportar.', 'warning');
    return;
  }

  exportItems.sort((a, b) => a.daysUntil - b.daysUntil);

  let filterLabel = 'TODOS OS VENCIMENTOS';
  if (filterType === 'EXPIRED') filterLabel = 'PRODUTOS VENCIDOS (PENDENTES)';
  else if (filterType === '15_DAYS') filterLabel = 'VENCIMENTOS ATÉ 15 DIAS';
  else if (filterType === '30_DAYS') filterLabel = 'VENCIMENTOS ATÉ 30 DIAS';
  else if (filterType === 'TRIAGED') filterLabel = 'PRODUTOS RETIRADOS PARA TRIAGEM';

  const formatted = formatMultipleProductsWhatsApp(exportItems, filterLabel);
  openWhatsAppExportModal(formatted, `Exportar: ${filterLabel}`);
}

// Ouvintes globais para atualização reativa dos dados vindos do Supabase
window.addEventListener('supabase-data-updated', async () => {
  const currentView = getActiveView();
  if (currentView === 'view-dashboard') {
    await renderDashboard();
  }
});

window.addEventListener('refresh-dashboard-trigger', async () => {
  await renderDashboard();
  const currentView = getActiveView();
  if (currentView === 'view-expirations') {
    const activeTab = document.querySelector('.btn-exp-filter-tab.active');
    const filterType = activeTab ? activeTab.getAttribute('data-filter') : 'ALL';
    await renderExpirationsList(filterType);
  }
});

// Inicia no carregamento do DOM
document.addEventListener('DOMContentLoaded', initApp);

