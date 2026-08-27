// Mecanismo de Sincronização em Tempo Real Online/Offline com Supabase
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { getUnsyncedQueue, markQueueItemSynced, initDB, getAllFromStore } from './db.js';

let isSyncing = false;
let syncStatusCallbacks = [];
let lastSyncError = null;
let lastSyncErrorCode = null;

// SCRIPT SQL COMPLETO E ATUALIZADO
export const SUPABASE_SETUP_SQL = `-- ====================================================================
-- SCRIPT DE LIBERAÇÃO DE ACESSO E SINCRONIZAÇÃO NO SUPABASE
-- Execute este script no menu "SQL Editor" do seu painel Supabase
-- ====================================================================

-- 1. Tabela de Produtos (Com todas as colunas de quantidade)
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT DEFAULT 'MERCEARIA',
  corridor TEXT DEFAULT 'CORREDOR 01',
  image TEXT,
  total_quantity NUMERIC DEFAULT 0,
  deposit_qty NUMERIC DEFAULT 0,
  fridge_qty NUMERIC DEFAULT 0,
  shelf_qty NUMERIC DEFAULT 0,
  gondola_end_qty NUMERIC DEFAULT 0,
  ear_qty NUMERIC DEFAULT 0,
  island_qty NUMERIC DEFAULT 0,
  cart_qty NUMERIC DEFAULT 0,
  checkout_qty NUMERIC DEFAULT 0,
  last_expiration_date TEXT,
  last_count_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Validades
CREATE TABLE IF NOT EXISTS public.product_expirations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  expiration_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabela de Contagens (Histórico detalhado)
CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  expiration_id TEXT NOT NULL,
  count_session_id TEXT,
  location_type TEXT NOT NULL,
  quantity NUMERIC DEFAULT 0,
  counted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Permissões e Segurança
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_expirations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts DISABLE ROW LEVEL SECURITY;
`;

export function registerSyncStatusListener(callback) {
  syncStatusCallbacks.push(callback);
  notifyStatus();
}

export function getSyncStatus() {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let label = '✓ Conectado';
  let className = 'status-online';

  if (!isOnline) {
    label = '● Offline';
    className = 'status-offline';
  } else if (isSyncing) {
    label = '↻ Sincronizando...';
    className = 'status-syncing';
  } else if (lastSyncError) {
    label = '⚠ Erro de Sincronização';
    className = 'status-offline';
  }

  return { isOnline, isSyncing, label, className, lastError: lastSyncError };
}

function notifyStatus() {
  const status = getSyncStatus();
  syncStatusCallbacks.forEach((cb) => cb(status));
}

function getSupabaseGetHeaders() {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Accept': 'application/json'
  };
}

function getSupabasePostHeaders(prefer = 'resolution=merge-duplicates,return=minimal') {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': prefer
  };
}

