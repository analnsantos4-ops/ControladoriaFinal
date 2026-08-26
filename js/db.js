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

      if (!db.objectStoreNames.contains('products')) {
        const productStore = db.createObjectStore('products', { keyPath: 'id' });
        productStore.createIndex('barcode', 'barcode', { unique: true });
        productStore.createIndex('sector', 'sector', { unique: false });
        productStore.createIndex('corridor', 'corridor', { unique: false });
        productStore.createIndex('name', 'name', { unique: false });
        productStore.createIndex('updated_at', 'updated_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('product_expirations')) {
        const expStore = db.createObjectStore('product_expirations', { keyPath: 'id' });
        expStore.createIndex('product_id', 'product_id', { unique: false });
        expStore.createIndex('expiration_date', 'expiration_date', { unique: false });
        expStore.createIndex('product_and_date', ['product_id', 'expiration_date'], { unique: true });
      }

      if (!db.objectStoreNames.contains('count_sessions')) {
        const sessionStore = db.createObjectStore('count_sessions', { keyPath: 'id' });
        sessionStore.createIndex('date', 'date', { unique: false });
        sessionStore.createIndex('status', 'status', { unique: false });
        sessionStore.createIndex('sector_corridor', ['sector', 'corridor'], { unique: false });
      }

      if (!db.objectStoreNames.contains('inventory_counts')) {
        const countStore = db.createObjectStore('inventory_counts', { keyPath: 'id' });
        countStore.createIndex('product_id', 'product_id', { unique: false });
        countStore.createIndex('expiration_id', 'expiration_id', { unique: false });
        countStore.createIndex('count_session_id', 'count_session_id', { unique: false });
        countStore.createIndex('counted_at', 'counted_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('sync_queue')) {
        const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id' });
        syncStore.createIndex('synced', 'synced', { unique: false });
        syncStore.createIndex('created_at', 'created_at', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('Erro ao abrir IndexedDB:', event.target.error);
      dbInitPromise = null;
      reject(event.target.error);
    };
  });

  return dbInitPromise;
}

