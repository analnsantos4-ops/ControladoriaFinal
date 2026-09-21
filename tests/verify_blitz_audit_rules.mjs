import 'fake-indexeddb/auto';
import assert from 'node:assert';

// Mock minimal browser globals if needed
global.window = global;
global.document = {
  getElementById: () => null,
  body: { appendChild: () => {} },
  createElement: () => ({ setAttribute: () => {}, classList: { add: () => {}, remove: () => {} } })
};
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; }
};

global.sessionStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); },
  removeItem(k) { delete this._store[k]; }
};

const { initDB, getAllFromStore, getBlitzSessionById, createBlitzSession } = await import('../js/db.js');
const { parseBlitzInputList, importBlitzItemsWithHistory, saveBlitzConference, finalizeBlitzWithAutoZeros } = await import('../js/blitz_engine.js');
const { getPreviousFinalizedBlitzConference } = await import('../js/db.js');
const { verifyCode } = await import('../js/auth.js');

async function runTests() {
  console.log('--- INICIANDO BATERIA DE TESTES DE AUDITORIA E REGRAS DA BLITZ ---');
  await initDB();

  // ==========================================
  // CENÁRIO 1: REGRA 1 CÓDIGO DE BARRAS = 1 PRODUTO
  // Duas linhas com o mesmo EAN 7891000000011 e validades distintas
  // ==========================================
  console.log('\n[TESTE 1] Importação de 2 linhas com mesmo EAN e validades diferentes...');
  const csvData = `Código Barras\tDescrição\tData Validade\tQuantidade
7891000000011\tArroz Ana Luiza Tipo 1 5KG\t15/10/2026\t0
7891000000011\tArroz Premium Ana Luiza Tipo 1 5KG\t30/10/2026\t0`;

  const parsedItems = parseBlitzInputList(csvData);
  assert.strictEqual(parsedItems.length, 2, 'Deve identificar 2 itens no CSV');
  assert.strictEqual(parsedItems[0].ean, '7891000000011');
  assert.strictEqual(parsedItems[1].ean, '7891000000011');

  // Cria Blitz 1 por Ana Luiza
  verifyCode('1407'); // Ana Luiza
  const session1 = await createBlitzSession({
    sector: 'MERCEARIA',
    user_name: 'Ana Luiza',
    user_id: 'ana_luiza'
  });
  const blitz1Id = session1.id;

  const importResult = await importBlitzItemsWithHistory(blitz1Id, parsedItems);
  assert.strictEqual(importResult.total, 2, 'Import result total deve ser 2 itens');

  // Verifica na tabela 'products' se existe APENAS 1 produto para esse código de barras
  const allProds = await getAllFromStore('products');
  const prodsWithEan = allProds.filter(p => String(p.barcode) === '7891000000011');
  assert.strictEqual(prodsWithEan.length, 1, 'REGRA FUNDAMENTAL: Deve existir apenas 1 único cadastro de produto para o EAN!');
  console.log('✓ TESTE 1 PASSOU: 1 único produto cadastrado no banco para o EAN 7891000000011.');

  // ==========================================
  // CENÁRIO 2: CONFERÊNCIA POR ANA LUIZA NA BLITZ 1
  // ==========================================
  console.log('\n[TESTE 2] Ana Luiza confere a validade 15/10/2026 com 11 unidades na Blitz 1...');
  const b1Items = await getAllFromStore('blitz_itens');
  const item15 = b1Items.find(i => i.blitz_id === blitz1Id && String(i.data_validade).includes('2026-10-15'));
  assert.ok(item15, 'Item 15/10/2026 deve existir na Blitz 1');

  await saveBlitzConference({
    blitzId: blitz1Id,
    itemId: item15.id,
    ean: '7891000000011',
    dataValidade: '2026-10-15',
    quantidade: 11,
    tipoConferencia: 'MANUAL',
    corredor: 'Corredor 1',
    locations: [{ location: 'Prateleira', quantity: 10 }, { location: 'Depósito', quantity: 1 }],
    usuario: 'Ana Luiza',
    user_id: 'ana_luiza'
  });

  // Finaliza Blitz 1 com auto-zeros (o item 30/10/2026 estava pendente e deve ir a 0)
  console.log('Finalizando Blitz 1 com auto-zeros...');
  const stats1 = await finalizeBlitzWithAutoZeros(blitz1Id, 'Ana Luiza', 'ana_luiza');
  assert.strictEqual(stats1.zerosAutomaticos, 1, 'Item 30/10/2026 deve ter virado zero automático');
  assert.strictEqual(stats1.conferidosManualmente, 1, 'Item 15/10/2026 deve ser mantido como conferido manualmente');
  console.log('✓ TESTE 2 PASSOU: Blitz 1 finalizada sem erros de user_id e regras de auto-zero cumpridas.');

  // ==========================================
  // CENÁRIO 3: ANGÉLICA INICIA BLITZ 2 E BIPA O PRODUTO
  // ==========================================
  console.log('\n[TESTE 3] Angélica inicia a Blitz 2 e consulta histórico...');
  verifyCode('160926'); // Angélica
  const session2 = await createBlitzSession({
    sector: 'MERCEARIA',
    user_name: 'Angélica',
    user_id: 'angelica'
  });
  const blitz2Id = session2.id;

  // 3.1 Angélica seleciona validade 15/10/2026
  const priorConf15 = await getPreviousFinalizedBlitzConference({
    currentBlitzId: blitz2Id,
    barcode: '7891000000011',
    expirationDate: '2026-10-15'
  });

  assert.ok(priorConf15, 'Deve encontrar histórico da conferência de Ana Luiza para 15/10/2026');
  assert.strictEqual(priorConf15.quantity, 11, 'Quantidade de referência deve ser 11 unidades');
  assert.strictEqual(priorConf15.responsible, 'Ana Luiza', 'Responsável anterior deve ser Ana Luiza');
  console.log('✓ TESTE 3.1 PASSOU: Angélica vê a última conferência de 15/10/2026: 11 un por Ana Luiza como referência.');

  // 3.2 Angélica seleciona validade que NUNCA foi conferida em nenhuma blitz
  const priorConfNever = await getPreviousFinalizedBlitzConference({
    currentBlitzId: blitz2Id,
    barcode: '7891000000011',
    expirationDate: '2027-05-20'
  });

  assert.strictEqual(priorConfNever, null, 'Para data nunca conferida, getPreviousFinalizedBlitzConference DEVE retornar null');
  console.log('✓ TESTE 3.2 PASSOU: Data nunca conferida retorna null (NUNCA CONFERIDO, ausência != 0).');

  // 3.3 Regra de isolamento de validade: 2026-10-15 NÃO vaza para 2026-10-30
  // O item 30/10/2026 na Blitz 1 foi ZERO_AUTOMATICO (quantidade 0), não 11 unidades!
  const priorConf30 = await getPreviousFinalizedBlitzConference({
    currentBlitzId: blitz2Id,
    barcode: '7891000000011',
    expirationDate: '2026-10-30'
  });
  assert.ok(priorConf30, 'Existe conferência de auto-zero de 30/10/2026');
  assert.strictEqual(priorConf30.quantity, 0, 'Quantidade para 30/10/2026 deve ser 0 e NÃO 11!');
  console.log('✓ TESTE 3.3 PASSOU: Isolamento estrito de validades verificado (quantidade 11 não vazou para 30/10/2026).');

  // ==========================================
  // CENÁRIO 4: FINALIZAÇÃO DA BLITZ 2 COM AUDITORIA
  // ==========================================
  console.log('\n[TESTE 4] Angélica confere 15/10/2026 com 14 un e finaliza Blitz 2...');
  // Cria item na Blitz 2
  await importBlitzItemsWithHistory(blitz2Id, parsedItems);
  const b2Items = await getAllFromStore('blitz_itens');
  const b2Item15 = b2Items.find(i => i.blitz_id === blitz2Id && String(i.data_validade).includes('2026-10-15'));

  await saveBlitzConference({
    blitzId: blitz2Id,
    itemId: b2Item15.id,
    ean: '7891000000011',
    dataValidade: '2026-10-15',
    quantidade: 14,
    tipoConferencia: 'MANUAL',
    corredor: 'Corredor 1',
    locations: [{ location: 'Prateleira', quantity: 14 }],
    usuario: 'Angélica',
    userId: 'angelica'
  });

  const stats2 = await finalizeBlitzWithAutoZeros(blitz2Id, 'Angélica', 'angelica');
  assert.strictEqual(stats2.conferidosManualmente, 1, '1 item conferido manualmente');
  assert.strictEqual(stats2.zerosAutomaticos, 1, '1 item auto-zerado');

  const b2Updated = await getBlitzSessionById(blitz2Id);
  assert.strictEqual(b2Updated.finalized_by, 'Angélica', 'finalized_by deve ser Angélica');
  assert.strictEqual(b2Updated.finalized_by_user_id, 'angelica', 'finalized_by_user_id deve ser angelica');

  // Checa auditoria
  const audits = await getAllFromStore('historico_alteracoes');
  const finishAudit = audits.find(a => a.blitz_id === blitz2Id && a.acao === 'FINALIZACAO');
  assert.ok(finishAudit, 'Deve registrar auditoria de finalização');
  assert.strictEqual(finishAudit.user_id, 'angelica', 'Auditoria deve registrar user_id angelica');
  console.log('✓ TESTE 4 PASSOU: Auditoria e finalização com Angélica registradas perfeitamente.');

  console.log('\n======================================================');
  console.log('TODOS OS TESTES PASSARAM COM 100% DE SUCESSO E CONFORMIDADE!');
  console.log('======================================================');
}

runTests().catch(err => {
  console.error('FALHA NOS TESTES:', err);
  process.exit(1);
});
