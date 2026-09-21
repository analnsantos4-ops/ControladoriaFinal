import assert from 'assert';
import { MASTER_SECURITY_PIN } from '../js/auth.js';
import {
  initDiagnosticConsole,
  logAppEvent,
  copyDiagnosticReportToClipboard,
  clearDiagnosticLogs
} from '../js/diagnostic_console.js';

console.log('--- TESTE DO CONSOLE DE DIAGNÓSTICO E ERROS (6 DÍGITOS) ---');

// Mock básico do browser se executando em Node
if (typeof window === 'undefined') {
  global.window = {
    location: { href: 'http://localhost:3000' },
    innerWidth: 1080,
    innerHeight: 1920,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const storageMock = () => {
    let s = {};
    return {
      getItem: (k) => s[k] || null,
      setItem: (k, v) => { s[k] = String(v); },
      removeItem: (k) => { delete s[k]; },
      clear: () => { s = {}; }
    };
  };
  global.localStorage = storageMock();
  global.sessionStorage = storageMock();
  try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: {
        writeText: async (text) => {
          global.__lastCopiedText = text;
          return true;
        }
      },
      configurable: true,
      writable: true
    });
  } catch (_) {}
}

// 1. Inicializa o console
initDiagnosticConsole();
console.log('✓ Console inicializado com sucesso.');

// 2. Valida o PIN de 6 dígitos
assert.strictEqual(MASTER_SECURITY_PIN, '200902', 'O PIN mestre deve ser 200902 (6 dígitos)');
assert.strictEqual(MASTER_SECURITY_PIN.length, 6, 'O PIN deve ter exatamente 6 dígitos');
console.log('✓ Código de acesso de 6 dígitos validado: 200902');

// 3. Testa registro de eventos e erros
logAppEvent('BLITZ', 'Conferindo produto teste EAN 7891000000011', { qtd: 10 });
logAppEvent('SYNC', 'Erro simulado de conexão com banco de dados', { code: 42703 }, 'error');

const logs = window.getDiagnosticLogs();
assert.ok(logs.length >= 2, 'Deve conter pelo menos 2 logs registrados');
const errorLog = logs.find(l => l.level === 'error');
assert.ok(errorLog, 'Deve conter o log com nível error');
assert.strictEqual(errorLog.category, 'SYNC');
console.log('✓ Registro de logs e captura de erros funcionando perfeitamente.');

// 4. Testa a geração e cópia do relatório
await copyDiagnosticReportToClipboard();
assert.ok(global.__lastCopiedText, 'O texto deve ter sido copiado para a área de transferência');
assert.ok(global.__lastCopiedText.includes('RELATÓRIO DE DIAGNÓSTICO E ERROS'), 'Deve conter o título do relatório');
assert.ok(global.__lastCopiedText.includes('ERROS CRÍTICOS IDENTIFICADOS'), 'Deve conter a seção de erros críticos');
assert.ok(global.__lastCopiedText.includes('Erro simulado de conexão com banco de dados'), 'Deve conter a mensagem de erro no relatório');
console.log('✓ Geração e cópia de relatório em Markdown para o chat aprovada com 100% de sucesso.');

console.log('======================================================');
console.log('TODOS OS TESTES DO CONSOLE DE DIAGNÓSTICO FORAM APROVADOS!');
console.log('======================================================');
