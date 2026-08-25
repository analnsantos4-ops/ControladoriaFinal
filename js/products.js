// Gerenciamento de Produtos, Cadastro, Foto e Detalhes
import { SETORS, CORRIDORS, LOCATIONS, compressImage, formatNumber, formatDateBR, parseDateBRtoISO, getTodayISO } from './utils.js';
import { getProductByBarcode, getProductById, saveProduct, saveProductExpiration, saveInventoryCounts, getProductExpirations, getLatestCountsForExpiration, getHistoryForProduct, getLocationHistoryForProduct, deleteProduct, deleteProductExpiration } from './db.js';
import { triggerSyncNow } from './sync.js';
import { showToast, showView, openPhotoModal, promptSecurityPin } from './ui.js';
import { openConferenceForProduct } from './inventory.js';
import { formatSingleProductWhatsApp, formatMultipleProductsWhatsApp, openWhatsAppExportModal } from './whatsapp.js';

let currentProductImage = '';

// Prepara os selects de Setor e Corredor
export function populateSectorAndCorridorSelects(sectorSelectId, corridorSelectId) {
  const sectorEl = document.getElementById(sectorSelectId);
  const corridorEl = document.getElementById(corridorSelectId);

  if (sectorEl) {
    sectorEl.innerHTML = SETORS.map((s) => `<option value="${s}">${s}</option>`).join('');
  }

  if (corridorEl) {
    corridorEl.innerHTML = CORRIDORS.map((c) => `<option value="${c}">${c}</option>`).join('');
  }
}

// Inicializa a tela de Novo Produto com código preenchido
export function openNewProductView(barcode = '') {
  const form = document.getElementById('form-new-product');
  if (form) form.reset();

  currentProductImage = '';
  document.getElementById('new-product-barcode').value = barcode;
  document.getElementById('new-product-img-preview').src = '';
  document.getElementById('new-product-img-preview-container').classList.add('hidden');
  document.getElementById('new-product-img-placeholder').classList.remove('hidden');

  populateSectorAndCorridorSelects('new-product-sector', 'new-product-corridor');

  // Preenche data padrão de validade (hoje ou vazia)
  const dateInput = document.getElementById('new-product-exp-date');
  if (dateInput) {
    dateInput.value = '';
  }

  // Reseta campos de contagem dos 8 locais
  LOCATIONS.forEach((loc, idx) => {
    const el = document.getElementById(`new-count-${idx}`);
    if (el) el.value = 0;
  });

  updateNewProductTotalCalculation();
  showView('view-product-new');
}

// Atualiza soma ao vivo no novo produto
export function updateNewProductTotalCalculation() {
  let total = 0;
  LOCATIONS.forEach((loc, idx) => {
    const el = document.getElementById(`new-count-${idx}`);
    if (el) total += Number(el.value) || 0;
  });

  const totalDisplay = document.getElementById('new-product-total-display');
  if (totalDisplay) {
    totalDisplay.textContent = formatNumber(total);
  }
}

// Manipula fotos do produto (câmera ou galeria)
export async function handleProductImageFile(file, isEdit = false) {
  if (!file) return;

  try {
    showToast('Processando foto...', 'sync', 1000);
    const compressed = await compressImage(file, 600, 600, 0.72);
    currentProductImage = compressed;

    const prefix = isEdit ? 'edit-product' : 'new-product';
    const preview = document.getElementById(`${prefix}-img-preview`);
    const container = document.getElementById(`${prefix}-img-preview-container`);
    const placeholder = document.getElementById(`${prefix}-img-placeholder`);

    if (preview) preview.src = compressed;
    if (container) container.classList.remove('hidden');
    if (placeholder) placeholder.classList.add('hidden');

    showToast('✓ Foto adicionada', 'success', 1500);
  } catch (err) {
    console.error('Erro ao processar imagem:', err);
    showToast('Erro ao carregar imagem', 'warning');
  }
}

