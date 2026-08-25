// Banco de Dados Local com IndexedDB para Controladoria - Ana Luiza
import { generateId, getTodayISO, getDaysUntilExpiration } from './utils.js';

const DB_NAME = 'ControladoriaAnaLuizaDB';
const DB_VERSION = 1;

let dbInstance = null;
let dbInitPromise = null;

export function initDB() {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

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
    };

    request.onsuccess = async (event) => {
      const db = event.target.result;
      dbInstance = db;
      try {
        await seedInitialDataIfEmpty(db);
      } catch (err) {
        console.warn('Erro na verificação de seed inicial:', err);
      }
      resolve(db);
    };

    request.onerror = (event) => {
      console.error('Erro ao abrir IndexedDB:', event.target.error);
      dbInitPromise = null;
      reject(event.target.error);
    };
  });

  return dbInitPromise;
}

// Leitura atômica de todos os itens de uma store
export async function getAllFromStore(storeName) {
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => {
        console.warn(`Erro no getAll de ${storeName}:`, e.target.error);
        resolve([]);
      };
    } catch (err) {
      console.warn(`Falha de transação em ${storeName}:`, err);
      resolve([]);
    }
  });
}

// ----------------------------------------------------
// PRODUTOS
// ----------------------------------------------------

export async function getProductByBarcode(barcode) {
  if (!barcode) return null;
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const index = store.index('barcode');
      const req = index.get(barcode.trim());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function getProductById(id) {
  if (!id) return null;
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function getAllProducts() {
  return getAllFromStore('products');
}

export async function searchProducts(searchTerm = '', sectorFilter = '', corridorFilter = '') {
  const all = await getAllProducts();
  const term = searchTerm.toLowerCase().trim();

  return all.filter((p) => {
    const matchTerm = !term ||
      (p.name && p.name.toLowerCase().includes(term)) ||
      (p.barcode && p.barcode.toLowerCase().includes(term));
    const matchSector = !sectorFilter || sectorFilter === 'TODOS' || p.sector === sectorFilter;
    const matchCorridor = !corridorFilter || corridorFilter === 'TODOS' || p.corridor === corridorFilter;

    return matchTerm && matchSector && matchCorridor;
  });
}

// Salva ou atualiza produto garantindo código de barras ÚNICO
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
  const productData = {
    id: product.id || generateId(),
    barcode: product.barcode.trim(),
    name: product.name ? product.name.trim() : '',
    image: product.image || '',
    sector: product.sector || 'MERCEARIA',
    corridor: product.corridor || 'CORREDOR 01',
    created_at: product.created_at || now,
    updated_at: now
  };

  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['products', 'sync_queue'], 'readwrite');
      const productStore = tx.objectStore('products');
      const syncStore = tx.objectStore('sync_queue');

      productStore.put(productData);

      // Adiciona na fila de sincronização
      syncStore.add({
        id: generateId(),
        operation: product.id ? 'UPSERT' : 'INSERT',
        table_name: 'products',
        record_id: productData.id,
        payload: productData,
        created_at: now,
        synced: 0
      });

      tx.oncomplete = () => resolve(productData);
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

// Exclui um produto por completo (produto, todas as validades e contagens)
export async function deleteProduct(productId) {
  if (!productId) return false;
  const db = await initDB();
  const now = new Date().toISOString();

  // 1. Busca todas as validades e contagens antes de deletar
  const expirations = await getProductExpirations(productId);
  const counts = await new Promise((resolve) => {
    try {
      const tx = db.transaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('product_id');
      const req = index.getAll(productId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['products', 'product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
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
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

// Exclui uma data de validade específica e suas contagens
export async function deleteProductExpiration(expirationId) {
  if (!expirationId) return false;
  const db = await initDB();
  const now = new Date().toISOString();

  // Busca contagens dessa validade
  const counts = await new Promise((resolve) => {
    try {
      const tx = db.transaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('expiration_id');
      const req = index.getAll(expirationId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
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
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

// ----------------------------------------------------
// VALIDADES DO PRODUTO (product_expirations)
// ----------------------------------------------------

export async function getAllExpirations() {
  return getAllFromStore('product_expirations');
}

export async function getProductExpirations(productId) {
  if (!productId) return [];
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('product_expirations', 'readonly');
      const store = tx.objectStore('product_expirations');
      const index = store.index('product_id');
      const req = index.getAll(productId);
      req.onsuccess = () => {
        const results = req.result || [];
        // Ordena por data de validade mais próxima
        results.sort((a, b) => (a.expiration_date > b.expiration_date ? 1 : -1));
        resolve(results);
      };
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

export async function getExpirationByProductAndDate(productId, expirationDate) {
  if (!productId || !expirationDate) return null;
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('product_expirations', 'readonly');
      const store = tx.objectStore('product_expirations');
      const index = store.index('product_and_date');
      const req = index.get([productId, expirationDate]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

export async function saveProductExpiration(productId, expirationDate) {
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

  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['product_expirations', 'sync_queue'], 'readwrite');
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
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

// ----------------------------------------------------
// CONTAGENS DE INVENTÁRIO (inventory_counts)
// ----------------------------------------------------

export async function getAllCounts() {
  return getAllFromStore('inventory_counts');
}

// Retorna as contagens mais recentes para cada local de uma validade específica
export async function getLatestCountsForExpiration(expirationId) {
  if (!expirationId) {
    return { countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false };
  }
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('expiration_id');
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
    } catch (e) {
      resolve({ countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false });
    }
  });
}

// Salva uma nova rodada de conferência para um produto e validade
export async function saveInventoryCounts(productId, expirationId, locationCounts, sessionId = null) {
  const now = new Date().toISOString();
  const db = await initDB();

  const countRecords = [];
  let totalCount = 0;

  Object.entries(locationCounts).forEach(([locationType, qty]) => {
    const quantity = Number(qty) || 0;
    totalCount += quantity;
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

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['inventory_counts', 'sync_queue'], 'readwrite');
      const countStore = tx.objectStore('inventory_counts');
      const syncStore = tx.objectStore('sync_queue');

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

      tx.oncomplete = () => resolve({ total: totalCount, countDate: now });
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
}

// Retorna histórico completo de um produto (datas, totais e detalhamento por local)
export async function getHistoryForProduct(productId) {
  if (!productId) return [];
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('inventory_counts', 'readonly');
      const store = tx.objectStore('inventory_counts');
      const index = store.index('product_id');
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
    } catch (e) {
      resolve([]);
    }
  });
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
// MÉTRICAS DO DASHBOARD INTELIGENTE
// ----------------------------------------------------

export async function getDashboardMetrics() {
  const [products, allExpirations, allCounts] = await Promise.all([
    getAllProducts(),
    getAllExpirations(),
    getAllCounts()
  ]);

  // Mapeia produto por id
  const productMap = {};
  products.forEach((p) => {
    productMap[p.id] = p;
  });

  // Calcula estoque mais recente por validade
  const expirationTotals = {};
  const expLastCounts = {};

  allCounts.forEach((c) => {
    if (!expLastCounts[c.expiration_id]) {
      expLastCounts[c.expiration_id] = {};
    }
    const currentForLoc = expLastCounts[c.expiration_id][c.location_type];
    const cTime = new Date(c.counted_at || c.created_at).getTime();
    const curTime = currentForLoc ? new Date(currentForLoc.counted_at || currentForLoc.created_at).getTime() : 0;
    if (!currentForLoc || cTime >= curTime) {
      expLastCounts[c.expiration_id][c.location_type] = c;
    }
  });

  Object.entries(expLastCounts).forEach(([expId, locObj]) => {
    let sum = 0;
    Object.values(locObj).forEach((item) => {
      sum += Number(item.quantity) || 0;
    });
    expirationTotals[expId] = sum;
  });

  // Categorização das validades
  const expiredProductsSet = new Set();
  let expiredUnits = 0;

  const upTo15DaysProductsSet = new Set();
  let upTo15DaysUnits = 0;

  const upTo30DaysProductsSet = new Set();
  let upTo30DaysUnits = 0;

  const upTo7DaysProductsSet = new Set();

  const upcomingList = [];

  allExpirations.forEach((exp) => {
    const product = productMap[exp.product_id];
    if (!product) return;

    const units = expirationTotals[exp.id] !== undefined ? expirationTotals[exp.id] : 0;
    const days = getDaysUntilExpiration(exp.expiration_date);

    if (days < 0) {
      // Vencidos
      expiredProductsSet.add(product.id);
      expiredUnits += units;
    } else if (days <= 15) {
      // Até 15 dias
      upTo15DaysProductsSet.add(product.id);
      upTo15DaysUnits += units;
      if (days <= 7) {
        upTo7DaysProductsSet.add(product.id);
      }
    } else if (days <= 30) {
      // Até 30 dias
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
        units
      });
    }
  });

  // Ordena próximos vencimentos por data mais próxima
  upcomingList.sort((a, b) => a.daysUntil - b.daysUntil);

  // Mensagem automática inteligente e curta
  let smartMessage = '✓ Tudo tranquilo por enquanto.';
  const totalExpired = expiredProductsSet.size;
  const total15Days = upTo15DaysProductsSet.size;
  const total7Days = upTo7DaysProductsSet.size;

  if (totalExpired > 0 && total15Days > 0) {
    smartMessage = `Você tem ${totalExpired} ${totalExpired === 1 ? 'produto vencido' : 'produtos vencidos'} e ${total15Days} ${total15Days === 1 ? 'produto vencendo' : 'produtos vencendo'} nos próximos 15 dias.`;
  } else if (totalExpired > 0) {
    smartMessage = `⚠ Atenção: Você tem ${totalExpired} ${totalExpired === 1 ? 'produto vencido' : 'produtos vencidos'}.`;
  } else if (total7Days > 0) {
    smartMessage = `⚠ Atenção: ${total7Days} ${total7Days === 1 ? 'produto vence' : 'produtos vencem'} nos próximos 7 dias.`;
  } else if (total15Days > 0) {
    smartMessage = `Você tem ${total15Days} ${total15Days === 1 ? 'produto vencendo' : 'produtos vencendo'} nos próximos 15 dias.`;
  }

  return {
    totalProductsCount: products.length,
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
    smartMessage,
    upcomingExpirations: upcomingList.slice(0, 10)
  };
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

  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['count_sessions', 'sync_queue'], 'readwrite');
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
      tx.onerror = (e) => reject(e.target.error);
    } catch (e) {
      reject(e);
    }
  });
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
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('sync_queue', 'readonly');
      const store = tx.objectStore('sync_queue');
      const index = store.index('synced');
      const req = index.getAll(0);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

export async function markQueueItemSynced(id) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('sync_queue', 'readwrite');
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
}

// ----------------------------------------------------
// SEED INICIAL COM PRODUTOS REAIS PARA TESTE
// ----------------------------------------------------

async function seedInitialDataIfEmpty(db) {
  const count = await new Promise((resolve) => {
    try {
      const tx = db.transaction('products', 'readonly');
      const store = tx.objectStore('products');
      const countReq = store.count();
      countReq.onsuccess = () => resolve(countReq.result || 0);
      countReq.onerror = () => resolve(0);
    } catch (e) {
      resolve(0);
    }
  });

  if (count > 0) return;

  const formatDate = (daysOffset) => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const initialProducts = [
    {
      id: 'prod_1',
      barcode: '7896253401809',
      name: 'BISCOITO RANCHEIRO 90G',
      image: '',
      sector: 'MERCEARIA',
      corridor: 'CORREDOR 03',
      expirations: [
        { id: 'exp_1_1', date: formatDate(3), locations: { 'DEPÓSITO': 50, 'PRATELEIRA': 100 } },
        { id: 'exp_1_2', date: formatDate(34), locations: { 'DEPÓSITO': 80, 'PRATELEIRA': 210, 'ILHA': 30 } }
      ]
    },
    {
      id: 'prod_2',
      barcode: '7891000100103',
      name: 'LEITE ITAMBÉ INTEGRAL 1L',
      image: '',
      sector: 'MERCEARIA',
      corridor: 'CORREDOR 03',
      expirations: [
        { id: 'exp_2_1', date: formatDate(5), locations: { 'DEPÓSITO': 120, 'GELADEIRA': 80, 'PRATELEIRA': 120 } }
      ]
    },
    {
      id: 'prod_3',
      barcode: '7896253402509',
      name: 'ROSQUINHA RANCHEIRO COCO 500G',
      image: '',
      sector: 'MERCEARIA',
      corridor: 'CORREDOR 03',
      expirations: [
        { id: 'exp_3_1', date: formatDate(12), locations: { 'DEPÓSITO': 1000, 'PRATELEIRA': 500, 'ILHA': 148 } }
      ]
    },
    {
      id: 'prod_4',
      barcode: '7896001200331',
      name: 'AZEITE DE OLIVA EXTRA VIRGEM 500ML',
      image: '',
      sector: 'MERCEARIA',
      corridor: 'CORREDOR 04',
      expirations: [
        { id: 'exp_4_1', date: formatDate(-2), locations: { 'PRATELEIRA': 18 } },
        { id: 'exp_4_2', date: formatDate(25), locations: { 'DEPÓSITO': 45, 'PRATELEIRA': 60 } }
      ]
    },
    {
      id: 'prod_5',
      barcode: '7891025100014',
      name: 'ALHO NACIONAL ROXO GRANEL (KG)',
      image: '',
      sector: 'ALHO',
      corridor: 'CORREDOR 01',
      expirations: [
        { id: 'exp_5_1', date: formatDate(8), locations: { 'ILHA': 65, 'DEPÓSITO': 80 } }
      ]
    },
    {
      id: 'prod_6',
      barcode: '7891038501234',
      name: 'SABÃO EM PÓ OMO LAVAGEM PERFEITA 1.6KG',
      image: '',
      sector: 'LIMPEZA',
      corridor: 'CORREDOR 08',
      expirations: [
        { id: 'exp_6_1', date: formatDate(180), locations: { 'DEPÓSITO': 150, 'PRATELEIRA': 90 } }
      ]
    },
    {
      id: 'prod_7',
      barcode: '7896004000123',
      name: 'VINHO TINTO SECO RESERVADO 750ML',
      image: '',
      sector: 'BEBIDAS',
      corridor: 'ADEGA',
      expirations: [
        { id: 'exp_7_1', date: formatDate(240), locations: { 'PRATELEIRA': 42, 'DEPÓSITO': 60 } }
      ]
    },
    {
      id: 'prod_8',
      barcode: '7891000300456',
      name: 'SHAMPOO SEDA CERAMIDAS 325ML',
      image: '',
      sector: 'PERFUMARIA',
      corridor: 'CORREDOR 06',
      expirations: [
        { id: 'exp_8_1', date: formatDate(-10), locations: { 'PRATELEIRA': 12 } },
        { id: 'exp_8_2', date: formatDate(45), locations: { 'DEPÓSITO': 36, 'PRATELEIRA': 24 } }
      ]
    }
  ];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(['products', 'product_expirations', 'inventory_counts'], 'readwrite');
      const prodStore = tx.objectStore('products');
      const expStore = tx.objectStore('product_expirations');
      const countStore = tx.objectStore('inventory_counts');

      const nowIso = new Date().toISOString();

      initialProducts.forEach((p) => {
        prodStore.put({
          id: p.id,
          barcode: p.barcode,
          name: p.name,
          image: p.image,
          sector: p.sector,
          corridor: p.corridor,
          created_at: nowIso,
          updated_at: nowIso
        });

        p.expirations.forEach((e) => {
          expStore.put({
            id: e.id,
            product_id: p.id,
            expiration_date: e.date,
            created_at: nowIso,
            updated_at: nowIso
          });

          Object.entries(e.locations).forEach(([loc, qty]) => {
            countStore.put({
              id: generateId(),
              product_id: p.id,
              expiration_id: e.id,
              count_session_id: null,
              location_type: loc,
              quantity: qty,
              counted_at: nowIso,
              created_at: nowIso,
              updated_at: nowIso
            });
          });
        });
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
}
