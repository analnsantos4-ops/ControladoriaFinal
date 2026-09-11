// Banco de Dados Local com IndexedDB para Controladoria - Ana Luiza & Angélica
import { generateId, getTodayISO, getDaysUntilExpiration, LOCATIONS, formatDateBR, parseDateBRtoISO } from './utils.js';
import { getCurrentUser } from './auth.js';

const DB_NAME = 'ControladoriaAnaLuizaDB';
const DB_VERSION = 5;

let dbInstance = null;
let dbInitPromise = null;

export function invalidateDB() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (_) {}
  }
  dbInstance = null;
  dbInitPromise = null;
}

export function initDB(force = false) {
  if (force) {
    invalidateDB();
  }
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onblocked = () => {
        console.warn('Conexão com IndexedDB bloqueada por outra aba/processo.');
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Tabela products (barcode UNIQUE)
        if (!db.objectStoreNames.contains('products')) {
          const productStore = db.createObjectStore('products', { keyPath: 'id' });
          productStore.createIndex('barcode', 'barcode', { unique: true });
          productStore.createIndex('sector', 'sector', { unique: false });
          productStore.createIndex('corridor', 'corridor', { unique: false });
          productStore.createIndex('name', 'name', { unique: false });
          productStore.createIndex('updated_at', 'updated_at', { unique: false });
        }

        // 2. Tabela product_expirations (product_id + expiration_date UNIQUE)
        if (!db.objectStoreNames.contains('product_expirations')) {
          const expStore = db.createObjectStore('product_expirations', { keyPath: 'id' });
          expStore.createIndex('product_id', 'product_id', { unique: false });
          expStore.createIndex('expiration_date', 'expiration_date', { unique: false });
          expStore.createIndex('product_and_date', ['product_id', 'expiration_date'], { unique: true });
        }

        // 3. Tabela count_sessions
        if (!db.objectStoreNames.contains('count_sessions')) {
          const sessionStore = db.createObjectStore('count_sessions', { keyPath: 'id' });
          sessionStore.createIndex('date', 'date', { unique: false });
          sessionStore.createIndex('status', 'status', { unique: false });
          sessionStore.createIndex('sector_corridor', ['sector', 'corridor'], { unique: false });
        }

        // 4. Tabela inventory_counts
        if (!db.objectStoreNames.contains('inventory_counts')) {
          const countStore = db.createObjectStore('inventory_counts', { keyPath: 'id' });
          countStore.createIndex('product_id', 'product_id', { unique: false });
          countStore.createIndex('expiration_id', 'expiration_id', { unique: false });
          countStore.createIndex('count_session_id', 'count_session_id', { unique: false });
          countStore.createIndex('counted_at', 'counted_at', { unique: false });
        }

        // 5. Tabela sync_queue
        if (!db.objectStoreNames.contains('sync_queue')) {
          const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
          syncStore.createIndex('synced', 'synced', { unique: false });
          syncStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // 6. Tabela blitz_sessions (Sessões de Blitz Semanal)
        if (!db.objectStoreNames.contains('blitz_sessions')) {
          const blitzStore = db.createObjectStore('blitz_sessions', { keyPath: 'id' });
          blitzStore.createIndex('status', 'status', { unique: false });
          blitzStore.createIndex('blitz_type', 'blitz_type', { unique: false });
          blitzStore.createIndex('started_at', 'started_at', { unique: false });
        }

        // 7. Tabela blitz_items (Itens e conferências da Blitz)
        if (!db.objectStoreNames.contains('blitz_items')) {
          const itemStore = db.createObjectStore('blitz_items', { keyPath: 'id' });
          itemStore.createIndex('blitz_session_id', 'blitz_session_id', { unique: false });
          itemStore.createIndex('product_id', 'product_id', { unique: false });
          itemStore.createIndex('session_product', ['blitz_session_id', 'product_id'], { unique: false });
          itemStore.createIndex('checked_at', 'checked_at', { unique: false });
        }

        // 8. Tabela oficial blitz (Especificação Completa e Auditável)
        if (!db.objectStoreNames.contains('blitz')) {
          const blitzStore = db.createObjectStore('blitz', { keyPath: 'id' });
          blitzStore.createIndex('status', 'status', { unique: false });
          blitzStore.createIndex('setor', 'setor', { unique: false });
          blitzStore.createIndex('data_inicio', 'data_inicio', { unique: false });
          blitzStore.createIndex('data_fim', 'data_fim', { unique: false });
          blitzStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // 9. Tabela oficial blitz_itens (EAN + DATA_DE_VALIDADE)
        if (!db.objectStoreNames.contains('blitz_itens')) {
          const bItensStore = db.createObjectStore('blitz_itens', { keyPath: 'id' });
          bItensStore.createIndex('blitz_id', 'blitz_id', { unique: false });
          bItensStore.createIndex('ean', 'ean', { unique: false });
          bItensStore.createIndex('produto_id', 'produto_id', { unique: false });
          bItensStore.createIndex('status', 'status', { unique: false });
          bItensStore.createIndex('blitz_ean_data', ['blitz_id', 'ean', 'data_validade'], { unique: true });
        }

        // 10. Tabela oficial conferencias_blitz (Registro de cada conferência física)
        if (!db.objectStoreNames.contains('conferencias_blitz')) {
          const confStore = db.createObjectStore('conferencias_blitz', { keyPath: 'id' });
          confStore.createIndex('blitz_id', 'blitz_id', { unique: false });
          confStore.createIndex('blitz_item_id', 'blitz_item_id', { unique: false });
          confStore.createIndex('produto_id', 'produto_id', { unique: false });
          confStore.createIndex('ean', 'ean', { unique: false });
          confStore.createIndex('blitz_produto', ['blitz_id', 'produto_id'], { unique: false });
          confStore.createIndex('blitz_ean', ['blitz_id', 'ean'], { unique: false });
          confStore.createIndex('conferido_em', 'conferido_em', { unique: false });
          confStore.createIndex('sync_status', 'sync_status', { unique: false });
          confStore.createIndex('tipo_conferencia', 'tipo_conferencia', { unique: false });
        } else {
          try {
            const confStore = event.target.transaction.objectStore('conferencias_blitz');
            if (confStore) {
              if (!confStore.indexNames.contains('produto_id')) confStore.createIndex('produto_id', 'produto_id', { unique: false });
              if (!confStore.indexNames.contains('blitz_produto')) confStore.createIndex('blitz_produto', ['blitz_id', 'produto_id'], { unique: false });
              if (!confStore.indexNames.contains('blitz_ean')) confStore.createIndex('blitz_ean', ['blitz_id', 'ean'], { unique: false });
              if (!confStore.indexNames.contains('sync_status')) confStore.createIndex('sync_status', 'sync_status', { unique: false });
            }
          } catch (_) {}
        }

        // 11. Tabela oficial historico_alteracoes (Auditoria Completa e Permanente)
        if (!db.objectStoreNames.contains('historico_alteracoes')) {
          const histStore = db.createObjectStore('historico_alteracoes', { keyPath: 'id' });
          histStore.createIndex('registro_id', 'registro_id', { unique: false });
          histStore.createIndex('tabela', 'tabela', { unique: false });
          histStore.createIndex('created_at', 'created_at', { unique: false });
          histStore.createIndex('usuario', 'usuario', { unique: false });
        }

        // 12. Tabela fotos_produtos (Fotos de cadastro e conferência)
        if (!db.objectStoreNames.contains('fotos_produtos')) {
          const fotoStore = db.createObjectStore('fotos_produtos', { keyPath: 'id' });
          fotoStore.createIndex('produto_id', 'produto_id', { unique: false });
          fotoStore.createIndex('blitz_id', 'blitz_id', { unique: false });
          fotoStore.createIndex('created_at', 'created_at', { unique: false });
        }

        // 13. Tabela oficial auditoria_blitz (Auditoria multiusuária detalhada)
        if (!db.objectStoreNames.contains('auditoria_blitz')) {
          const audStore = db.createObjectStore('auditoria_blitz', { keyPath: 'id' });
          audStore.createIndex('blitz_id', 'blitz_id', { unique: false });
          audStore.createIndex('tabela', 'tabela', { unique: false });
          audStore.createIndex('acao', 'acao', { unique: false });
          audStore.createIndex('responsible_user_id', 'responsible_user_id', { unique: false });
          audStore.createIndex('created_at', 'created_at', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        dbInstance = db;
        dbInitPromise = null;

        db.onclose = () => {
          console.warn('Conexão IndexedDB foi fechada. Resetando instância.');
          dbInstance = null;
          dbInitPromise = null;
        };

        db.onversionchange = () => {
          console.warn('Mudança de versão do IndexedDB. Fechando conexão.');
          try {
            db.close();
          } catch (_) {}
          dbInstance = null;
          dbInitPromise = null;
        };

        db.onerror = (e) => {
          console.warn('Aviso de erro no IndexedDB:', e);
        };

        resolve(db);
      };

      request.onerror = (event) => {
        console.error('Erro ao abrir IndexedDB:', event.target.error);
        dbInstance = null;
        dbInitPromise = null;
        reject(event.target.error);
      };
    } catch (err) {
      console.error('Exceção ao inicializar IndexedDB:', err);
      dbInstance = null;
      dbInitPromise = null;
      reject(err);
    }
  });

  return dbInitPromise;
}

/**
 * Cria uma transação segura com auto-recuperação caso a conexão esteja fechando/fechada.
 */
export async function getSafeTransaction(storeNames, mode = 'readonly') {
  let db = await initDB();
  try {
    const tx = db.transaction(storeNames, mode);
    return { db, tx };
  } catch (err) {
    const errMsg = (err && err.message) ? String(err.message).toLowerCase() : '';
    const isConnError = err && (
      err.name === 'InvalidStateError' ||
      errMsg.includes('closing') ||
      errMsg.includes('closed') ||
      errMsg.includes('connection')
    );
    if (isConnError) {
      console.warn('Conexão com IndexedDB estava fechando/fechada. Reconectando com segurança...');
      dbInstance = null;
      dbInitPromise = null;
      db = await initDB(true);
      const tx = db.transaction(storeNames, mode);
      return { db, tx };
    }
    throw err;
  }
}

// Leitura atômica de todos os itens de uma store
export async function getAllFromStore(storeName) {
  try {
    const { tx } = await getSafeTransaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => {
        console.warn(`Erro no getAll de ${storeName}:`, e.target?.error || e);
        resolve([]);
      };
    });
  } catch (err) {
    console.warn(`Falha de transação em ${storeName}:`, err);
    return [];
  }
}

// ----------------------------------------------------
// PRODUTOS
// ----------------------------------------------------