// Salva o novo produto com validações estritas
export async function saveNewProduct() {
  const barcodeInput = document.getElementById('new-product-barcode');
  const nameInput = document.getElementById('new-product-name');
  const sectorSelect = document.getElementById('new-product-sector');
  const corridorSelect = document.getElementById('new-product-corridor');
  const expDateInput = document.getElementById('new-product-exp-date');

  const barcode = barcodeInput ? barcodeInput.value.trim() : '';
  const name = nameInput ? nameInput.value.trim() : '';
  const sector = sectorSelect ? sectorSelect.value : 'MERCEARIA';
  const corridor = corridorSelect ? corridorSelect.value : 'CORREDOR 01';
  let expDate = expDateInput ? expDateInput.value.trim() : '';

  if (!barcode) {
    showToast('⚠ Digite o código de barras', 'warning');
    barcodeInput?.focus();
    return;
  }

  if (!name) {
    showToast('⚠ Digite o nome do produto', 'warning');
    nameInput?.focus();
    return;
  }

  // Validação estrita de código de barras duplicado
  const existing = await getProductByBarcode(barcode);
  if (existing) {
    showDuplicateBarcodeModal(existing);
    return;
  }

  try {
    // 1. Salva o produto
    const savedProd = await saveProduct({
      barcode,
      name: name.toUpperCase(),
      image: currentProductImage,
      sector,
      corridor
    });

    showToast('✓ Produto cadastrado!', 'success');

    // 2. Se informou data de validade, cria a validade e salva as contagens
    if (expDate) {
      // Normaliza se for DD/MM/AAAA para ISO
      if (expDate.includes('/')) {
        expDate = parseDateBRtoISO(expDate);
      }

      const { expiration } = await saveProductExpiration(savedProd.id, expDate);

      // Coleta contagens dos 8 locais
      const locationCounts = {};
      LOCATIONS.forEach((loc, idx) => {
        const input = document.getElementById(`new-count-${idx}`);
        const qty = input ? Number(input.value) || 0 : 0;
        locationCounts[loc] = qty;
      });

      await saveInventoryCounts(savedProd.id, expiration.id, locationCounts);
    }

    // Dispara envio imediato para a nuvem Supabase em segundo plano
    triggerSyncNow().catch((e) => console.warn('Sync background error:', e));

    // Abre diretamente a conferência do produto ou exibe sucesso
    openConferenceForProduct(savedProd);
  } catch (error) {
    console.error('Erro ao salvar produto:', error);
    if (error.existingProduct) {
      showDuplicateBarcodeModal(error.existingProduct);
    } else {
      showToast(`⚠ ${error.message || 'Erro ao salvar produto'}`, 'warning');
    }
  }
}

// Modal de Alerta quando o código de barras já existe
export function showDuplicateBarcodeModal(existingProduct) {
  let modal = document.getElementById('modal-duplicate-barcode');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-duplicate-barcode';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-card">
      <div class="modal-header-warning">
        <span class="warning-icon">⚠</span>
        <h3 class="modal-title">PRODUTO JÁ CADASTRADO</h3>
      </div>
      <p class="modal-desc">Este código de barras já pertence a um produto no sistema.</p>
      
      <div class="duplicate-product-card">
        <div class="compact-product-photo">
          ${
            existingProduct.image
              ? `<img src="${existingProduct.image}" alt="Foto" />`
              : `<div class="photo-placeholder-box"><span>FOTO</span></div>`
          }
        </div>
        <div class="duplicate-product-info">
          <h4 class="product-name">${existingProduct.name}</h4>
          <p class="product-barcode-pill">${existingProduct.barcode}</p>
          <p class="product-loc-text">${existingProduct.sector} · ${existingProduct.corridor}</p>
        </div>
      </div>

      <div class="modal-actions-stacked">
        <button type="button" class="btn-primary" id="btn-open-existing-duplicate">
          [ ABRIR PRODUTO ]
        </button>
        <button type="button" class="btn-secondary" id="btn-cancel-duplicate">
          VOLTAR
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  document.getElementById('btn-open-existing-duplicate').addEventListener('click', () => {
    modal.classList.remove('open');
    openConferenceForProduct(existingProduct);
  });

  document.getElementById('btn-cancel-duplicate').addEventListener('click', () => {
    modal.classList.remove('open');
  });
}