// LIMPEZA E FORMATAÇÃO DE DADOS PARA O SUPABASE
function cleanPayloadForSupabase(tableName, payload) {
  if (!payload) return {};

  if (tableName === 'products') {
    return {
      id: String(payload.id),
      barcode: String(payload.barcode),
      name: String(payload.name || '').toUpperCase(),
      sector: String(payload.sector || 'MERCEARIA'),
      corridor: String(payload.corridor || 'CORREDOR 01'),
      image: payload.image || null,
      total_quantity: Number(payload.total_quantity) || 0,
      deposit_qty: Number(payload.deposit_qty) || 0,
      fridge_qty: Number(payload.fridge_qty) || 0,
      shelf_qty: Number(payload.shelf_qty) || 0,
      gondola_end_qty: Number(payload.gondola_end_qty) || 0,
      ear_qty: Number(payload.ear_qty) || 0,
      island_qty: Number(payload.island_qty) || 0,
      cart_qty: Number(payload.cart_qty) || 0,
      checkout_qty: Number(payload.checkout_qty) || 0,
      last_expiration_date: payload.last_expiration_date || null,
      last_count_date: payload.last_count_date || new Date().toISOString(),
      created_at: payload.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  if (tableName === 'product_expirations') {
    return {
      id: String(payload.id),
      product_id: String(payload.product_id),
      expiration_date: String(payload.expiration_date),
      created_at: payload.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  if (tableName === 'inventory_counts') {
    return {
      id: String(payload.id),
      product_id: String(payload.product_id),
      expiration_id: String(payload.expiration_id),
      count_session_id: payload.count_session_id || null,
      location_type: String(payload.location_type || 'PRATELEIRA'),
      quantity: Number(payload.quantity) || 0,
      counted_at: payload.counted_at || new Date().toISOString(),
      created_at: payload.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  return payload;
}

async function pushToSupabase(tableName, operation, rawPayload, skipParentCheck = false) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  try {
    if (operation === 'DELETE') {
      const delUrl = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${encodeURIComponent(rawPayload.id)}`;
      const res = await fetch(delUrl, { method: 'DELETE', headers: getSupabaseGetHeaders() });
      return res.ok || res.status === 404;
    }

    // Se for tabela filha (product_expirations ou inventory_counts), garante que o produto pai existe no Supabase
    if (!skipParentCheck && (tableName === 'product_expirations' || tableName === 'inventory_counts')) {
      const prodId = rawPayload.product_id;
      if (prodId) {
        try {
          const db = await initDB();
          const prod = await new Promise((res) => {
            try {
              const tx = db.transaction('products', 'readonly');
              const req = tx.objectStore('products').get(prodId);
              req.onsuccess = () => res(req.result || null);
              req.onerror = () => res(null);
            } catch (_) {
              res(null);
            }
          });
          if (prod) {
            await pushToSupabase('products', 'UPSERT', prod, true);
          }
        } catch (_) {}
      }
    }

    // Se for inventory_counts, garante que a validade pai também existe no Supabase
    if (!skipParentCheck && tableName === 'inventory_counts' && rawPayload.expiration_id) {
      try {
        const db = await initDB();
        const exp = await new Promise((res) => {
          try {
            const tx = db.transaction('product_expirations', 'readonly');
            const req = tx.objectStore('product_expirations').get(rawPayload.expiration_id);
            req.onsuccess = () => res(req.result || null);
            req.onerror = () => res(null);
          } catch (_) {
            res(null);
          }
        });
        if (exp) {
          await pushToSupabase('product_expirations', 'UPSERT', exp, true);
        }
      } catch (_) {}
    }

    const payload = cleanPayloadForSupabase(tableName, rawPayload);
    const postUrl = `${SUPABASE_URL}/rest/v1/${tableName}`;
    const response = await fetch(postUrl, {
      method: 'POST',
      headers: getSupabasePostHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(payload)
    });

    if (response.ok || response.status === 201 || response.status === 200 || response.status === 204) {
      lastSyncError = null;
      lastSyncErrorCode = null;
      return true;
    }

    // Fallback: Se retornar 409 ou 400, tenta PATCH
    if (response.status === 409 || response.status === 400) {
      const patchUrl = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${encodeURIComponent(payload.id)}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: getSupabasePostHeaders('return=minimal'),
        body: JSON.stringify(payload)
      });
      if (patchRes.ok || patchRes.status === 204) {
        lastSyncError = null;
        lastSyncErrorCode = null;
        return true;
      }
    }
    
    const errText = await response.text();
    console.warn(`[Supabase ${tableName}] Status ${response.status}:`, errText);
    lastSyncError = errText;
    return false;
  } catch (error) {
    console.warn(`[Supabase Network Error]:`, error);
    lastSyncError = error.message;
    return false;
  }
}

export async function processSyncQueue() {
  if (isSyncing || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  isSyncing = true;
  notifyStatus();

  try {
    const queue = await getUnsyncedQueue();
    if (queue && queue.length > 0) {
      // Ordena a fila para garantir integridade referencial:
      // Inserções: products -> product_expirations -> inventory_counts
      // Exclusões: inventory_counts -> product_expirations -> products
      const priorityMap = {
        'products': 1,
        'product_expirations': 2,
        'count_sessions': 3,
        'inventory_counts': 4
      };

      const sortedQueue = [...queue].sort((a, b) => {
        const isDelA = a.operation === 'DELETE';
        const isDelB = b.operation === 'DELETE';
        if (isDelA && !isDelB) return -1;
        if (!isDelA && isDelB) return 1;

        if (isDelA && isDelB) {
          return (priorityMap[b.table_name] || 99) - (priorityMap[a.table_name] || 99);
        }

        return (priorityMap[a.table_name] || 99) - (priorityMap[b.table_name] || 99);
      });

      for (const item of sortedQueue) {
        const success = await pushToSupabase(item.table_name, item.operation || 'UPSERT', item.payload);
        if (success) {
          await markQueueItemSynced(item.id);
        }
      }
    }
    await pullFromSupabase();
  } catch (e) {
    console.error('Falha na fila de sincronização:', e);
  } finally {
    isSyncing = false;
    notifyStatus();
  }
}

export async function pullFromSupabase() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return false;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  try {
    const headers = getSupabaseGetHeaders();
    
    // Função auxiliar tolerante a falhas por tabela
    const fetchTable = async (tableName) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}?select=*`, {
          method: 'GET',
          headers
        });
        if (res.ok) {
          return await res.json();
        }
        return null;
      } catch (err) {
        console.warn(`[Pull Supabase] Falha ao ler ${tableName}:`, err);
        return null;
      }
    };

    const [products, expirations, counts] = await Promise.all([
      fetchTable('products'),
      fetchTable('product_expirations'),
      fetchTable('inventory_counts')
    ]);

    if (!products && !expirations && !counts) {
      return false;
    }

    // Carrega produtos locais ANTES de abrir a transação de escrita para não inativar a transaction
    let localProducts = [];
    if (Array.isArray(products) && products.length > 0) {
      localProducts = await getAllFromStore('products');
    }
    const localMap = new Map(localProducts.map((p) => [p.id, p]));

    const db = await initDB();
    const tx = db.transaction(['products', 'product_expirations', 'inventory_counts'], 'readwrite');
    const prodStore = tx.objectStore('products');
    const expStore = tx.objectStore('product_expirations');
    const countStore = tx.objectStore('inventory_counts');

    if (Array.isArray(products) && products.length > 0) {
      products.forEach((p) => {
        const local = localMap.get(p.id);
        if (local && local.image && !p.image) {
          p.image = local.image;
        }
        prodStore.put(p);
      });
    }

    if (Array.isArray(expirations) && expirations.length > 0) {
      expirations.forEach((e) => expStore.put(e));
    }

    if (Array.isArray(counts) && counts.length > 0) {
      counts.forEach((c) => countStore.put(c));
    }

    lastSyncError = null;
    lastSyncErrorCode = null;

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('supabase-data-updated', {
            detail: { productsCount: products?.length || 0, countsCount: counts?.length || 0 }
          }));
        }
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.error('Erro ao puxar dados do Supabase:', err);
    return false;
  }
}

export async function triggerSyncNow() {
  return processSyncQueue();
}

export function initSyncEngine() {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      notifyStatus();
      processSyncQueue();
    });
    window.addEventListener('offline', () => {
      notifyStatus();
    });
    setInterval(processSyncQueue, 30000); // 30 segundos
    setTimeout(processSyncQueue, 500);
  }
}

