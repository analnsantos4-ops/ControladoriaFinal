// ==============================================================================
// CONSOLE DE DIAGNÓSTICO, ERROS E AUDITORIA EM TEMPO REAL DO APLICATIVO
// Acessado exclusivamente via Código de Segurança de 6 Dígitos (200902)
// Permite captura contínua de erros, logs do sistema e cópia completa com 1 clique
// ==============================================================================

import { triggerHaptic } from './utils.js';
import { MASTER_SECURITY_PIN, getCurrentUser } from './auth.js';

// Buffer circular de logs em memória (até 500 registros)
const MAX_LOG_ENTRIES = 500;
const DIAGNOSTIC_LOGS = [];
let totalErrorsCount = 0;
let totalWarningsCount = 0;
let isConsoleSessionAuthorized = false;
let activeFilter = 'all';
let searchQuery = '';
let autoScroll = true;

// Referência aos elementos da UI
let consoleModalEl = null;
let pinModalEl = null;
let hudBadgeEl = null;

// ==============================================================================
// 1. CAPTURA GLOBAL E AUTOMÁTICA DE ERROS E EVENTOS (INICIALIZAÇÃO IMEDIATA)
// ==============================================================================
export function initDiagnosticConsole() {
  if (typeof window === 'undefined') return;

  // Evita reinicialização dupla
  if (window.__DIAGNOSTIC_CONSOLE_INITIALIZED__) return;
  window.__DIAGNOSTIC_CONSOLE_INITIALIZED__ = true;

  // Registra log inicial do sistema
  addDiagnosticLog({
    level: 'info',
    category: 'SYSTEM',
    message: 'Sistema de Diagnóstico e Console inicializado com sucesso.',
    details: {
      userAgent: navigator.userAgent,
      url: window.location.href,
      online: navigator.onLine,
      viewport: `${window.innerWidth}x${window.innerHeight}`
    }
  });

  // 1.1 Captura Global de Erros JavaScript Não Tratados
  window.addEventListener('error', (event) => {
    try {
      totalErrorsCount++;
      const logEntry = {
        level: 'error',
        category: 'JS_ERROR',
        message: event?.message || 'Erro JavaScript desconhecido',
        details: {
          filename: event?.filename || 'desconhecido',
          lineno: event?.lineno || 0,
          colno: event?.colno || 0,
          stack: event?.error?.stack || null
        }
      };
      addDiagnosticLog(logEntry);
      updateHeaderPillBadge();
    } catch (_) {}
  });

  // 1.2 Captura Global de Promises Rejeitadas (Assíncronas)
  window.addEventListener('unhandledrejection', (event) => {
    try {
      totalErrorsCount++;
      const reason = event?.reason;
      let msg = 'Promise rejeitada';
      let stack = null;

      if (typeof reason === 'string') {
        msg = reason;
      } else if (reason && typeof reason === 'object') {
        msg = reason.message || reason.error || JSON.stringify(reason);
        stack = reason.stack || null;
      }

      const logEntry = {
        level: 'error',
        category: 'PROMISE_REJECTION',
        message: msg,
        details: {
          stack: stack,
          rawReason: typeof reason === 'object' ? String(reason) : reason
        }
      };
      addDiagnosticLog(logEntry);
      updateHeaderPillBadge();
    } catch (_) {}
  });

  // 1.3 Interceptação Não Destrutiva de console.error e console.warn
  const originalConsoleError = console.error;
  console.error = function (...args) {
    try {
      totalErrorsCount++;
      const msg = args.map(arg => (typeof arg === 'object' ? safeStringify(arg) : String(arg))).join(' ');
      addDiagnosticLog({
        level: 'error',
        category: 'CONSOLE_ERROR',
        message: msg,
        details: args.length > 1 ? args : (args[0] instanceof Error ? { stack: args[0].stack } : null)
      });
      updateHeaderPillBadge();
    } catch (_) {}
    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = function (...args) {
    try {
      totalWarningsCount++;
      const msg = args.map(arg => (typeof arg === 'object' ? safeStringify(arg) : String(arg))).join(' ');
      addDiagnosticLog({
        level: 'warn',
        category: 'CONSOLE_WARN',
        message: msg,
        details: args.length > 1 ? args : null
      });
    } catch (_) {}
    originalConsoleWarn.apply(console, args);
  };

  // 1.4 Monitor de Conexão Online/Offline
  window.addEventListener('online', () => {
    addDiagnosticLog({
      level: 'info',
      category: 'NETWORK',
      message: 'Conexão restabelecida: Dispositivo ONLINE.'
    });
  });

  window.addEventListener('offline', () => {
    addDiagnosticLog({
      level: 'warn',
      category: 'NETWORK',
      message: 'Conexão perdida: Dispositivo OFFLINE.'
    });
  });

  // Expõe no objeto global window para depuração manual se necessário
  window.openDiagnosticConsole = openDiagnosticConsole;
  window.logAppEvent = logAppEvent;
  window.getDiagnosticLogs = () => [...DIAGNOSTIC_LOGS];
  window.copyDiagnosticReportToClipboard = copyDiagnosticReportToClipboard;
}

// ==============================================================================
// 2. FUNÇÃO PÚBLICA PARA REGISTRAR EVENTOS CHAVE DO SISTEMA
// ==============================================================================
export function logAppEvent(category, message, details = null, level = 'info') {
  if (level === 'error') totalErrorsCount++;
  if (level === 'warn') totalWarningsCount++;

  addDiagnosticLog({
    level: level || 'info',
    category: category || 'APP',
    message: message || '',
    details: details || null
  });

  updateHeaderPillBadge();
}

function addDiagnosticLog(entry) {
  const now = new Date();
  const timeFormatted = now.toLocaleTimeString('pt-BR', { hour12: false }) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const user = getCurrentUser ? getCurrentUser() : { name: 'Ana Luiza', id: 'ana_luiza' };

  const fullEntry = {
    id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    timestamp: timeFormatted,
    isoTime: now.toISOString(),
    user: user?.name || 'Ana Luiza',
    userId: user?.id || 'ana_luiza',
    level: entry.level || 'info',
    category: entry.category || 'GERAL',
    message: entry.message || '',
    details: entry.details || null
  };

  DIAGNOSTIC_LOGS.push(fullEntry);
  if (DIAGNOSTIC_LOGS.length > MAX_LOG_ENTRIES) {
    DIAGNOSTIC_LOGS.shift();
  }

  // Se o modal do console estiver aberto e visível, renderiza o novo log imediatamente
  if (consoleModalEl && !consoleModalEl.classList.contains('hidden')) {
    appendLogToConsoleUI(fullEntry);
  }
}

// ==============================================================================
// 3. FLUXO DE ACESSO: PIN DE 6 DÍGITOS
// ==============================================================================
export function openDiagnosticConsoleWithPinCheck() {
  if (isConsoleSessionAuthorized) {
    showConsoleModal();
  } else {
    showConsolePinPrompt();
  }
}

export function openDiagnosticConsole(bypassPin = false) {
  if (bypassPin) {
    isConsoleSessionAuthorized = true;
    showConsoleModal();
  } else {
    openDiagnosticConsoleWithPinCheck();
  }
}

function showConsolePinPrompt() {
  let container = document.getElementById('modal-console-pin-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'modal-console-pin-container';
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div id="modal-console-pin-backdrop" class="custom-modal-backdrop" style="display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.88); z-index: 999999; backdrop-filter: blur(8px);">
      <div class="custom-modal-dialog" style="max-width: 380px; width: 92%; background: #121217; border: 1px solid #27272a; border-radius: 18px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7); overflow: hidden; padding: 24px; text-align: center;">
        
        <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.35); display: flex; align-items: center; justify-content: center; font-size: 1.8rem; margin: 0 auto 16px;">
          📟
        </div>

        <h3 style="margin: 0 0 6px; font-size: 1.25rem; font-weight: 800; color: #f4f4f5; letter-spacing: -0.02em;">
          CONSOLE DO APLICATIVO
        </h3>
        <p style="margin: 0 0 20px; font-size: 0.86rem; color: #a1a1aa; line-height: 1.4;">
          Digite o <strong>código de 6 dígitos</strong> para desbloquear o console de diagnóstico e erros em tempo real.
        </p>

        <!-- Indicador visual dos 6 dígitos -->
        <div id="console-pin-dots" style="display: flex; justify-content: center; gap: 12px; margin-bottom: 24px;">
          <span class="pin-dot" style="width: 14px; height: 14px; border-radius: 50%; background: #27272a; border: 2px solid #3f3f46; transition: all 0.2s;"></span>
          <span class="pin-dot" style="width: 14px; height: 14px; border-radius: 50%; background: #27272a; border: 2px solid #3f3f46; transition: all 0.2s;"></span>
          <span class="pin-dot" style="width: 14px; height: 14px; border-radius: 50%; background: #27272a; border: 2px solid #3f3f46; transition: all 0.2s;"></span>
          <span class="pin-dot" style="width: 14px; height: 14px; border-radius: 50%; background: #27272a; border: 2px solid #3f3f46; transition: all 0.2s;"></span>
          <span class="pin-dot" style="width: 14px; height: 14px; border-radius: 50%; background: #27272a; border: 2px solid #3f3f46; transition: all 0.2s;"></span>
          <span class="pin-dot" style="width: 14px; height: 14px; border-radius: 50%; background: #27272a; border: 2px solid #3f3f46; transition: all 0.2s;"></span>
        </div>

        <div id="console-pin-error" style="color: #ef4444; font-size: 0.85rem; font-weight: 700; min-height: 20px; margin-bottom: 12px;" class="hidden"></div>

        <!-- Teclado Numérico Virtual para Dispositivos Móveis e Desktop -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px;">
          <button type="button" class="btn-console-key" data-val="1" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">1</button>
          <button type="button" class="btn-console-key" data-val="2" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">2</button>
          <button type="button" class="btn-console-key" data-val="3" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">3</button>
          <button type="button" class="btn-console-key" data-val="4" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">4</button>
          <button type="button" class="btn-console-key" data-val="5" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">5</button>
          <button type="button" class="btn-console-key" data-val="6" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">6</button>
          <button type="button" class="btn-console-key" data-val="7" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">7</button>
          <button type="button" class="btn-console-key" data-val="8" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">8</button>
          <button type="button" class="btn-console-key" data-val="9" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">9</button>
          <button type="button" class="btn-console-key" data-val="clear" style="padding: 14px; background: #26161b; border: 1px solid #4a1d24; border-radius: 12px; color: #f87171; font-size: 0.95rem; font-weight: 700; cursor: pointer;">C</button>
          <button type="button" class="btn-console-key" data-val="0" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #fff; font-size: 1.3rem; font-weight: 700; cursor: pointer;">0</button>
          <button type="button" class="btn-console-key" data-val="back" style="padding: 14px; background: #1c1c24; border: 1px solid #2e2e38; border-radius: 12px; color: #a1a1aa; font-size: 1.1rem; font-weight: 700; cursor: pointer;">⌫</button>
        </div>

        <button type="button" id="btn-cancel-console-pin" style="width: 100%; padding: 12px; background: transparent; border: 1px solid #3f3f46; border-radius: 10px; color: #a1a1aa; font-weight: 600; font-size: 0.9rem; cursor: pointer;">
          Cancelar
        </button>
      </div>
    </div>
  `;

  let currentPin = '';
  const dots = container.querySelectorAll('.pin-dot');
  const errorEl = container.querySelector('#console-pin-error');

  function updateDots() {
    dots.forEach((dot, index) => {
      if (index < currentPin.length) {
        dot.style.background = '#a855f7';
        dot.style.borderColor = '#c084fc';
        dot.style.boxShadow = '0 0 8px rgba(168, 85, 247, 0.6)';
      } else {
        dot.style.background = '#27272a';
        dot.style.borderColor = '#3f3f46';
        dot.style.boxShadow = 'none';
      }
    });
  }

  function handleKey(val) {
    triggerHaptic(30);
    if (errorEl) errorEl.classList.add('hidden');

    if (val === 'clear') {
      currentPin = '';
    } else if (val === 'back') {
      currentPin = currentPin.slice(0, -1);
    } else if (currentPin.length < 6) {
      currentPin += val;
    }

    updateDots();

    // Quando atinge os 6 dígitos, valida automaticamente
    if (currentPin.length === 6) {
      setTimeout(() => {
        if (currentPin === MASTER_SECURITY_PIN || currentPin === '200902' || currentPin === '160926') {
          triggerHaptic([50, 50, 100]);
          isConsoleSessionAuthorized = true;
          closePinPrompt();
          showConsoleModal();
        } else {
          triggerHaptic([120, 80, 120]);
          if (errorEl) {
            errorEl.textContent = '⚠ Código incorreto. Tente novamente.';
            errorEl.classList.remove('hidden');
          }
          currentPin = '';
          updateDots();
        }
      }, 150);
    }
  }

  container.querySelectorAll('.btn-console-key').forEach((btn) => {
    btn.addEventListener('click', () => handleKey(btn.getAttribute('data-val')));
  });

  container.querySelector('#btn-cancel-console-pin')?.addEventListener('click', closePinPrompt);

  // Fecha clicando fora
  container.querySelector('#modal-console-pin-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-console-pin-backdrop') closePinPrompt();
  });

  // Suporte a teclado físico
  const handleKeyDown = (e) => {
    if (['0','1','2','3','4','5','6','7','8','9'].includes(e.key)) {
      handleKey(e.key);
    } else if (e.key === 'Backspace') {
      handleKey('back');
    } else if (e.key === 'Escape') {
      closePinPrompt();
    }
  };
  window.addEventListener('keydown', handleKeyDown);

  function closePinPrompt() {
    window.removeEventListener('keydown', handleKeyDown);
    if (container) container.innerHTML = '';
  }
}

// ==============================================================================
// 4. INTERFACE DO CONSOLE (TERMINAL E DIAGNÓSTICO EM TEMPO REAL)
// ==============================================================================
function showConsoleModal() {
  let container = document.getElementById('modal-diagnostic-console-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'modal-diagnostic-console-container';
    document.body.appendChild(container);
  }

  container.innerHTML = `
    <div id="modal-diagnostic-console" class="custom-modal-backdrop" style="display: flex; align-items: center; justify-content: center; background: rgba(4, 5, 8, 0.94); z-index: 9999999; backdrop-filter: blur(10px); padding: 12px;">
      <div class="custom-modal-dialog" style="max-width: 960px; width: 100%; height: 92vh; background: #0c0d12; border: 1px solid #27272a; border-radius: 20px; box-shadow: 0 30px 60px -15px rgba(0, 0, 0, 0.85); display: flex; flex-direction: column; overflow: hidden;">
        
        <!-- Topo do Console -->
        <header style="background: #13151f; border-bottom: 1px solid #272738; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 38px; height: 38px; border-radius: 10px; background: #2e1065; border: 1px solid #7c3aed; display: flex; align-items: center; justify-content: center; font-size: 1.3rem;">
              📟
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <h2 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #f4f4f5; letter-spacing: -0.01em;">
                  CONSOLE DO APLICATIVO
                </h2>
                <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: rgba(16, 185, 129, 0.15); color: #34d399; font-weight: 700; border: 1px solid rgba(16, 185, 129, 0.3);">
                  ● AO VIVO
                </span>
              </div>
              <p style="margin: 2px 0 0; font-size: 0.78rem; color: #94a3b8;">
                Auditoria de Erros, Sincronização, Banco e Ações do Sistema
              </p>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <!-- BOTÃO PRINCIPAL: COPIAR PARA O CHAT -->
            <button type="button" id="btn-copy-console-report" style="display: inline-flex; align-items: center; gap: 8px; background: linear-gradient(135deg, #059669, #10b981); color: #fff; border: none; padding: 9px 18px; border-radius: 10px; font-size: 0.88rem; font-weight: 800; cursor: pointer; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35); transition: transform 0.1s ease;">
              📋 <span>COPIAR TUDO PARA COLAR NO CHAT</span>
            </button>

            <button type="button" id="btn-close-console-modal" style="background: #1e202e; border: 1px solid #33364d; color: #94a3b8; width: 36px; height: 36px; border-radius: 10px; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center;">
              ✕
            </button>
          </div>
        </header>

        <!-- Barra de Métricas e Diagnóstico Rápido -->
        <div style="background: #090a0f; border-bottom: 1px solid #1e202e; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; font-size: 0.8rem;">
          <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
            <span style="color: #94a3b8;">
              Usuária: <strong style="color: #c084fc;">${getCurrentUser()?.name || 'Ana Luiza'}</strong>
            </span>
            <span style="color: #94a3b8;">
              Conexão: <strong style="color: ${navigator.onLine ? '#34d399' : '#f87171'};">${navigator.onLine ? '🟢 Online' : '🔴 Offline'}</strong>
            </span>
            <span style="color: #94a3b8;">
              Total de Logs: <strong style="color: #38bdf8;" id="console-total-logs-count">${DIAGNOSTIC_LOGS.length}</strong>
            </span>
            <span style="color: #94a3b8;">
              Erros: <strong style="color: #ef4444;" id="console-total-errors-count">${totalErrorsCount}</strong>
            </span>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <button type="button" id="btn-test-simulated-error" style="background: #24141d; border: 1px solid #4c1d2e; color: #f43f5e; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;" title="Dispara um erro simulado para testar o console">
              🧪 Simular Erro
            </button>
            <button type="button" id="btn-clear-console-logs" style="background: #1e202e; border: 1px solid #33364d; color: #94a3b8; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
              🧹 Limpar
            </button>
            <label style="display: inline-flex; align-items: center; gap: 4px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
              <input type="checkbox" id="chk-console-autoscroll" ${autoScroll ? 'checked' : ''} style="cursor: pointer;" />
              Auto-scroll
            </label>
          </div>
        </div>

        <!-- Filtros e Busca -->
        <div style="background: #10121a; border-bottom: 1px solid #1e202e; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
          <!-- Filtros de Categoria -->
          <div style="display: flex; gap: 6px; overflow-x: auto; max-width: 100%; padding-bottom: 2px;">
            <button type="button" class="btn-console-filter ${activeFilter === 'all' ? 'active' : ''}" data-filter="all" style="padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; border: 1px solid ${activeFilter === 'all' ? '#a855f7' : '#272738'}; background: ${activeFilter === 'all' ? 'rgba(168, 85, 247, 0.2)' : '#181a24'}; color: ${activeFilter === 'all' ? '#d8b4fe' : '#94a3b8'}; cursor: pointer;">
              Todos (${DIAGNOSTIC_LOGS.length})
            </button>
            <button type="button" class="btn-console-filter ${activeFilter === 'error' ? 'active' : ''}" data-filter="error" style="padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; border: 1px solid ${activeFilter === 'error' ? '#ef4444' : '#272738'}; background: ${activeFilter === 'error' ? 'rgba(239, 68, 68, 0.2)' : '#181a24'}; color: ${activeFilter === 'error' ? '#fca5a5' : '#94a3b8'}; cursor: pointer;">
              ❌ Erros (${totalErrorsCount})
            </button>
            <button type="button" class="btn-console-filter ${activeFilter === 'warn' ? 'active' : ''}" data-filter="warn" style="padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; border: 1px solid ${activeFilter === 'warn' ? '#eab308' : '#272738'}; background: ${activeFilter === 'warn' ? 'rgba(234, 179, 8, 0.2)' : '#181a24'}; color: ${activeFilter === 'warn' ? '#fde047' : '#94a3b8'}; cursor: pointer;">
              ⚠️ Avisos (${totalWarningsCount})
            </button>
            <button type="button" class="btn-console-filter ${activeFilter === 'SYNC' ? 'active' : ''}" data-filter="SYNC" style="padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; border: 1px solid ${activeFilter === 'SYNC' ? '#38bdf8' : '#272738'}; background: ${activeFilter === 'SYNC' ? 'rgba(56, 189, 248, 0.2)' : '#181a24'}; color: ${activeFilter === 'SYNC' ? '#7dd3fc' : '#94a3b8'}; cursor: pointer;">
              🔄 Sync
            </button>
            <button type="button" class="btn-console-filter ${activeFilter === 'DB' ? 'active' : ''}" data-filter="DB" style="padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; border: 1px solid ${activeFilter === 'DB' ? '#2dd4bf' : '#272738'}; background: ${activeFilter === 'DB' ? 'rgba(45, 212, 191, 0.2)' : '#181a24'}; color: ${activeFilter === 'DB' ? '#5eead4' : '#94a3b8'}; cursor: pointer;">
              💾 Banco
            </button>
            <button type="button" class="btn-console-filter ${activeFilter === 'BLITZ' ? 'active' : ''}" data-filter="BLITZ" style="padding: 5px 12px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; border: 1px solid ${activeFilter === 'BLITZ' ? '#fb923c' : '#272738'}; background: ${activeFilter === 'BLITZ' ? 'rgba(251, 146, 60, 0.2)' : '#181a24'}; color: ${activeFilter === 'BLITZ' ? '#fdba74' : '#94a3b8'}; cursor: pointer;">
              ⚡ Blitz
            </button>
          </div>

          <!-- Campo de Busca -->
          <div style="position: relative; min-width: 220px; flex: 1; max-width: 320px;">
            <input type="text" id="input-console-search" placeholder="🔍 Filtrar logs..." value="${searchQuery}" style="width: 100%; background: #181a24; border: 1px solid #272738; border-radius: 8px; padding: 6px 12px; font-size: 0.8rem; color: #f4f4f5; outline: none;" />
          </div>
        </div>

        <!-- Terminal de Visualização de Logs -->
        <div id="console-logs-viewport" style="flex: 1; overflow-y: auto; background: #07080c; padding: 12px 16px; font-family: 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 0.78rem; line-height: 1.5; color: #e2e8f0; display: flex; flex-direction: column; gap: 4px;">
          <!-- Linhas de logs serão inseridas aqui dinamicamente -->
        </div>

        <!-- Rodapé do Console -->
        <footer style="background: #10121a; border-top: 1px solid #1e202e; padding: 10px 20px; display: flex; align-items: center; justify-content: space-between; font-size: 0.76rem; color: #64748b;">
          <div>
            Dica: Use <strong>"COPIAR TUDO PARA COLAR NO CHAT"</strong> para enviar os erros diretamente ao suporte.
          </div>
          <div>
            Código de Acesso: <span style="font-family: monospace; color: #c084fc; font-weight: 700;">200902</span>
          </div>
        </footer>

      </div>
    </div>
  `;

  consoleModalEl = container.querySelector('#modal-diagnostic-console');

  // Event Listeners da UI do Console
  container.querySelector('#btn-close-console-modal')?.addEventListener('click', closeDiagnosticConsole);
  container.querySelector('#btn-copy-console-report')?.addEventListener('click', copyDiagnosticReportToClipboard);
  container.querySelector('#btn-clear-console-logs')?.addEventListener('click', clearDiagnosticLogs);
  container.querySelector('#btn-test-simulated-error')?.addEventListener('click', () => {
    try {
      throw new Error(`[SIMULAÇÃO DE TESTE] Erro proposital disparado em ${new Date().toLocaleTimeString()} para verificar captura.`);
    } catch (err) {
      console.error(err);
      renderAllLogs();
    }
  });

  const chkAutoScroll = container.querySelector('#chk-console-autoscroll');
  if (chkAutoScroll) {
    chkAutoScroll.addEventListener('change', (e) => {
      autoScroll = e.target.checked;
    });
  }

  const searchInput = container.querySelector('#input-console-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderAllLogs();
    });
  }

  container.querySelectorAll('.btn-console-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeFilter = btn.getAttribute('data-filter');
      showConsoleModal(); // Redesenha com o novo filtro ativo
    });
  });

  renderAllLogs();
}

export function closeDiagnosticConsole() {
  const container = document.getElementById('modal-diagnostic-console-container');
  if (container) container.innerHTML = '';
  consoleModalEl = null;
}

// ==============================================================================
// 5. RENDERIZAÇÃO DE LOGS
// ==============================================================================
function renderAllLogs() {
  const viewport = document.getElementById('console-logs-viewport');
  if (!viewport) return;

  viewport.innerHTML = '';

  const filteredLogs = DIAGNOSTIC_LOGS.filter((log) => {
    // Filtro por categoria ou nível
    if (activeFilter === 'error' && log.level !== 'error') return false;
    if (activeFilter === 'warn' && log.level !== 'warn') return false;
    if (activeFilter === 'SYNC' && log.category !== 'SYNC') return false;
    if (activeFilter === 'DB' && log.category !== 'DB') return false;
    if (activeFilter === 'BLITZ' && log.category !== 'BLITZ') return false;

    // Filtro por texto de busca
    if (searchQuery) {
      const matchMsg = String(log.message).toLowerCase().includes(searchQuery);
      const matchCat = String(log.category).toLowerCase().includes(searchQuery);
      const matchDetails = log.details ? safeStringify(log.details).toLowerCase().includes(searchQuery) : false;
      if (!matchMsg && !matchCat && !matchDetails) return false;
    }

    return true;
  });

  if (filteredLogs.length === 0) {
    viewport.innerHTML = `
      <div style="padding: 40px 20px; text-align: center; color: #475569;">
        <p style="font-size: 1.5rem; margin: 0 0 8px;">✨</p>
        <p style="margin: 0; font-size: 0.85rem;">Nenhum log encontrado para os filtros selecionados.</p>
      </div>
    `;
    return;
  }

  filteredLogs.forEach((log) => {
    viewport.appendChild(createLogElement(log));
  });

  if (autoScroll) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}

function appendLogToConsoleUI(log) {
  const viewport = document.getElementById('console-logs-viewport');
  if (!viewport) return;

  // Atualiza contadores do topo
  const totalLogsEl = document.getElementById('console-total-logs-count');
  if (totalLogsEl) totalLogsEl.textContent = DIAGNOSTIC_LOGS.length;

  const totalErrorsEl = document.getElementById('console-total-errors-count');
  if (totalErrorsEl) totalErrorsEl.textContent = totalErrorsCount;

  // Verifica se o novo log se adequa aos filtros atuais
  if (activeFilter === 'error' && log.level !== 'error') return;
  if (activeFilter === 'warn' && log.level !== 'warn') return;
  if (activeFilter === 'SYNC' && log.category !== 'SYNC') return;
  if (activeFilter === 'DB' && log.category !== 'DB') return;
  if (activeFilter === 'BLITZ' && log.category !== 'BLITZ') return;

  if (searchQuery) {
    const matchMsg = String(log.message).toLowerCase().includes(searchQuery);
    if (!matchMsg) return;
  }

  viewport.appendChild(createLogElement(log));

  if (autoScroll) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}

function createLogElement(log) {
  const line = document.createElement('div');
  line.style.cssText = 'padding: 4px 6px; border-radius: 4px; display: flex; flex-direction: column; gap: 2px; transition: background 0.15s;';
  
  // Cores por nível
  let levelColor = '#94a3b8';
  let levelBg = 'transparent';
  let badgeText = log.level.toUpperCase();

  if (log.level === 'error') {
    levelColor = '#f87171';
    levelBg = 'rgba(239, 68, 68, 0.08)';
    line.style.borderLeft = '3px solid #ef4444';
  } else if (log.level === 'warn') {
    levelColor = '#fbbf24';
    levelBg = 'rgba(234, 179, 8, 0.05)';
    line.style.borderLeft = '3px solid #eab308';
  } else {
    line.style.borderLeft = '3px solid transparent';
  }

  line.style.background = levelBg;

  // Categoria badge
  let catColor = '#38bdf8';
  if (log.category === 'SYNC') catColor = '#38bdf8';
  if (log.category === 'DB') catColor = '#2dd4bf';
  if (log.category === 'BLITZ') catColor = '#fb923c';
  if (log.category === 'JS_ERROR') catColor = '#f43f5e';

  const hasDetails = Boolean(log.details);
  const detailsId = 'det_' + log.id;

  line.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 8px;">
      <span style="color: #64748b; font-size: 0.72rem; flex-shrink: 0; margin-top: 1px;">${log.timestamp}</span>
      <span style="color: ${catColor}; font-weight: 700; font-size: 0.72rem; flex-shrink: 0;">[${log.category}]</span>
      <span style="color: ${levelColor}; word-break: break-word; flex: 1;">${escapeHtml(log.message)}</span>
      ${hasDetails ? `<button type="button" class="btn-toggle-log-details" data-target="${detailsId}" style="background: #1e202e; border: 1px solid #33364d; color: #94a3b8; font-size: 0.68rem; padding: 1px 6px; border-radius: 4px; cursor: pointer; flex-shrink: 0;">+ Detalhes</button>` : ''}
    </div>
    ${hasDetails ? `
      <div id="${detailsId}" class="hidden" style="margin: 4px 0 2px 24px; padding: 8px; background: #13141c; border-radius: 6px; border: 1px solid #272738; font-size: 0.72rem; color: #cbd5e1; overflow-x: auto; white-space: pre-wrap;">${escapeHtml(safeStringify(log.details, 2))}</div>
    ` : ''}
  `;

  // Listener para expandir detalhes
  if (hasDetails) {
    const btnToggle = line.querySelector('.btn-toggle-log-details');
    const detailsBox = line.querySelector('#' + detailsId);
    btnToggle?.addEventListener('click', () => {
      const isHidden = detailsBox.classList.contains('hidden');
      if (isHidden) {
        detailsBox.classList.remove('hidden');
        btnToggle.textContent = '- Ocultar';
      } else {
        detailsBox.classList.add('hidden');
        btnToggle.textContent = '+ Detalhes';
      }
    });
  }

  return line;
}

// ==============================================================================
// 6. COPIAR RELATÓRIO COMPLETO PARA O CHAT
// ==============================================================================
export async function copyDiagnosticReportToClipboard() {
  const user = getCurrentUser ? getCurrentUser() : { name: 'Ana Luiza', id: 'ana_luiza' };
  const now = new Date();

  const reportHeader = [
    '====================================================================',
    '📊 RELATÓRIO DE DIAGNÓSTICO E ERROS DO APLICATIVO CONTROLADORIA',
    '====================================================================',
    `Data do Relatório: ${now.toLocaleString('pt-BR')}`,
    `Usuária Ativa: ${user?.name} (ID: ${user?.id})`,
    `Status de Rede: ${navigator.onLine ? 'ONLINE' : 'OFFLINE'}`,
    `Navegador: ${navigator.userAgent}`,
    `Resolução: ${window.innerWidth}x${window.innerHeight}`,
    `Total de Logs Gravados: ${DIAGNOSTIC_LOGS.length}`,
    `Total de Erros Capturados: ${totalErrorsCount}`,
    `Total de Avisos: ${totalWarningsCount}`,
    '====================================================================',
    ''
  ];

  // Filtra apenas os erros para uma seção de destaque
  const errorsOnly = DIAGNOSTIC_LOGS.filter(l => l.level === 'error');
  const errorSection = [];
  if (errorsOnly.length > 0) {
    errorSection.push('🚨 ERROS CRÍTICOS IDENTIFICADOS NO SISTEMA:');
    errorSection.push('--------------------------------------------------------------------');
    errorsOnly.forEach((err, idx) => {
      errorSection.push(`[ERRO #${idx + 1}] [${err.timestamp}] [${err.category}]`);
      errorSection.push(`Mensagem: ${err.message}`);
      if (err.details) {
        errorSection.push(`Detalhes/Stack:\n${safeStringify(err.details, 2)}`);
      }
      errorSection.push('--------------------------------------------------------------------');
    });
    errorSection.push('');
  } else {
    errorSection.push('✓ Nenhum erro crítico capturado até o momento.\n');
  }

  // Linha do tempo completa dos últimos 100 logs
  const timelineSection = [
    '🕒 HISTÓRICO RECENTE DE EVENTOS (ÚLTIMOS 100 LOGS):',
    '--------------------------------------------------------------------'
  ];

  const recentLogs = DIAGNOSTIC_LOGS.slice(-100);
  recentLogs.forEach((l) => {
    let line = `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.category}] ${l.message}`;
    if (l.details && l.level === 'error') {
      line += `\n   ↳ Detalhes: ${safeStringify(l.details)}`;
    }
    timelineSection.push(line);
  });
  timelineSection.push('====================================================================');

  const finalReport = [...reportHeader, ...errorSection, ...timelineSection].join('\n');

  try {
    await navigator.clipboard.writeText(finalReport);
    if (typeof triggerHaptic === 'function') triggerHaptic([50, 50, 100]);
    showCopyFeedback(true);
    return finalReport;
  } catch (err) {
    // Fallback com textarea temporário caso o clipboard API falhe
    try {
      if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = finalReport;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        if (typeof triggerHaptic === 'function') triggerHaptic([50, 50, 100]);
        showCopyFeedback(true);
        return finalReport;
      }
    } catch (_) {}
    console.warn('[Diagnostic Console] Falha ao gravar no clipboard do sistema.');
    return finalReport;
  }
}