// Abre a visualização completa de detalhes do produto
export async function openProductDetailView(productId) {
  const product = await getProductById(productId);
  if (!product) {
    showToast('⚠ Produto não encontrado', 'warning');
    return;
  }

  const expirations = await getProductExpirations(productId);
  const history = await getHistoryForProduct(productId);
  const locationHistory = await getLocationHistoryForProduct(productId);

  // Calcula estoque total e por local
  const locationSums = {};
  LOCATIONS.forEach((l) => (locationSums[l] = 0));
  let totalStock = 0;

  for (const exp of expirations) {
    const latest = await getLatestCountsForExpiration(exp.id);
    totalStock += latest.total;
    Object.entries(latest.countsByLocation).forEach(([loc, qty]) => {
      locationSums[loc] = (locationSums[loc] || 0) + qty;
    });
  }

  // Renderiza no container
  const detailContainer = document.getElementById('product-detail-content');
  if (detailContainer) {
    detailContainer.innerHTML = `
      <!-- Cabeçalho Compacto do Produto -->
      <div class="product-compact-header-card">
        <div class="product-header-photo-col" id="detail-photo-trigger">
          ${
            product.image
              ? `<img src="${product.image}" alt="${product.name}" class="product-header-thumb" />`
              : `<div class="photo-placeholder-box"><span>FOTO</span></div>`
          }
        </div>
        <div class="product-header-info-col">
          <h2 class="detail-product-name">${product.name}</h2>
          <div class="detail-barcode-row">
            <span class="barcode-badge">${product.barcode}</span>
          </div>
          <div class="detail-location-row">
            <span class="loc-badge sector">${product.sector}</span>
            <span class="loc-badge corridor">${product.corridor}</span>
          </div>
        </div>
      </div>

      <!-- Estoque Atual -->
      <div class="detail-section-card">
        <div class="section-label-header">ESTOQUE ATUAL</div>
        <div class="metric-highlight-number">
          ${formatNumber(totalStock)} <span class="unit-label">UNIDADES</span>
        </div>
      </div>

      <!-- Validades -->
      <div class="detail-section-card">
        <div class="section-label-header">VALIDADES CADASTRADAS</div>
        <div class="expirations-list-group">
          ${
            expirations.length === 0
              ? `<p class="empty-state-text">Nenhuma validade cadastrada ainda.</p>`
              : expirations
                  .map((exp) => {
                    return `
                <div class="exp-item-row">
                  <span class="exp-date-label">📅 ${formatDateBR(exp.expiration_date)}</span>
                  <div class="exp-item-actions">
                    <button type="button" class="btn-count-date-mini" data-expid="${exp.id}" data-prodid="${product.id}">
                      Conferir
                    </button>
                    <button type="button" class="btn-delete-date-mini" data-expid="${exp.id}" data-date="${formatDateBR(exp.expiration_date)}" title="Apagar esta validade">
                      🗑️
                    </button>
                  </div>
                </div>
              `;
                  })
                  .join('')
          }
        </div>
      </div>

      <!-- Localizações -->
      <div class="detail-section-card">
        <div class="section-label-header">LOCALIZAÇÕES</div>
        <div class="locations-grid-stats">
          ${LOCATIONS.map((loc) => {
            const qty = locationSums[loc] || 0;
            return `
              <div class="location-stat-box ${qty > 0 ? 'has-qty' : 'zero-qty'}">
                <span class="loc-name">${loc}</span>
                <span class="loc-qty">${formatNumber(qty)}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Exportar para WhatsApp -->
      <div class="detail-section-card wa-export-card">
        <button type="button" class="btn-whatsapp-action" id="btn-detail-export-wa">
          <span class="wa-btn-icon">📲</span>
          <span class="wa-btn-text">EXPORTAR PARA WHATSAPP</span>
        </button>
      </div>

      <!-- Últimas Conferências e Histórico por Local -->
      <div class="detail-section-card">
        <div class="section-label-header">ÚLTIMAS CONFERÊNCIAS</div>
        ${
          history.length === 0
            ? `<p class="empty-state-text">Nenhuma conferência registrada.</p>`
            : `
          <div class="history-timeline">
            ${history
              .slice(0, 8)
              .map((h) => {
                const dateBR = formatDateBR(h.date ? h.date.split('T')[0] : '');
                return `
                <div class="history-item">
                  <div class="history-item-header">
                    <span class="history-date">${dateBR}</span>
                    <span class="history-total">→ ${formatNumber(h.total)} unidades</span>
                  </div>
                  <div class="history-locations-tags">
                    ${Object.entries(h.locations)
                      .filter(([_, q]) => q > 0)
                      .map(([loc, q]) => `<span class="hist-tag">${loc}: ${q}</span>`)
                      .join('')}
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        `
        }

        <!-- Histórico Específico por Local -->
        <div class="location-movement-history">
          <div class="sub-section-label">HISTÓRICO POR LOCAL</div>
          <div class="location-movements-list">
            ${LOCATIONS.filter((l) => locationHistory[l] && locationHistory[l].length > 0)
              .map((loc) => {
                const moves = locationHistory[loc].slice(0, 4);
                return `
                <div class="loc-move-card">
                  <div class="loc-move-title">${loc}</div>
                  <div class="loc-move-flow">
                    ${moves.map((m) => `${formatDateBR(m.date.split('T')[0])} → <strong>${m.quantity}</strong>`).join('  |  ')}
                  </div>
                </div>
              `;
              })
              .join('')}
          </div>
        </div>
      </div>

      <!-- Ações do Produto -->
      <div class="detail-actions-bottom">
        <button type="button" class="btn-primary" id="btn-detail-make-conference">
          [ 📷 FAZER CONFERÊNCIA ]
        </button>
        <button type="button" class="btn-secondary" id="btn-detail-back">
          VOLTAR
        </button>
        <button type="button" class="btn-danger-outline" id="btn-detail-delete-product">
          🗑️ APAGAR PRODUTO (SENHA 2009)
        </button>
      </div>
    `;

    // Event listeners
    document.getElementById('btn-detail-make-conference')?.addEventListener('click', () => {
      openConferenceForProduct(product);
    });

    document.getElementById('btn-detail-back')?.addEventListener('click', () => {
      showView('view-dashboard');
    });

    // Exportação para WhatsApp
    document.getElementById('btn-detail-export-wa')?.addEventListener('click', () => {
      // Pega a validade mais próxima ou a primeira
      const firstExp = expirations[0];
      const dateBR = firstExp ? formatDateBR(firstExp.expiration_date) : 'NÃO INFORMADA';
      const formatted = formatSingleProductWhatsApp(product.name, product.barcode, dateBR, totalStock);
      openWhatsAppExportModal(formatted, `Exportar ${product.name}`);
    });

    // Apagar Produto Inteiro (Senha 2009)
    document.getElementById('btn-detail-delete-product')?.addEventListener('click', () => {
      promptSecurityPin(
        'APAGAR PRODUTO',
        `Deseja realmente excluir "${product.name}" do sistema? Todas as validades e contagens registradas serão apagadas permanentemente.`,
        async () => {
          showToast('Apagando produto...', 'sync', 1500);
          await deleteProduct(product.id);
          triggerSyncNow().catch((e) => console.warn('Sync background error:', e));
          showToast('✓ Produto apagado com sucesso!', 'success', 2500);
          window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
          showView('view-dashboard');
        }
      );
    });

    if (product.image) {
      document.getElementById('detail-photo-trigger')?.addEventListener('click', () => {
        openPhotoModal(product.image, product.name);
      });
    }

    // Mini buttons para conferir data específica
    document.querySelectorAll('.btn-count-date-mini').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const expId = e.currentTarget.getAttribute('data-expid');
        openConferenceForProduct(product, expId);
      });
    });

    // Mini buttons para APAGAR data específica (Senha 2009)
    document.querySelectorAll('.btn-delete-date-mini').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const expId = e.currentTarget.getAttribute('data-expid');
        const dateStr = e.currentTarget.getAttribute('data-date');
        promptSecurityPin(
          'APAGAR VALIDADE',
          `Deseja excluir a validade ${dateStr} do produto "${product.name}"? As contagens desta data serão removidas.`,
          async () => {
            showToast('Apagando validade...', 'sync', 1500);
            await deleteProductExpiration(expId);
            triggerSyncNow().catch((e) => console.warn('Sync background error:', e));
            showToast('✓ Validade apagada!', 'success', 2000);
            openProductDetailView(product.id);
          }
        );
      });
    });
  }

  showView('view-product-detail');
}
