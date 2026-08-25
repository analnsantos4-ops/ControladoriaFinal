// Mecanismo de Sincronização em Tempo Real Online/Offline com Supabase
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { getUnsyncedQueue, markQueueItemSynced, initDB, getAllFromStore } from './db.js';

let isSyncing = false;
let syncStatusCallbacks = [];
let lastSyncError = null;

export function registerSyncStatusListener(callback) {
  syncStatusCallbacks.push(callback);
  notifyStatus();
}

function notifyStatus(statusOverride = null) {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
  let status = {
    isOnline,
    isSyncing,
    label: isOnline
      ? (isSyncing ? '↻ Sincronizando...' : (lastSyncError ? '⚠ Erro Nuvem (Toque)' : '✓ Supabase Conectado'))
      : '● Offline (Salvo no celular)',
    className: isOnline
      ? (isSyncing ? 'status-syncing' : (lastSyncError ? 'status-offline' : 'status-online'))
      : 'status-offline',
    lastError: lastSyncError
  };

  if (statusOverride) {
    status = { ...status, ...statusOverride };
  }

  syncStatusCallbacks.forEach((cb) => cb(status));
}

// Cabeçalhos padrão para o PostgREST do Supabase
function getSupabaseHeaders(prefer = 'resolution=merge-duplicates') {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': prefer
  };
}

