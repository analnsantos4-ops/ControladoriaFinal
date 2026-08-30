// Gerenciamento de Produtos, Cadastro, Foto e Detalhes
import { SETORS, CORRIDORS, LOCATIONS, compressImage, formatNumber, formatDateBR, parseDateBRtoISO, getTodayISO } from './utils.js';
import { getProductByBarcode, getProductById, saveProduct, saveProductExpiration, saveInventoryCounts, saveCompleteProductWithCounts, getProductExpirations, getLatestCountsForExpiration, getHistoryForProduct, getLocationHistoryForProduct, deleteProduct, deleteProductExpiration, toggleExpirationTriaged, sendProductExpirationToTriage, saveBlitzItem } from './db.js';
import { triggerSyncNow } from './sync.js';
import { showToast, showView, openPhotoModal, promptSecurityPin, promptTriageBarcodeConfirmation } from './ui.js';
import { openConferenceForProduct } from './inventory.js';
import { formatSingleProductWhatsApp, formatMultipleProductsWhatsApp, openWhatsAppExportModal } from './whatsapp.js';

let currentProductImage = '';
let currentNewProductBlitzContext = null;

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

// Inicializa a tela de Novo Produto com código preenchido e suporte a contexto Blitz
export function openNewProductView(barcode = '', prefilledSector = '', prefilledExpDate = '', blitzContext = null) {
  const form = document.getElementById('form-new-product');
  if (form) form.reset();

  currentProductImage = '';
  currentNewProductBlitzContext = blitzContext;

  document.getElementById('new-product-barcode').value = barcode;
  document.getElementById('new-product-img-preview').src = '';
  document.getElementById('new-product-img-preview-container').classList.add('hidden');
  document.getElementById('new-product-img-placeholder').classList.remove('hidden');

  populateSectorAndCorridorSelects('new-product-sector', 'new-product-corridor');

  if (prefilledSector) {
    const secEl = document.getElementById('new-product-sector');
    if (secEl) secEl.value = prefilledSector;
  }

  // Preenche data padrão de validade
  const dateInput = document.getElementById('new-product-exp-date');
  if (dateInput) {
    dateInput.value = prefilledExpDate || '';
  }

  // Reseta campos de contagem dos locais
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

// Salva o novo produto com validações estritas e persistência garantida
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
    showToast('Salvando produto e estoque...', 'sync', 1500);

    // 1. Coleta contagens dos 8 locais
    const locationCounts = {};
    LOCATIONS.forEach((loc, idx) => {
      const input = document.getElementById(`new-count-${idx}`);
      const qty = input ? Number(input.value) || 0 : 0;
      locationCounts[loc] = qty;
    });

    let finalExpDate = expDate ? expDate.trim() : '';
    if (!finalExpDate) {
      finalExpDate = getTodayISO();
    } else if (finalExpDate.includes('/')) {
      finalExpDate = parseDateBRtoISO(finalExpDate);
    }

    // 2. Gravação completa atômica em IndexedDB + fila de sincronização
    const result = await saveCompleteProductWithCounts({
      product: {
        barcode,
        name: name.toUpperCase(),
        image: currentProductImage,
        sector,
        corridor
      },
      expirationDate: finalExpDate,
      locationCounts
    });

    // Se cadastrado no fluxo da Blitz Semanal, registra item como TEM
    if (currentNewProductBlitzContext) {
      try {
        let totalCount = 0;
        Object.values(locationCounts).forEach(v => { totalCount += Number(v) || 0; });

        await saveBlitzItem({
          blitz_session_id: currentNewProductBlitzContext.sessionId,
          product_id: result.product.id,
          barcode: result.product.barcode,
          requested_expiration_date: currentNewProductBlitzContext.requestedDate || finalExpDate,
          result: 'TEM',
          conference_id: result.countRecord?.id || null,
          total_quantity: totalCount
        });
      } catch (errBlitz) {
        console.warn('Erro ao associar novo produto à Blitz:', errBlitz);
      }
      currentNewProductBlitzContext = null;
    }

    showToast('✓ Produto e quantidades gravados!', 'success', 2500);

    // Atualiza estatísticas do dashboard imediatamente
    window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));

    // Dispara envio para Supabase em segundo plano
    triggerSyncNow().catch((e) => console.warn('Sync background error:', e));

    // Abre diretamente os detalhes do produto ou conferência
    openConferenceForProduct(result.product, result.expiration.id);
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
        <span class="smart-msg-badge-icon orange-badge">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
          </svg>
        </span>
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

  // Calcula estoque ativo (na loja) e estoque em triagem
  const locationSums = {};
  LOCATIONS.forEach((l) => (locationSums[l] = 0));
  let totalActiveStock = 0;
  let totalTriagedStock = 0;

  for (const exp of expirations) {
    const latest = await getLatestCountsForExpiration(exp.id);
    exp.unitsTotal = latest.total;
    const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';
    if (isTriaged) {
      totalTriagedStock += latest.total;
    } else {
      totalActiveStock += latest.total;
      Object.entries(latest.countsByLocation).forEach(([loc, qty]) => {
        locationSums[loc] = (locationSums[loc] || 0) + Number(qty);
      });
    }
  }

  // Se não houver contagens em inventory_counts e não estiver tudo em triagem, utiliza os valores gravados no próprio produto
  if (totalActiveStock === 0 && totalTriagedStock === 0 && Number(product.total_quantity) > 0) {
    totalActiveStock = Number(product.total_quantity) || 0;
    locationSums['DEPÓSITO'] = Number(product.deposit_qty) || 0;
    locationSums['GELADEIRA'] = Number(product.fridge_qty) || 0;
    locationSums['PRATELEIRA'] = Number(product.shelf_qty) || 0;
    locationSums['PONTA DE GÔNDOLA'] = Number(product.gondola_end_qty) || 0;
    locationSums['ORELHA'] = Number(product.ear_qty) || 0;
    locationSums['ILHA'] = Number(product.island_qty) || 0;
    locationSums['CARRINHO'] = Number(product.cart_qty) || 0;
    locationSums['FRENTE DE LOJA'] = Number(product.checkout_qty) || 0;
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
            ${
              totalActiveStock === 0 && totalTriagedStock > 0
                ? `<span class="loc-badge tag-triaged" style="font-weight: 800;">📦 RETIRADO P/ TRIAGEM</span>`
                : ''
            }
          </div>
        </div>
      </div>

      <!-- Estoque Atual -->
      <div class="detail-section-card">
        <div class="section-label-header">ESTOQUE ATIVO (GÔNDOLA / DEPÓSITO)</div>
        <div class="metric-highlight-number">
          ${formatNumber(totalActiveStock)} <span class="unit-label">UNIDADES NA LOJA</span>
        </div>
        ${
          totalTriagedStock > 0
            ? `<div style="margin-top: 6px; font-size: 0.8rem; font-weight: 700; color: #eab308; background: rgba(234, 179, 8, 0.1); padding: 4px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                📦 ${formatNumber(totalTriagedStock)} unidades retiradas para a triagem
              </div>`
            : ''
        }
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
                    const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';
                    return `
                <div class="exp-item-row ${isTriaged ? 'row-triaged' : ''}">
                  <div class="exp-item-info">
                    <span class="exp-date-label">📅 ${formatDateBR(exp.expiration_date)}</span>
                    <span class="exp-units-pill">${formatNumber(exp.unitsTotal || 0)} un.</span>
                    ${isTriaged ? `<span class="exp-badge tag-triaged">📦 TRIAGEM</span>` : ''}
                  </div>
                  <div class="exp-item-actions">
                    <button type="button" class="btn-triage-date-mini ${isTriaged ? 'btn-triage-active' : ''}" data-expid="${exp.id}" data-triaged="${isTriaged}" title="${isTriaged ? 'Restaurar ao estoque' : 'Mover para triagem'}">
                      ${isTriaged ? '↩️ Restaurar' : '📦 Triagem'}
                    </button>
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
        <button type="button" class="btn-secondary" id="btn-detail-edit-product" style="border-color: rgba(56, 189, 248, 0.5); color: #38bdf8; font-weight: 800;">
          ✏️ EDITAR PRODUTO (NOME, FOTO, CÓDIGO)
        </button>
        <button type="button" class="btn-secondary" id="btn-detail-back-bottom">
          ← VOLTAR PARA PRODUTOS CADASTRADOS
        </button>
        <button type="button" class="btn-danger-outline" id="btn-detail-delete-product">
          🗑️ APAGAR PRODUTO (SENHA 200902)
        </button>
      </div>
    `;

    // Event listeners
    document.getElementById('btn-detail-make-conference')?.addEventListener('click', () => {
      openConferenceForProduct(product);
    });

    document.getElementById('btn-detail-edit-product')?.addEventListener('click', () => {
      openEditProductModal(product);
    });

    // Retorna para a tela de Produtos Cadastrados (Busca)
    const handleBackToSearch = () => {
      window.dispatchEvent(new CustomEvent('open-search-view'));
    };
    document.getElementById('btn-detail-back-bottom')?.addEventListener('click', handleBackToSearch);
    document.getElementById('btn-detail-header-back')?.addEventListener('click', handleBackToSearch);

    // Exportação para WhatsApp
    document.getElementById('btn-detail-export-wa')?.addEventListener('click', () => {
      // Pega a validade mais próxima ou a primeira
      const firstExp = expirations[0];
      const dateBR = firstExp ? formatDateBR(firstExp.expiration_date) : 'NÃO INFORMADA';
      const formatted = formatSingleProductWhatsApp(product.name, product.barcode, dateBR, totalActiveStock);
      openWhatsAppExportModal(formatted, `Exportar ${product.name}`);
    });

    // Apagar Produto Inteiro (Senha 200902)
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
          window.dispatchEvent(new CustomEvent('open-search-view'));
        }
      );
    });

    if (product.image) {
      document.getElementById('detail-photo-trigger')?.addEventListener('click', () => {
        openPhotoModal(product.image, product.name);
      });
    }

    // Mini buttons para enviar validade específica para Triagem ou Restaurar ao estoque
    document.querySelectorAll('.btn-triage-date-mini').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const expId = e.currentTarget.getAttribute('data-expid');
        const isTriaged = e.currentTarget.getAttribute('data-triaged') === 'true';
        const targetExp = expirations.find((x) => String(x.id) === String(expId));

        if (isTriaged) {
          promptSecurityPin(
            'RESTAURAR AO ESTOQUE',
            `Deseja restaurar esta validade do produto "${product.name}" de volta para o estoque ativo de vendas?`,
            async () => {
              try {
                showToast('Restaurando ao estoque...', 'sync', 1000);
                await toggleExpirationTriaged(expId, false);
                triggerSyncNow().catch((err) => console.warn('Sync background error:', err));
                showToast('✓ Validade restaurada para o estoque ativo!', 'success', 2500);
                window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
                await openProductDetailView(product.id);
              } catch (err) {
                console.error('Erro ao restaurar:', err);
                showToast('Erro ao restaurar validade', 'warning');
              }
            }
          );
          return;
        }

        promptTriageBarcodeConfirmation({
          product,
          expiration: targetExp ? { expiration_date: formatDateBR(targetExp.expiration_date) } : { expiration_date: '' },
          onConfirmed: async () => {
            try {
              showToast('Enviando para triagem...', 'sync', 1000);
              await sendProductExpirationToTriage(product.id, expId);
              triggerSyncNow().catch((err) => console.warn('Sync background error:', err));
              showToast('✓ Código confirmado! Lote retirado da área de vendas e enviado para Triagem.', 'success', 3000);
              window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
              await openProductDetailView(product.id);
            } catch (err) {
              console.error('Erro ao enviar para triagem:', err);
              showToast('Erro ao processar envio para triagem', 'warning');
            }
          }
        });
      });
    });

    // Mini buttons para conferir data específica
    document.querySelectorAll('.btn-count-date-mini').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const expId = e.currentTarget.getAttribute('data-expid');
        openConferenceForProduct(product, expId);
      });
    });

    // Mini buttons para APAGAR data específica (Senha 2002)
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