export async function checkSupabaseHealth() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id&limit=1`, {
      method: 'GET',
      headers: getSupabaseGetHeaders()
    });
    return { connected: res.ok };
  } catch (e) {
    return { connected: false, message: e.message };
  }
}

export async function syncAllLocalDataToSupabase() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return { success: false, syncedCount: 0 };

  try {
    const [products, expirations, counts] = await Promise.all([
      getAllFromStore('products'),
      getAllFromStore('product_expirations'),
      getAllFromStore('inventory_counts')
    ]);

    let syncedCount = 0;
    // 1. Produtos primeiro
    for (const p of products) {
      const ok = await pushToSupabase('products', 'UPSERT', p, true);
      if (ok) syncedCount++;
    }
    // 2. Validades segundo
    for (const e of expirations) {
      await pushToSupabase('product_expirations', 'UPSERT', e, false);
    }
    // 3. Contagens terceiro
    for (const c of counts) {
      await pushToSupabase('inventory_counts', 'UPSERT', c, false);
    }

    return { success: true, syncedCount, totalProducts: products.length };
  } catch (err) {
    console.warn('Erro ao sincronizar dados locais para Supabase:', err);
    return { success: false, syncedCount: 0 };
  }
}

export async function wipeSupabaseCloudData() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
  const headers = getSupabaseGetHeaders();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/inventory_counts?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/product_expirations?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/count_sessions?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/products?id=neq.none`, { method: 'DELETE', headers });
    lastSyncError = null;
    lastSyncErrorCode = null;
    return true;
  } catch (e) {
    console.warn('Erro ao limpar Supabase:', e);
    return false;
  }
}