export async function getAllFromStore(storeName) {
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

// PRODUTOS
export async function getProductByBarcode(barcode) {
  if (!barcode) return null;
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const req = db.transaction('products', 'readonly')
        .objectStore('products')
        .index('barcode')
        .get(String(barcode).trim());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function getProductById(id) {
  if (!id) return null;
  const db = await initDB();
  return new Promise((resolve) => {
    try {
      const req = db.transaction('products', 'readonly').objectStore('products').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

export async function getAllProducts() {
  return getAllFromStore('products');
}

export async function searchProducts(searchTerm = '', sectorFilter = '', corridorFilter = '') {
  const all = await getAllProducts();
  const term = searchTerm.toLowerCase().trim();
  return all.filter((p) => {
    const matchTerm = !term || (p.name && p.name.toLowerCase().includes(term)) || (p.barcode && String(p.barcode).toLowerCase().includes(term));
    const matchSector = !sectorFilter || sectorFilter === 'TODOS' || p.sector === sectorFilter;
    const matchCorridor = !corridorFilter || corridorFilter === 'TODOS' || p.corridor === corridorFilter;
    return matchTerm && matchSector && matchCorridor;
  });
}

export async function saveProduct(product) {
  if (!product?.barcode) throw new Error('Código de barras é obrigatório.');
  const db = await initDB();
  const now = new Date().toISOString();
  
  const productData = {
    ...product,
    id: product.id || generateId(),
    name: product.name?.toUpperCase(),
    updated_at: now,
    created_at: product.created_at || now
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['products', 'sync_queue'], 'readwrite');
    tx.objectStore('products').put(productData);
    tx.objectStore('sync_queue').add({
      id: generateId(),
      operation: 'UPSERT',
      table_name: 'products',
      payload: productData,
      created_at: now,
      synced: 0
    });
    tx.oncomplete = () => resolve(productData);
    tx.onerror = () => reject();
  });
}

// VALIDADES
export async function getAllExpirations() {
  return getAllFromStore('product_expirations');
}

export async function getProductExpirations(productId) {
  if (!productId) return [];
  const db = await initDB();
  return new Promise((resolve) => {
    const req = db.transaction('product_expirations', 'readonly')
      .objectStore('product_expirations').index('product_id').getAll(productId);
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.expiration_date.localeCompare(b.expiration_date)));
    req.onerror = () => resolve([]);
  });
}

export async function getExpirationByProductAndDate(productId, expirationDate) {
  const db = await initDB();
  return new Promise((resolve) => {
    const req = db.transaction('product_expirations', 'readonly')
      .objectStore('product_expirations').index('product_and_date').get([productId, expirationDate]);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

export async function saveProductExpiration(productId, expirationDate) {
  const existing = await getExpirationByProductAndDate(productId, expirationDate);
  if (existing) return { isNew: false, expiration: existing };

  const db = await initDB();
  const now = new Date().toISOString();
  const expData = { id: generateId(), product_id: productId, expiration_date: expirationDate, created_at: now, updated_at: now };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['product_expirations', 'sync_queue'], 'readwrite');
    tx.objectStore('product_expirations').put(expData);
    tx.objectStore('sync_queue').add({
      id: generateId(),
      operation: 'INSERT',
      table_name: 'product_expirations',
      payload: expData,
      created_at: now,
      synced: 0
    });
    tx.oncomplete = () => resolve({ isNew: true, expiration: expData });
    tx.onerror = () => reject();
  });
}

// CONTAGENS (FUNÇÃO BLINDADA)
export async function getAllCounts() {
  return getAllFromStore('inventory_counts');
}

export async function getLatestCountsForExpiration(expirationId) {
  const db = await initDB();
  return new Promise((resolve) => {
    const req = db.transaction('inventory_counts', 'readonly').objectStore('inventory_counts').index('expiration_id').getAll(expirationId);
    req.onsuccess = () => {
      const counts = req.result || [];
      const latestByLocation = {};
      let total = 0;
      counts.forEach(c => {
        const current = latestByLocation[c.location_type];
        if (!current || new Date(c.counted_at) > new Date(current.counted_at)) {
          latestByLocation[c.location_type] = c;
        }
      });
      const finalCounts = {};
      Object.entries(latestByLocation).forEach(([loc, reg]) => {
        finalCounts[loc] = reg.quantity;
        total += reg.quantity;
      });
      resolve({ countsByLocation: finalCounts, total, hasPreviousCount: counts.length > 0 });
    };
    req.onerror = () => resolve({ countsByLocation: {}, total: 0, hasPreviousCount: false });
  });
}

export async function saveInventoryCounts(productId, expirationId, locationCounts = {}, sessionId = null) {
  const now = new Date().toISOString();
  const db = await initDB();

  // 1. Normalizar e calcular total
  const normalizedCounts = {
    'DEPÓSITO': Number(locationCounts['DEPÓSITO']) || 0,
    'GELADEIRA': Number(locationCounts['GELADEIRA']) || 0,
    'PRATELEIRA': Number(locationCounts['PRATELEIRA']) || 0,
    'PONTA DE GÔNDOLA': Number(locationCounts['PONTA DE GÔNDOLA']) || 0,
    'ORELHA': Number(locationCounts['ORELHA']) || 0,
    'ILHA': Number(locationCounts['ILHA']) || 0,
    'CARRINHO': Number(locationCounts['CARRINHO']) || 0,
    'FRENTE DE LOJA': Number(locationCounts['FRENTE DE LOJA']) || 0
  };

  const totalCount = Object.values(normalizedCounts).reduce((a, b) => a + b, 0);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(['products', 'inventory_counts', 'sync_queue'], 'readwrite');
    const prodStore = tx.objectStore('products');
    const countStore = tx.objectStore('inventory_counts');
    const syncStore = tx.objectStore('sync_queue');

    // 2. Atualizar Produto (Resumo de Quantidades)
    prodStore.get(productId).onsuccess = (e) => {
      const product = e.target.result;
      if (product) {
        product.total_quantity = totalCount;
        product.deposit_qty = normalizedCounts['DEPÓSITO'];
        product.fridge_qty = normalizedCounts['GELADEIRA'];
        product.shelf_qty = normalizedCounts['PRATELEIRA'];
        product.gondola_end_qty = normalizedCounts['PONTA DE GÔNDOLA'];
        product.ear_qty = normalizedCounts['ORELHA'];
        product.island_qty = normalizedCounts['ILHA'];
        product.cart_qty = normalizedCounts['CARRINHO'];
        product.checkout_qty = normalizedCounts['FRENTE DE LOJA'];
        product.last_count_date = now;
        product.updated_at = now;
        prodStore.put(product);
        
        syncStore.add({
          id: generateId(),
          operation: 'UPSERT',
          table_name: 'products',
          payload: product,
          created_at: now,
          synced: 0
        });
      }
    };

    // 3. Salvar Registros Individuais de Contagem
    Object.entries(normalizedCounts).forEach(([loc, qty]) => {
      const record = {
        id: generateId(),
        product_id: productId,
        expiration_id: expirationId,
        count_session_id: sessionId,
        location_type: loc,
        quantity: qty,
        counted_at: now,
        created_at: now
      };
      countStore.put(record);
      syncStore.add({
        id: generateId(),
        operation: 'INSERT',
        table_name: 'inventory_counts',
        payload: record,
        created_at: now,
        synced: 0
      });
    });

    tx.oncomplete = () => resolve({ total: totalCount, date: now });
    tx.onerror = () => reject();
  });
}

