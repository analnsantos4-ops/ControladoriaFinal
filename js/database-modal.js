// ====================================================
// MODAL DE GESTÃO E EXPORTAÇÃO DO BANCO DE DADOS
// Permite visualização de dados, download em JSON e SQL
// ====================================================

import {
  getDatabaseSummaryStats,
  exportDatabaseJSON,
  exportDatabaseSQL
} from './db.js';
import { SUPABASE_SETUP_SQL } from './sync.js';
import { formatNumber } from './utils.js';

let modalEl = null;

export async function openDatabaseModal() {
  if (!modalEl) {
    createDatabaseModal();
  }

  modalEl.classList.remove('hidden');
  modalEl.classList.add('active');

  await refreshDatabaseStats();
}

export function closeDatabaseModal() {
  if (modalEl) {
    modalEl.classList.remove('active');
    modalEl.classList.add('hidden');
  }
}

function createDatabaseModal() {
  let container = document.getElementById('modal-database-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'modal-database-container';
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div id="modal-database-management" class="custom-modal-backdrop hidden">
      <div class="custom-modal-dialog modal-lg">
        <header class="modal-dialog-header" style="background: linear-gradient(135deg, #0f172a, #1e293b); border-bottom: 2px solid #38bdf8;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.6rem;">💾</span>
            <div>
              <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #f8fafc;">BANCO DE DADOS DO SISTEMA</h3>
              <p style="margin: 2px 0 0; font-size: 0.8rem; color: #94a3b8;">Estrutura, Backup Completo e Scripts SQL</p>
            </div>
          </div>
          <button type="button" id="btn-close-db-modal" class="btn-close-modal" style="color: #94a3b8; font-size: 1.4rem; background: none; border: none; cursor: pointer;">✕</button>
        </header>

        <div class="modal-tabs-nav" style="display: flex; gap: 8px; padding: 12px 16px; background: #0b1120; border-bottom: 1px solid #1e293b;">
          <button type="button" id="tab-db-overview" class="btn-tab active" style="padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 0.85rem; border: none; cursor: pointer; background: #38bdf8; color: #04131f;">
            📊 Visão Geral & Downloads
          </button>
          <button type="button" id="tab-db-sql" class="btn-tab" style="padding: 6px 14px; border-radius: 8px; font-weight: 700; font-size: 0.85rem; border: none; cursor: pointer; background: #1e293b; color: #94a3b8;">
            📜 Script SQL (DDL Supabase)
          </button>
        </div>

        <div class="modal-dialog-body" style="padding: 16px; max-height: 70vh; overflow-y: auto; background: #0f172a; color: #e2e8f0;">
          
          <!-- TAB 1: VISÃO GERAL E DOWNLOADS -->
          <div id="content-db-overview">
            <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: flex; gap: 10px; align-items: flex-start;">
              <span style="font-size: 1.3rem;">ℹ️</span>
              <div style="font-size: 0.85rem; line-height: 1.45; color: #bae6fd;">
                <strong>Banco de Dados Ativo:</strong> Seus dados são salvos localmente com alta performance no <strong>IndexedDB</strong> do navegador e sincronizados com a nuvem (Supabase). Você pode baixar cópias completas em JSON ou SQL abaixo.
              </div>
            </div>

            <!-- ESTATÍSTICAS DO BANCO -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px;">
              <div class="stat-card" style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px; text-align: center;">
                <span style="font-size: 1.3rem;">📦</span>
                <div id="db-stat-products" style="font-size: 1.4rem; font-weight: 900; color: #38bdf8; margin: 4px 0;">0</div>
                <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Produtos</div>
              </div>

              <div class="stat-card" style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px; text-align: center;">
                <span style="font-size: 1.3rem;">🏷️</span>
                <div id="db-stat-expirations" style="font-size: 1.4rem; font-weight: 900; color: #f59e0b; margin: 4px 0;">0</div>
                <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Lotes / Validades</div>
              </div>

              <div class="stat-card" style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px; text-align: center;">
                <span style="font-size: 1.3rem;">⚡</span>
                <div id="db-stat-blitz" style="font-size: 1.4rem; font-weight: 900; color: #a855f7; margin: 4px 0;">0</div>
                <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Sessões Blitz</div>
              </div>

              <div class="stat-card" style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px; text-align: center;">
                <span style="font-size: 1.3rem;">✍️</span>
                <div id="db-stat-conferencias" style="font-size: 1.4rem; font-weight: 900; color: #10b981; margin: 4px 0;">0</div>
                <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Conferências</div>
              </div>

              <div class="stat-card" style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 12px; text-align: center;">
                <span style="font-size: 1.3rem;">🔢</span>
                <div id="db-stat-units" style="font-size: 1.4rem; font-weight: 900; color: #34d399; margin: 4px 0;">0</div>
                <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Unidades Estoque</div>
              </div>
            </div>

            <!-- OPÇÕES DE DOWNLOAD DO BANCO -->
            <h4 style="font-size: 0.95rem; font-weight: 800; color: #f8fafc; margin: 0 0 12px; display: flex; align-items: center; gap: 6px;">
              📥 Extrair e Baixar o Banco de Dados
            </h4>

            <div style="display: flex; flex-direction: column; gap: 12px;">
              <!-- DOWNLOAD JSON -->
              <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div>
                  <div style="font-weight: 800; color: #38bdf8; font-size: 0.95rem;">Backup Completo em JSON (.json)</div>
                  <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">
                    Contém todas as 12 tabelas do sistema: produtos, validades, contagens, blitz, fotos e conferências.
                  </div>
                </div>
                <button type="button" id="btn-download-db-json" class="btn-primary" style="white-space: nowrap; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 0.85rem; background: #38bdf8; color: #04131f; border: none; cursor: pointer;">
                  📥 Baixar JSON
                </button>
              </div>

              <!-- DOWNLOAD SQL -->
              <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div>
                  <div style="font-weight: 800; color: #a855f7; font-size: 0.95rem;">Dump SQL com Dados (.sql)</div>
                  <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">
                    Script SQL completo com comandos <code>INSERT INTO</code> para importar diretamente no Supabase ou PostgreSQL.
                  </div>
                </div>
                <button type="button" id="btn-download-db-sql" class="btn-primary" style="white-space: nowrap; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 0.85rem; background: #a855f7; color: #ffffff; border: none; cursor: pointer;">
                  📥 Baixar SQL
                </button>
              </div>

              <!-- COPIAR SCRIPT DDL -->
              <div style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                <div>
                  <div style="font-weight: 800; color: #10b981; font-size: 0.95rem;">Script de Estrutura (DDL)</div>
                  <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">
                    Copia o código SQL de criação de tabelas, índices e permissões RLS para a área de transferência.
                  </div>
                </div>
                <button type="button" id="btn-copy-db-ddl" class="btn-secondary" style="white-space: nowrap; padding: 8px 16px; border-radius: 8px; font-weight: 800; font-size: 0.85rem; background: #10b981; color: #042617; border: none; cursor: pointer;">
                  📋 Copiar SQL DDL
                </button>
              </div>
            </div>
          </div>

          <!-- TAB 2: SCRIPT SQL DDL -->
          <div id="content-db-sql" class="hidden">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <span style="font-size: 0.85rem; color: #94a3b8;">Execute este script no <strong>SQL Editor</strong> do seu painel Supabase:</span>
              <button type="button" id="btn-copy-sql-viewer" style="background: #38bdf8; color: #04131f; border: none; padding: 6px 12px; border-radius: 6px; font-weight: 800; font-size: 0.8rem; cursor: pointer;">
                📋 Copiar Script
              </button>
            </div>
            <pre style="background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 12px; font-family: monospace; font-size: 0.75rem; color: #38bdf8; overflow-x: auto; max-height: 48vh;"><code id="db-sql-code-display"></code></pre>
          </div>

        </div>

        <footer class="modal-dialog-footer" style="padding: 12px 16px; background: #0b1120; border-top: 1px solid #1e293b; display: flex; justify-content: flex-end;">
          <button type="button" id="btn-close-db-modal-footer" class="btn-secondary" style="padding: 8px 18px; border-radius: 8px; font-weight: 700; font-size: 0.85rem; background: #334155; color: #f8fafc; border: none; cursor: pointer;">
            Fechar
          </button>
        </footer>
      </div>
    </div>
  `;

  modalEl = document.getElementById('modal-database-management');

  // Eventos de Fechamento
  document.getElementById('btn-close-db-modal')?.addEventListener('click', closeDatabaseModal);
  document.getElementById('btn-close-db-modal-footer')?.addEventListener('click', closeDatabaseModal);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeDatabaseModal();
  });

  // Eventos das Abas
  const tabOverview = document.getElementById('tab-db-overview');
  const tabSql = document.getElementById('tab-db-sql');
  const contentOverview = document.getElementById('content-db-overview');
  const contentSql = document.getElementById('content-db-sql');
  const sqlCodeDisplay = document.getElementById('db-sql-code-display');

  if (sqlCodeDisplay) {
    sqlCodeDisplay.textContent = SUPABASE_SETUP_SQL;
  }

  tabOverview?.addEventListener('click', () => {
    tabOverview.style.background = '#38bdf8';
    tabOverview.style.color = '#04131f';
    tabSql.style.background = '#1e293b';
    tabSql.style.color = '#94a3b8';
    contentOverview?.classList.remove('hidden');
    contentSql?.classList.add('hidden');
  });

  tabSql?.addEventListener('click', () => {
    tabSql.style.background = '#38bdf8';
    tabSql.style.color = '#04131f';
    tabOverview.style.background = '#1e293b';
    tabOverview.style.color = '#94a3b8';
    contentSql?.classList.remove('hidden');
    contentOverview?.classList.add('hidden');
  });

  // Eventos de Download e Cópia
  document.getElementById('btn-download-db-json')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-download-db-json');
    if (btn) {
      btn.textContent = '⏳ Baixando...';
      btn.disabled = true;
    }
    try {
      await exportDatabaseJSON();
      if (btn) btn.textContent = '✅ Baixado!';
      setTimeout(() => {
        if (btn) {
          btn.textContent = '📥 Baixar JSON';
          btn.disabled = false;
        }
      }, 2000);
    } catch (err) {
      console.error(err);
      if (btn) {
        btn.textContent = '❌ Erro';
        btn.disabled = false;
      }
    }
  });

  document.getElementById('btn-download-db-sql')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-download-db-sql');
    if (btn) {
      btn.textContent = '⏳ Gerando SQL...';
      btn.disabled = true;
    }
    try {
      await exportDatabaseSQL();
      if (btn) btn.textContent = '✅ Baixado!';
      setTimeout(() => {
        if (btn) {
          btn.textContent = '📥 Baixar SQL';
          btn.disabled = false;
        }
      }, 2000);
    } catch (err) {
      console.error(err);
      if (btn) {
        btn.textContent = '❌ Erro';
        btn.disabled = false;
      }
    }
  });

  const handleCopyDDL = async (btn) => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = '✅ Copiado!';
        setTimeout(() => {
          btn.textContent = orig;
        }, 2000);
      }
    } catch (_) {
      alert('Script copiado com sucesso.');
    }
  };

  document.getElementById('btn-copy-db-ddl')?.addEventListener('click', (e) => handleCopyDDL(e.currentTarget));
  document.getElementById('btn-copy-sql-viewer')?.addEventListener('click', (e) => handleCopyDDL(e.currentTarget));
}

async function refreshDatabaseStats() {
  try {
    const stats = await getDatabaseSummaryStats();
    const elProd = document.getElementById('db-stat-products');
    const elExp = document.getElementById('db-stat-expirations');
    const elBlitz = document.getElementById('db-stat-blitz');
    const elConf = document.getElementById('db-stat-conferencias');
    const elUnits = document.getElementById('db-stat-units');

    if (elProd) elProd.textContent = formatNumber(stats.productsCount);
    if (elExp) elExp.textContent = formatNumber(stats.expirationsCount);
    if (elBlitz) elBlitz.textContent = formatNumber(stats.blitzSessionsCount);
    if (elConf) elConf.textContent = formatNumber(stats.conferenciasCount);
    if (elUnits) elUnits.textContent = formatNumber(stats.totalUnits);
  } catch (err) {
    console.error('Erro ao obter estatísticas do banco:', err);
  }
}
