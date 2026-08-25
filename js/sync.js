// Mecanismo de Sincronização Online/Offline com Supabase
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { getUnsyncedQueue, markQueueItemSynced } from './db.js';

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
    label: isOnline ? (isSyncing ? '↻ Sincronizando...' : '✓ Sincronizado') : '● Offline (Salvo no dispositivo)',
    className: isOnline ? (isSyncing ? 'status-syncing' : 'status-online') : 'status-offline'
  };

  if (statusOverride) {
    status = { ...status, ...statusOverride };
  }

  syncStatusCallbacks.forEach((cb) => cb(status));
}

// Executa a fila de sincronização em segundo plano
export async function processSyncQueue() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    notifyStatus();
    return;
  }

  if (isSyncing) return;
  isSyncing = true;
  notifyStatus();

  try {
    const queue = await getUnsyncedQueue();
    if (queue.length === 0) {
      isSyncing = false;
      notifyStatus();
      return;
    }

    for (const item of queue) {
      try {
        const success = await pushToSupabase(item.table_name, item.operation, item.payload);
        if (success) {
          await markQueueItemSynced(item.id);
        }
      } catch (err) {
        console.warn(`Sync item ${item.id} skipped (will retry):`, err);
      }
    }
  } catch (e) {
    console.warn('Sync error:', e);
  } finally {
    isSyncing = false;
    notifyStatus();
  }
}

// Envio REST direto para o PostgREST do Supabase
async function pushToSupabase(tableName, operation, payload) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  const url = `${SUPABASE_URL}/rest/v1/${tableName}`;
  const headers = {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates'
  };

  try {
    let method = 'POST';
    if (operation === 'DELETE') {
      method = 'DELETE';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(payload)
    });

    return response.ok || response.status === 409 || response.status === 201 || response.status === 200;
  } catch (error) {
    // Falha de rede ou CORS -> offline, tenta novamente mais tarde
    return false;
  }
}

// Inicializa listeners de rede
export function initSyncEngine() {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      notifyStatus();
      processSyncQueue();
    });

    window.addEventListener('offline', () => {
      notifyStatus();
    });

    // Tenta sincronizar a cada 45 segundos se estiver online
    setInterval(() => {
      if (navigator.onLine && !isSyncing) {
        processSyncQueue();
      }
    }, 45000);
  }

  notifyStatus();
}