// SALVAMENTO COMPLETO (USADO NO CADASTRO NOVO)
export async function saveCompleteProductWithCounts({ product, expirationDate, locationCounts = {} }) {
  const db = await initDB();
  const now = new Date().toISOString();
  const productId = product.id || generateId();
  const expDate = expirationDate || getTodayISO();

  // Salva Produto e Validade primeiro
  await saveProduct({ ...product, id: productId });
  const { expiration } = await saveProductExpiration(productId, expDate);
  
  // Salva as contagens usando a função blindada acima
  return await saveInventoryCounts(productId, expiration.id, locationCounts);
}

// EXCLUSÕES
export async function deleteProduct(productId) {
  const db = await initDB();
  const now = new Date().toISOString();
  return new Promise((resolve) => {
    const tx = db.transaction(['products', 'product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
    tx.objectStore('products').delete(productId);
    tx.objectStore('sync_queue').add({ id: generateId(), operation: 'DELETE', table_name: 'products', payload: { id: productId }, created_at: now, synced: 0 });
    tx.oncomplete = () => resolve(true);
  });
}

export async function deleteProductExpiration(expirationId) {
  const db = await initDB();
  const now = new Date().toISOString();
  return new Promise((resolve) => {
    const tx = db.transaction(['product_expirations', 'inventory_counts', 'sync_queue'], 'readwrite');
    tx.objectStore('product_expirations').delete(expirationId);
    tx.objectStore('sync_queue').add({ id: generateId(), operation: 'DELETE', table_name: 'product_expirations', payload: { id: expirationId }, created_at: now, synced: 0 });
    tx.oncomplete = () => resolve(true);
  });
}

// DASHBOARD E MÉTRICAS
export async function getDashboardMetrics() {
  const [products, allExpirations, allCounts] = await Promise.all([
    getAllProducts(),
    getAllExpirations(),
    getAllCounts()
  ]);

  const expiredSet = new Set();
  const upTo15Set = new Set();
  let expiredUnits = 0;

  allExpirations.forEach(exp => {
    const days = getDaysUntilExpiration(exp.expiration_date);
    if (days < 0) expiredSet.add(exp.product_id);
    else if (days <= 15) upTo15Set.add(exp.product_id);
  });

  return {
    totalProductsCount: products.length,
    expired: { productsCount: expiredSet.size, unitsCount: 0 },
    upTo15Days: { productsCount: upTo15Set.size, unitsCount: 0 },
    smartStatus: expiredSet.size > 0 ? 'danger' : (upTo15Set.size > 0 ? 'warning' : 'ok'),
    smartTitle: expiredSet.size > 0 ? 'Produtos Vencidos!' : 'Estoque em Dia',
    smartMessage: expiredSet.size > 0 ? `Existem ${expiredSet.size} itens vencidos.` : 'Tudo certo por aqui.',
    upcomingExpirations: []
  };
}

// SESSÕES
export async function saveSession(session) {
  const db = await initDB();
  const sessionData = { ...session, id: session.id || generateId(), updated_at: new Date().toISOString() };
  return new Promise((resolve) => {
    const tx = db.transaction(['count_sessions'], 'readwrite');
    tx.objectStore('count_sessions').put(sessionData);
    tx.oncomplete = () => {
      localStorage.setItem('active_audit_session', JSON.stringify(sessionData));
      resolve(sessionData);
    };
  });
}

export function getActiveSession() {
  const s = localStorage.getItem('active_audit_session');
  return s ? JSON.parse(s) : null;
}

export function clearActiveSession() {
  localStorage.removeItem('active_audit_session');
}

export async function getUnsyncedQueue() {
  const db = await initDB();
  return new Promise((resolve) => {
    const req = db.transaction('sync_queue', 'readonly').objectStore('sync_queue').index('synced').getAll(0);
    req.onsuccess = () => resolve(req.result || []);
  });
}

export async function markQueueItemSynced(id) {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    store.get(id).onsuccess = (e) => {
      const item = e.target.result;
      if (item) { item.synced = 1; store.put(item); }
    };
    tx.oncomplete = () => resolve(true);
  });
}

export async function clearAllDatabaseData() {
  const db = await initDB();
  return new Promise((resolve) => {
    const tx = db.transaction(['products', 'product_expirations', 'inventory_counts', 'count_sessions', 'sync_queue'], 'readwrite');
    tx.objectStore('products').clear();
    tx.objectStore('product_expirations').clear();
    tx.objectStore('inventory_counts').clear();
    tx.objectStore('count_sessions').clear();
    tx.objectStore('sync_queue').clear();
    tx.oncomplete = () => { localStorage.clear(); resolve(true); };
  });
}