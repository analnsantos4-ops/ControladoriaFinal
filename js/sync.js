// Mecanismo de Sincronização em Tempo Real Online/Offline com Supabase
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
import { getUnsyncedQueue, markQueueItemSynced, initDB, getAllFromStore } from './db.js';

let isSyncing = false;
let syncStatusCallbacks = [];
let lastSyncError = null;
let lastSyncErrorCode = null;

export const SUPABASE_SETUP_SQL = `-- ====================================================================
-- SCRIPT DE LIBERAÇÃO DE ACESSO E SINCRONIZAÇÃO NO SUPABASE
-- Execute este script no menu "SQL Editor" do seu painel Supabase
-- ====================================================================

-- 1. Garante a criação das 3 tabelas com a estrutura correta
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT DEFAULT 'MERCEARIA',
  corridor TEXT DEFAULT 'CORREDOR 01',
  image TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.product_expirations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  expiration_date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  expiration_id TEXT NOT NULL,
  count_session_id TEXT,
  location_type TEXT DEFAULT 'PRATELEIRA',
  quantity NUMERIC DEFAULT 0,
  counted_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Concede permissões completas de acesso para a chave anônima da API
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

GRANT ALL ON TABLE public.products TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.product_expirations TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.inventory_counts TO anon, authenticated, service_role;

-- 3. Desativa o bloqueio Row Level Security (RLS) para permitir que o app sincronize
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
  let label = '✓ Supabase Conectado';
  let className = 'status-online';

  if (!isOnline) {
    label = '● Offline (Salvo no celular)';
    className = 'status-offline';
  } else if (isSyncing) {
    label = '↻ Sincronizando...';
    className = 'status-syncing';
  } else if (lastSyncErrorCode === '42501' || lastSyncError?.includes('permission denied') || lastSyncError?.includes('42501')) {
    label = '⚠ Supabase: Liberar SQL (Toque)';
    className = 'status-offline';
  } else if (lastSyncError) {
    label = '⚠ Erro Nuvem (Toque)';
    className = 'status-offline';
  }

  return {
    isOnline,
    isSyncing,
    label,
    className,
    lastError: lastSyncError,
    lastErrorCode: lastSyncErrorCode
  };
}

function notifyStatus(statusOverride = null) {
  let status = getSyncStatus();
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

// Testa a saúde da conexão diretamente com a API do Supabase
export async function checkSupabaseHealth() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return {
      connected: false,
      message: 'Chaves do Supabase não configuradas.',
      code: 'NO_CONFIG'
    };
  }

  try {
    const headers = getSupabaseHeaders('return=minimal');
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?select=id&limit=1`, {
      method: 'GET',
      headers
    });

    if (res.ok) {
      lastSyncError = null;
      lastSyncErrorCode = null;
      notifyStatus();
      return {
        connected: true,
        message: 'Conectado com sucesso ao Supabase!',
        status: res.status
      };
    }

    const errorBody = await res.text();
    let parsedError = {};
    try {
      parsedError = JSON.parse(errorBody);
    } catch (_) {}

    lastSyncError = parsedError.message || errorBody || `Status ${res.status}`;
    lastSyncErrorCode = parsedError.code || String(res.status);
    notifyStatus();

    return {
      connected: false,
      status: res.status,
      code: parsedError.code || String(res.status),
      message: parsedError.message || errorBody,
      hint: parsedError.hint || null
    };
  } catch (err) {
    lastSyncError = 'Erro de conexão ou sem internet';
    lastSyncErrorCode = 'NETWORK_ERROR';
    notifyStatus();
    return {
      connected: false,
      code: 'NETWORK_ERROR',
      message: String(err.message || err)
    };
  }
}

