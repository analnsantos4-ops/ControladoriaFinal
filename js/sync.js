// Mecanismo de Sincronização em Tempo Real Online/Offline com Supabase
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { getUnsyncedQueue, markQueueItemSynced, initDB } from './db.js';

let isSyncing = false;
let syncStatusCallbacks = [];

export function registerSyncStatusListener(callback) {
  syncStatusCallbacks.push(callback);
  notifyStatus();
}

function notifyStatus(statusOverride = null) {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let status = {
    isOnline,
    isSyncing,
    label: isOnline ? (isSyncing ? '↻ Sincronizando...' : '✓ Supabase Conectado') : '● Offline (Salvo no dispositivo)',
    className: isOnline ? (isSyncing ? 'status-syncing' : 'status-online') : 'status-offline'
  };

  if (statusOverride) {
    status = { ...status, ...statusOverride };
  }

  syncStatusCallbacks.forEach((cb) => cb(status));
}

// Cabeçalhos padrão para o PostgREST do Supabase
function getSupabaseHeaders() {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };
}

// 1. Envio de alterações locais para o Supabase (Push)
export async function processSyncQueue() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    notifyStatus();
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || isSyncing) return;
  isSyncing = true;
  notifyStatus();

  try {
    const queue = await getUnsyncedQueue();
    if (queue && queue.length > 0) {
      for (const item of queue) {
        try {
          const success = await pushToSupabase(item.table_name, item.operation, item.payload);
          if (success) {
            await markQueueItemSynced(item.id);
          }
        } catch (err) {
          console.warn(`Sync item ${item.id} adiado:`, err);
        }
      }
    }

    // Após o push, faz o pull dos dados mais recentes da nuvem
    await pullFromSupabase();
  } catch (e) {
    console.warn('Sync error:', e);
  } finally {
    isSyncing = false;
    notifyStatus();
  }
}

// Envia registro unitário para o Supabase
async function pushToSupabase(tableName, operation, payload) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  try {
    let url = `${SUPABASE_URL}/rest/v1/${tableName}`;
    let method = 'POST';
    let headers = getSupabaseHeaders();
    let body = JSON.stringify(payload);

    if (operation === 'DELETE') {
      method = 'DELETE';
      url = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${payload.id}`;
      body = null;
    }

    const response = await fetch(url, {
      method,
      headers,
      body
    });

    return response.ok || response.status === 409 || response.status === 201 || response.status === 200 || response.status === 204;
  } catch (error) {
    console.warn('Push error para Supabase:', error);
    return false;
  }
}

// 2. Busca todos os dados da nuvem para atualizar outros celulares (Pull)
export async function pullFromSupabase() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return false;
  }

  try {
    const headers = {
      'apikey': SUPABASE_PUBLISHABLE_KEY,
      'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Accept': 'application/json'
    };

    const [prodRes, expRes, countRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/products?select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/product_expirations?select=*`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/inventory_counts?select=*`, { headers })
    ]);

    if (!prodRes.ok) return false;

    const products = prodRes.ok ? await prodRes.json() : [];
    const expirations = expRes.ok ? await expRes.json() : [];
    const counts = countRes.ok ? await countRes.json() : [];

    // Mescla no IndexedDB local sem recriar na sync_queue
    const db = await initDB();
    const tx = db.transaction(['products', 'product_expirations', 'inventory_counts'], 'readwrite');
    const prodStore = tx.objectStore('products');
    const expStore = tx.objectStore('product_expirations');
    const countStore = tx.objectStore('inventory_counts');

    for (const p of products) prodStore.put(p);
    for (const e of expirations) expStore.put(e);
    for (const c of counts) countStore.put(c);

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('Erro ao puxar dados do Supabase:', err);
    return false;
  }
}

// Limpa todos os dados de teste no Supabase
export async function wipeSupabaseCloudData() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
  const headers = getSupabaseHeaders();
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/inventory_counts?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/product_expirations?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/count_sessions?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/products?id=neq.none`, { method: 'DELETE', headers });
    return true;
  } catch (e) {
    console.warn('Erro ao limpar Supabase:', e);
    return false;
  }
}

// Inicializa motor de sincronização contínua
export function initSyncEngine() {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      notifyStatus();
      processSyncQueue();
    });

    window.addEventListener('offline', () => {
      notifyStatus();
    });

    // Puxa e envia dados ao iniciar
    setTimeout(() => {
      if (navigator.onLine) {
        processSyncQueue();
      }
    }, 1500);

    // Sincronização periódica a cada 30 segundos
    setInterval(() => {
      if (navigator.onLine && !isSyncing) {
        processSyncQueue();
      }
    }, 30000);
  }

  notifyStatus();
}