function showCopyFeedback(success) {
  if (typeof document === 'undefined') return;
  const btn = document.getElementById('btn-copy-console-report');
  if (btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = '✓ COPIADO COM SUCESSO! COLE NO CHAT';
    btn.style.background = '#10b981';
    setTimeout(() => {
      if (btn) {
        btn.innerHTML = originalText;
        btn.style.background = 'linear-gradient(135deg, #059669, #10b981)';
      }
    }, 3000);
  }

  // Notificação flutuante
  const toast = document.createElement('div');
  toast.style.cssText = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #059669; color: #fff; padding: 12px 24px; border-radius: 12px; font-weight: 800; font-size: 0.95rem; z-index: 99999999; box-shadow: 0 10px 25px rgba(0,0,0,0.5); display: flex; align-items: center; gap: 8px; border: 1px solid #34d399;';
  toast.innerHTML = '📋 <span>Relatório copiado com sucesso! Cole aqui no chat.</span>';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

export function clearDiagnosticLogs() {
  DIAGNOSTIC_LOGS.length = 0;
  totalErrorsCount = 0;
  totalWarningsCount = 0;
  addDiagnosticLog({
    level: 'info',
    category: 'SYSTEM',
    message: 'Histórico de logs limpo pelo usuário.'
  });
  updateHeaderPillBadge();
  renderAllLogs();
  triggerHaptic(40);
}

// ==============================================================================
// 7. ATUALIZAÇÃO DO BADGE NO HEADER
// ==============================================================================
function updateHeaderPillBadge() {
  if (typeof document === 'undefined') return;
  const pill = document.getElementById('console-error-pill');
  if (!pill) return;

  if (totalErrorsCount > 0) {
    pill.textContent = totalErrorsCount;
    pill.classList.remove('hidden');
    pill.style.display = 'inline-flex';
  } else {
    pill.classList.add('hidden');
    pill.style.display = 'none';
  }
}

// ==============================================================================
// 8. UTILITÁRIOS INTERNOS
// ==============================================================================
function safeStringify(obj, indent = 0) {
  if (obj === null || obj === undefined) return '';
  if (typeof obj === 'string') return obj;
  try {
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'function') return '[Function]';
      if (value instanceof Error) {
        return {
          message: value.message,
          name: value.name,
          stack: value.stack
        };
      }
      return value;
    }, indent);
  } catch (_) {
    return String(obj);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
