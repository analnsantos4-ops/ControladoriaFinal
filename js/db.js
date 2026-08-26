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
    } catch {
      resolve(null);
    }
  });
}

export async function getProductById(id) {
  if (!id) return null;
  const db = await initDB();

  return new Promise((resolve) => {
    try {
      const req = db.transaction('products', 'readonly')
        .objectStore('products')
        .get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
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
    const matchTerm =
      !term ||
      (p.name && p.name.toLowerCase().includes(term)) ||
      (p.barcode && String(p.barcode).toLowerCase().includes(term));

    const matchSector =
      !sectorFilter || sectorFilter === 'TODOS' || p.sector === sectorFilter;

    const matchCorridor =
      !corridorFilter || corridorFilter === 'TODOS' || p.corridor === corridorFilter;

    return matchTerm && matchSector && matchCorridor;
  });
}

export async function saveProduct(product) {
  if (!product?.barcode) {
    throw new Error('Código de barras é obrigatório.');
  }

  const existingWithBarcode = await getProductByBarcode(product.barcode);

  if (existingWithBarcode && existingWithBarcode.id !== product.id) {
    const error = new Error('Este código de barras já pertence a outro produto.');
    error.existingProduct = existingWithBarcode;
    throw error;
  }

  const now = new Date().toISOString();
  const existing = product.id ? await getProductById(product.id) : null;

  const num = (value, fallback = 0) =>
    Number(value !== undefined ? value : fallback) || 0;

  const depositQty = num(product.deposit_qty, existing?.deposit_qty);
  const fridgeQty = num(product.fridge_qty, existing?.fridge_qty);
  const shelfQty = num(product.shelf_qty, existing?.shelf_qty);
  const gondolaEndQty = num(product.gondola_end_qty, existing?.gondola_end_qty);
  const earQty = num(product.ear_qty, existing?.ear_qty);
  const islandQty = num(product.island_qty, existing?.island_qty);
  const cartQty = num(product.cart_qty, existing?.cart_qty);
  const checkoutQty = num(product.checkout_qty, existing?.checkout_qty);

  const totalQty =
    depositQty + fridgeQty + shelfQty + gondolaEndQty +
    earQty + islandQty + cartQty + checkoutQty;

  const productData = {
    id: product.id || generateId(),
    barcode: String(product.barcode).trim(),
    name: product.name ? product.name.trim().toUpperCase() : (existing?.name || ''),
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
    last_expiration_date: product.last_expiration_date ?? existing?.last_expiration_date ?? null,
    last_count_date: product.last_count_date ?? existing?.last_count_date ?? now,
    created_at: product.created_at || existing?.created_at || now,
    updated_at: now
  };

  const db = await initDB();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['products', 'sync_queue'], 'readwrite');
      tx.objectStore('products').put(productData);
      tx.objectStore('sync_queue').add({
        id: generateId(),
        operation: 'UPSERT',
        table_name: 'products',
        record_id: productData.id,
        payload: productData,
        created_at: now,
        synced: 0
      });

      tx.oncomplete = () => resolve(productData);
      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = () => reject(tx.error || new Error('Transação abortada.'));
    } catch (e) {
      reject(e);
    }
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
    try {
      const req = db.transaction('product_expirations', 'readonly')
        .objectStore('product_expirations')
        .index('product_id')
        .getAll(productId);

      req.onsuccess = () => {
        const results = req.result || [];
        results.sort((a, b) => String(a.expiration_date).localeCompare(String(b.expiration_date)));
        resolve(results);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getExpirationByProductAndDate(productId, expirationDate) {
  if (!productId || !expirationDate) return null;
  const db = await initDB();

  return new Promise((resolve) => {
    try {
      const req = db.transaction('product_expirations', 'readonly')
        .objectStore('product_expirations')
        .index('product_and_date')
        .get([productId, expirationDate]);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveProductExpiration(productId, expirationDate) {
  if (!productId || !expirationDate) {
    throw new Error('Produto e data de validade são obrigatórios.');
  }

  const existing = await getExpirationByProductAndDate(productId, expirationDate);
  if (existing) return { isNew: false, expiration: existing };

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
      tx.objectStore('product_expirations').put(expData);
      tx.objectStore('sync_queue').add({
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

// CONTAGENS
export async function getAllCounts() {
  return getAllFromStore('inventory_counts');
}

export async function getLatestCountsForExpiration(expirationId) {
  if (!expirationId) {
    return { countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false };
  }

  const db = await initDB();

  return new Promise((resolve) => {
    try {
      const req = db.transaction('inventory_counts', 'readonly')
        .objectStore('inventory_counts')
        .index('expiration_id')
        .getAll(expirationId);

      req.onsuccess = () => {
        const counts = req.result || [];
        if (!counts.length) {
          resolve({ countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false });
          return;
        }

        const latestByLocation = {};

        counts.forEach((item) => {
          const old = latestByLocation[item.location_type];
          const itemTime = new Date(item.counted_at || item.created_at).getTime();
          const oldTime = old ? new Date(old.counted_at || old.created_at).getTime() : -Infinity;

          if (!old || itemTime > oldTime) {
            latestByLocation[item.location_type] = item;
          }
        });

        const countsByLocation = {};
        let total = 0;

        Object.entries(latestByLocation).forEach(([loc, item]) => {
          const quantity = Number(item.quantity) || 0;
          countsByLocation[loc] = quantity;
          total += quantity;
        });

        const mostRecent = counts.reduce((latest, item) => {
          const latestTime = latest ? new Date(latest.counted_at || latest.created_at).getTime() : -Infinity;
          const itemTime = new Date(item.counted_at || item.created_at).getTime();
          return itemTime > latestTime ? item : latest;
        }, null);

        resolve({
          countsByLocation,
          total,
          lastCountDate: mostRecent ? (mostRecent.counted_at || mostRecent.created_at) : null,
          hasPreviousCount: true
        });
      };

      req.onerror = () => resolve({ countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false });
    } catch {
      resolve({ countsByLocation: {}, total: 0, lastCountDate: null, hasPreviousCount: false });
    }
  });
}

export async function saveInventoryCounts(productId, expirationId, locationCounts = {}, sessionId = null) {
  if (!productId || !expirationId) {
    throw new Error('Produto e validade são obrigatórios.');
  }

  const now = new Date().toISOString();
  const db = await initDB();

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

  const totalCount = Object.values(normalizedCounts)
    .reduce((total, qty) => total + qty, 0);

  const countRecords = Object.entries(normalizedCounts).map(([location_type, quantity]) => ({
    id: generateId(),
    product_id: productId,
    expiration_id: expirationId,
    count_session_id: sessionId,
    location_type,
    quantity,
    counted_at: now,
    created_at: now,
    updated_at: now
  }));

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(['products', 'inventory_counts', 'sync_queue'], 'readwrite');
      const prodStore = tx.objectStore('products');
      const countStore = tx.objectStore('inventory_counts');
      const syncStore = tx.objectStore('sync_queue');

      const prodReq = prodStore.get(productId);

      prodReq.onerror = () => {
        try { tx.abort(); } catch {}
        reject(prodReq.error);
      };

      prodReq.onsuccess = () => {
        const product = prodReq.result;

        if (!product) {
          try { tx.abort(); } catch {}
          reject(new Error(`Produto ${productId} não encontrado.`));
          return;
        }

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
          record_id: product.id,
          payload: product,
          created_at: now,
          synced: 0
        });

        countRecords.forEach((record) => {
          countStore.put(record);

          syncStore.add({
            id: generateId(),
            operation: 'UPSERT',
            table_name: 'inventory_counts',
            record_id: record.id,
            payload: record,
            created_at: now,
            synced: 0
          });
        });
      };

      tx.oncomplete = () => resolve({
        total: totalCount,
        countDate: now,
        locations: normalizedCounts
      });

      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = () => reject(tx.error || new Error('Transação abortada.'));
    } catch (error) {
      reject(error);
    }
  });
}

// SALVAMENTO COMPLETO
export async function saveCompleteProductWithCounts({ product, expirationDate, locationCounts = {} }) {
  if (!product?.barcode) throw new Error('Código de barras é obrigatório.');

  const existingByBarcode = await getProductByBarcode(product.barcode);
  const productId = product.id || existingByBarcode?.id || generateId();

  if (existingByBarcode && product.id && existingByBarcode.id !== product.id) {
    throw new Error('Este código de barras já pertence a outro produto.');
  }

  const existingProduct = await getProductById(productId);
  const now = new Date().toISOString();
  const finalExpirationDate = expirationDate || getTodayISO();

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

  const totalQty = Object.values(normalizedCounts).reduce((a, b) => a + b, 0);

  const existingExpiration = await getExpirationByProductAndDate(productId, finalExpirationDate);
  const expirationId = existingExpiration?.id || generateId();

  const productData = {
    id: productId,
    barcode: String(product.barcode).trim(),
    name: product.name ? product.name.trim().toUpperCase() : (existingProduct?.name || ''),
    image: product.image !== undefined ? product.image : (existingProduct?.image || ''),
    sector: product.sector || existingProduct?.sector || 'MERCEARIA',
    corridor: product.corridor || existingProduct?.corridor || 'CORREDOR 01',
    total_quantity: totalQty,
    deposit_qty: normalizedCounts['DEPÓSITO'],
    fridge_qty: normalizedCounts['GELADEIRA'],
    shelf_qty: normalizedCounts['PRATELEIRA'],
    gondola_end_qty: normalizedCounts['PONTA DE GÔNDOLA'],
    ear_qty: normalizedCounts['ORELHA'],
    island_qty: normalizedCounts['ILHA'],
    cart_qty: normalizedCounts['CARRINHO'],
    checkout_qty: normalizedCounts['FRENTE DE LOJA'],
    last_expiration_date: finalExpirationDate,
    last_count_date: now,
    created_at: product.created_at || existingProduct?.created_at || now,
    updated_at: now
  };

  const expirationData = {
    id: expirationId,
    product_id: productId,
    expiration_date: finalExpirationDate,
    created_at: existingExpiration?.created_at || now,
    updated_at: now
  };

  const countRecords = Object.entries(normalizedCounts).map(([location_type, quantity]) => ({
    id: generateId(),
    product_id: productId,
    expiration_id: expirationId,
    count_session_id: null,
    location_type,
    quantity,
    counted_at: now,
    created_at: now,
    updated_at: now
  }));

  const db = await initDB();

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(
        ['products', 'product_expirations', 'inventory_counts', 'sync_queue'],
        'readwrite'
      );

      const prodStore = tx.objectStore('products');
      const expStore = tx.objectStore('product_expirations');
      const countStore = tx.objectStore('inventory_counts');
      const syncStore = tx.objectStore('sync_queue');

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

      expStore.put(expirationData);
      syncStore.add({
        id: generateId(),
        operation: existingExpiration ? 'UPSERT' : 'INSERT',
        table_name: 'product_expirations',
        record_id: expirationId,
        payload: expirationData,
        created_at: now,
        synced: 0
      });

      countRecords.forEach((cnt) => {
        countStore.put(cnt);
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

      tx.oncomplete = () => resolve({
        product: productData,
        expiration: expirationData,
        counts: countRecords,
        total: totalQty
      });

      tx.onerror = (e) => reject(e.target.error);
      tx.onabort = () => reject(tx.error || new Error('Transação abortada.'));
    } catch (err) {
      reject(err);
    }
  });
}

// EXCLUSÕES
export async function deleteProduct(productId) {
  if (!productId) return false;

  const now = new Date().toISOString();
  const db = await initDB();
  const expirations = await getProductExpirations(productId);

  const counts = await new Promise((resolve) => {
    try {
      const req = db.transaction('inventory_counts', 'readonly')
        .objectStore('inventory_counts')
        .index('product_id')
        .getAll(productId);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(
        ['products', 'product_expirations', 'inventory_counts', 'sync_queue'],
        'readwrite'
      );

      const prodStore = tx.objectStore('products');
      const expStore = tx.objectStore('product_expirations');
      const countStore = tx.objectStore('inventory_counts');
      const syncStore = tx.objectStore('sync_queue');

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

export async function deleteProductExpiration(expirationId) {
  if (!expirationId) return false;

  const now = new Date().toISOString();
  const db = await initDB();

  const counts = await new Promise((resolve) => {
    try {
      const req = db.transaction('inventory_counts', 'readonly')
        .objectStore('inventory_counts')
        .index('expiration_id')
        .getAll(expirationId);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(
        ['product_expirations', 'inventory_counts', 'sync_queue'],
        'readwrite'
      );

      const expStore = tx.objectStore('product_expirations');
      const countStore = tx.objectStore('inventory_counts');
      const syncStore = tx.objectStore('sync_queue');

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

// HISTÓRICO
export async function getHistoryForProduct(productId) {
  if (!productId) return [];

  const db = await initDB();

  return new Promise((resolve) => {
    try {
      const req = db.transaction('inventory_counts', 'readonly')
        .objectStore('inventory_counts')
        .index('product_id')
        .getAll(productId);

      req.onsuccess = () => {
        const groups = {};

        (req.result || []).forEach((item) => {
          const dateKey = item.counted_at || item.created_at || item.id;

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

        resolve(
          Object.values(groups).sort(
            (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
          )
        );
      };

      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function getLocationHistoryForProduct(productId) {
  const history = await getHistoryForProduct(productId);
  const locationBreakdown = {};

  history.forEach((entry) => {
    Object.entries(entry.locations).forEach(([loc, qty]) => {
      if (!locationBreakdown[loc]) locationBreakdown[loc] = [];
      locationBreakdown[loc].push({
        date: entry.date,
        quantity: qty
      });
    });
  });

  return locationBreakdown;
}

// DASHBOARD
export async function getDashboardMetrics() {
  const [products, allExpirations, allCounts] = await Promise.all([
    getAllProducts(),
    getAllExpirations(),
    getAllCounts()
  ]);

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));
  const expirationLastCounts = {};

  allCounts.forEach((count) => {
    if (!expirationLastCounts[count.expiration_id]) {
      expirationLastCounts[count.expiration_id] = {};
    }

    const current = expirationLastCounts[count.expiration_id][count.location_type];
    const countTime = new Date(count.counted_at || count.created_at).getTime();
    const currentTime = current
      ? new Date(current.counted_at || current.created_at).getTime()
      : -Infinity;

    if (!current || countTime >= currentTime) {
      expirationLastCounts[count.expiration_id][count.location_type] = count;
    }
  });

  const expirationTotals = {};

  Object.entries(expirationLastCounts).forEach(([expirationId, locations]) => {
    expirationTotals[expirationId] = Object.values(locations)
      .reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  });

  const expiredProductsSet = new Set();
  const upTo15DaysProductsSet = new Set();
  const upTo30DaysProductsSet = new Set();
  const upTo7DaysProductsSet = new Set();

  let expiredUnits = 0;
  let upTo15DaysUnits = 0;
  let upTo30DaysUnits = 0;

  const upcomingList = [];

  allExpirations.forEach((exp) => {
    const product = productMap[exp.product_id];
    if (!product) return;

    const units = expirationTotals[exp.id] !== undefined
      ? expirationTotals[exp.id]
      : 0;

    const days = getDaysUntilExpiration(exp.expiration_date);

    if (days < 0) {
      expiredProductsSet.add(product.id);
      expiredUnits += units;
    } else if (days <= 15) {
      upTo15DaysProductsSet.add(product.id);
      upTo15DaysUnits += units;
      if (days <= 7) upTo7DaysProductsSet.add(product.id);
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
        units
      });
    }
  });

  upcomingList.sort((a, b) => a.daysUntil - b.daysUntil);

  const totalExpired = expiredProductsSet.size;
  const total15Days = upTo15DaysProductsSet.size;
  const total7Days = upTo7DaysProductsSet.size;

  let smartStatus = 'ok';
  let smartTitle = 'Estoque em dia';
  let smartText = 'Nenhum produto vencido ou com validade crítica.';
  let smartMessage = 'Tudo em dia no estoque.';

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
    smartStatus,
    smartTitle,
    smartText,
    smartMessage,
    upcomingExpirations: upcomingList.slice(0, 10)
  };
}

// SESSÕES
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
    const session = localStorage.getItem('active_audit_session');
    return session ? JSON.parse(session) : null;
  } catch {
    return null;
  }
}

export function clearActiveSession() {
  localStorage.removeItem('active_audit_session');
}

// FILA DE SINCRONIZAÇÃO
export async function getUnsyncedQueue() {
  const db = await initDB();

  return new Promise((resolve) => {
    try {
      const req = db.transaction('sync_queue', 'readonly')
        .objectStore('sync_queue')
        .index('synced')
        .getAll(0);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch {
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
      };

      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    } catch (e) {
      reject(e);
    }
  });
}

// LIMPAR BANCO LOCAL
export async function clearAllDatabaseData() {
  const db = await initDB();

  return new Promise((resolve, reject) => {
    try {
      const stores = [
        'products',
        'product_expirations',
        'inventory_counts',
        'count_sessions',
        'sync_queue'
      ];

      const tx = db.transaction(stores, 'readwrite');

      stores.forEach((storeName) => {
        tx.objectStore(storeName).clear();
      });

      tx.oncomplete = () => {
        localStorage.removeItem('active_audit_session');
        resolve(true);
      };

      tx.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}