// Higieniza e prepara o payload de acordo com a tabela do Supabase
function cleanPayloadForSupabase(tableName, payload) {
  if (!payload) return {};
  const clean = { ...payload };

  if (tableName === 'products') {
    return {
      id: String(clean.id || ''),
      barcode: String(clean.barcode || ''),
      name: String(clean.name || '').toUpperCase(),
      sector: String(clean.sector || 'MERCEARIA'),
      corridor: String(clean.corridor || 'CORREDOR 01'),
      image: clean.image ? String(clean.image) : null,
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
      lastSyncErrorCode = null;
      return true;
    }

    const errText = await response.text();
    let errJson = null;
    try {
      errJson = JSON.parse(errText);
    } catch (_) {}

    if (errJson && errJson.code) {
      lastSyncErrorCode = errJson.code;
      lastSyncError = errJson.message || errText;
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
        lastSyncErrorCode = null;
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
        lastSyncErrorCode = null;
        return true;
      }

      const patchErr = await patchRes.text();
      console.warn(`[Supabase Push Fallback Error] ${tableName}:`, patchErr);
      return false;
    }

    console.warn(`[Supabase Push Error ${response.status}] ${tableName}:`, errText);
    return false;
  } catch (error) {
    console.warn('[Supabase Network Error]:', error);
    lastSyncError = 'Erro de rede';
    lastSyncErrorCode = 'NETWORK_ERROR';
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
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return { success: false, syncedCount: 0 };

  try {
    const [products, expirations, counts] = await Promise.all([
      getAllFromStore('products'),
      getAllFromStore('product_expirations'),
      getAllFromStore('inventory_counts')
    ]);

    let syncedCount = 0;
    for (const p of products) {
      const ok = await pushToSupabase('products', 'UPSERT', p);
      if (ok) syncedCount++;
    }
    for (const e of expirations) {
      await pushToSupabase('product_expirations', 'UPSERT', e);
    }
    for (const c of counts) {
      await pushToSupabase('inventory_counts', 'UPSERT', c);
    }

    return { success: true, syncedCount, totalProducts: products.length };
  } catch (err) {
    console.warn('Erro ao enviar dados locais completos para Supabase:', err);
    return { success: false, syncedCount: 0 };
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
      const errText = await prodRes.text();
      let errJson = null;
      try { errJson = JSON.parse(errText); } catch (_) {}
      if (errJson && errJson.code) {
        lastSyncErrorCode = errJson.code;
        lastSyncError = errJson.message;
      } else {
        lastSyncError = `Pull Error ${prodRes.status}`;
      }
      return false;
    }

    const products = prodRes.ok ? await prodRes.json() : [];
    const expirations = expRes.ok ? await expRes.json() : [];
    const counts = countRes.ok ? await countRes.json() : [];

    const localProducts = await getAllFromStore('products');
    const localProductMap = {};
    localProducts.forEach((lp) => {
      localProductMap[lp.id] = lp;
    });

    // Mescla no IndexedDB local preservando fotos salvas localmente
    const db = await initDB();
    const tx = db.transaction(['products', 'product_expirations', 'inventory_counts'], 'readwrite');
    const prodStore = tx.objectStore('products');
    const expStore = tx.objectStore('product_expirations');
    const countStore = tx.objectStore('inventory_counts');

    for (const p of products) {
      const local = localProductMap[p.id];
      if (local && local.image && !p.image) {
        p.image = local.image;
      }
      prodStore.put(p);
    }
    for (const e of expirations) {
      expStore.put(e);
    }
    for (const c of counts) {
      countStore.put(c);
    }

    lastSyncError = null;
    lastSyncErrorCode = null;

    return new Promise((resolve) => {
      tx.oncomplete = () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('supabase-data-updated', {
            detail: { productsCount: products.length, countsCount: counts.length }
          }));
        }
        resolve(true);
      };
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('Erro ao puxar dados do Supabase:', err);
    return false;
  }
}

// Disparo imediato sob demanda
export async function triggerSyncNow() {
  await checkSupabaseHealth();
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
    lastSyncErrorCode = null;
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
        checkSupabaseHealth().then(() => {
          processSyncQueue();
        });
      }
    }, 500);

    // Sincronização periódica a cada 15 segundos
    setInterval(() => {
      if (navigator.onLine && !isSyncing) {
        processSyncQueue();
      }
    }, 15000);
  }

  notifyStatus();
}