export async function getProductByBarcode(barcode) {
  if (!barcode) return null;
  try {
    const { tx } = await getSafeTransaction('products', 'readonly');
    const store = tx.objectStore('products');
    const index = store.index('barcode');
    return new Promise((resolve) => {
      const req = index.get(barcode.trim());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function getProductById(id) {
  if (!id) return null;
  try {
    const { tx } = await getSafeTransaction('products', 'readonly');
    const store = tx.objectStore('products');
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function getAllProducts() {
  const products = await getAllFromStore('products');
  products.sort((a, b) => {
    const nameA = (a.name || '').trim();
    const nameB = (b.name || '').trim();
    return nameA.localeCompare(nameB, 'pt-BR', { sensitivity: 'base' });
  });
  return products;
}

/**
 * Produtos registrados: SOMENTE produtos com fotografia, corredor e setor preenchidos.
 */
export function isProductRegistered(product) {
  if (!product) return false;
  const hasPhoto = Boolean(
    (product.image && String(product.image).trim().length > 0) ||
    (product.photo_url && String(product.photo_url).trim().length > 0)
  );
  const hasCorridor = Boolean(product.corridor && String(product.corridor).trim().length > 0);
  const hasSector = Boolean(product.sector && String(product.sector).trim().length > 0 && String(product.sector).trim().toUpperCase() !== 'GERAL');
  return hasPhoto && hasCorridor && hasSector;
}

/**
 * Legado mantido para compatibilidade, 'Verificados' foi descontinuado conforme solicitação.
 */
export function isProductVerifiedOnly(product) {
  return false;
}

/**
 * Determina se o produto é originário do cadastro em massa da Blitz
 * (Produtos exportados da Blitz colocados semanalmente no programa)
 */
export function isProductBlitzImport(product) {
  if (!product) return false;
  return product.is_blitz_import === true ||
         product.origin === 'BLITZ_IMPORT' ||
         product.status === 'LISTA DE BLITZ' ||
         product.status === 'LISTA_DE_BLITZ';
}

export async function searchProducts(searchTerm = '', sectorFilter = '', corridorFilter = '', typeFilter = 'ALL') {
  const all = await getAllProducts();
  const term = searchTerm.toLowerCase().trim();

  const filtered = all.filter((p) => {
    const isReg = isProductRegistered(p);
    const isBlitz = isProductBlitzImport(p);
    const hasUnits = (Number(p.total_quantity) || 0) > 0;

    if (typeFilter === 'REGISTERED' && !isReg) return false;
    if (typeFilter === 'BLITZ' && !isBlitz) return false;
    if (typeFilter === 'WITH_UNITS' && !hasUnits) return false;

    const matchTerm = !term ||
      (p.name && p.name.toLowerCase().includes(term)) ||
      (p.barcode && p.barcode.toLowerCase().includes(term));
    const matchSector = !sectorFilter || sectorFilter === 'TODOS' || p.sector === sectorFilter;
    const matchCorridor = !corridorFilter || corridorFilter === 'TODOS' || p.corridor === corridorFilter;

    return matchTerm && matchSector && matchCorridor;
  });

  // Ordena em ordem alfabética (A-Z) com suporte a acentos
  filtered.sort((a, b) => {
    const nameA = (a.name || '').trim();
    const nameB = (b.name || '').trim();
    return nameA.localeCompare(nameB, 'pt-BR', { sensitivity: 'base' });
  });

  return filtered;
}

// Salva ou atualiza produto garantindo código de barras ÚNICO e mantendo quantidades
export async function saveProduct(product) {
  if (!product.barcode) {
    throw new Error('Código de barras é obrigatório.');
  }

  // Verifica se já existe outro produto com o mesmo barcode
  const existingWithBarcode = await getProductByBarcode(product.barcode);
  if (existingWithBarcode && existingWithBarcode.id !== product.id) {
    const error = new Error('Este código de barras já pertence a outro produto.');
    error.existingProduct = existingWithBarcode;
    throw error;
  }

  const now = new Date().toISOString();
  const existing = product.id ? await getProductById(product.id) : null;

  const depositQty = Number(product.deposit_qty !== undefined ? product.deposit_qty : (existing?.deposit_qty || 0));
  const fridgeQty = Number(product.fridge_qty !== undefined ? product.fridge_qty : (existing?.fridge_qty || 0));
  const shelfQty = Number(product.shelf_qty !== undefined ? product.shelf_qty : (existing?.shelf_qty || 0));
  const gondolaEndQty = Number(product.gondola_end_qty !== undefined ? product.gondola_end_qty : (existing?.gondola_end_qty || 0));
  const earQty = Number(product.ear_qty !== undefined ? product.ear_qty : (existing?.ear_qty || 0));
  const islandQty = Number(product.island_qty !== undefined ? product.island_qty : (existing?.island_qty || 0));
  const cartQty = Number(product.cart_qty !== undefined ? product.cart_qty : (existing?.cart_qty || 0));
  const checkoutQty = Number(product.checkout_qty !== undefined ? product.checkout_qty : (existing?.checkout_qty || 0));

  const totalQty = product.total_quantity !== undefined
    ? Number(product.total_quantity)
    : (depositQty + fridgeQty + shelfQty + gondolaEndQty + earQty + islandQty + cartQty + checkoutQty);

  // Determina se o produto é classificado como apenas verificado
  let isVerified = false;
  const rawName = product.name ? product.name.trim().toUpperCase() : '';
  const rawCode = product.barcode.trim().toUpperCase();
  if (product.is_verified_only !== undefined) {
    isVerified = Boolean(product.is_verified_only);
  } else if (!rawName || rawName === rawCode || rawName === `PRODUTO ${rawCode}` || (rawName.startsWith('PRODUTO ') && rawName.includes(rawCode))) {
    isVerified = true;
  } else if (existing && existing.is_verified_only && (!rawName || rawName === rawCode || (rawName.startsWith('PRODUTO ') && rawName.includes(rawCode)))) {
    isVerified = true;
  } else {
    isVerified = false;
  }

  const photoVal = product.image || product.photo_url || existing?.image || existing?.photo_url || '';
  const productData = {
    id: product.id || generateId(),
    barcode: product.barcode.trim(),
    name: product.name ? product.name.trim() : '',
    image: photoVal,
    photo_url: photoVal,
    sector: product.sector || existing?.sector || 'MERCEARIA',
    corridor: product.corridor !== undefined ? product.corridor : (existing?.corridor !== undefined ? existing.corridor : null),
    status: product.status || existing?.status || (isVerified ? 'VERIFICADO' : 'LISTA_DE_BLITZ'),
    is_verified_only: isVerified,
    total_quantity: totalQty,
    deposit_qty: depositQty,
    fridge_qty: fridgeQty,
    shelf_qty: shelfQty,
    gondola_end_qty: gondolaEndQty,
    ear_qty: earQty,
    island_qty: islandQty,
    cart_qty: cartQty,
    checkout_qty: checkoutQty,
    last_expiration_date: product.last_expiration_date || existing?.last_expiration_date || null,
    last_count_date: product.last_count_date || existing?.last_count_date || now,
    created_at: product.created_at || existing?.created_at || now,
    updated_at: now
  };

  try {
    const { tx } = await getSafeTransaction(['products', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const productStore = tx.objectStore('products');
        const syncStore = tx.objectStore('sync_queue');

        productStore.put(productData);

        // Adiciona na fila de sincronização
        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'products',
          record_id: productData.id,
          payload: productData,
          created_at: now,
          synced: 0
        });

        tx.oncomplete = () => resolve(productData);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    throw err;
  }
}

/**
 * Cadastro em massa de produtos para a Blitz (ou catálogo geral)
 * Regras:
 * - Código de barras é o identificador principal (não duplica produto se já existir)
 * - Vincula ao setor selecionado
 * - Corredor fica vazio (null)
 * - Não exige validade, quantidade, foto ou localização
 * - Não cria registro de validade
 * - Status inicial: "LISTA_DE_BLITZ"
 */
export async function bulkRegisterBlitzProducts({ items, sector = 'MERCEARIA' }) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { total: 0, created: 0, updated: 0, products: [] };
  }

  const now = new Date().toISOString();
  const normalizedSector = String(sector || 'MERCEARIA').trim().toUpperCase();

  // Obtém todos os produtos existentes para consulta por código de barras
  const allExisting = await getAllProducts();
  const barcodeMap = new Map();
  allExisting.forEach(p => {
    if (p.barcode) {
      barcodeMap.set(String(p.barcode).trim(), p);
    }
  });

  const { tx } = await getSafeTransaction(['products', 'sync_queue'], 'readwrite');

  return new Promise((resolve, reject) => {
    try {
      const productStore = tx.objectStore('products');
      const syncStore = tx.objectStore('sync_queue');

      let createdCount = 0;
      let updatedCount = 0;
      const savedProducts = [];

      for (const item of items) {
        const cleanBarcode = String(item.barcode || '').trim();
        if (!cleanBarcode) continue;

        const cleanName = String(item.name || '').trim().toUpperCase();
        const existing = barcodeMap.get(cleanBarcode);

        if (existing) {
          // PRODUTO JÁ EXISTE NO BANCO: NÃO DUPLICAR!
          // Apenas atualiza nome se o existente estiver genérico ou vazio
          if (cleanName && (!existing.name || existing.name === cleanBarcode || existing.name === `PRODUTO ${cleanBarcode}`)) {
            existing.name = cleanName;
          }
          existing.sector = normalizedSector;
          // Se ainda não estiver verificado, garante o status de lista de blitz
          if (!existing.status || existing.status === 'LISTA_DE_BLITZ') {
            existing.status = 'LISTA_DE_BLITZ';
            existing.is_blitz_import = true;
            existing.origin = 'BLITZ_IMPORT';
          }
          existing.updated_at = now;

          productStore.put(existing);
          syncStore.add({
            id: generateId(),
            operation: 'UPSERT',
            table_name: 'products',
            record_id: existing.id,
            payload: existing,
            created_at: now,
            synced: 0
          });

          updatedCount++;
          savedProducts.push(existing);
        } else {
          // NOVO PRODUTO CADASTRADO EM MASSA
          const newProduct = {
            id: generateId(),
            barcode: cleanBarcode,
            name: cleanName || `PRODUTO ${cleanBarcode}`,
            sector: normalizedSector,
            corridor: null, // Corredor vazio conforme especificação
            status: 'LISTA_DE_BLITZ', // Status inicial obrigatório
            is_blitz_import: true, // Separado dos registrados, fica em (produtos exportados da blitz)
            origin: 'BLITZ_IMPORT',
            image: null,
            is_verified_only: false,
            total_quantity: 0,
            deposit_qty: 0,
            fridge_qty: 0,
            shelf_qty: 0,
            gondola_end_qty: 0,
            ear_qty: 0,
            island_qty: 0,
            cart_qty: 0,
            checkout_qty: 0,
            last_expiration_date: null,
            last_count_date: now,
            created_at: now,
            updated_at: now
          };

          productStore.put(newProduct);
          syncStore.add({
            id: generateId(),
            operation: 'UPSERT',
            table_name: 'products',
            record_id: newProduct.id,
            payload: newProduct,
            created_at: now,
            synced: 0
          });

          barcodeMap.set(cleanBarcode, newProduct);
          createdCount++;
          savedProducts.push(newProduct);
        }
      }

      tx.oncomplete = () => {
        resolve({
          total: savedProducts.length,
          created: createdCount,
          updated: updatedCount,
          products: savedProducts
        });
      };
      tx.onerror = (e) => reject(e.target?.error || e);
    } catch (e) {
      reject(e);
    }
  });
}

export async function updateProductCorridor(productId, corridor) {
  const product = await getProductById(productId);
  if (!product) return null;
  product.corridor = corridor ? String(corridor).trim() : null;
  product.updated_at = new Date().toISOString();
  return await saveProduct(product);
}

export async function updateProductStatus(productId, status) {
  const product = await getProductById(productId);
  if (!product) return null;
  product.status = status;
  product.updated_at = new Date().toISOString();
  return await saveProduct(product);
}

// Exclui um produto por completo (produto, todas as validades e contagens)
export async function deleteProduct(productId) {
  if (!productId) return false;
  const now = new Date().toISOString();

  // 1. Busca todas as validades e contagens antes de deletar
  const expirations = await getProductExpirations(productId);
  const counts = await new Promise(async (resolve) => {
    try {
      const { tx } = await getSafeTransaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('product_id');
      const req = index.getAll(productId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });

  try {
    const { tx } = await getSafeTransaction(['products', 'product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const prodStore = tx.objectStore('products');
        const expStore = tx.objectStore('product_expirations');
        const countStore = tx.objectStore('inventory_counts');
        const syncStore = tx.objectStore('sync_queue');

        // Remove o produto
        prodStore.delete(productId);
        syncStore.add({
          id: generateId(),
          operation: 'DELETE',
          table_name: 'products',
          record_id: productId,
          payload: { id: productId },
          created_at: now,
          synced: 0
        });

        // Remove as validades associadas
        expirations.forEach((exp) => {
          expStore.delete(exp.id);
          syncStore.add({
            id: generateId(),
            operation: 'DELETE',
            table_name: 'product_expirations',
            record_id: exp.id,
            payload: { id: exp.id },
            created_at: now,
            synced: 0
          });
        });

        // Remove as contagens associadas
        counts.forEach((cnt) => {
          countStore.delete(cnt.id);
          syncStore.add({
            id: generateId(),
            operation: 'DELETE',
            table_name: 'inventory_counts',
            record_id: cnt.id,
            payload: { id: cnt.id },
            created_at: now,
            synced: 0
          });
        });

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    console.error('Erro ao deletar produto:', err);
    return false;
  }
}

// Exclui uma data de validade específica e suas contagens
export async function deleteProductExpiration(expirationId) {
  if (!expirationId) return false;
  const now = new Date().toISOString();

  // 1. Descobre o product_id da validade antes de deletar
  let productId = null;
  try {
    const { tx } = await getSafeTransaction('product_expirations', 'readonly');
    const store = tx.objectStore('product_expirations');
    const expObj = await new Promise((resolve) => {
      const req = store.get(expirationId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
    if (expObj && expObj.product_id) {
      productId = expObj.product_id;
    }
  } catch (e) {
    // ignora
  }

  // 2. Busca contagens dessa validade
  const counts = await new Promise(async (resolve) => {
    try {
      const { tx } = await getSafeTransaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('expiration_id');
      const req = index.getAll(expirationId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });

  try {
    const { tx } = await getSafeTransaction(['product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
    await new Promise((resolve, reject) => {
      try {
        const expStore = tx.objectStore('product_expirations');
        const countStore = tx.objectStore('inventory_counts');
        const syncStore = tx.objectStore('sync_queue');

        // Remove a validade
        expStore.delete(expirationId);
        syncStore.add({
          id: generateId(),
          operation: 'DELETE',
          table_name: 'product_expirations',
          record_id: expirationId,
          payload: { id: expirationId },
          created_at: now,
          synced: 0
        });

        // Remove contagens associadas
        counts.forEach((cnt) => {
          countStore.delete(cnt.id);
          syncStore.add({
            id: generateId(),
            operation: 'DELETE',
            table_name: 'inventory_counts',
            record_id: cnt.id,
            payload: { id: cnt.id },
            created_at: now,
            synced: 0
          });
        });

        tx.oncomplete = () => resolve(true);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });

    // 3. Atualiza o produto pai para recalcular estoque e validade mais próxima
    if (productId) {
      await updateProductAfterExpirationRemoved(productId);
    }

    return true;
  } catch (err) {
    console.error('Erro ao deletar validade:', err);
    return false;
  }
}

/**
 * Atualiza o produto pai quando uma validade é excluída ou expurgada:
 * Se sobrarem outras validades ativas, recalcula o estoque e aponta para a data mais próxima.
 * Se não sobrar nenhuma data ativa, zera estoques e last_expiration_date, preservando o produto.
 */
export async function updateProductAfterExpirationRemoved(productId) {
  if (!productId) return;
  try {
    const product = await getProductById(productId);
    if (!product) return;

    const allExps = await getProductExpirations(productId);
    const activeExps = (allExps || []).filter(
      (e) => !(e.is_triaged === true || e.is_triaged === 1 || e.is_triaged === 'true')
    );

    if (activeExps.length > 0) {
      const locationSums = {};
      LOCATIONS.forEach((l) => (locationSums[l] = 0));
      let newTotal = 0;

      for (const exp of activeExps) {
        const counts = await getLatestCountsForExpiration(exp.id);
        newTotal += counts.total || 0;
        Object.entries(counts.countsByLocation || {}).forEach(([loc, qty]) => {
          locationSums[loc] = (locationSums[loc] || 0) + Number(qty);
        });
      }

      activeExps.sort((a, b) => (a.expiration_date > b.expiration_date ? 1 : -1));
      const earliestExp = activeExps[0];

      product.total_quantity = newTotal;
      product.deposit_qty = locationSums['DEPÓSITO'] || 0;
      product.fridge_qty = locationSums['GELADEIRA'] || 0;
      product.shelf_qty = locationSums['PRATELEIRA'] || 0;
      product.gondola_end_qty = locationSums['PONTA DE GÔNDOLA'] || 0;
      product.ear_qty = locationSums['ORELHA'] || 0;
      product.island_qty = locationSums['ILHA'] || 0;
      product.cart_qty = locationSums['CARRINHO'] || 0;
      product.checkout_qty = locationSums['FRENTE DE LOJA'] || 0;
      product.last_expiration_date = earliestExp ? earliestExp.expiration_date : null;
      product.updated_at = new Date().toISOString();

      await saveProduct(product);
    } else {
      product.total_quantity = 0;
      product.deposit_qty = 0;
      product.fridge_qty = 0;
      product.shelf_qty = 0;
      product.gondola_end_qty = 0;
      product.ear_qty = 0;
      product.island_qty = 0;
      product.cart_qty = 0;
      product.checkout_qty = 0;
      product.last_expiration_date = null;
      product.updated_at = new Date().toISOString();

      await saveProduct(product);
    }
  } catch (err) {
    console.warn('[updateProductAfterExpirationRemoved Error]:', err);
  }
}

// ----------------------------------------------------
// VALIDADES DO PRODUTO (product_expirations)
// ----------------------------------------------------

export async function getAllExpirations() {
  return getAllFromStore('product_expirations');
}

export async function getProductExpirations(productId) {
  if (!productId) return [];
  try {
    const { tx } = await getSafeTransaction('product_expirations', 'readonly');
    const store = tx.objectStore('product_expirations');
    const index = store.index('product_id');
    return new Promise((resolve) => {
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const results = req.result || [];
        // Ordena por data de validade mais próxima
        results.sort((a, b) => (a.expiration_date > b.expiration_date ? 1 : -1));
        resolve(results);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function getExpirationByProductAndDate(productId, expirationDate) {
  if (!productId || !expirationDate) return null;
  try {
    const { tx } = await getSafeTransaction('product_expirations', 'readonly');
    const store = tx.objectStore('product_expirations');
    const index = store.index('product_and_date');
    return new Promise((resolve) => {
      const req = index.get([productId, expirationDate]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function saveProductExpiration(productIdOrObj, expirationDateArg = null) {
  let productId = productIdOrObj;
  let expirationDate = expirationDateArg;

  if (typeof productIdOrObj === 'object' && productIdOrObj !== null) {
    productId = productIdOrObj.product_id || productIdOrObj.productId;
    expirationDate = productIdOrObj.expiration_date || productIdOrObj.expirationDate;
  }

  if (!productId || !expirationDate) {
    return { isNew: false, expiration: null };
  }

  // Normaliza formato da data se vier como YYYY-MM-DDTHH... ou DD/MM/YYYY
  if (expirationDate.includes('T')) {
    expirationDate = expirationDate.split('T')[0];
  }

  const existing = await getExpirationByProductAndDate(productId, expirationDate);
  if (existing) {
    return { isNew: false, expiration: existing };
  }

  const now = new Date().toISOString();
  const expData = {
    id: generateId(),
    product_id: productId,
    expiration_date: expirationDate,
    created_at: now,
    updated_at: now
  };

  try {
    const { tx } = await getSafeTransaction(['product_expirations', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const expStore = tx.objectStore('product_expirations');
        const syncStore = tx.objectStore('sync_queue');

        expStore.put(expData);

        syncStore.add({
          id: generateId(),
          operation: 'INSERT',
          table_name: 'product_expirations',
          record_id: expData.id,
          payload: expData,
          created_at: now,
          synced: 0
        });

        tx.oncomplete = () => resolve({ isNew: true, expiration: expData });
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    throw err;
  }
}

// ----------------------------------------------------
// CONTAGENS DE INVENTÁRIO (inventory_counts)
// ----------------------------------------------------

export async function getAllCounts() {
  return getAllFromStore('inventory_counts');
}

// // Retorna as contagens mais recentes para cada local de uma validade específica
export async function getLatestCountsForExpiration(expirationId) {
  if (!expirationId) {
    return { countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false };
  }
  try {
    const { tx } = await getSafeTransaction('inventory_counts', 'readonly');
    const store = tx.objectStore('inventory_counts');
    const index = store.index('expiration_id');
    return new Promise((resolve) => {
      const req = index.getAll(expirationId);
      req.onsuccess = () => {
        const counts = req.result || [];
        if (counts.length === 0) {
          resolve({
            countsByLocation: {},
            total: 0,
            lastCountDate: null,
            hasPreviousCount: false
          });
          return;
        }

        const sorted = counts.sort((a, b) => new Date(b.counted_at || b.created_at).getTime() - new Date(a.counted_at || a.created_at).getTime());
        const mostRecent = sorted[0];

        const latestByLocation = {};
        let total = 0;
        counts.forEach((item) => {
          if (!latestByLocation[item.location_type] || 
              new Date(item.counted_at || item.created_at) > new Date(latestByLocation[item.location_type].counted_at || latestByLocation[item.location_type].created_at)) {
            latestByLocation[item.location_type] = item;
          }
        });

        const simpleCounts = {};
        Object.keys(latestByLocation).forEach((loc) => {
          const q = Number(latestByLocation[loc].quantity) || 0;
          simpleCounts[loc] = q;
          total += q;
        });

        resolve({
          countsByLocation: simpleCounts,
          total,
          lastCountDate: mostRecent ? (mostRecent.counted_at || mostRecent.created_at) : null,
          hasPreviousCount: true
        });
      };
      req.onerror = () => resolve({ countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false });
    });
  } catch (e) {
    return { countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false };
  }
}

// Salva uma nova rodada de conferência para um produto e validade, atualizando também a tabela de produtos
export async function saveInventoryCounts(productId, expirationId, locationCounts, sessionId = null) {
  const now = new Date().toISOString();

  const countRecords = [];
  let totalCount = 0;

  const locQtyMap = {
    'DEPÓSITO': 0,
    'GELADEIRA': 0,
    'PRATELEIRA': 0,
    'PONTA DE GÔNDOLA': 0,
    'ORELHA': 0,
    'ILHA': 0,
    'CARRINHO': 0,
    'FRENTE DE LOJA': 0
  };

  Object.entries(locationCounts).forEach(([locationType, qty]) => {
    const quantity = Number(qty) || 0;
    totalCount += quantity;
    if (locQtyMap[locationType] !== undefined) {
      locQtyMap[locationType] = quantity;
    }
    countRecords.push({
      id: generateId(),
      product_id: productId,
      expiration_id: expirationId,
      count_session_id: sessionId || null,
      location_type: locationType,
      quantity,
      counted_at: now,
      created_at: now,
      updated_at: now
    });
  });

  try {
    const { tx } = await getSafeTransaction(['products', 'inventory_counts', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const prodStore = tx.objectStore('products');
        const countStore = tx.objectStore('inventory_counts');
        const syncStore = tx.objectStore('sync_queue');

        // 1. Atualiza o produto pai com os totais e locais diretamente
        const prodReq = prodStore.get(productId);
        prodReq.onsuccess = () => {
          if (prodReq.result) {
            const prod = prodReq.result;
            prod.total_quantity = totalCount;
            prod.deposit_qty = locQtyMap['DEPÓSITO'] || 0;
            prod.fridge_qty = locQtyMap['GELADEIRA'] || 0;
            prod.shelf_qty = locQtyMap['PRATELEIRA'] || 0;
            prod.gondola_end_qty = locQtyMap['PONTA DE GÔNDOLA'] || 0;
            prod.ear_qty = locQtyMap['ORELHA'] || 0;
            prod.island_qty = locQtyMap['ILHA'] || 0;
            prod.cart_qty = locQtyMap['CARRINHO'] || 0;
            prod.checkout_qty = locQtyMap['FRENTE DE LOJA'] || 0;
            prod.last_count_date = now;
            prod.updated_at = now;

            prodStore.put(prod);

            syncStore.add({
              id: generateId(),
              operation: 'UPSERT',
              table_name: 'products',
              record_id: prod.id,
              payload: prod,
              created_at: now,
              synced: 0
            });
          }

          // 2. Salva os registros em inventory_counts após o produto
          countRecords.forEach((record) => {
            countStore.add(record);
            syncStore.add({
              id: generateId(),
              operation: 'INSERT',
              table_name: 'inventory_counts',
              record_id: record.id,
              payload: record,
              created_at: now,
              synced: 0
            });
          });
        };

        tx.oncomplete = () => {
          invalidateMetricsCache();
          resolve({ total: totalCount, countDate: now });
        };
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    throw err;
  }
}

// Salva Produto, Validade e Contagem em UMA ÚNICA transação atômica
export async function saveCompleteProductWithCounts({ product, expirationDate, locationCounts }) {
  const now = new Date().toISOString();

  let deposit = Number(locationCounts['DEPÓSITO'] || 0);
  let fridge = Number(locationCounts['GELADEIRA'] || 0);
  let shelf = Number(locationCounts['PRATELEIRA'] || 0);
  let gondola = Number(locationCounts['PONTA DE GÔNDOLA'] || 0);
  let ear = Number(locationCounts['ORELHA'] || 0);
  let island = Number(locationCounts['ILHA'] || 0);
  let cart = Number(locationCounts['CARRINHO'] || 0);
  let checkout = Number(locationCounts['FRENTE DE LOJA'] || 0);
  let totalQty = deposit + fridge + shelf + gondola + ear + island + cart + checkout;

  const productId = product.id || generateId();
  const expirationId = generateId();

  const productData = {
    id: productId,
    barcode: product.barcode.trim(),
    name: product.name ? product.name.trim().toUpperCase() : '',
    image: product.image || '',
    sector: product.sector || 'MERCEARIA',
    corridor: product.corridor || 'Corredor 1',
    total_quantity: totalQty,
    deposit_qty: deposit,
    fridge_qty: fridge,
    shelf_qty: shelf,
    gondola_end_qty: gondola,
    ear_qty: ear,
    island_qty: island,
    cart_qty: cart,
    checkout_qty: checkout,
    last_expiration_date: expirationDate || null,
    last_count_date: now,
    created_at: product.created_at || now,
    updated_at: now
  };

  const expirationData = {
    id: expirationId,
    product_id: productId,
    expiration_date: expirationDate || getTodayISO(),
    created_at: now,
    updated_at: now
  };

  const countRecords = Object.entries(locationCounts).map(([loc, qty]) => ({
    id: generateId(),
    product_id: productId,
    expiration_id: expirationId,
    count_session_id: null,
    location_type: loc,
    quantity: Number(qty) || 0,
    counted_at: now,
    created_at: now,
    updated_at: now
  }));

  try {
    const { tx } = await getSafeTransaction(['products', 'product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const prodStore = tx.objectStore('products');
        const expStore = tx.objectStore('product_expirations');
        const countStore = tx.objectStore('inventory_counts');
        const syncStore = tx.objectStore('sync_queue');

        // 1. Salva Produto
        prodStore.put(productData);
        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'products',
          record_id: productId,
          payload: productData,
          created_at: now,
          synced: 0
        });

        // 2. Salva Validade
        expStore.put(expirationData);
        syncStore.add({
          id: generateId(),
          operation: 'INSERT',
          table_name: 'product_expirations',
          record_id: expirationId,
          payload: expirationData,
          created_at: now,
          synced: 0
        });

        // 3. Salva Contagens dos 8 Locais
        countRecords.forEach((cnt) => {
          countStore.add(cnt);
          syncStore.add({
            id: generateId(),
            operation: 'INSERT',
            table_name: 'inventory_counts',
            record_id: cnt.id,
            payload: cnt,
            created_at: now,
            synced: 0
          });
        });

        tx.oncomplete = () => {
          invalidateMetricsCache();
          resolve({
            product: productData,
            expiration: expirationData,
            counts: countRecords,
            total: totalQty
          });
        };
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    throw err;
  }
}

// Retorna histórico completo de um produto (datas, totais, blitzes e detalhamento por local)
export async function getHistoryForProduct(productId, barcode = null) {
  if (!productId && !barcode) return [];
  try {
    const historyMap = {};

    // 1. Busca em inventory_counts
    if (productId) {
      const { tx } = await getSafeTransaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('product_id');
      const counts = await new Promise((resolve) => {
        const req = index.getAll(productId);
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });

      counts.forEach((item) => {
        const dateKey = item.counted_at ? item.counted_at.substring(0, 16) : (item.created_at ? item.created_at.substring(0, 16) : 'data');
        if (!historyMap[dateKey]) {
          historyMap[dateKey] = {
            date: item.counted_at || item.created_at,
            locations: {},
            total: 0,
            expirationId: item.expiration_id,
            origin: 'inventario'
          };
        }
        const q = Number(item.quantity) || 0;
        historyMap[dateKey].locations[item.location_type] = (historyMap[dateKey].locations[item.location_type] || 0) + q;
        historyMap[dateKey].total += q;
      });
    }

    // 2. Busca em blitz_items para que conferências de Blitz também componham o histórico semanal do produto
    let blitzList = [];
    if (productId) {
      blitzList = await getAllBlitzItemsForProduct(productId);
    }
    if (barcode) {
      const bList = await getAllBlitzItemsForBarcode(barcode);
      bList.forEach(b => {
        if (!blitzList.some(item => item.id === b.id)) {
          blitzList.push(b);
        }
      });
    }

    blitzList.forEach((bItem) => {
      const bDate = bItem.checked_at || bItem.created_at || new Date().toISOString();
      const dateKey = `blitz_${bDate.substring(0, 16)}_${bItem.requested_expiration_date || ''}`;
      if (!historyMap[dateKey]) {
        const locs = {};
        if (bItem.locations && Array.isArray(bItem.locations)) {
          bItem.locations.forEach(l => {
            locs[l.location] = Number(l.quantity) || 0;
          });
        }
        historyMap[dateKey] = {
          date: bDate,
          locations: locs,
          total: Number(bItem.total_quantity) || 0,
          requestedDate: bItem.requested_expiration_date,
          result: bItem.result,
          userName: bItem.user_name,
          origin: 'blitz'
        };
      }
    });

    return Object.values(historyMap).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (e) {
    return [];
  }
}

// Retorna histórico por local para saber exatamente o que mudou (Ex: DEPÓSITO 04/08->90, 11/08->110)
export async function getLocationHistoryForProduct(productId) {
  const history = await getHistoryForProduct(productId);
  const locationBreakdown = {};

  history.forEach((entry) => {
    Object.entries(entry.locations).forEach(([loc, qty]) => {
      if (!locationBreakdown[loc]) {
        locationBreakdown[loc] = [];
      }
      locationBreakdown[loc].push({
        date: entry.date,
        quantity: qty
      });
    });
  });

  return locationBreakdown;
}

// ----------------------------------------------------
// MÉTRICAS DO DASHBOARD INTELIGENTE COM CACHE ULTRA RÁPIDO
// ----------------------------------------------------

let cachedMetrics = null;
let lastMetricsCalculationTime = 0;
const METRICS_CACHE_TTL = 1500; // 1.5 segundos de cache para evitar leituras repetidas em rajada

const metricsCacheMap = new Map();

export function invalidateMetricsCache() {
  cachedMetrics = null;
  metricsCacheMap.clear();
  lastMetricsCalculationTime = 0;
}

export async function getDashboardMetrics(sectorFilter = null) {
  const cleanFilter = Array.isArray(sectorFilter) && sectorFilter.length > 0
    ? sectorFilter.map(s => String(s).trim().toUpperCase())
    : null;
  const cacheKey = cleanFilter ? cleanFilter.slice().sort().join('|') : '__all__';

  const now = Date.now();
  const cached = metricsCacheMap.get(cacheKey);
  if (cached && (now - cached.timestamp < METRICS_CACHE_TTL)) {
    return cached.data;
  }

  await runAutomaticTriageCleanup();

  // Carrega produtos, validades e histórico de contagens recentes
  const [allProductsRaw, allExpirations, allCounts] = await Promise.all([
    getAllProducts(),
    getAllExpirations(),
    getAllCounts()
  ]);

  // Aplica filtro de setores se fornecido (ex: setores da Angélica ou Ana Luiza)
  const products = cleanFilter
    ? allProductsRaw.filter((p) => {
        const pSec = String(p.sector || '').trim().toUpperCase();
        return cleanFilter.some(s => s === pSec || (s.includes('LIMPEZA') && pSec.includes('LIMPEZA')));
      })
    : allProductsRaw;

  // Mapeia produto por id
  const productMap = {};
  let totalAllUnits = 0;
  products.forEach((p) => {
    productMap[p.id] = p;
    totalAllUnits += Number(p.total_quantity) || 0;
  });

  // Mapeia contagens recentes por expiration_id para determinar a quantidade precisa de cada lote/data
  const latestCountByExp = {};
  allCounts.forEach((item) => {
    if (!item.expiration_id) return;
    if (!latestCountByExp[item.expiration_id]) {
      latestCountByExp[item.expiration_id] = {};
    }
    const locMap = latestCountByExp[item.expiration_id];
    const prev = locMap[item.location_type];
    const itemTime = new Date(item.counted_at || item.created_at || 0).getTime();
    const prevTime = prev ? new Date(prev.counted_at || prev.created_at || 0).getTime() : 0;
    if (!prev || itemTime >= prevTime) {
      locMap[item.location_type] = item;
    }
  });

  const expQuantityMap = {};
  Object.entries(latestCountByExp).forEach(([expId, locMap]) => {
    let sum = 0;
    Object.values(locMap).forEach((rec) => {
      sum += Number(rec.quantity) || 0;
    });
    expQuantityMap[expId] = sum;
  });

  // Categorização das validades
  const expiredProductsSet = new Set();
  let expiredUnits = 0;

  const upTo15DaysProductsSet = new Set();
  let upTo15DaysUnits = 0;

  const upTo30DaysProductsSet = new Set();
  let upTo30DaysUnits = 0;

  const triagedProductsSet = new Set();
  let triagedUnits = 0;

  const upTo7DaysProductsSet = new Set();

  const upcomingList = [];

  allExpirations.forEach((exp) => {
    const product = productMap[exp.product_id];
    if (!product) return;

    // Se houver contagens registradas para a validade, usamos a quantidade dela.
    // Caso contrário, usamos a quantidade total cadastrada no produto.
    let units = 0;
    if (expQuantityMap[exp.id] !== undefined) {
      units = expQuantityMap[exp.id];
    } else {
      units = Number(product.total_quantity) || 0;
    }

    const days = getDaysUntilExpiration(exp.expiration_date);
    const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';

    // REGRA DE OURO: SE O PRODUTO TEM 0 UNIDADES NA DATA, ELE NÃO VENCE!
    // Somente se tiver 1 ou mais unidades (units >= 1) é que vence e aciona alertas.
    const hasUnits = units >= 1;

    if (isTriaged) {
      triagedProductsSet.add(product.id);
      triagedUnits += units;
    } else if (hasUnits) {
      // Apenas produtos COM ESTOQUE (1 ou mais unidades) entram nos alertas de vencimento/vencidos
      if (days < 0) {
        expiredProductsSet.add(product.id);
        expiredUnits += units;
      } else if (days <= 15) {
        upTo15DaysProductsSet.add(product.id);
        upTo15DaysUnits += units;
        if (days <= 7) {
          upTo7DaysProductsSet.add(product.id);
        }
      } else if (days <= 30) {
        upTo30DaysProductsSet.add(product.id);
        upTo30DaysUnits += units;
      }

      if (days >= 0 && days <= 60) {
        upcomingList.push({
          productId: product.id,
          expirationId: exp.id,
          name: product.name,
          barcode: product.barcode,
          image: product.image,
          sector: product.sector,
          corridor: product.corridor,
          expirationDate: exp.expiration_date,
          daysUntil: days,
          units,
          isTriaged: false
        });
      }
    }
  });

  // Ordena próximos vencimentos por data mais próxima
  upcomingList.sort((a, b) => a.daysUntil - b.daysUntil);

  // Mensagem automática inteligente e categorizada
  let smartStatus = 'ok'; // 'danger' | 'warning' | 'ok' | 'info'
  let smartTitle = 'Estoque em dia';
  let smartText = 'Nenhum produto vencido ou com validade crítica.';
  let smartMessage = 'Tudo em dia no estoque.';
  const totalExpired = expiredProductsSet.size;
  const total15Days = upTo15DaysProductsSet.size;
  const total7Days = upTo7DaysProductsSet.size;

  if (totalExpired > 0 && total15Days > 0) {
    smartStatus = 'danger';
    smartTitle = 'Atenção Crítica';
    smartText = `Você possui <strong>${totalExpired} ${totalExpired === 1 ? 'produto vencido' : 'produtos vencidos'}</strong> e <strong>${total15Days}</strong> vencendo nos próximos 15 dias.`;
    smartMessage = `Você possui ${totalExpired} ${totalExpired === 1 ? 'produto vencido' : 'produtos vencidos'} e ${total15Days} vencendo em até 15 dias.`;
  } else if (totalExpired > 0) {
    smartStatus = 'danger';
    smartTitle = 'Atenção: Vencimento Detectado';
    smartText = `Você possui <strong>${totalExpired} ${totalExpired === 1 ? 'produto vencido' : 'produtos vencidos'}</strong> que requer ação imediata.`;
    smartMessage = `Você possui ${totalExpired} ${totalExpired === 1 ? 'produto vencido' : 'produtos vencidos'}.`;
  } else if (total7Days > 0) {
    smartStatus = 'warning';
    smartTitle = 'Atenção: Vence em até 7 dias';
    smartText = `<strong>${total7Days} ${total7Days === 1 ? 'produto vence' : 'produtos vencem'}</strong> nos próximos 7 dias.`;
    smartMessage = `${total7Days} ${total7Days === 1 ? 'produto vence' : 'produtos vencem'} nos próximos 7 dias.`;
  } else if (total15Days > 0) {
    smartStatus = 'warning';
    smartTitle = 'Atenção: Vence em até 15 dias';
    smartText = `<strong>${total15Days} ${total15Days === 1 ? 'produto vence' : 'produtos vencem'}</strong> nos próximos 15 dias.`;
    smartMessage = `${total15Days} ${total15Days === 1 ? 'produto vence' : 'produtos vencem'} nos próximos 15 dias.`;
  } else if (products.length === 0) {
    smartStatus = 'info';
    smartTitle = 'Comece por aqui';
    smartText = 'Cadastre produtos ou faça a importação do WhatsApp para gerenciar o estoque.';
    smartMessage = 'Nenhum produto cadastrado no momento.';
  }

  const result = {
    totalProductsCount: products.length,
    totalUnitsCount: totalAllUnits,
    totalAllUnits,
    expired: {
      productsCount: expiredProductsSet.size,
      unitsCount: expiredUnits
    },
    upTo15Days: {
      productsCount: upTo15DaysProductsSet.size,
      unitsCount: upTo15DaysUnits
    },
    upTo30Days: {
      productsCount: upTo30DaysProductsSet.size,
      unitsCount: upTo30DaysUnits
    },
    triaged: {
      productsCount: triagedProductsSet.size,
      unitsCount: triagedUnits
    },
    smartStatus,
    smartTitle,
    smartText,
    smartMessage,
    upcomingExpirations: upcomingList.slice(0, 10)
  };

  metricsCacheMap.set(cacheKey, { timestamp: now, data: result });
  return result;
}

// Alterna o status de 'Retirado para triagem' de uma validade
export async function toggleExpirationTriaged(expirationId, isTriaged = true) {
  if (!expirationId) return null;
  const db = await initDB();
  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['product_expirations', 'sync_queue'], 'readwrite');
      const expStore = tx.objectStore('product_expirations');
      const syncStore = tx.objectStore('sync_queue');

      const req = expStore.get(expirationId);
      req.onsuccess = () => {
        const exp = req.result;
        if (!exp) {
          resolve(null);
          return;
        }
        exp.is_triaged = !!isTriaged;
        exp.triaged_at = isTriaged ? now : null;
        exp.updated_at = now;

        expStore.put(exp);

        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'product_expirations',
          record_id: exp.id,
          payload: exp,
          created_at: now,
          synced: 0
        });
      };

      tx.oncomplete = () => {
        window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
        resolve(true);
      };
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Envia um lote/validade para Triagem:
 * 1. Marca a validade como triada (is_triaged = true, triaged_at = data atual).
 * 2. Recalcula o estoque ativo da gôndola do produto com base apenas nas validades ativas restantes.
 * 3. Se não sobrarem outras validades ativas, zera o estoque da gôndola mantendo o cadastro do produto.
 */
export async function sendProductExpirationToTriage(productId, expirationId) {
  if (!productId || !expirationId) return false;

  // 1. Marca a validade específica como triada
  await toggleExpirationTriaged(expirationId, true);

  // 2. Busca o produto pai
  const product = await getProductById(productId);
  if (!product) return true;

  // 3. Busca validades restantes ATIVAS (não triadas) do produto
  const allExps = await getProductExpirations(productId);
  const activeExps = (allExps || []).filter(
    (e) => !(e.is_triaged === true || e.is_triaged === 1 || e.is_triaged === 'true')
  );

  if (activeExps && activeExps.length > 0) {
    // Recalcula totais com base nas validades ativas restantes
    const locationSums = {};
    LOCATIONS.forEach((l) => (locationSums[l] = 0));
    let newTotal = 0;

    for (const exp of activeExps) {
      const counts = await getLatestCountsForExpiration(exp.id);
      newTotal += counts.total || 0;
      Object.entries(counts.countsByLocation || {}).forEach(([loc, qty]) => {
        locationSums[loc] = (locationSums[loc] || 0) + Number(qty);
      });
    }

    // Ordena para pegar a validade ativa mais próxima
    activeExps.sort((a, b) => (a.expiration_date > b.expiration_date ? 1 : -1));
    const earliestExp = activeExps[0];

    product.total_quantity = newTotal;
    product.deposit_qty = locationSums['DEPÓSITO'] || 0;
    product.fridge_qty = locationSums['GELADEIRA'] || 0;
    product.shelf_qty = locationSums['PRATELEIRA'] || 0;
    product.gondola_end_qty = locationSums['PONTA DE GÔNDOLA'] || 0;
    product.ear_qty = locationSums['ORELHA'] || 0;
    product.island_qty = locationSums['ILHA'] || 0;
    product.cart_qty = locationSums['CARRINHO'] || 0;
    product.checkout_qty = locationSums['FRENTE DE LOJA'] || 0;
    product.last_expiration_date = earliestExp ? earliestExp.expiration_date : null;
    product.updated_at = new Date().toISOString();

    await saveProduct(product);
  } else {
    // Não restam outras datas ativas: zera quantidades ativas da gôndola, mas MANTÉM o produto cadastrado!
    product.total_quantity = 0;
    product.deposit_qty = 0;
    product.fridge_qty = 0;
    product.shelf_qty = 0;
    product.gondola_end_qty = 0;
    product.ear_qty = 0;
    product.island_qty = 0;
    product.cart_qty = 0;
    product.checkout_qty = 0;
    product.last_expiration_date = null;
    product.updated_at = new Date().toISOString();

    await saveProduct(product);
  }

  // Notifica o sistema para sincronizar e atualizar a interface
  window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
  return true;
}

/**
 * Restaura um lote/validade da Triagem de volta ao Estoque Ativo da Loja:
 * 1. Desmarca o status de triagem (is_triaged = false, triaged_at = null).
 * 2. Recalcula o estoque ativo da gôndola reintegrando as contagens deste lote.
 */
export async function restoreProductExpirationFromTriage(productId, expirationId) {
  if (!productId || !expirationId) return false;
  await toggleExpirationTriaged(expirationId, false);

  const product = await getProductById(productId);
  if (!product) return true;

  const allExps = await getProductExpirations(productId);
  const activeExps = (allExps || []).filter(
    (e) => !(e.is_triaged === true || e.is_triaged === 1 || e.is_triaged === 'true')
  );

  const locationSums = {};
  LOCATIONS.forEach((l) => (locationSums[l] = 0));
  let newTotal = 0;

  for (const exp of activeExps) {
    const counts = await getLatestCountsForExpiration(exp.id);
    newTotal += counts.total || 0;
    Object.entries(counts.countsByLocation || {}).forEach(([loc, qty]) => {
      locationSums[loc] = (locationSums[loc] || 0) + Number(qty);
    });
  }

  activeExps.sort((a, b) => (a.expiration_date > b.expiration_date ? 1 : -1));
  const earliestExp = activeExps[0];

  product.total_quantity = newTotal;
  product.deposit_qty = locationSums['DEPÓSITO'] || 0;
  product.fridge_qty = locationSums['GELADEIRA'] || 0;
  product.shelf_qty = locationSums['PRATELEIRA'] || 0;
  product.gondola_end_qty = locationSums['PONTA DE GÔNDOLA'] || 0;
  product.ear_qty = locationSums['ORELHA'] || 0;
  product.island_qty = locationSums['ILHA'] || 0;
  product.cart_qty = locationSums['CARRINHO'] || 0;
  product.checkout_qty = locationSums['FRENTE DE LOJA'] || 0;
  product.last_expiration_date = earliestExp ? earliestExp.expiration_date : null;
  product.updated_at = new Date().toISOString();

  await saveProduct(product);
  window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
  return true;
}

// Prazo de retenção na triagem: 3 dias (72 horas em milissegundos)
export const TRIAGE_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Limpeza automática de triagem e lotes zerados vencidos:
 * 1. REGRA: Quando um lote estiver com 0 unidades e 1 dia ou mais depois do vencimento (days <= -1),
 *    ele vai diretamente para a triagem e é removido definitivamente do banco de dados (IndexedDB e Supabase)
 *    para não sobrecarregar e manter o banco limpo e rápido.
 * 2. Exclui definitivamente qualquer lote em triagem após o prazo de retenção (3 dias).
 */
export async function runAutomaticTriageCleanup() {
  try {
    const expirations = await getAllExpirations();
    if (!expirations || expirations.length === 0) return 0;

    const [products, allCounts] = await Promise.all([
      getAllProducts(),
      getAllCounts()
    ]);

    const productMap = {};
    products.forEach((p) => {
      productMap[p.id] = p;
    });

    // Mapeia as contagens mais recentes por expiration_id
    const latestCountByExp = {};
    allCounts.forEach((item) => {
      if (!item.expiration_id) return;
      if (!latestCountByExp[item.expiration_id]) {
        latestCountByExp[item.expiration_id] = {};
      }
      const locMap = latestCountByExp[item.expiration_id];
      const prev = locMap[item.location_type];
      const itemTime = new Date(item.counted_at || item.created_at || 0).getTime();
      const prevTime = prev ? new Date(prev.counted_at || prev.created_at || 0).getTime() : 0;
      if (!prev || itemTime >= prevTime) {
        locMap[item.location_type] = item;
      }
    });

    const expQuantityMap = {};
    Object.entries(latestCountByExp).forEach(([expId, locMap]) => {
      let sum = 0;
      Object.values(locMap).forEach((rec) => {
        sum += Number(rec.quantity) || 0;
      });
      expQuantityMap[expId] = sum;
    });

    let purgedCount = 0;
    const now = Date.now();

    for (const exp of expirations) {
      const product = productMap[exp.product_id];
      const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';
      const days = getDaysUntilExpiration(exp.expiration_date);

      let units = 0;
      if (expQuantityMap[exp.id] !== undefined) {
        units = expQuantityMap[exp.id];
      } else if (product) {
        units = Number(product.total_quantity) || 0;
      }

      // REGRA: Se está zerado E 1 dia ou mais depois do vencimento (days <= -1):
      // Vai diretamente para triagem e é removido definitivamente do banco de dados!
      if (units <= 0 && days <= -1) {
        await deleteProductExpiration(exp.id);
        purgedCount++;
        continue;
      }

      // Lotes que estão em triagem física
      if (isTriaged) {
        const triagedTimestamp = exp.triaged_at ? new Date(exp.triaged_at).getTime() : null;

        // Se possui registro de quando foi triado e já se passaram 3 dias (72 horas)
        if (triagedTimestamp && (now - triagedTimestamp) >= TRIAGE_RETENTION_MS) {
          await deleteProductExpiration(exp.id);
          purgedCount++;
        } else if (!triagedTimestamp) {
          // Fallback para itens antigos sem triaged_at: se data de validade já passou há mais de 3 dias
          if (days < -3) {
            await deleteProductExpiration(exp.id);
            purgedCount++;
          }
        }
      }
    }

    if (purgedCount > 0) {
      console.log(`[Limpeza Automática] ${purgedCount} data(s) de validade zeradas vencidas/triadas foram removidas do banco de dados.`);
      window.dispatchEvent(new CustomEvent('refresh-dashboard-trigger'));
    }
    return purgedCount;
  } catch (err) {
    console.warn('[Limpeza Automática Error]:', err);
    return 0;
  }
}

/**
 * Retorna as estatísticas completas de Memória e Armazenamento do Banco de Dados
 */
export async function getDatabaseStorageStats() {
  const db = await initDB();

  // 1. Estimativa de cota nativa da Storage API do navegador
  let storageEstimate = {
    usage: 0,
    quota: 0,
    percentUsed: 0,
    usageFormatted: '0 KB',
    quotaFormatted: '0 MB'
  };

  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      const usage = est.usage || 0;
      const quota = est.quota || (1024 * 1024 * 1024 * 2); // 2GB fallback
      const percent = quota > 0 ? (usage / quota) * 100 : 0;
      storageEstimate = {
        usage,
        quota,
        percentUsed: Number(percent.toFixed(2)),
        usageFormatted: formatByteSize(usage),
        quotaFormatted: formatByteSize(quota)
      };
    } catch (e) {
      console.warn('Storage estimate error:', e);
    }
  }

  // 2. Contagem e peso detalhado de cada tabela no IndexedDB
  const tables = ['products', 'product_expirations', 'inventory_counts', 'count_sessions', 'sync_queue'];
  const tableStats = {};
  let totalRecords = 0;
  let estimatedDbBytes = 0;
  let totalPhotoCount = 0;
  let totalPhotoBytes = 0;
  let triagedCount = 0;
  let activeExpCount = 0;

  for (const tableName of tables) {
    try {
      const records = await new Promise(async (resolve) => {
        try {
          const { tx } = await getSafeTransaction(tableName, 'readonly');
          const store = tx.objectStore(tableName);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (_) {
          resolve([]);
        }
      });

      const count = records.length;
      totalRecords += count;

      let jsonBytes = 0;
      try {
        const str = JSON.stringify(records);
        jsonBytes = new Blob([str]).size;
      } catch (_) {
        jsonBytes = count * 250;
      }

      if (tableName === 'products') {
        records.forEach((p) => {
          if (p.image && typeof p.image === 'string') {
            totalPhotoCount++;
            totalPhotoBytes += p.image.length;
          }
        });
      }

      if (tableName === 'product_expirations') {
        records.forEach((e) => {
          const isT = e.is_triaged === true || e.is_triaged === 1 || e.is_triaged === 'true';
          if (isT) {
            triagedCount++;
          } else {
            activeExpCount++;
          }
        });
      }

      estimatedDbBytes += jsonBytes;
      tableStats[tableName] = {
        count,
        sizeBytes: jsonBytes,
        sizeFormatted: formatByteSize(jsonBytes)
      };
    } catch (err) {
      tableStats[tableName] = { count: 0, sizeBytes: 0, sizeFormatted: '0 B' };
    }
  }

  const finalUsedBytes = Math.max(storageEstimate.usage, estimatedDbBytes);

  return {
    storageEstimate: {
      ...storageEstimate,
      usage: finalUsedBytes,
      usageFormatted: formatByteSize(finalUsedBytes)
    },
    totalRecords,
    activeExpCount,
    triagedCount,
    totalPhotoCount,
    totalPhotoBytes,
    totalPhotoFormatted: formatByteSize(totalPhotoBytes),
    tableStats,
    estimatedDbBytes,
    estimatedDbFormatted: formatByteSize(estimatedDbBytes)
  };
}

function formatByteSize(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ----------------------------------------------------
// SESSÕES DE CONFERÊNCIA (count_sessions)
// ----------------------------------------------------

export async function saveSession(session) {
  const now = new Date().toISOString();
  const sessionData = {
    id: session.id || generateId(),
    date: session.date || getTodayISO(),
    sector: session.sector,
    corridor: session.corridor,
    location_type: session.location_type || 'PRATELEIRA',
    status: session.status || 'IN_PROGRESS',
    created_at: session.created_at || now,
    updated_at: now
  };

  try {
    const { tx } = await getSafeTransaction(['count_sessions', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        tx.objectStore('count_sessions').put(sessionData);
        tx.objectStore('sync_queue').add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'count_sessions',
          record_id: sessionData.id,
          payload: sessionData,
          created_at: now,
          synced: 0
        });

        tx.oncomplete = () => {
          localStorage.setItem('active_audit_session', JSON.stringify(sessionData));
          resolve(sessionData);
        };
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    throw err;
  }
}

export function getActiveSession() {
  try {
    const s = localStorage.getItem('active_audit_session');
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}

export function clearActiveSession() {
  localStorage.removeItem('active_audit_session');
}

// ----------------------------------------------------
// FILA DE SINCRONIZAÇÃO (sync_queue)
// ----------------------------------------------------

export async function getUnsyncedQueue() {
  try {
    const { tx } = await getSafeTransaction('sync_queue', 'readonly');
    const store = tx.objectStore('sync_queue');
    const index = store.index('synced');
    return new Promise((resolve) => {
      const req = index.getAll(0);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function markQueueItemSynced(id) {
  try {
    const { tx } = await getSafeTransaction('sync_queue', 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const store = tx.objectStore('sync_queue');
        const req = store.get(id);

        req.onsuccess = () => {
          if (req.result) {
            req.result.synced = 1;
            req.result.synced_at = new Date().toISOString();
            store.put(req.result);
          }
          resolve();
        };
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    console.warn('Erro ao marcar item sincronizado:', err);
  }
}

// ----------------------------------------------------
// BLITZ POR PERÍODO (blitz_sessions e blitz_items)
// ----------------------------------------------------

export async function createBlitzSession({ blitz_type, sector, user_name, user_id, responsible_user_id, responsible_user_name, start_date = null, end_date = null, period_label = null, target_dates = [] }) {
  const now = new Date().toISOString();
  const normalizedSector = (sector || blitz_type || 'GERAL').toUpperCase();
  const currentUser = getCurrentUser();
  const effectiveUserId = user_id || responsible_user_id || currentUser?.id || 'ana_luiza';
  const effectiveUserName = user_name || responsible_user_name || (effectiveUserId === 'angelica' ? 'Angélica' : currentUser?.name || 'Ana Luiza');

  // Processa datas procuradas (uma ou várias datas)
  const cleanTargetDates = Array.isArray(target_dates) && target_dates.length > 0
    ? target_dates.map(d => d.includes('/') ? parseDateBRtoISO(d) : String(d).trim().split('T')[0]).filter(Boolean)
    : [];
  
  // Garante datas limpas em formato ISO YYYY-MM-DD
  let cleanStart = start_date ? (start_date.includes('/') ? parseDateBRtoISO(start_date) : start_date.split('T')[0]) : null;
  let cleanEnd = end_date ? (end_date.includes('/') ? parseDateBRtoISO(end_date) : end_date.split('T')[0]) : null;

  if (cleanTargetDates.length > 0) {
    if (!cleanStart) cleanStart = cleanTargetDates[0];
    if (!cleanEnd) cleanEnd = cleanTargetDates[cleanTargetDates.length - 1];
  }

  if (!cleanStart || !cleanEnd) {
    const today = new Date();
    const next30 = new Date();
    next30.setDate(next30.getDate() + 30);
    cleanStart = cleanStart || today.toISOString().split('T')[0];
    cleanEnd = cleanEnd || next30.toISOString().split('T')[0];
  }

  if (cleanTargetDates.length === 0 && cleanStart) {
    cleanTargetDates.push(cleanStart);
  }

  // Período formatado legível
  let label = period_label;
  if (!label || label.includes('--/--/----') || label === 'Geral') {
    if (cleanTargetDates.length > 1) {
      label = cleanTargetDates.map(d => formatDateBR(d)).join(', ');
    } else {
      label = `${formatDateBR(cleanStart)} → ${formatDateBR(cleanEnd)}`;
    }
  }

  const session = {
    id: generateId(),
    blitz_type: blitz_type || normalizedSector,
    sector: normalizedSector,
    start_date: cleanStart,
    end_date: cleanEnd,
    target_dates: cleanTargetDates,
    period_label: label,
    user_id: effectiveUserId,
    responsible_user_id: effectiveUserId,
    user_name: effectiveUserName,
    responsible_user_name: effectiveUserName,
    started_at: now,
    finished_at: null,
    status: 'em_andamento',
    created_at: now,
    updated_at: now
  };

  try {
    const { tx } = await getSafeTransaction(['blitz_sessions', 'sync_queue', 'blitz'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const sessionStore = tx.objectStore('blitz_sessions');
        const syncStore = tx.objectStore('sync_queue');
        const blitzStore = tx.objectStoreNames.contains('blitz') ? tx.objectStore('blitz') : null;

        // Fecha preventivamente APENAS a sessão anterior em aberto DESTA MESMA usuária (nunca fecha a da colega!)
        const getAllReq = sessionStore.getAll();
        getAllReq.onsuccess = () => {
          const allSessions = getAllReq.result || [];
          allSessions.forEach((s) => {
            const sUserId = s.responsible_user_id || s.user_id || (s.user_name?.toLowerCase().includes('angelica') ? 'angelica' : 'ana_luiza');
            if (s.status === 'em_andamento' && sUserId === effectiveUserId) {
              s.status = 'finalizada';
              s.finished_at = now;
              s.updated_at = now;
              sessionStore.put(s);
              if (blitzStore) {
                blitzStore.put({
                  id: s.id,
                  data_inicio: s.start_date || cleanStart,
                  data_fim: s.end_date || cleanEnd,
                  setor: s.sector || normalizedSector,
                  responsavel: s.responsible_user_name || s.user_name || effectiveUserName,
                  user_id: sUserId,
                  status: 'FINALIZADA',
                  observacao: s.period_label || '',
                  finalized_at: now,
                  created_at: s.created_at || now,
                  updated_at: now
                });
              }
            }
          });
        };

        sessionStore.put(session);

        if (blitzStore) {
          blitzStore.put({
            id: session.id,
            data_inicio: session.start_date,
            data_fim: session.end_date,
            setor: session.sector,
            responsavel: session.responsible_user_name || session.user_name,
            user_id: effectiveUserId,
            status: 'EM_ANDAMENTO',
            observacao: session.period_label || '',
            finalized_at: null,
            created_at: now,
            updated_at: now
          });
        }

        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'blitz_sessions',
          record_id: session.id,
          payload: session,
          created_at: now,
          synced: 0
        });

        tx.oncomplete = () => resolve(session);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    throw err;
  }
}

export async function getActiveBlitzSession(targetUserId = null) {
  try {
    const { tx } = await getSafeTransaction('blitz_sessions', 'readonly');
    const store = tx.objectStore('blitz_sessions');
    const index = store.index('status');
    return new Promise((resolve) => {
      const req = index.getAll('em_andamento');
      req.onsuccess = () => {
        let list = req.result || [];
        if (list.length === 0) {
          resolve(null);
          return;
        }
        // Se targetUserId for fornecido ou se tivermos a usuária ativa do sistema:
        const effectiveUserId = targetUserId || getCurrentUser()?.id;
        if (effectiveUserId) {
          const userFiltered = list.filter(s => {
            const sUserId = s.responsible_user_id || s.user_id || (s.user_name?.toLowerCase().includes('angelica') ? 'angelica' : 'ana_luiza');
            return sUserId === effectiveUserId;
          });
          if (userFiltered.length > 0) {
            userFiltered.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
            resolve(userFiltered[0]);
            return;
          }
        }
        // Fallback: retorna a mais recente em andamento
        list.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
        resolve(list[0] || null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function getAllActiveBlitzSessions() {
  try {
    const { tx } = await getSafeTransaction('blitz_sessions', 'readonly');
    const store = tx.objectStore('blitz_sessions');
    const index = store.index('status');
    return new Promise((resolve) => {
      const req = index.getAll('em_andamento');
      req.onsuccess = () => {
        const list = req.result || [];
        list.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function getBlitzSessionById(id) {
  if (!id) return null;
  try {
    const { tx } = await getSafeTransaction('blitz_sessions', 'readonly');
    const store = tx.objectStore('blitz_sessions');
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function updateBlitzSessionPeriod(sessionId, { start_date, end_date, period_label, sector, blitz_type, target_dates }) {
  if (!sessionId) return null;
  const now = new Date().toISOString();
  try {
    const cleanStart = start_date ? (start_date.includes('/') ? parseDateBRtoISO(start_date) : start_date.split('T')[0]) : null;
    const cleanEnd = end_date ? (end_date.includes('/') ? parseDateBRtoISO(end_date) : end_date.split('T')[0]) : null;
    let label = period_label;

    const { tx } = await getSafeTransaction(['blitz_sessions', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      const store = tx.objectStore('blitz_sessions');
      const syncStore = tx.objectStore('sync_queue');
      const req = store.get(sessionId);
      req.onsuccess = () => {
        const session = req.result;
        if (!session) {
          resolve(null);
          return;
        }
        if (cleanStart) session.start_date = cleanStart;
        if (cleanEnd) session.end_date = cleanEnd;
        if (Array.isArray(target_dates)) {
          session.target_dates = target_dates.map(d => d.includes('/') ? parseDateBRtoISO(d) : String(d).trim().split('T')[0]).filter(Boolean);
          if (!label && session.target_dates.length > 1) {
            label = session.target_dates.map(d => formatDateBR(d)).join(', ');
          }
        }
        if (label) session.period_label = label;
        else if (cleanStart && cleanEnd) session.period_label = `${formatDateBR(cleanStart)} → ${formatDateBR(cleanEnd)}`;
        if (sector) {
          session.sector = String(sector).trim().toUpperCase();
          session.blitz_type = blitz_type ? String(blitz_type).trim().toUpperCase() : session.sector;
        }
        session.updated_at = now;
        store.put(session);

        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'blitz_sessions',
          record_id: session.id,
          payload: session,
          created_at: now,
          synced: 0
        });

        tx.oncomplete = () => resolve(session);
      };
      req.onerror = (e) => reject(e);
    });
  } catch (err) {
    console.error('Erro ao atualizar período da blitz:', err);
    return null;
  }
}

export async function finishBlitzSession(sessionId = null, userId = null, userName = null) {
  const now = new Date().toISOString();
  const currentUser = getCurrentUser();
  const currentUserId = userId || currentUser?.id || 'ana_luiza';
  const effectiveUserName = userName || (currentUserId === 'angelica' ? 'Angélica' : currentUser?.name || 'Ana Luiza');

  try {
    const { tx } = await getSafeTransaction(['blitz_sessions', 'sync_queue', 'blitz'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const store = tx.objectStore('blitz_sessions');
        const syncStore = tx.objectStore('sync_queue');
        const blitzStore = tx.objectStoreNames.contains('blitz') ? tx.objectStore('blitz') : null;

        const getAllReq = store.getAll();
        let updatedSession = null;

        getAllReq.onsuccess = () => {
          const allSessions = getAllReq.result || [];
          allSessions.forEach((session) => {
            const sUserId = session.responsible_user_id || session.user_id || (session.user_name?.toLowerCase().includes('angelica') ? 'angelica' : 'ana_luiza');
            const matchesTarget = sessionId ? session.id === sessionId : (session.status === 'em_andamento' && sUserId === currentUserId);

            if (matchesTarget && session.status === 'em_andamento') {
              session.status = 'finalizada';
              session.finished_at = session.finished_at || now;
              session.finalized_at = session.finalized_at || now;
              session.finalized_by = effectiveUserName;
              session.finalized_by_user_id = currentUserId;
              session.updated_at = now;
              if (!updatedSession || session.id === sessionId) {
                updatedSession = session;
              }
              store.put(session);

              if (blitzStore) {
                const getBReq = blitzStore.get(session.id);
                getBReq.onsuccess = () => {
                  const bRecord = getBReq.result || {
                    id: session.id,
                    data_inicio: session.start_date,
                    data_fim: session.end_date,
                    setor: session.sector,
                    responsavel: session.responsible_user_name || session.user_name || 'Ana Luiza',
                    created_at: session.created_at || now
                  };
                  bRecord.status = 'FINALIZADA';
                  bRecord.finalized_at = now;
                  bRecord.finalized_by = effectiveUserName;
                  bRecord.finalized_by_user_id = currentUserId;
                  bRecord.updated_at = now;
                  blitzStore.put(bRecord);
                };
              }

              syncStore.add({
                id: generateId(),
                operation: 'UPSERT',
                table_name: 'blitz_sessions',
                record_id: session.id,
                payload: session,
                created_at: now,
                synced: 0
              });
            }
          });
        };

        tx.oncomplete = () => resolve(updatedSession);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    console.error('Erro ao finalizar blitz:', err);
    return null;
  }
}

export async function cancelBlitzSession(sessionId = null, userId = null) {
  const now = new Date().toISOString();
  const currentUserId = userId || getCurrentUser()?.id;

  try {
    const { tx } = await getSafeTransaction(['blitz_sessions', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const store = tx.objectStore('blitz_sessions');
        const syncStore = tx.objectStore('sync_queue');

        const getAllReq = store.getAll();
        let hasCanceled = false;

        getAllReq.onsuccess = () => {
          const allSessions = getAllReq.result || [];
          allSessions.forEach((session) => {
            const sUserId = session.responsible_user_id || session.user_id || (session.user_name?.toLowerCase().includes('angelica') ? 'angelica' : 'ana_luiza');
            const matchesTarget = sessionId ? session.id === sessionId : (session.status === 'em_andamento' && sUserId === currentUserId);

            if (matchesTarget && session.status === 'em_andamento') {
              session.status = 'cancelada';
              session.finished_at = session.finished_at || now;
              session.updated_at = now;
              hasCanceled = true;
              store.put(session);

              syncStore.add({
                id: generateId(),
                operation: 'UPSERT',
                table_name: 'blitz_sessions',
                record_id: session.id,
                payload: session,
                created_at: now,
                synced: 0
              });
            }
          });
        };

        tx.oncomplete = () => resolve(hasCanceled);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    console.error('Erro ao cancelar blitz:', err);
    return false;
  }
}

export async function getAllBlitzSessions() {
  const sessions = await getAllFromStore('blitz_sessions');
  // Ordena por data de início decrescente (mais recentes primeiro)
  return sessions.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
}

export async function saveBlitzItem({
  id = null,
  blitz_session_id,
  product_id = null,
  barcode,
  sector = 'MERCEARIA',
  requested_expiration_date = '',
  previous_quantity = 0,
  total_quantity = 0,
  difference = 0,
  result = 'TEM', // 'TEM' | 'NAO_TEM' | 'NAO_IDENTIFICADO'
  locations = [],
  conference_id = null,
  user_id = null,
  user_name = null,
  is_new_expiration = false,
  notes = ''
}) {
  const now = new Date().toISOString();
  const itemId = id || generateId();
  const prevQty = Number(previous_quantity) || 0;
  const totQty = Number(total_quantity) || 0;
  const diff = difference !== undefined && difference !== null ? Number(difference) : (totQty - prevQty);

  const currentUser = getCurrentUser();
  const effectiveUserId = user_id || currentUser?.id || 'ana_luiza';
  const effectiveUserName = (user_name && user_name !== 'Ana Luiza') ? user_name : (effectiveUserId === 'angelica' ? 'Angélica' : currentUser?.name || 'Ana Luiza');

  const itemData = {
    id: itemId,
    blitz_session_id,
    product_id: product_id || null,
    barcode: String(barcode || '').trim(),
    sector: String(sector || 'MERCEARIA').toUpperCase(),
    requested_expiration_date: String(requested_expiration_date || '').trim(),
    previous_quantity: prevQty,
    total_quantity: totQty,
    difference: diff,
    result: (result === 'TEM' || result === 'NAO_TEM' || result === 'NAO_IDENTIFICADO') ? result : 'TEM',
    locations: Array.isArray(locations) ? locations : [],
    conference_id: conference_id || null,
    user_id: effectiveUserId,
    user_name: effectiveUserName,
    created_by: effectiveUserId,
    is_new_expiration: Boolean(is_new_expiration),
    notes: String(notes || ''),
    checked_at: now,
    created_at: now,
    updated_at: now
  };

  try {
    const { tx } = await getSafeTransaction(['blitz_items', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const itemStore = tx.objectStore('blitz_items');
        const syncStore = tx.objectStore('sync_queue');

        itemStore.put(itemData);

        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'blitz_items',
          record_id: itemData.id,
          payload: itemData,
          created_at: now,
          synced: 0
        });

        tx.oncomplete = () => resolve(itemData);
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (e) {
        reject(e);
      }
    });
  } catch (err) {
    throw err;
  }
}

export async function getBlitzItemsBySessionId(sessionId) {
  if (!sessionId) return [];
  try {
    const { tx } = await getSafeTransaction('blitz_items', 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('blitz_session_id');
    return new Promise((resolve) => {
      const req = index.getAll(sessionId);
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0));
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function getBlitzItemBySessionAndProduct(sessionId, productId) {
  if (!sessionId || !productId) return null;
  try {
    const { tx } = await getSafeTransaction('blitz_items', 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('session_product');
    return new Promise((resolve) => {
      const req = index.get([sessionId, productId]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function getBlitzItemBySessionProductAndDate(sessionId, productId, expirationDate) {
  if (!sessionId || !productId || !expirationDate) return null;
  try {
    const items = await getBlitzItemsBySessionId(sessionId);
    return items.find(it => it.product_id === productId && it.requested_expiration_date === expirationDate) || null;
  } catch (e) {
    return null;
  }
}

export async function getBlitzItemBySessionBarcodeAndDate(sessionId, barcode, expirationDate) {
  if (!sessionId || !barcode || !expirationDate) return null;
  try {
    const items = await getBlitzItemsBySessionId(sessionId);
    const cleanBarcode = String(barcode).trim();
    const cleanDate = String(expirationDate).trim();
    const cleanDateBR = formatDateBR(cleanDate);
    return items.find(it => {
      const itBarcode = String(it.barcode || '').trim();
      const itDate = String(it.requested_expiration_date || '').trim();
      const itDateBR = formatDateBR(itDate);
      return itBarcode === cleanBarcode && (itDate === cleanDate || itDateBR === cleanDateBR);
    }) || null;
  } catch (e) {
    return null;
  }
}

/**
 * Consulta a última conferência da Blitz para a combinação EXATA: PRODUTO + DATA DE VALIDADE
 */
export async function getLastBlitzItemForProductAndDate(productId, expirationDate) {
  if (!productId || !expirationDate) return null;
  try {
    const cleanExp = String(expirationDate).trim().split('T')[0];
    const cleanExpBR = formatDateBR(cleanExp);
    const { tx } = await getSafeTransaction('blitz_items', 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('product_id');
    return new Promise((resolve) => {
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const items = req.result || [];
        const matching = items.filter(it => {
          const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
          const itExpBR = formatDateBR(itExp);
          return itExp === cleanExp || itExpBR === cleanExpBR;
        });
        if (matching.length === 0) {
          resolve(null);
          return;
        }
        matching.sort((a, b) => new Date(b.checked_at || b.created_at || 0) - new Date(a.checked_at || a.created_at || 0));
        resolve(matching[0]);
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

/**
 * Consulta a última conferência da Blitz por CÓDIGO DE BARRAS + DATA DE VALIDADE
 */
export async function getLastBlitzItemForBarcodeAndDate(barcode, expirationDate) {
  if (!barcode || !expirationDate) return null;
  try {
    const cleanBarcode = String(barcode).trim();
    const cleanExp = String(expirationDate).trim().split('T')[0];
    const cleanExpBR = formatDateBR(cleanExp);

    const allItems = await getAllBlitzItems();
    const matching = allItems.filter(it => {
      const itBarcode = String(it.barcode || '').trim();
      const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
      const itExpBR = formatDateBR(itExp);
      return itBarcode === cleanBarcode && (itExp === cleanExp || itExpBR === cleanExpBR);
    });
    if (matching.length === 0) return null;
    matching.sort((a, b) => new Date(b.checked_at || b.created_at || 0) - new Date(a.checked_at || a.created_at || 0));
    return matching[0];
  } catch (e) {
    return null;
  }
}

/**
 * Busca de forma abrangente qualquer conferência anterior ou registro de validade existente no banco:
 * 1. Em blitz_items (mesmo com 0 unidades / NÃO TEM)
 * 2. Em inventory_counts / product_expirations (conferências de inventário geral)
 * 3. No cadastro do produto (se tiver quantidade ou última validade registrada)
 */
export async function getComprehensiveConferenceRecordForProductAndDate(product, expirationDate, excludeItemId = null) {
  if (!product || !expirationDate) return null;

  try {
    const cleanDate = String(expirationDate).trim().split('T')[0];
    const cleanDateBR = formatDateBR(cleanDate);
    const productId = product.id || null;
    const barcode = product.barcode ? String(product.barcode).trim() : null;

    const candidates = [];

    // 1. Busca em blitz_items por product_id e por barcode
    let blitzList = [];
    if (productId) {
      try {
        const byProd = await getAllBlitzItemsForProduct(productId);
        blitzList.push(...byProd);
      } catch (_) {}
    }
    if (barcode) {
      try {
        const byBar = await getAllBlitzItemsForBarcode(barcode);
        byBar.forEach(b => {
          if (!blitzList.some(item => item.id === b.id)) {
            blitzList.push(b);
          }
        });
      } catch (_) {}
    }

    blitzList.forEach(it => {
      if (excludeItemId && it.id === excludeItemId) return;
      const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
      const itExpBR = formatDateBR(itExp);
      if (itExp === cleanDate || itExpBR === cleanDateBR) {
        const locs = (it.locations && Array.isArray(it.locations)) ? it.locations : [];
        const tot = Number(it.total_quantity) || 0;
        candidates.push({
          source: 'blitz',
          id: it.id,
          date: it.checked_at || it.created_at || new Date().toISOString(),
          total: tot,
          result: it.result || (tot > 0 ? 'TEM' : 'NAO_TEM'),
          locations: locs,
          userName: it.user_name || 'Conferente',
          productName: product.name || `PRODUTO ${barcode || ''}`,
          barcode: barcode || it.barcode,
          requestedDate: itExp || cleanDate
        });
      }
    });

    // 2. Busca em product_expirations e inventory_counts
    let expRecords = [];
    if (productId) {
      try {
        expRecords = await getProductExpirations(productId);
      } catch (_) {}
    }
    if (expRecords.length === 0 && barcode) {
      try {
        const prod = await getProductByBarcode(barcode);
        if (prod && prod.id) {
          expRecords = await getProductExpirations(prod.id);
        }
      } catch (_) {}
    }

    for (const exp of expRecords) {
      const expDate = String(exp.expiration_date || '').trim().split('T')[0];
      const expDateBR = formatDateBR(expDate);
      if (expDate === cleanDate || expDateBR === cleanDateBR) {
        let countsInfo = { countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false };
        try {
          countsInfo = await getLatestCountsForExpiration(exp.id);
        } catch (_) {}

        const locs = Object.entries(countsInfo.countsByLocation || {})
          .filter(([_, q]) => Number(q) > 0)
          .map(([location, quantity]) => ({ location, quantity: Number(quantity) }));

        const countDate = countsInfo.lastCountDate || exp.updated_at || exp.created_at || (product && (product.last_count_date || product.updated_at || product.created_at));
        const total = countsInfo.hasPreviousCount ? Number(countsInfo.total) : (product && product.total_quantity !== undefined ? Number(product.total_quantity) : 0);

        candidates.push({
          source: countsInfo.hasPreviousCount ? 'inventario' : 'cadastro',
          id: exp.id,
          date: countDate || new Date().toISOString(),
          total: total,
          result: total > 0 ? 'TEM' : 'NAO_TEM',
          locations: locs,
          userName: 'Conferente',
          productName: product.name || `PRODUTO ${barcode || ''}`,
          barcode: barcode,
          requestedDate: expDate || cleanDate
        });
      }
    }

    // 3. Se ainda não achou, verifica se o próprio produto tem essa data como last_expiration_date
    if (candidates.length === 0 && product && product.last_expiration_date) {
      const prodExp = String(product.last_expiration_date).trim().split('T')[0];
      const prodExpBR = formatDateBR(prodExp);
      if (prodExp === cleanDate || prodExpBR === cleanDateBR) {
        const locs = [];
        if (product.deposit_qty) locs.push({ location: 'Depósito', quantity: product.deposit_qty });
        if (product.shelf_qty) locs.push({ location: 'Prateleira', quantity: product.shelf_qty });
        if (product.fridge_qty) locs.push({ location: 'Geladeira', quantity: product.fridge_qty });
        const tot = Number(product.total_quantity) || 0;
        candidates.push({
          source: 'produto',
          id: product.id,
          date: product.last_count_date || product.updated_at || product.created_at || new Date().toISOString(),
          total: tot,
          result: tot > 0 ? 'TEM' : 'NAO_TEM',
          locations: locs,
          userName: 'Conferente',
          productName: product.name || `PRODUTO ${barcode || ''}`,
          barcode: barcode,
          requestedDate: prodExp || cleanDate
        });
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Ordena do mais recente para o mais antigo
    candidates.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return candidates[0];
  } catch (err) {
    console.warn('Erro ao buscar conferência abrangente:', err);
    return null;
  }
}

/**
 * Retorna todo o histórico de contagens anteriores da combinação PRODUTO + DATA DE VALIDADE
 * Ordenado do mais recente para o mais antigo
 */
export async function getAllBlitzItemsForProductAndDate(productId, expirationDate) {
  if (!productId || !expirationDate) return [];
  try {
    const cleanExp = String(expirationDate).trim().split('T')[0];
    const cleanExpBR = formatDateBR(cleanExp);
    const { tx } = await getSafeTransaction('blitz_items', 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('product_id');
    return new Promise((resolve) => {
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const items = req.result || [];
        const matching = items.filter(it => {
          const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
          const itExpBR = formatDateBR(itExp);
          return itExp === cleanExp || itExpBR === cleanExpBR;
        });
        matching.sort((a, b) => new Date(b.checked_at || b.created_at || 0) - new Date(a.checked_at || a.created_at || 0));
        resolve(matching);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function getAllBlitzItemsForBarcode(barcode) {
  if (!barcode) return [];
  try {
    const cleanBarcode = String(barcode).trim();
    const allItems = await getAllBlitzItems();
    return allItems
      .filter(it => String(it.barcode || '').trim() === cleanBarcode)
      .sort((a, b) => new Date(b.checked_at || b.created_at || 0) - new Date(a.checked_at || a.created_at || 0));
  } catch (e) {
    return [];
  }
}

export async function getLastBlitzItemForProduct(productId) {
  if (!productId) return null;
  try {
    const { tx } = await getSafeTransaction('blitz_items', 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('product_id');
    return new Promise((resolve) => {
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const items = req.result || [];
        if (items.length === 0) {
          resolve(null);
          return;
        }
        items.sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0));
        resolve(items[0]);
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function getAllBlitzItemsForProduct(productId) {
  if (!productId) return [];
  try {
    const { tx } = await getSafeTransaction('blitz_items', 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('product_id');
    return new Promise((resolve) => {
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const items = req.result || [];
        items.sort((a, b) => new Date(b.checked_at || 0) - new Date(a.checked_at || 0));
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export async function getAllBlitzItems() {
  return getAllFromStore('blitz_items');
}

/**
 * Salva conferência da Blitz e atualiza o estoque físico atual da validade (substituindo a quantidade física atual,
 * MAS NUNCA apagando o histórico em blitz_items ou inventory_counts).
 */
export async function saveBlitzConferenceRecord({
  id = null,
  sessionId,
  productId,
  barcode,
  sector,
  corridor = null,
  requestedDate,
  previousQuantity = 0,
  newQuantity = 0,
  result, // 'TEM' | 'NAO_TEM' | 'NAO_IDENTIFICADO'
  locations = [], // [{ location: 'Depósito', quantity: 70 }, ...]
  photo_proof = null,
  foto_url = null,
  userName = null,
  userId = null,
  isNewExpiration = false
}) {
  const diff = Number(newQuantity) - Number(previousQuantity);
  const photoData = photo_proof || foto_url || null;

  const currentUser = getCurrentUser();
  const effectiveUserId = userId || currentUser?.id || 'ana_luiza';
  const effectiveUserName = (userName && userName !== 'Ana Luiza') ? userName : (effectiveUserId === 'angelica' ? 'Angélica' : currentUser?.name || 'Ana Luiza');

  // Garante que o produto SEMPRE seja guardado e exista na tabela de produtos do banco de dados
  let effectiveProductId = productId;
  if (!effectiveProductId && barcode) {
    try {
      let existingProd = await getProductByBarcode(barcode);
      if (!existingProd) {
        existingProd = await saveProduct({
          barcode: String(barcode).trim(),
          name: `PRODUTO ${String(barcode).trim()}`,
          sector: sector || 'GERAL',
          corridor: corridor || 'Corredor 1',
          image: photoData || '',
          photo_url: photoData || ''
        });
      }
      if (existingProd && existingProd.id) {
        effectiveProductId = existingProd.id;
      }
    } catch (e) {
      console.warn('[Blitz] Aviso ao garantir existência do produto no banco:', e);
    }
  }

  // Se houver foto e produto, salva foto no produto e na tabela de fotos
  if (photoData && (effectiveProductId || barcode)) {
    try {
      await saveProductPhotoRecord({
        productId: effectiveProductId,
        barcode: barcode,
        photoBase64: photoData,
        expirationDate: requestedDate,
        type: 'CONFERENCIA'
      });
    } catch (_) {}
  }

  // 1. Busca se já existe um item desta mesma Blitz, Produto e Validade para SUBSTITUIR (Re-bipagem oficial)
  let effectiveId = id || null;
  const cleanBar = barcode ? String(barcode).trim() : '';
  const cleanReqDate = requestedDate ? String(requestedDate).split('T')[0] : '';
  const cleanReqDateBR = cleanReqDate ? formatDateBR(cleanReqDate) : '';

  try {
    const existingSessionItems = await getBlitzItemsBySessionId(sessionId);
    const duplicates = existingSessionItems.filter(it => {
      const bMatch = cleanBar && String(it.barcode || '').trim() === cleanBar;
      const pMatch = effectiveProductId && it.product_id === effectiveProductId;
      const itExp = String(it.requested_expiration_date || '').split('T')[0];
      const itExpBR = formatDateBR(itExp);
      const dMatch = itExp === cleanReqDate || itExpBR === cleanReqDateBR;
      return (bMatch || pMatch) && dMatch;
    });

    if (duplicates.length > 0) {
      // Reutiliza o id do primeiro registro
      effectiveId = duplicates[0].id;

      // Limpa duplicatas excedentes no banco para manter apenas o registro oficial vigente
      if (duplicates.length > 1) {
        try {
          const { tx: dupTx } = await getSafeTransaction('blitz_items', 'readwrite');
          const dupStore = dupTx.objectStore('blitz_items');
          for (let i = 1; i < duplicates.length; i++) {
            dupStore.delete(duplicates[i].id);
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.warn('[Blitz] Aviso ao verificar registros anteriores da Blitz atual:', err);
  }

  // Salva o registro no histórico da Blitz (atualizando o registro vigente)
  const blitzItem = await saveBlitzItem({
    id: effectiveId,
    blitz_session_id: sessionId,
    product_id: effectiveProductId || null,
    barcode: barcode,
    sector: sector,
    requested_expiration_date: requestedDate,
    previous_quantity: Number(previousQuantity) || 0,
    total_quantity: Number(newQuantity) || 0,
    difference: diff,
    result: result,
    locations: locations,
    photo_proof: photoData,
    user_id: effectiveUserId,
    user_name: effectiveUserName,
    responsible_user_id: effectiveUserId,
    responsible_user_name: effectiveUserName,
    is_new_expiration: isNewExpiration
  });

  // Também sincroniza atomicamente blitz_itens e conferencias_blitz
  try {
    const { tx: bTx } = await getSafeTransaction(['blitz_itens', 'conferencias_blitz', 'auditoria_blitz'], 'readwrite');
    const bItensStore = bTx.objectStore('blitz_itens');
    const confStore = bTx.objectStore('conferencias_blitz');

    // 1. Atualiza blitz_itens para CONFERIDO com as novas quantidades e locais
    const bItensReq = bItensStore.getAll();
    bItensReq.onsuccess = () => {
      const allBItens = bItensReq.result || [];
      const targetBItem = allBItens.find(it => 
        it.blitz_id === sessionId &&
        String(it.ean || '').trim() === cleanBar &&
        String(it.data_validade || '').split('T')[0] === cleanReqDate
      );
      if (targetBItem) {
        targetBItem.status = 'CONFERIDO';
        targetBItem.quantidade = Number(newQuantity) || 0;
        targetBItem.locations = locations;
        if (photoData) targetBItem.foto_url = photoData;
        if (corridor) targetBItem.corredor = corridor;
        targetBItem.user_id = effectiveUserId;
        targetBItem.usuario = effectiveUserName;
        targetBItem.responsible_user_id = effectiveUserId;
        targetBItem.responsible_user_name = effectiveUserName;
        targetBItem.conferido_em = new Date().toISOString();
        targetBItem.updated_at = new Date().toISOString();
        bItensStore.put(targetBItem);
      }
    };

    // 2. Atualiza conferencias_blitz mantendo ESTRITAMENTE A ÚLTIMA conferência oficial da Blitz atual
    // Regra Crítica: UNIQUE(blitz_id, product_id)
    const confReq = confStore.getAll();
    confReq.onsuccess = () => {
      const allConfs = confReq.result || [];
      const matchingConfs = allConfs.filter(c => {
        if (c.blitz_id !== sessionId) return false;
        const eanMatch = cleanBar && String(c.ean || '').trim() === cleanBar;
        const pMatch = effectiveProductId && c.produto_id === effectiveProductId;
        if (!cleanReqDate) return eanMatch || pMatch;
        const dMatch = String(c.data_validade || '').split('T')[0] === cleanReqDate || formatDateBR(c.data_validade) === cleanReqDateBR;
        return (eanMatch || pMatch) && dMatch;
      });

      const nowIso = new Date().toISOString();
      let savedConfRecord = null;

      if (matchingConfs.length > 0) {
        const primary = matchingConfs[0];
        primary.quantidade = Number(newQuantity) || 0;
        primary.quantidade_anterior = Number(previousQuantity) || 0;
        primary.diferenca = diff;
        primary.locations = locations;
        primary.tipo_conferencia = 'MANUAL';
        primary.data_validade = cleanReqDate;
        primary.user_id = effectiveUserId;
        primary.usuario = effectiveUserName;
        primary.responsible_user_id = effectiveUserId;
        primary.responsible_user_name = effectiveUserName;
        primary.updated_by = effectiveUserId;
        primary.sync_status = 'pending';
        if (effectiveProductId && !primary.produto_id) primary.produto_id = effectiveProductId;
        if (photoData) {
          primary.foto_url = photoData;
          primary.foto_conferencia = photoData;
        }
        if (corridor) primary.corredor = corridor;
        primary.conferido_em = nowIso;
        primary.updated_at = nowIso;
        confStore.put(primary);
        savedConfRecord = primary;

        // Remove duplicatas excedentes para manter apenas um único registro na mesma Blitz
        for (let i = 1; i < matchingConfs.length; i++) {
          confStore.delete(matchingConfs[i].id);
        }
      } else {
        const newConf = {
          id: generateId(),
          blitz_id: sessionId,
          blitz_item_id: blitzItem ? blitzItem.id : generateId(),
          produto_id: effectiveProductId || null,
          ean: cleanBar,
          data_validade: cleanReqDate,
          quantidade: Number(newQuantity) || 0,
          quantidade_anterior: Number(previousQuantity) || 0,
          diferenca: diff,
          tipo_conferencia: 'MANUAL',
          locations: locations,
          corredor: corridor || null,
          foto_url: photoData || null,
          foto_conferencia: photoData || null,
          user_id: effectiveUserId,
          usuario: effectiveUserName,
          responsible_user_id: effectiveUserId,
          responsible_user_name: effectiveUserName,
          created_by: effectiveUserId,
          sync_status: 'pending',
          conferido_em: nowIso,
          created_at: nowIso,
          updated_at: nowIso
        };
        confStore.put(newConf);
        savedConfRecord = newConf;
      }

      // Grava auditoria detalhada da conferência
      try {
        if (bTx.objectStoreNames.contains('auditoria_blitz')) {
          const audStore = bTx.objectStore('auditoria_blitz');
          audStore.add({
            id: generateId('aud_'),
            blitz_id: sessionId,
            registro_id: savedConfRecord?.id || generateId('reg_'),
            tabela: 'conferencias_blitz',
            acao: 'CONFERENCIA',
            user_id: effectiveUserId,
            user_name: effectiveUserName,
            responsible_user_id: effectiveUserId,
            responsible_user_name: effectiveUserName,
            detalhes: `${effectiveUserName} conferiu ${Number(newQuantity) || 0} un do produto ${cleanBar} (Validade: ${cleanReqDate})`,
            data_hora: nowIso,
            created_at: nowIso
          });
        }
      } catch (_) {}

      // Enfileira para sincronização segura com o Supabase
      if (savedConfRecord) {
        try {
          getSafeTransaction('sync_queue', 'readwrite').then(({ tx: sTx }) => {
            sTx.objectStore('sync_queue').add({
              id: generateId(),
              table_name: 'conferencias_blitz',
              operation: 'UPSERT',
              record_id: savedConfRecord.id,
              payload: savedConfRecord,
              created_at: nowIso
            });
          }).catch(() => {});
        } catch (_) {}
      }
    };
  } catch (err) {
    console.warn('[Blitz] Aviso ao sincronizar conferencias_blitz:', err);
  }

  // 2. Se houver produto (ou auto-criado) e houver data, atualiza o estoque físico atual e salva no histórico semanal
  if (effectiveProductId && requestedDate && result !== 'NAO_IDENTIFICADO') {
    try {
      // Garante que a data de validade existe no cadastro
      let expRecord = await getExpirationByProductAndDate(effectiveProductId, requestedDate);
      if (!expRecord) {
        const res = await saveProductExpiration(effectiveProductId, requestedDate);
        expRecord = res.expiration;
      }

      if (expRecord && expRecord.id) {
        // Converte as localizações em mapa para saveInventoryCounts
        const locMap = {};
        if (result === 'TEM' && locations && locations.length > 0) {
          locations.forEach(loc => {
            const lName = String(loc.location || '').toUpperCase();
            locMap[lName] = (locMap[lName] || 0) + (Number(loc.quantity) || 0);
          });
        } else {
          // Se NÃO TEM, zera os locais principais
          locMap['DEPÓSITO'] = 0;
          locMap['ÁREA DE VENDA'] = 0;
          locMap['PRATELEIRA'] = 0;
        }

        // Salva as contagens atuais no inventário (mantendo histórico e atualizando o produto)
        await saveInventoryCounts(effectiveProductId, expRecord.id, locMap, sessionId);

        // REGRA: Se a quantidade for 0 e estiver 1 dia ou mais depois do vencimento (days <= -1):
        // Remove definitivamente do banco de dados para não sobrecarregar
        if (Number(newQuantity) <= 0 && getDaysUntilExpiration(requestedDate) <= -1) {
          await deleteProductExpiration(expRecord.id);
        }
      }
    } catch (e) {
      console.warn('[Blitz] Aviso ao atualizar estoque atual da validade:', e);
    }
  }

  // 3. Atualiza o status do produto para VERIFICADO após passar pela conferência da Blitz
  if (effectiveProductId) {
    try {
      const prodToUpdate = await getProductById(effectiveProductId);
      if (prodToUpdate && prodToUpdate.status !== 'VERIFICADO') {
        prodToUpdate.status = 'VERIFICADO';
        prodToUpdate.updated_at = new Date().toISOString();
        await saveProduct(prodToUpdate);
      }
    } catch (e) {
      console.warn('[Blitz] Aviso ao atualizar status do produto verificado:', e);
    }
  }

  return blitzItem;
}

/**
 * REGRA CRÍTICA: Busca conferência exclusivamente de uma Blitz anterior (id !== currentBlitzId).
 * Retorna { blitzId, blitzLabel, blitzDate, date, quantity, total, locations, shelfQty, depositQty, fridgeQty, otherLocations, expirationDate }
 * ou null se for o primeiro registro do produto/validade.
 * NUNCA retorna conferência da Blitz atual nem inventa histórico de 0 un.
 */
export async function getPreviousFinalizedBlitzConference({ currentBlitzId, barcode, productId, expirationDate = null }) {
  if (!barcode && !productId) return null;

  try {
    const cleanBar = barcode ? String(barcode).trim() : null;
    const cleanExp = expirationDate ? String(expirationDate).trim().split('T')[0] : null;
    const cleanExpBR = cleanExp ? formatDateBR(cleanExp) : null;

    const { tx } = await getSafeTransaction(['blitz_sessions', 'blitz', 'blitz_items', 'blitz_itens', 'conferencias_blitz'], 'readonly');
    const sessionStore = tx.objectStore('blitz_sessions');
    const blitzStore = tx.objectStore('blitz');
    const bItemsStore = tx.objectStore('blitz_items');
    const bItensStore = tx.objectStore('blitz_itens');
    const confStore = tx.objectStore('conferencias_blitz');

    const [allSessions, allBlitzes, allItems, allBItens, allConfs] = await Promise.all([
      new Promise(r => { const req = sessionStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = blitzStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = bItemsStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = bItensStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = confStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); })
    ]);

    // Mapeia todas as blitzes anteriores distintas (excluindo estritamente a Blitz atual)
    const priorBlitzMap = new Map();

    allSessions.forEach(s => {
      if (s.id && s.id !== currentBlitzId) {
        const respId = s.responsible_user_id || s.user_id || (s.user_name?.toLowerCase().includes('angelica') ? 'angelica' : 'ana_luiza');
        const respName = s.responsible_user_name || s.user_name || (respId === 'angelica' ? 'Angélica' : 'Ana Luiza');
        priorBlitzMap.set(s.id, {
          id: s.id,
          date: s.finished_at || s.started_at || s.start_date || s.created_at,
          label: s.period_label || s.sector || `Blitz ${String(s.id).slice(0, 8)}`,
          sector: s.sector || 'MERCEARIA',
          responsible_user_id: respId,
          responsible_user_name: respName,
          isFinalized: s.status === 'finalizada' || s.status === 'finished' || Boolean(s.finished_at)
        });
      }
    });

    allBlitzes.forEach(b => {
      if (b.id && b.id !== currentBlitzId) {
        if (!priorBlitzMap.has(b.id)) {
          const respId = b.responsible_user_id || b.user_id || (b.responsavel?.toLowerCase().includes('angelica') ? 'angelica' : 'ana_luiza');
          const respName = b.responsible_user_name || b.responsavel || (respId === 'angelica' ? 'Angélica' : 'Ana Luiza');
          priorBlitzMap.set(b.id, {
            id: b.id,
            date: b.finalized_at || b.data_fim || b.data_inicio || b.created_at,
            label: b.setor || `Blitz ${String(b.id).slice(0, 8)}`,
            sector: b.setor || 'MERCEARIA',
            responsible_user_id: respId,
            responsible_user_name: respName,
            isFinalized: b.status === 'FINALIZADA' || b.status === 'finalizada' || Boolean(b.finalized_at)
          });
        }
      }
    });

    if (priorBlitzMap.size === 0) {
      return null;
    }

    // Ordena as blitzes anteriores da mais recente para a mais antiga
    const sortedPrior = Array.from(priorBlitzMap.values()).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    // Função auxiliar para destrinchar contagem por localização (Prateleira, Depósito, Geladeira, etc.)
    const parseLocations = (locs = []) => {
      let shelfQty = 0;
      let depositQty = 0;
      let fridgeQty = 0;
      const others = [];

      if (Array.isArray(locs)) {
        locs.forEach(l => {
          const name = String(l.location || '').trim().toUpperCase();
          const q = Number(l.quantity) || 0;
          if (name === 'PRATELEIRA') shelfQty += q;
          else if (name === 'DEPÓSITO' || name === 'DEPOSITO') depositQty += q;
          else if (name === 'GELADEIRA') fridgeQty += q;
          else if (q > 0) others.push(`${l.location}: ${q}`);
        });
      }

      return {
        locations: locs,
        shelfQty,
        depositQty,
        fridgeQty,
        otherLocations: others
      };
    };

    // Procura conferência deste produto na blitz anterior mais recente
    for (const b of sortedPrior) {
      const formattedDateStr = b.date ? (formatDateBR(b.date) || String(b.date).split('T')[0]) : 'Blitz anterior';

      // 1. Prioridade: conferencias_blitz
      const priorConfs = allConfs.filter(c => {
        if (c.blitz_id !== b.id) return false;
        const eanMatch = cleanBar && String(c.ean || '').trim() === cleanBar;
        const idMatch = productId && c.produto_id === productId;
        return eanMatch || idMatch;
      });

      if (priorConfs.length > 0) {
        let matchConf = null;
        if (cleanExp) {
          matchConf = priorConfs.find(c => {
            const d = String(c.data_validade || '').split('T')[0];
            return d === cleanExp || formatDateBR(c.data_validade) === cleanExpBR;
          });
        } else {
          matchConf = priorConfs[0];
        }

        if (matchConf) {
          const qty = Number(matchConf.quantidade) || 0;
          const locDetails = parseLocations(matchConf.locations || []);
          return {
            blitzId: b.id,
            blitzLabel: b.label || 'Blitz anterior',
            blitzDate: formattedDateStr,
            date: b.date,
            quantity: qty,
            total: qty,
            expirationDate: matchConf.data_validade || cleanExp,
            locations: locDetails.locations,
            shelfQty: locDetails.shelfQty,
            depositQty: locDetails.depositQty,
            fridgeQty: locDetails.fridgeQty,
            otherLocations: locDetails.otherLocations,
            responsible_user_id: b.responsible_user_id,
            responsible_user_name: b.responsible_user_name,
            responsible: b.responsible_user_name,
            sector: b.sector,
            result: qty > 0 ? 'TEM' : 'NAO_TEM'
          };
        }
      }

      // 2. Prioridade: blitz_itens
      const priorBItens = allBItens.filter(it => {
        if (it.blitz_id !== b.id) return false;
        const eanMatch = cleanBar && String(it.ean || '').trim() === cleanBar;
        const idMatch = productId && it.produto_id === productId;
        return (eanMatch || idMatch) && (it.status === 'CONFERIDO' || Boolean(it.conferido_em) || Number(it.quantidade) > 0);
      });

      if (priorBItens.length > 0) {
        let matchBItem = null;
        if (cleanExp) {
          matchBItem = priorBItens.find(it => {
            const d = String(it.data_validade || '').split('T')[0];
            return d === cleanExp || formatDateBR(it.data_validade) === cleanExpBR;
          });
        } else {
          matchBItem = priorBItens[0];
        }

        if (matchBItem) {
          const qty = Number(matchBItem.quantidade != null ? matchBItem.quantidade : matchBItem.total_quantity) || 0;
          const locDetails = parseLocations(matchBItem.locations || []);
          return {
            blitzId: b.id,
            blitzLabel: b.label || 'Blitz anterior',
            blitzDate: formattedDateStr,
            date: b.date,
            quantity: qty,
            total: qty,
            expirationDate: matchBItem.data_validade || cleanExp,
            locations: locDetails.locations,
            shelfQty: locDetails.shelfQty,
            depositQty: locDetails.depositQty,
            fridgeQty: locDetails.fridgeQty,
            otherLocations: locDetails.otherLocations,
            responsible_user_id: b.responsible_user_id,
            responsible_user_name: b.responsible_user_name,
            responsible: b.responsible_user_name,
            sector: b.sector,
            result: qty > 0 ? 'TEM' : 'NAO_TEM'
          };
        }
      }

      // 3. Prioridade: blitz_items
      const priorItems = allItems.filter(it => {
        if (it.blitz_session_id !== b.id) return false;
        const barMatch = cleanBar && String(it.barcode || '').trim() === cleanBar;
        const idMatch = productId && it.product_id === productId;
        const isChecked = Boolean(it.checked_at) || it.result === 'TEM' || it.result === 'NAO_TEM';
        return (barMatch || idMatch) && isChecked;
      });

      if (priorItems.length > 0) {
        let matchItem = null;
        if (cleanExp) {
          matchItem = priorItems.find(it => {
            const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
            return itExp === cleanExp || formatDateBR(itExp) === cleanExpBR;
          });
        } else {
          matchItem = priorItems[0];
        }

        if (matchItem) {
          const qty = Number(matchItem.total_quantity != null ? matchItem.total_quantity : matchItem.quantity) || 0;
          const locDetails = parseLocations(matchItem.locations || []);
          return {
            blitzId: b.id,
            blitzLabel: b.label || 'Blitz anterior',
            blitzDate: formattedDateStr,
            date: b.date,
            quantity: qty,
            total: qty,
            expirationDate: matchItem.requested_expiration_date || cleanExp,
            locations: locDetails.locations,
            shelfQty: locDetails.shelfQty,
            depositQty: locDetails.depositQty,
            fridgeQty: locDetails.fridgeQty,
            otherLocations: locDetails.otherLocations,
            responsible_user_id: b.responsible_user_id,
            responsible_user_name: b.responsible_user_name,
            responsible: b.responsible_user_name,
            sector: b.sector,
            result: matchItem.result || (qty > 0 ? 'TEM' : 'NAO_TEM')
          };
        }
      }
    }

    return null;
  } catch (err) {
    console.warn('Erro ao consultar conferência em blitz anterior:', err);
    return null;
  }
}

export const getPreviousBlitzConferenceForProduct = getPreviousFinalizedBlitzConference;

/**
 * Consulta a conferência oficial de um produto dentro de uma Blitz específica.
 * Garante que a busca seja estritamente escopada pelo blitz_id.
 */
export async function getBlitzConferenceByProductAndBlitz(blitzId, productId, barcode, targetDate = null) {
  if (!blitzId || (!productId && !barcode)) return null;
  const cleanBar = barcode ? String(barcode).trim() : null;
  const cleanExp = targetDate ? String(targetDate).trim().split('T')[0] : null;
  const cleanExpBR = cleanExp ? formatDateBR(cleanExp) : null;

  try {
    const { tx } = await getSafeTransaction(['conferencias_blitz', 'blitz_itens', 'blitz_items'], 'readonly');
    const confStore = tx.objectStore('conferencias_blitz');
    const bItensStore = tx.objectStore('blitz_itens');
    const bItemsStore = tx.objectStore('blitz_items');

    const [allConfs, allBItens, allItems] = await Promise.all([
      new Promise(r => { const req = confStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = bItensStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = bItemsStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); })
    ]);

    const matchConf = allConfs.find(c => {
      if (c.blitz_id !== blitzId) return false;
      const eanMatch = cleanBar && String(c.ean || '').trim() === cleanBar;
      const pMatch = productId && c.produto_id === productId;
      if (!cleanExp) return eanMatch || pMatch;
      const cDate = String(c.data_validade || '').split('T')[0];
      const dMatch = cDate === cleanExp || formatDateBR(cDate) === cleanExpBR;
      return (eanMatch || pMatch) && dMatch;
    });

    if (matchConf) {
      const qty = Number(matchConf.quantidade) || 0;
      return {
        id: matchConf.id,
        blitzId: matchConf.blitz_id,
        productId: matchConf.produto_id,
        barcode: matchConf.ean,
        expirationDate: matchConf.data_validade,
        quantity: qty,
        total: qty,
        previousQuantity: Number(matchConf.quantidade_anterior) || 0,
        difference: Number(matchConf.diferenca) || 0,
        locations: matchConf.locations || [],
        corredor: matchConf.corredor || '',
        photo: matchConf.foto_url || matchConf.foto_conferencia || null,
        conferidoEm: matchConf.conferido_em || matchConf.created_at || null,
        raw: matchConf
      };
    }

    const matchBItem = allBItens.find(it => {
      if (it.blitz_id !== blitzId) return false;
      const eanMatch = cleanBar && String(it.ean || '').trim() === cleanBar;
      const pMatch = productId && it.produto_id === productId;
      const isConferred = it.status === 'CONFERIDO' || Boolean(it.conferido_em) || Number(it.quantidade) > 0;
      if (!isConferred) return false;
      if (!cleanExp) return eanMatch || pMatch;
      const itDate = String(it.data_validade || '').split('T')[0];
      const dMatch = itDate === cleanExp || formatDateBR(itDate) === cleanExpBR;
      return (eanMatch || pMatch) && dMatch;
    });

    if (matchBItem) {
      const qty = Number(matchBItem.quantidade != null ? matchBItem.quantidade : matchBItem.total_quantity) || 0;
      return {
        id: matchBItem.id,
        blitzId: matchBItem.blitz_id,
        productId: matchBItem.produto_id,
        barcode: matchBItem.ean,
        expirationDate: matchBItem.data_validade,
        quantity: qty,
        total: qty,
        previousQuantity: Number(matchBItem.previous_quantity) || 0,
        difference: Number(matchBItem.difference) || 0,
        locations: matchBItem.locations || [],
        corredor: matchBItem.corredor || '',
        photo: matchBItem.foto_url || null,
        conferidoEm: matchBItem.conferido_em || matchBItem.updated_at || null,
        raw: matchBItem
      };
    }

    const matchItem = allItems.find(it => {
      if (it.blitz_session_id !== blitzId) return false;
      const barMatch = cleanBar && String(it.barcode || '').trim() === cleanBar;
      const idMatch = productId && it.product_id === productId;
      const isConferred = Boolean(it.checked_at) || it.result === 'TEM' || it.result === 'NAO_TEM';
      if (!isConferred) return false;
      if (!cleanExp) return barMatch || idMatch;
      const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
      const dMatch = itExp === cleanExp || formatDateBR(itExp) === cleanExpBR;
      return (barMatch || idMatch) && dMatch;
    });

    if (matchItem) {
      const qty = Number(matchItem.total_quantity != null ? matchItem.total_quantity : matchItem.quantity) || 0;
      return {
        id: matchItem.id,
        blitzId: matchItem.blitz_session_id,
        productId: matchItem.product_id,
        barcode: matchItem.barcode,
        expirationDate: matchItem.requested_expiration_date,
        quantity: qty,
        total: qty,
        previousQuantity: Number(matchItem.previous_quantity) || 0,
        difference: Number(matchItem.difference) || 0,
        locations: matchItem.locations || [],
        corredor: matchItem.corridor || '',
        photo: matchItem.photo_proof || null,
        conferidoEm: matchItem.checked_at || matchItem.created_at || null,
        raw: matchItem
      };
    }

    return null;
  } catch (err) {
    console.warn('Erro em getBlitzConferenceByProductAndBlitz:', err);
    return null;
  }
}

/**
 * Busca se o produto e validade já foram conferidos NESTA MESMA BLITZ ATUAL (em andamento).
 * Evita que ao re-bipar o mesmo produto informe falsamente 'PRIMEIRO REGISTRO'.
 */
export async function getCurrentBlitzConferenceRecord({ currentBlitzId, barcode, productId, expirationDate = null }) {
  if (!currentBlitzId || (!barcode && !productId)) return null;

  try {
    const cleanBar = barcode ? String(barcode).trim() : null;
    const cleanExp = expirationDate ? String(expirationDate).trim().split('T')[0] : null;
    const cleanExpBR = cleanExp ? formatDateBR(cleanExp) : null;

    const { tx } = await getSafeTransaction(['conferencias_blitz', 'blitz_itens', 'blitz_items'], 'readonly');
    const confStore = tx.objectStore('conferencias_blitz');
    const bItensStore = tx.objectStore('blitz_itens');
    const bItemsStore = tx.objectStore('blitz_items');

    const [allConfs, allBItens, allItems] = await Promise.all([
      new Promise(r => { const req = confStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = bItensStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); }),
      new Promise(r => { const req = bItemsStore.getAll(); req.onsuccess = () => r(req.result || []); req.onerror = () => r([]); })
    ]);

    // 1. Prioridade: conferencias_blitz da sessão atual
    const matchConf = allConfs.find(c => {
      if (c.blitz_id !== currentBlitzId) return false;
      const eanMatch = cleanBar && String(c.ean || '').trim() === cleanBar;
      const idMatch = productId && c.produto_id === productId;
      if (!cleanExp) return eanMatch || idMatch;
      const dMatch = String(c.data_validade || '').split('T')[0] === cleanExp || formatDateBR(c.data_validade) === cleanExpBR;
      return (eanMatch || idMatch) && dMatch;
    });

    if (matchConf) {
      const qty = Number(matchConf.quantidade) || 0;
      return {
        blitzId: currentBlitzId,
        quantity: qty,
        total: qty,
        locations: matchConf.locations || [],
        conferidoEm: matchConf.conferido_em || matchConf.created_at || null,
        result: qty > 0 ? 'TEM' : 'NAO_TEM',
        photo: matchConf.foto_url || matchConf.foto_conferencia || null,
        expirationDate: matchConf.data_validade
      };
    }

    // 2. blitz_itens da sessão atual
    const matchBItem = allBItens.find(it => {
      if (it.blitz_id !== currentBlitzId) return false;
      const eanMatch = cleanBar && String(it.ean || '').trim() === cleanBar;
      const idMatch = productId && it.produto_id === productId;
      if (!cleanExp) return (eanMatch || idMatch) && (it.status === 'CONFERIDO' || Boolean(it.conferido_em) || Number(it.quantidade) > 0);
      const dMatch = String(it.data_validade || '').split('T')[0] === cleanExp || formatDateBR(it.data_validade) === cleanExpBR;
      return (eanMatch || idMatch) && dMatch && (it.status === 'CONFERIDO' || Boolean(it.conferido_em) || Number(it.quantidade) > 0);
    });

    if (matchBItem) {
      const qty = Number(matchBItem.quantidade != null ? matchBItem.quantidade : matchBItem.total_quantity) || 0;
      return {
        blitzId: currentBlitzId,
        quantity: qty,
        total: qty,
        locations: matchBItem.locations || [],
        conferidoEm: matchBItem.conferido_em || matchBItem.updated_at || null,
        result: qty > 0 ? 'TEM' : 'NAO_TEM',
        photo: matchBItem.foto_url || null,
        expirationDate: matchBItem.data_validade
      };
    }

    // 3. blitz_items da sessão atual
    const matchItem = allItems.find(it => {
      if (it.blitz_session_id !== currentBlitzId) return false;
      const barMatch = cleanBar && String(it.barcode || '').trim() === cleanBar;
      const idMatch = productId && it.product_id === productId;
      const isChecked = Boolean(it.checked_at) || it.result === 'TEM' || it.result === 'NAO_TEM';
      if (!isChecked) return false;
      if (!cleanExp) return barMatch || idMatch;
      const itExp = String(it.requested_expiration_date || '').trim().split('T')[0];
      const dMatch = itExp === cleanExp || formatDateBR(itExp) === cleanExpBR;
      return (barMatch || idMatch) && dMatch;
    });

    if (matchItem) {
      const qty = Number(matchItem.total_quantity != null ? matchItem.total_quantity : matchItem.quantity) || 0;
      return {
        blitzId: currentBlitzId,
        quantity: qty,
        total: qty,
        locations: matchItem.locations || [],
        conferidoEm: matchItem.updated_at || matchItem.created_at || null,
        result: matchItem.result || (qty > 0 ? 'TEM' : 'NAO_TEM'),
        photo: matchItem.photo_proof || null,
        expirationDate: matchItem.requested_expiration_date
      };
    }

    return null;
  } catch (err) {
    console.warn('Erro ao consultar conferência na Blitz atual:', err);
    return null;
  }
}

/**
 * Salva a fotografia do produto tanto no cadastro do produto quanto
 * na tabela fotos_produtos e enfileira para sincronização.
 */
export async function saveProductPhotoRecord({ productId, barcode, photoBase64, expirationDate = null, type = 'PRODUTO' }) {
  if (!photoBase64 || (!productId && !barcode)) return false;
  try {
    const now = new Date().toISOString();
    let product = productId ? await getProductById(productId) : await getProductByBarcode(barcode);
    if (product) {
      product.image = photoBase64;
      product.photo_url = photoBase64;
      product.updated_at = now;
      await saveProduct(product);
    }

    const { tx } = await getSafeTransaction(['fotos_produtos', 'sync_queue'], 'readwrite');
    const fotoStore = tx.objectStore('fotos_produtos');
    const syncStore = tx.objectStore('sync_queue');

    const photoRecord = {
      id: generateId('foto_'),
      produto_id: product?.id || productId || null,
      ean: String(barcode || product?.barcode || '').trim(),
      tipo: type || 'PRODUTO',
      url_ou_base64: photoBase64,
      data_validade: expirationDate ? String(expirationDate).split('T')[0] : null,
      criado_em: now
    };

    fotoStore.put(photoRecord);

    syncStore.add({
      id: generateId(),
      operation: 'UPSERT',
      table_name: 'fotos_produtos',
      record_id: photoRecord.id,
      payload: photoRecord,
      created_at: now,
      synced: 0
    });

    return true;
  } catch (err) {
    console.warn('Erro ao salvar foto em fotos_produtos:', err);
    return false;
  }
}

/**
 * Consulta se existe foto salva na tabela fotos_produtos para o produto ou código de barras
 */
export async function getProductPhotoFromDb(productId, barcode) {
  try {
    const cleanBar = barcode ? String(barcode).trim() : null;
    const { tx } = await getSafeTransaction('fotos_produtos', 'readonly');
    const store = tx.objectStore('fotos_produtos');
    const all = await new Promise(r => {
      const req = store.getAll();
      req.onsuccess = () => r(req.result || []);
      req.onerror = () => r([]);
    });
    const match = all.reverse().find(f => (productId && f.produto_id === productId) || (cleanBar && String(f.ean).trim() === cleanBar));
    return match ? (match.url_ou_base64 || match.url || null) : null;
  } catch (_) {
    return null;
  }
}

// ----------------------------------------------------
// ZERAR / LIMPAR BANCO DE DADOS (IndexedDB e Supabase)
// ----------------------------------------------------

export async function clearAllDatabaseData() {
  const stores = [
    'products',
    'product_expirations',
    'inventory_counts',
    'count_sessions',
    'blitz_sessions',
    'blitz_items',
    'blitz',
    'blitz_itens',
    'conferencias_blitz',
    'historico_alteracoes',
    'fotos_produtos',
    'sync_queue'
  ];
  try {
    const { tx } = await getSafeTransaction(stores, 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        stores.forEach((storeName) => {
          tx.objectStore(storeName).clear();
        });
        tx.oncomplete = () => {
          localStorage.removeItem('active_audit_session');
          localStorage.removeItem('active_blitz_session_cache');
          resolve(true);
        };
        tx.onerror = (e) => reject(e.target?.error || e);
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    console.error('Erro ao limpar dados:', err);
    throw err;
  }
}

// ----------------------------------------------------
// EXPORTAÇÃO E EXTRAÇÃO DO BANCO DE DADOS (JSON E SQL)
// ----------------------------------------------------

export async function getAllDatabaseData() {
  const storeNames = [
    'products',
    'product_expirations',
    'inventory_counts',
    'count_sessions',
    'blitz_sessions',
    'blitz_items',
    'blitz',
    'blitz_itens',
    'conferencias_blitz',
    'historico_alteracoes',
    'fotos_produtos',
    'auditoria_blitz'
  ];

  const db = await initDB();
  const result = {};

  for (const storeName of storeNames) {
    try {
      if (db.objectStoreNames.contains(storeName)) {
        result[storeName] = await getAllRecords(storeName);
      } else {
        result[storeName] = [];
      }
    } catch (_) {
      result[storeName] = [];
    }
  }

  return result;
}

export async function getDatabaseSummaryStats() {
  const data = await getAllDatabaseData();
  let totalUnits = 0;
  (data.products || []).forEach(p => {
    totalUnits += Number(p.total_quantity) || 0;
  });

  return {
    productsCount: data.products?.length || 0,
    expirationsCount: data.product_expirations?.length || 0,
    countsCount: data.inventory_counts?.length || 0,
    blitzSessionsCount: data.blitz_sessions?.length || 0,
    blitzItemsCount: (data.blitz_items?.length || 0) + (data.blitz_itens?.length || 0),
    conferenciasCount: data.conferencias_blitz?.length || 0,
    totalUnits,
    historyCount: (data.historico_alteracoes?.length || 0) + (data.auditoria_blitz?.length || 0),
    photosCount: data.fotos_produtos?.length || 0
  };
}

export async function exportDatabaseJSON() {
  const data = await getAllDatabaseData();
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  const stats = await getDatabaseSummaryStats();
  const payload = {
    export_version: '2.0',
    app_name: 'Controladoria - Ana Luiza & Angélica',
    exported_at: now.toISOString(),
    stats,
    tables: data
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `banco_controladoria_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);

  return payload;
}

export async function exportDatabaseSQL() {
  const data = await getAllDatabaseData();
  const now = new Date();
  const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

  let sql = `-- ====================================================================\n`;
  sql += `-- DUMP COMPLETO DO BANCO DE DADOS - CONTROLADORIA\n`;
  sql += `-- Usuárias: Ana Luiza & Angélica\n`;
  sql += `-- Exportado em: ${now.toLocaleString('pt-BR')}\n`;
  sql += `-- Compatível com Supabase / PostgreSQL\n`;
  sql += `-- ====================================================================\n\n`;

  const esc = (val) => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return isNaN(val) ? '0' : String(val);
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
    return `'${String(val).replace(/'/g, "''")}'`;
  };

  // 1. Tabela products
  if (data.products?.length > 0) {
    sql += `-- --------------------------------------------------------------------\n`;
    sql += `-- PRODUTOS (${data.products.length} registros)\n`;
    sql += `-- --------------------------------------------------------------------\n`;
    for (const p of data.products) {
      sql += `INSERT INTO public.products (id, barcode, name, sector, corridor, image, total_quantity, deposit_qty, fridge_qty, shelf_qty, gondola_end_qty, ear_qty, island_qty, cart_qty, checkout_qty, is_verified_only, created_at, updated_at)\n`;
      sql += `VALUES (${esc(p.id)}, ${esc(p.barcode)}, ${esc(p.name)}, ${esc(p.sector)}, ${esc(p.corridor)}, ${esc(p.image)}, ${esc(p.total_quantity || 0)}, ${esc(p.deposit_qty || 0)}, ${esc(p.fridge_qty || 0)}, ${esc(p.shelf_qty || 0)}, ${esc(p.gondola_end_qty || 0)}, ${esc(p.ear_qty || 0)}, ${esc(p.island_qty || 0)}, ${esc(p.cart_qty || 0)}, ${esc(p.checkout_qty || 0)}, ${esc(p.is_verified_only || false)}, ${esc(p.created_at || now.toISOString())}, ${esc(p.updated_at || now.toISOString())})\n`;
      sql += `ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, total_quantity = EXCLUDED.total_quantity, updated_at = NOW();\n\n`;
    }
  }

  // 2. Tabela product_expirations
  if (data.product_expirations?.length > 0) {
    sql += `-- --------------------------------------------------------------------\n`;
    sql += `-- VALIDADES (${data.product_expirations.length} registros)\n`;
    sql += `-- --------------------------------------------------------------------\n`;
    for (const exp of data.product_expirations) {
      sql += `INSERT INTO public.product_expirations (id, product_id, expiration_date, is_triaged, created_at, updated_at)\n`;
      sql += `VALUES (${esc(exp.id)}, ${esc(exp.product_id)}, ${esc(exp.expiration_date)}, ${esc(exp.is_triaged || false)}, ${esc(exp.created_at || now.toISOString())}, ${esc(exp.updated_at || now.toISOString())})\n`;
      sql += `ON CONFLICT (id) DO NOTHING;\n\n`;
    }
  }

  // 3. Tabela blitz_sessions
  if (data.blitz_sessions?.length > 0) {
    sql += `-- --------------------------------------------------------------------\n`;
    sql += `-- SESSÕES DE BLITZ (${data.blitz_sessions.length} registros)\n`;
    sql += `-- --------------------------------------------------------------------\n`;
    for (const bs of data.blitz_sessions) {
      sql += `INSERT INTO public.blitz_sessions (id, blitz_type, sector, user_name, start_date, end_date, period_label, status, started_at, finished_at)\n`;
      sql += `VALUES (${esc(bs.id)}, ${esc(bs.blitz_type)}, ${esc(bs.sector)}, ${esc(bs.responsible_user_name || bs.user_name || 'Ana Luiza')}, ${esc(bs.start_date)}, ${esc(bs.end_date)}, ${esc(bs.period_label)}, ${esc(bs.status)}, ${esc(bs.started_at)}, ${esc(bs.finished_at)})\n`;
      sql += `ON CONFLICT (id) DO NOTHING;\n\n`;
    }
  }

  // 4. Tabela conferencias_blitz
  if (data.conferencias_blitz?.length > 0) {
    sql += `-- --------------------------------------------------------------------\n`;
    sql += `-- CONFERÊNCIAS DE BLITZ (${data.conferencias_blitz.length} registros)\n`;
    sql += `-- --------------------------------------------------------------------\n`;
    for (const c of data.conferencias_blitz) {
      sql += `INSERT INTO public.conferencias_blitz (id, blitz_id, item_id, blitz_item_id, produto_id, ean, data_validade, quantidade, diferenca, usuario, conferido_em)\n`;
      sql += `VALUES (${esc(c.id)}, ${esc(c.blitz_id)}, ${esc(c.item_id)}, ${esc(c.blitz_item_id)}, ${esc(c.produto_id)}, ${esc(c.ean)}, ${esc(c.data_validade)}, ${esc(c.quantidade || 0)}, ${esc(c.diferenca || 0)}, ${esc(c.responsible_user_name || c.usuario || 'Ana Luiza')}, ${esc(c.conferido_em || now.toISOString())})\n`;
      sql += `ON CONFLICT (id) DO NOTHING;\n\n`;
    }
  }

  const blob = new Blob([sql], { type: 'text/sql' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `banco_controladoria_dump_${dateStr}.sql`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 500);

  return sql;
}