// Higieniza e prepara o payload de acordo com a tabela do Supabase
function cleanPayloadForSupabase(tableName, payload) {
  if (!payload) return {};
  const clean = { ...payload };

  if (tableName === 'products') {
    // Garante tipos e campos compatíveis
    return {
      id: String(clean.id || ''),
      barcode: String(clean.barcode || ''),
      name: String(clean.name || '').toUpperCase(),
      sector: String(clean.sector || 'MERCEARIA'),
      corridor: String(clean.corridor || 'CORREDOR 01'),
      created_at: clean.created_at || new Date().toISOString(),
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === 'product_expirations') {
    return {
      id: String(clean.id || ''),
      product_id: String(clean.product_id || ''),
      expiration_date: String(clean.expiration_date || ''),
      created_at: clean.created_at || new Date().toISOString(),
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  if (tableName === 'inventory_counts') {
    return {
      id: String(clean.id || ''),
      product_id: String(clean.product_id || ''),
      expiration_id: String(clean.expiration_id || ''),
      count_session_id: clean.count_session_id ? String(clean.count_session_id) : null,
      location_type: String(clean.location_type || 'PRATELEIRA'),
      quantity: Number(clean.quantity) || 0,
      counted_at: clean.counted_at || clean.created_at || new Date().toISOString(),
      created_at: clean.created_at || new Date().toISOString(),
      updated_at: clean.updated_at || new Date().toISOString()
    };
  }

  return clean;
}

// Envia registro unitário para o Supabase com retry inteligente e fallback
async function pushToSupabase(tableName, operation, rawPayload) {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  try {
    if (operation === 'DELETE') {
      const delUrl = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${encodeURIComponent(rawPayload.id)}`;
      const delRes = await fetch(delUrl, {
        method: 'DELETE',
        headers: getSupabaseHeaders('return=minimal')
      });
      return delRes.ok || delRes.status === 404;
    }

    const payload = cleanPayloadForSupabase(tableName, rawPayload);

    // Tentativa 1: POST com resolution=merge-duplicates (Upsert padrão Supabase)
    const postUrl = `${SUPABASE_URL}/rest/v1/${tableName}`;
    let response = await fetch(postUrl, {
      method: 'POST',
      headers: getSupabaseHeaders('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(payload)
    });

    if (response.ok || response.status === 201 || response.status === 200 || response.status === 204) {
      lastSyncError = null;
      return true;
    }

    // Se falhar com conflito 409 ou 400 (ex: sem constraint merge-duplicates), tenta PATCH por ID
    if (response.status === 409 || response.status === 400) {
      const patchUrl = `${SUPABASE_URL}/rest/v1/${tableName}?id=eq.${encodeURIComponent(payload.id)}`;
      const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: getSupabaseHeaders('return=minimal'),
        body: JSON.stringify(payload)
      });

      if (patchRes.ok || patchRes.status === 204) {
        lastSyncError = null;
        return true;
      }

      // Se o PATCH retornou 404/vazio, tenta INSERT POST direto sem Prefer resolution
      const plainInsertRes = await fetch(postUrl, {
        method: 'POST',
        headers: getSupabaseHeaders('return=minimal'),
        body: JSON.stringify(payload)
      });

      if (plainInsertRes.ok || plainInsertRes.status === 201) {
        lastSyncError = null;
        return true;
      }

      const errDetail = await response.text();
      console.warn(`[Supabase Push Fallback Error] ${tableName}:`, errDetail);
      lastSyncError = errDetail;
      return false;
    }

    const errText = await response.text();
    console.warn(`[Supabase Push Error ${response.status}] ${tableName}:`, errText);
    lastSyncError = `Status ${response.status}`;
    return false;
  } catch (error) {
    console.warn('[Supabase Network Error]:', error);
    lastSyncError = 'Erro de rede';
    return false;
  }
}

// 1. Envio da fila de sincronização (Push)
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

    // Garante que todos os produtos locais estejam salvos no Supabase
    await syncAllLocalDataToSupabase();

    // Puxa atualizações mais recentes da nuvem
    await pullFromSupabase();
  } catch (e) {
    console.warn('Sync error:', e);
  } finally {
    isSyncing = false;
    notifyStatus();
  }
}

// Garante envio de todos os registros locais existentes para a nuvem
export async function syncAllLocalDataToSupabase() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;

  try {
    const [products, expirations, counts] = await Promise.all([
      getAllFromStore('products'),
      getAllFromStore('product_expirations'),
      getAllFromStore('inventory_counts')
    ]);

    for (const p of products) {
      await pushToSupabase('products', 'UPSERT', p);
    }
    for (const e of expirations) {
      await pushToSupabase('product_expirations', 'UPSERT', e);
    }
    for (const c of counts) {
      await pushToSupabase('inventory_counts', 'UPSERT', c);
    }

    return true;
  } catch (err) {
    console.warn('Erro ao enviar dados locais completos para Supabase:', err);
    return false;
  }
}

// 2. Busca todos os dados da nuvem para sincronizar com o celular (Pull)
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

    if (!prodRes.ok) {
      lastSyncError = `Pull Error ${prodRes.status}`;
      return false;
    }

    const products = prodRes.ok ? await prodRes.json() : [];
    const expirations = expRes.ok ? await expRes.json() : [];
    const counts = countRes.ok ? await countRes.json() : [];

    // Mescla no IndexedDB local preservando fotos salvas localmente
    const db = await initDB();
    const tx = db.transaction(['products', 'product_expirations', 'inventory_counts'], 'readwrite');
    const prodStore = tx.objectStore('products');
    const expStore = tx.objectStore('product_expirations');
    const countStore = tx.objectStore('inventory_counts');

    for (const p of products) {
      // Preserva imagem local se o Supabase não tiver
      const existingReq = prodStore.get(p.id);
      existingReq.onsuccess = () => {
        const local = existingReq.result;
        if (local && local.image && !p.image) {
          p.image = local.image;
        }
        prodStore.put(p);
      };
    }
    for (const e of expirations) expStore.put(e);
    for (const c of counts) countStore.put(c);

    lastSyncError = null;

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('Erro ao puxar dados do Supabase:', err);
    return false;
  }
}

// Disparo imediato sob demanda
export function triggerSyncNow() {
  return processSyncQueue();
}

// Limpa todos os dados no Supabase
export async function wipeSupabaseCloudData() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
  const headers = getSupabaseHeaders('return=minimal');
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/inventory_counts?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/product_expirations?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/count_sessions?id=neq.none`, { method: 'DELETE', headers });
    await fetch(`${SUPABASE_URL}/rest/v1/products?id=neq.none`, { method: 'DELETE', headers });
    lastSyncError = null;
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
    }, 600);

    // Sincronização periódica a cada 15 segundos
    setInterval(() => {
      if (navigator.onLine && !isSyncing) {
        processSyncQueue();
      }
    }, 15000);
  }

  notifyStatus();
}
