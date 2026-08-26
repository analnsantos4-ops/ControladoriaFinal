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

function getSupabaseHeaders(prefer = 'resolution=merge-duplicates') {
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
      counted_at: payload.counted_at || new Date().toISOString()
    };
  }

  if (tableName === 'product_expirations') {
    return {
      id: String(payload.id),
      product_id: String(payload.product_id),
      expiration_date: String(payload.expiration_date),
      updated_at: new Date().toISOString()
    };
  }

  return payload;
}

async function pushToSupabase(tableName, operation, rawPayload) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  try {
    if (operation === 'DELETE') {
      const delUrl = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${rawPayload.id}`;
      const res = await fetch(delUrl, { method: 'DELETE', headers: getSupabaseHeaders('return=minimal') });
      return res.ok;
    }

    const payload = cleanPayloadForSupabase(tableName, rawPayload);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${tableName}`, {
      method: 'POST',
      headers: getSupabaseHeaders(),
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      lastSyncError = null;
      return true;
    }
    
    const errText = await response.text();
    console.error(`Erro no Supabase (${tableName}):`, errText);
    lastSyncError = errText;
    return false;
  } catch (error) {
    lastSyncError = error.message;
    return false;
  }
}

export async function processSyncQueue() {
  if (isSyncing || !navigator.onLine) return;
  isSyncing = true;
  notifyStatus();

  try {
    const queue = await getUnsyncedQueue();
    for (const item of queue) {
      const success = await pushToSupabase(item.table_name, item.operation || 'UPSERT', item.payload);
      if (success) {
        await markQueueItemSynced(item.id);
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
  if (!navigator.onLine) return false;
  try {
    const headers = getSupabaseHeaders('return=representation');
    const [prodRes, expRes, countRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/product_expirations?select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/inventory_counts?select=*`, { headers })
    ]);

    if (prodRes.ok && expRes.ok && countRes.ok) {
      const products = await prodRes.json();
      const expirations = await expRes.json();
      const counts = await countRes.json();

      const db = await initDB();
      const tx = db.transaction(['products', 'product_expirations', 'inventory_counts'], 'readwrite');
      
      products.forEach(p => tx.objectStore('products').put(p));
      expirations.forEach(e => tx.objectStore('product_expirations').put(e));
      counts.forEach(c => tx.objectStore('inventory_counts').put(c));

      return true;
    }
  } catch (err) {
    console.error('Erro ao puxar dados:', err);
  }
  return false;
}

export async function triggerSyncNow() {
  return processSyncQueue();
}

export function initSyncEngine() {
  window.addEventListener('online', processSyncQueue);
  setInterval(processSyncQueue, 30000); // 30 segundos
  processSyncQueue();
}

export async function checkSupabaseHealth() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id&limit=1`, {
            method: 'GET',
            headers: getSupabaseHeaders()
        });
        return { connected: res.ok };
    } catch (e) {
        return { connected: false, message: e.message };
    }
}

export async function syncAllLocalDataToSupabase() {
    return processSyncQueue();
}

export async function wipeSupabaseCloudData() {
    // Implementar se necessário para zerar o banco remoto
    console.warn("Wipe cloud não implementado por segurança via JS.");
    return true;
}