// ----------------------------------------------------
// MODAL DE EDIÇÃO DE PRODUTO (NOME, FOTO, CÓDIGO DE BARRAS, LOCAL E QUANTIDADES)
// ----------------------------------------------------
export async function openEditProductModal(product) {
  let editModal = document.getElementById('modal-edit-product');
  if (!editModal) {
    editModal = document.createElement('div');
    editModal.id = 'modal-edit-product';
    editModal.className = 'custom-modal';
    document.body.appendChild(editModal);
  }

  let editedImage = product.image || '';

  // Carrega validades e contagens atuais
  const expirations = await getProductExpirations(product.id);
  const primaryExp = expirations.length > 0 ? expirations[0] : null;
  let currentLocCounts = {
    'DEPÓSITO': Number(product.deposit_qty) || 0,
    'GELADEIRA': Number(product.fridge_qty) || 0,
    'PRATELEIRA': Number(product.shelf_qty) || 0,
    'PONTA DE GÔNDOLA': Number(product.gondola_end_qty) || 0,
    'ORELHA': Number(product.ear_qty) || 0,
    'ILHA': Number(product.island_qty) || 0,
    'CARRINHO': Number(product.cart_qty) || 0,
    'FRENTE DE LOJA': Number(product.checkout_qty) || 0
  };

  if (primaryExp) {
    const latest = await getLatestCountsForExpiration(primaryExp.id);
    if (latest.hasPreviousCount) {
      currentLocCounts = { ...currentLocCounts, ...latest.countsByLocation };
    }
  }

  const initialTotal = Object.values(currentLocCounts).reduce((a, b) => a + Number(b || 0), 0);

  editModal.innerHTML = `
    <div class="modal-backdrop" id="modal-edit-backdrop"></div>
    <div class="modal-card" style="max-width: 480px; max-height: 90vh; overflow-y: auto; padding: 18px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 1.3rem;">✏️</span>
          <h3 style="font-size: 1.05rem; font-weight: 800; color: #f4f4f5; margin: 0;">Editar Produto e Estoque</h3>
        </div>
        <button type="button" id="btn-close-edit-modal" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <form id="form-edit-product-modal" autocomplete="off" style="display: flex; flex-direction: column; gap: 12px;">
        <!-- Foto do Produto -->
        <div class="form-group" style="margin-bottom: 4px;">
          <label style="font-size: 0.8rem; font-weight: 700; color: #a1a1aa; display: block; margin-bottom: 6px;">
            Fotografia do Produto:
          </label>
          <div style="display: flex; align-items: center; gap: 12px; background: #18181b; padding: 10px; border-radius: 8px; border: 1px solid #27272a;">
            <div id="edit-modal-photo-preview-box" style="width: 72px; height: 72px; border-radius: 6px; overflow: hidden; background: #09090b; border: 1px solid #3f3f46; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${
                editedImage
                  ? `<img id="edit-modal-img" src="${editedImage}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" />`
                  : `<span id="edit-modal-no-photo" style="font-size: 0.68rem; color: #71717a; font-weight: 700;">SEM FOTO</span>`
              }
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px; flex: 1;">
              <div style="display: flex; gap: 6px;">
                <button type="button" id="btn-edit-photo-camera" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.76rem;">
                  📷 Câmera
                </button>
                <button type="button" id="btn-edit-photo-gallery" class="btn-secondary-mini" style="flex: 1; height: 32px; font-size: 0.76rem;">
                  🖼️ Galeria
                </button>
              </div>
              <button type="button" id="btn-edit-photo-remove" class="btn-secondary-mini" style="height: 28px; font-size: 0.72rem; color: #ef4444; border-color: rgba(239, 68, 68, 0.3);">
                🗑️ Remover Foto
              </button>
              <input type="file" id="file-camera-edit" accept="image/*" capture="environment" class="hidden" />
              <input type="file" id="file-gallery-edit" accept="image/*" class="hidden" />
            </div>
          </div>
        </div>

        <!-- Código de Barras -->
        <div class="form-group" style="margin-bottom: 2px;">
          <label for="edit-prod-barcode" style="font-size: 0.8rem; font-weight: 700; color: #a1a1aa; display: block; margin-bottom: 4px;">
            Código de Barras:
          </label>
          <input
            type="text"
            id="edit-prod-barcode"
            class="form-input"
            value="${product.barcode || ''}"
            required
            style="font-family: monospace; font-size: 1.05rem; font-weight: 700; color: #10b981;"
          />
        </div>

        <!-- Nome do Produto -->
        <div class="form-group" style="margin-bottom: 2px;">
          <label for="edit-prod-name" style="font-size: 0.8rem; font-weight: 700; color: #a1a1aa; display: block; margin-bottom: 4px;">
            Nome do Produto:
          </label>
          <input
            type="text"
            id="edit-prod-name"
            class="form-input"
            value="${product.name || ''}"
            required
            style="text-transform: uppercase; font-weight: 700;"
          />
        </div>

        <!-- Setor e Corredor -->
        <div class="form-row-2col" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
          <div class="form-group">
            <label for="edit-prod-sector" style="font-size: 0.8rem; font-weight: 700; color: #a1a1aa; display: block; margin-bottom: 4px;">Setor:</label>
            <select id="edit-prod-sector" class="form-select"></select>
          </div>
          <div class="form-group">
            <label for="edit-prod-corridor" style="font-size: 0.8rem; font-weight: 700; color: #a1a1aa; display: block; margin-bottom: 4px;">Corredor:</label>
            <select id="edit-prod-corridor" class="form-select"></select>
          </div>
        </div>

        <!-- Ajuste Rápido de Quantidades por Local -->
        <div style="background: #18181b; padding: 10px; border-radius: 8px; border: 1px solid #27272a; margin-top: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 0.78rem; font-weight: 800; color: #38bdf8; text-transform: uppercase;">
              📊 Quantidades por Local:
            </span>
            <span style="font-size: 0.78rem; font-weight: 800; color: #10b981;">
              Total: <strong id="edit-modal-total-display">${initialTotal}</strong> un.
            </span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            ${LOCATIONS.map((loc, idx) => `
              <div style="display: flex; align-items: center; justify-content: space-between; background: #09090b; padding: 4px 8px; border-radius: 6px; border: 1px solid #27272a; gap: 4px;">
                <span style="font-size: 0.7rem; color: #a1a1aa; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;" title="${loc}">${loc}</span>
                <input
                  type="number"
                  min="0"
                  id="edit-loc-count-${idx}"
                  data-location="${loc}"
                  class="form-input edit-loc-input"
                  value="${currentLocCounts[loc] || 0}"
                  onfocus="this.select()"
                  style="width: 68px; min-width: 54px; height: 32px; text-align: center; font-weight: 800; font-size: 1.05rem; padding: 0 4px; border-radius: 5px; background: #000; color: #f4f4f5;"
                />
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Botões de Ação -->
        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px;">
          <button type="button" id="btn-edit-go-conference" class="btn-secondary" style="height: 40px; border-color: rgba(16, 185, 129, 0.4); color: #10b981; font-weight: 700;">
            📦 ABRIR TELA DE CONFERÊNCIA COMPLETA
          </button>
          <div style="display: flex; gap: 8px;">
            <button type="button" id="btn-cancel-edit" class="btn-secondary" style="flex: 1; height: 42px;">
              Cancelar
            </button>
            <button type="submit" id="btn-save-edit" class="btn-primary" style="flex: 1.5; height: 42px; background: #10b981; color: #022c22; font-weight: 800;">
              ✓ SALVAR ALTERAÇÕES
            </button>
          </div>
        </div>
      </form>
    </div>
  `;

  editModal.classList.add('open');

  // Recalculo do total ao vivo no modal de edição
  const updateModalTotal = () => {
    let tot = 0;
    LOCATIONS.forEach((loc, idx) => {
      const el = document.getElementById(`edit-loc-count-${idx}`);
      if (el) tot += Number(el.value) || 0;
    });
    const totDisplay = document.getElementById('edit-modal-total-display');
    if (totDisplay) totDisplay.textContent = formatNumber(tot);
  };

  LOCATIONS.forEach((loc, idx) => {
    document.getElementById(`edit-loc-count-${idx}`)?.addEventListener('input', updateModalTotal);
  });

  // Popula Setor e Corredor com valores selecionados
  populateSectorAndCorridorSelects('edit-prod-sector', 'edit-prod-corridor');
  const sectorEl = document.getElementById('edit-prod-sector');
  const corridorEl = document.getElementById('edit-prod-corridor');
  if (sectorEl) sectorEl.value = product.sector || 'MERCEARIA';
  if (corridorEl) corridorEl.value = product.corridor || 'CORREDOR 01';

  // Gerenciamento de foto na edição
  const fileCamera = document.getElementById('file-camera-edit');
  const fileGallery = document.getElementById('file-gallery-edit');
  const previewBox = document.getElementById('edit-modal-photo-preview-box');

  const updateModalPhotoPreview = (imgData) => {
    editedImage = imgData;
    if (previewBox) {
      if (imgData) {
        previewBox.innerHTML = `<img id="edit-modal-img" src="${imgData}" alt="Foto" style="width: 100%; height: 100%; object-fit: cover;" />`;
      } else {
        previewBox.innerHTML = `<span style="font-size: 0.68rem; color: #71717a; font-weight: 700;">SEM FOTO</span>`;
      }
    }
  };

  document.getElementById('btn-edit-photo-camera')?.addEventListener('click', () => fileCamera?.click());
  document.getElementById('btn-edit-photo-gallery')?.addEventListener('click', () => fileGallery?.click());
  document.getElementById('btn-edit-photo-remove')?.addEventListener('click', () => {
    updateModalPhotoPreview('');
    showToast('Foto removida', 'info', 1500);
  });

  const handleEditFile = async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    try {
      showToast('Processando foto...', 'sync', 1000);
      const compressed = await compressImage(file, 600, 600, 0.72);
      updateModalPhotoPreview(compressed);
      showToast('✓ Foto atualizada', 'success', 1500);
    } catch (err) {
      console.error(err);
      showToast('Erro ao processar imagem', 'warning');
    }
  };

  fileCamera?.addEventListener('change', handleEditFile);
  fileGallery?.addEventListener('change', handleEditFile);

  const closeEditModal = () => editModal.classList.remove('open');
  document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditModal);
  document.getElementById('modal-edit-backdrop')?.addEventListener('click', closeEditModal);
  document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditModal);

  document.getElementById('btn-edit-go-conference')?.addEventListener('click', () => {
    closeEditModal();
    openConferenceForProduct(product);
  });

  // Submissão do Form de Edição
  document.getElementById('form-edit-product-modal')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const barcode = document.getElementById('edit-prod-barcode')?.value?.trim() || '';
    const name = document.getElementById('edit-prod-name')?.value?.trim() || '';
    const sector = sectorEl?.value || 'MERCEARIA';
    const corridor = corridorEl?.value || 'CORREDOR 01';

    if (!barcode) {
      showToast('Código de barras é obrigatório', 'warning');
      return;
    }
    if (!name) {
      showToast('Nome do produto é obrigatório', 'warning');
      return;
    }

    // Se o código de barras mudou, valida se não existe outro produto com o novo código
    if (barcode !== product.barcode) {
      const existingWithBarcode = await getProductByBarcode(barcode);
      if (existingWithBarcode && existingWithBarcode.id !== product.id) {
        showToast('⚠ Este código de barras já pertence a outro produto!', 'warning', 4000);
        return;
      }
    }

    try {
      showToast('Salvando alterações...', 'sync', 1500);

      // Coleta os valores atualizados dos 8 locais
      const newLocCounts = {};
      let updatedTotal = 0;
      LOCATIONS.forEach((loc, idx) => {
        const inp = document.getElementById(`edit-loc-count-${idx}`);
        const q = inp ? Number(inp.value) || 0 : 0;
        newLocCounts[loc] = q;
        updatedTotal += q;
      });

      const updatedProduct = await saveProduct({
        id: product.id,
        barcode,
        name: name.toUpperCase(),
        image: editedImage,
        sector,
        corridor,
        total_quantity: updatedTotal,
        deposit_qty: newLocCounts['DEPÓSITO'] || 0,
        fridge_qty: newLocCounts['GELADEIRA'] || 0,
        shelf_qty: newLocCounts['PRATELEIRA'] || 0,
        gondola_end_qty: newLocCounts['PONTA DE GÔNDOLA'] || 0,
        ear_qty: newLocCounts['ORELHA'] || 0,
        island_qty: newLocCounts['ILHA'] || 0,
        cart_qty: newLocCounts['CARRINHO'] || 0,
        checkout_qty: newLocCounts['FRENTE DE LOJA'] || 0,
        created_at: product.created_at || new Date().toISOString()
      });

      // Salva contagens no registro de validade se existir ou cria um
      let targetExpId = primaryExp ? primaryExp.id : null;
      if (!targetExpId) {
        const { expiration } = await saveProductExpiration(product.id, getTodayISO());
        targetExpId = expiration.id;
      }
      await saveInventoryCounts(product.id, targetExpId, newLocCounts);

      closeEditModal();
      triggerSyncNow().catch((err) => console.warn('Sync error:', err));
      showToast('✓ Alterações salvas com sucesso!', 'success', 2500);

      // Retorna para a tela de Produtos Cadastrados
      window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
      window.dispatchEvent(new CustomEvent('open-search-view'));
    } catch (err) {
      console.error('Erro ao editar produto:', err);
      showToast(`⚠ Erro ao salvar: ${err.message || err}`, 'warning', 3000);
    }
  });
}
