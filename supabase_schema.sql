-- ====================================================================
-- SISTEMA DE CONTROLADORIA E AUDITORIA (ANA LUIZA)
-- SCRIPT COMPLETO E DEFINITIVO - POSTGRESQL / SUPABASE
-- Execute no menu "SQL Editor" do seu painel Supabase
-- ====================================================================

-- 1. PRODUTOS
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  barcode TEXT NOT NULL,
  name TEXT NOT NULL,
  sector TEXT DEFAULT 'MERCEARIA',
  corridor TEXT DEFAULT 'Corredor 1',
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
  is_verified_only BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_verified_only BOOLEAN DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDENTE';
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_sector ON public.products (sector);
CREATE INDEX IF NOT EXISTS idx_products_corridor ON public.products (corridor);

-- 2. VALIDADES DOS PRODUTOS
CREATE TABLE IF NOT EXISTS public.product_expirations (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  expiration_date TEXT NOT NULL,
  is_triaged BOOLEAN DEFAULT FALSE,
  triaged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.product_expirations ADD COLUMN IF NOT EXISTS is_triaged BOOLEAN DEFAULT FALSE;
ALTER TABLE public.product_expirations ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_product_exp_product_id ON public.product_expirations (product_id);
CREATE INDEX IF NOT EXISTS idx_product_exp_date ON public.product_expirations (expiration_date);

-- 3. CONTAGENS DE ESTOQUE
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

CREATE INDEX IF NOT EXISTS idx_inv_counts_product_id ON public.inventory_counts (product_id);
CREATE INDEX IF NOT EXISTS idx_inv_counts_session ON public.inventory_counts (count_session_id);

-- 4. SESSÕES DE CONTAGEM
CREATE TABLE IF NOT EXISTS public.count_sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  sector TEXT,
  corridor TEXT,
  location_type TEXT DEFAULT 'PRATELEIRA',
  status TEXT DEFAULT 'IN_PROGRESS',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_count_sessions_date ON public.count_sessions (date);

-- 5. BLITZ MESTRE
CREATE TABLE IF NOT EXISTS public.blitz (
  id TEXT PRIMARY KEY,
  data_inicio TEXT,
  data_fim TEXT,
  setor TEXT DEFAULT 'MERCEARIA',
  responsavel TEXT DEFAULT 'Ana Luiza',
  status TEXT DEFAULT 'EM_ANDAMENTO',
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_blitz_status ON public.blitz (status);
CREATE INDEX IF NOT EXISTS idx_blitz_setor ON public.blitz (setor);

-- 6. ITENS DA BLITZ (EAN + DATA DE VALIDADE)
CREATE TABLE IF NOT EXISTS public.blitz_itens (
  id TEXT PRIMARY KEY,
  blitz_id TEXT NOT NULL,
  produto_id TEXT,
  ean TEXT NOT NULL,
  nome_produto TEXT NOT NULL,
  data_validade TEXT NOT NULL,
  data_validade_br TEXT,
  status TEXT DEFAULT 'PENDENTE',
  is_new_product BOOLEAN DEFAULT FALSE,
  previous_quantity NUMERIC DEFAULT 0,
  had_quantity_previously BOOLEAN DEFAULT FALSE,
  had_zero_previously BOOLEAN DEFAULT FALSE,
  previous_history JSONB DEFAULT '[]'::jsonb,
  corredor TEXT,
  foto_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.blitz_itens ADD COLUMN IF NOT EXISTS quantidade NUMERIC DEFAULT 0;
ALTER TABLE public.blitz_itens ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.blitz_itens ADD COLUMN IF NOT EXISTS conferido_em TIMESTAMPTZ;
ALTER TABLE public.blitz_itens ADD COLUMN IF NOT EXISTS corredor TEXT;
ALTER TABLE public.blitz_itens ADD COLUMN IF NOT EXISTS foto_url TEXT;

CREATE INDEX IF NOT EXISTS idx_blitz_itens_blitz_id ON public.blitz_itens (blitz_id);
CREATE INDEX IF NOT EXISTS idx_blitz_itens_ean ON public.blitz_itens (ean);
CREATE INDEX IF NOT EXISTS idx_blitz_itens_status ON public.blitz_itens (status);

-- 7. CONFERÊNCIAS DA BLITZ
CREATE TABLE IF NOT EXISTS public.conferencias_blitz (
  id TEXT PRIMARY KEY,
  blitz_id TEXT NOT NULL,
  item_id TEXT,
  blitz_item_id TEXT,
  produto_id TEXT,
  ean TEXT NOT NULL,
  data_validade TEXT NOT NULL,
  quantidade NUMERIC DEFAULT 0,
  quantidade_anterior NUMERIC DEFAULT 0,
  diferenca NUMERIC DEFAULT 0,
  tipo_conferencia TEXT DEFAULT 'MANUAL',
  locations JSONB DEFAULT '[]'::jsonb,
  corredor TEXT,
  foto_url TEXT,
  foto_conferencia TEXT,
  foto_produto TEXT,
  usuario TEXT DEFAULT 'Ana Luiza',
  observacao TEXT,
  conferido_em TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS item_id TEXT;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS blitz_item_id TEXT;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS produto_id TEXT;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS quantidade_anterior NUMERIC DEFAULT 0;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS diferenca NUMERIC DEFAULT 0;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS tipo_conferencia TEXT DEFAULT 'MANUAL';
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS foto_url TEXT;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS foto_conferencia TEXT;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS foto_produto TEXT;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS locations JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS corredor TEXT;

CREATE INDEX IF NOT EXISTS idx_conf_blitz_id ON public.conferencias_blitz (blitz_id);
CREATE INDEX IF NOT EXISTS idx_conf_ean ON public.conferencias_blitz (ean);
CREATE INDEX IF NOT EXISTS idx_conf_produto ON public.conferencias_blitz (produto_id);
ALTER TABLE public.conferencias_blitz ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'synced';
CREATE UNIQUE INDEX IF NOT EXISTS idx_conf_unique_blitz_prod_data ON public.conferencias_blitz (blitz_id, produto_id, data_validade) WHERE produto_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conf_unique_blitz_ean_data ON public.conferencias_blitz (blitz_id, ean, data_validade) WHERE ean IS NOT NULL AND (produto_id IS NULL OR produto_id = '');

-- 8. AUDITORIA E HISTÓRICO DE ALTERAÇÕES
CREATE TABLE IF NOT EXISTS public.historico_alteracoes (
  id TEXT PRIMARY KEY,
  entidade TEXT DEFAULT 'conferencia',
  entidade_id TEXT DEFAULT '',
  blitz_id TEXT,
  ean TEXT,
  campo_alterado TEXT DEFAULT '',
  valor_anterior TEXT,
  valor_novo TEXT,
  motivo TEXT,
  usuario TEXT DEFAULT 'Ana Luiza',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migração segura de colunas caso a tabela já existisse com estrutura antiga
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS entidade TEXT DEFAULT 'conferencia';
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS entidade_id TEXT DEFAULT '';
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS blitz_id TEXT;
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS ean TEXT;
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS campo_alterado TEXT DEFAULT '';
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS valor_anterior TEXT;
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS valor_novo TEXT;
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS motivo TEXT;
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS usuario TEXT DEFAULT 'Ana Luiza';
ALTER TABLE public.historico_alteracoes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_hist_entidade ON public.historico_alteracoes (entidade, entidade_id);
CREATE INDEX IF NOT EXISTS idx_hist_blitz_id ON public.historico_alteracoes (blitz_id);

-- 9. FOTOS DE PRODUTOS E AUDITORIA
CREATE TABLE IF NOT EXISTS public.fotos_produtos (
  id TEXT PRIMARY KEY,
  produto_id TEXT,
  ean TEXT NOT NULL,
  tipo TEXT DEFAULT 'PRODUTO',
  url_ou_base64 TEXT,
  data_validade TEXT,
  criado_em TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fotos_ean ON public.fotos_produtos (ean);

-- 10. COMPATIBILIDADE OPERACIONAL (BLITZ SESSIONS & BLITZ ITEMS)
CREATE TABLE IF NOT EXISTS public.blitz_sessions (
  id TEXT PRIMARY KEY,
  blitz_type TEXT NOT NULL,
  sector TEXT DEFAULT 'GERAL',
  user_name TEXT DEFAULT 'Ana Luiza',
  start_date TEXT,
  end_date TEXT,
  period_label TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT DEFAULT 'em_andamento',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.blitz_items (
  id TEXT PRIMARY KEY,
  blitz_session_id TEXT NOT NULL,
  product_id TEXT,
  barcode TEXT NOT NULL,
  sector TEXT DEFAULT 'MERCEARIA',
  corridor TEXT,
  requested_expiration_date TEXT,
  previous_quantity NUMERIC DEFAULT 0,
  total_quantity NUMERIC DEFAULT 0,
  difference NUMERIC DEFAULT 0,
  result TEXT NOT NULL,
  locations JSONB DEFAULT '[]'::jsonb,
  conference_id TEXT,
  user_id TEXT,
  user_name TEXT DEFAULT 'Ana Luiza',
  is_new_expiration BOOLEAN DEFAULT FALSE,
  notes TEXT,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ====================================================================
-- PERMISSÕES DE ACESSO E DESATIVAÇÃO DE ROW LEVEL SECURITY (RLS)
-- ====================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_expirations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_counts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.count_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.blitz DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.blitz_itens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.conferencias_blitz DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.historico_alteracoes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos_produtos DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.blitz_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.blitz_items DISABLE ROW LEVEL SECURITY;
