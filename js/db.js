// Banco de Dados Local com IndexedDB para Controladoria - Ana Luiza
import { generateId, getTodayISO, getDaysUntilExpiration, LOCATIONS } from './utils.js';

const DB_NAME = 'ControladoriaAnaLuizaDB';
const DB_VERSION = 2;

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

export async function searchProducts(searchTerm = '', sectorFilter = '', corridorFilter = '') {
  const all = await getAllProducts();
  const term = searchTerm.toLowerCase().trim();

  const filtered = all.filter((p) => {
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

  const productData = {
    id: product.id || generateId(),
    barcode: product.barcode.trim(),
    name: product.name ? product.name.trim() : '',
    image: product.image !== undefined ? product.image : (existing?.image || ''),
    sector: product.sector || existing?.sector || 'MERCEARIA',
    corridor: product.corridor || existing?.corridor || 'CORREDOR 01',
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

  // Busca contagens dessa validade
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
    return new Promise((resolve, reject) => {
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
  } catch (err) {
    console.error('Erro ao deletar validade:', err);
    return false;
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
    corridor: product.corridor || 'CORREDOR 01',
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

// Retorna histórico completo de um produto (datas, totais e detalhamento por local)
export async function getHistoryForProduct(productId) {
  if (!productId) return [];
  try {
    const { tx } = await getSafeTransaction('inventory_counts', 'readonly');
    const store = tx.objectStore('inventory_counts');
    const index = store.index('product_id');
    return new Promise((resolve) => {
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const allCounts = req.result || [];
        const groups = {};

        allCounts.forEach((item) => {
          const dateKey = item.counted_at ? item.counted_at.substring(0, 16) : (item.created_at ? item.created_at.substring(0, 16) : 'data');
          if (!groups[dateKey]) {
            groups[dateKey] = {
              date: item.counted_at || item.created_at,
              locations: {},
              total: 0,
              expirationId: item.expiration_id
            };
          }
          const q = Number(item.quantity) || 0;
          groups[dateKey].locations[item.location_type] = q;
          groups[dateKey].total += q;
        });

        // Transforma em array e ordena por data decrescente
        const historyList = Object.values(groups).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        resolve(historyList);
      };
      req.onerror = () => resolve([]);
    });
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

export function invalidateMetricsCache() {
  cachedMetrics = null;
  lastMetricsCalculationTime = 0;
}

export async function getDashboardMetrics() {
  const now = Date.now();
  if (cachedMetrics && (now - lastMetricsCalculationTime < METRICS_CACHE_TTL)) {
    return cachedMetrics;
  }

  await runAutomaticTriageCleanup();

  // Carrega apenas produtos e validades (ignora a tabela pesada de histórico de contagens para máxima velocidade)
  const [products, allExpirations] = await Promise.all([
    getAllProducts(),
    getAllExpirations()
  ]);

  // Mapeia produto por id
  const productMap = {};
  let totalAllUnits = 0;
  products.forEach((p) => {
    productMap[p.id] = p;
    totalAllUnits += Number(p.total_quantity) || 0;
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

    const units = Number(product.total_quantity) || 0;
    const days = getDaysUntilExpiration(exp.expiration_date);
    const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';

    if (isTriaged) {
      triagedProductsSet.add(product.id);
      triagedUnits += units;
    } else {
      // Apenas produtos ATIVOS (não triados) entram nos alertas e contadores de gôndola/estoque
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

      if (days >= 0 && days <= 60 && units > 0) {
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

  return {
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
 * Limpeza automática de triagem:
 * Exclui definitivamente do banco de dados qualquer lote em triagem após 3 dias (72 horas)
 * do momento em que foi enviado para a triagem.
 */
export async function runAutomaticTriageCleanup() {
  try {
    const expirations = await getAllExpirations();
    if (!expirations || expirations.length === 0) return 0;

    let purgedCount = 0;
    const now = Date.now();

    for (const exp of expirations) {
      const isTriaged = exp.is_triaged === true || exp.is_triaged === 1 || exp.is_triaged === 'true';
      if (!isTriaged) continue;

      const triagedTimestamp = exp.triaged_at ? new Date(exp.triaged_at).getTime() : null;

      // Se possui registro de quando foi triado e já se passaram 3 dias (72 horas)
      if (triagedTimestamp && (now - triagedTimestamp) >= TRIAGE_RETENTION_MS) {
        await deleteProductExpiration(exp.id);
        purgedCount++;
      } else if (!triagedTimestamp) {
        // Fallback para itens antigos sem triaged_at: se data de validade já passou há mais de 3 dias
        const days = getDaysUntilExpiration(exp.expiration_date);
        if (days < -3) {
          await deleteProductExpiration(exp.id);
          purgedCount++;
        }
      }
    }

    if (purgedCount > 0) {
      console.log(`[Limpeza Automática] ${purgedCount} lotes em triagem após 3 dias foram excluídos definitivamente do banco de dados.`);
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
// BLITZ SEMANAL (blitz_sessions e blitz_items)
// ----------------------------------------------------

export async function createBlitzSession({ blitz_type }) {
  const now = new Date().toISOString();
  const session = {
    id: generateId(),
    blitz_type: blitz_type || 'mercearia',
    started_at: now,
    finished_at: null,
    status: 'em_andamento',
    created_at: now,
    updated_at: now
  };

  try {
    const { tx } = await getSafeTransaction(['blitz_sessions', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const sessionStore = tx.objectStore('blitz_sessions');
        const syncStore = tx.objectStore('sync_queue');

        // Fecha preventivamente qualquer outra sessão anterior que tenha ficado em aberto
        const getAllReq = sessionStore.getAll();
        getAllReq.onsuccess = () => {
          const allSessions = getAllReq.result || [];
          allSessions.forEach((s) => {
            if (s.status === 'em_andamento') {
              s.status = 'finalizada';
              s.finished_at = now;
              s.updated_at = now;
              sessionStore.put(s);
            }
          });
        };

        sessionStore.put(session);

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

export async function getActiveBlitzSession() {
  try {
    const { tx } = await getSafeTransaction('blitz_sessions', 'readonly');
    const store = tx.objectStore('blitz_sessions');
    const index = store.index('status');
    return new Promise((resolve) => {
      const req = index.getAll('em_andamento');
      req.onsuccess = () => {
        const list = req.result || [];
        if (list.length === 0) {
          resolve(null);
          return;
        }
        // Retorna a sessão em andamento mais recente
        list.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
        resolve(list[0]);
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
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

export async function finishBlitzSession(sessionId = null) {
  const now = new Date().toISOString();

  try {
    const { tx } = await getSafeTransaction(['blitz_sessions', 'sync_queue'], 'readwrite');
    return new Promise((resolve, reject) => {
      try {
        const store = tx.objectStore('blitz_sessions');
        const syncStore = tx.objectStore('sync_queue');

        const getAllReq = store.getAll();
        let updatedSession = null;

        getAllReq.onsuccess = () => {
          const allSessions = getAllReq.result || [];
          allSessions.forEach((session) => {
            // Finaliza a sessão alvo ou qualquer sessão que ainda esteja 'em_andamento'
            if ((sessionId && session.id === sessionId) || (!sessionId && session.status === 'em_andamento') || session.status === 'em_andamento') {
              session.status = 'finalizada';
              session.finished_at = session.finished_at || now;
              session.updated_at = now;
              if (!updatedSession || session.id === sessionId) {
                updatedSession = session;
              }
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

export async function cancelBlitzSession(sessionId = null) {
  const now = new Date().toISOString();

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
            // Cancela a sessão alvo ou qualquer sessão que ainda esteja 'em_andamento'
            if ((sessionId && session.id === sessionId) || (!sessionId && session.status === 'em_andamento') || (session.id === sessionId)) {
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
  product_id,
  barcode,
  requested_expiration_date,
  result, // 'TEM' | 'NAO_TEM'
  conference_id = null,
  total_quantity = 0
}) {
  const now = new Date().toISOString();
  const itemId = id || generateId();

  const itemData = {
    id: itemId,
    blitz_session_id,
    product_id,
    barcode: String(barcode || '').trim(),
    requested_expiration_date: String(requested_expiration_date || '').trim(),
    result: result === 'TEM' ? 'TEM' : 'NAO_TEM',
    conference_id: conference_id || null,
    total_quantity: Number(total_quantity) || 0,
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

