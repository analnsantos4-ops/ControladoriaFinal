import 'fake-indexeddb/auto';
import assert from 'node:assert';

// Mock browser globals
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

const {
  initDB,
  getAllFromStore,
  createBlitzSession,
  saveBlitzConferenceRecord,
  getPreviousFinalizedBlitzConference
} = await import('../js/db.js');

const {
  importBlitzItemsWithHistory,
  saveBlitzConference,
  finalizeBlitzWithAutoZeros,
  getBlitzItens
} = await import('../js/blitz_engine.js');

const { verifyCode } = await import('../js/auth.js');

async function runTests() {
  console.log('================================================================');
  console.log('  TESTES DOS 7 CENÁRIOS DA REGRA DE OURO DA CONTAGEM DA BLITZ');
  console.log('================================================================\n');

  await initDB();

  // -------------------------------------------------------------
  // CENÁRIO 1: CADA BLITZ É UMA NOVA CONTAGEM
  // Blitz 1 (Ana) -> Prateleira = 15
  // Blitz 2 (Angélica) -> Orelha = 5
  // Esperado: Blitz 1 = 15, Blitz 2 = 5, Total da Blitz 2 NÃO É 20.
  // -------------------------------------------------------------
  console.log('[CENÁRIO 1] Testando separação total entre Blitz 1 (Ana) e Blitz 2 (Angélica)...');
  verifyCode('1407'); // Ana Luiza
  const session1 = await createBlitzSession({
    sector: 'MERCEARIA',
    user_name: 'Ana Luiza',
    user_id: 'ana_luiza'
  });
  const blitz1Id = session1.id;

  const itemsImportB1 = [
    { ean: '7891111111111', nome: 'Produto X Teste', data_validade: '2026-12-31', quantidade: 0 }
  ];
  await importBlitzItemsWithHistory(blitz1Id, itemsImportB1);

  // Ana Luiza confere 15 unidades na Prateleira
  await saveBlitzConferenceRecord({
    sessionId: blitz1Id,
    barcode: '7891111111111',
    requestedDate: '2026-12-31',
    newQuantity: 15,
    result: 'TEM',
    locations: [{ location: 'PRATELEIRA', quantity: 15 }],
    userId: 'ana_luiza',
    userName: 'Ana Luiza'
  });

  // Finaliza Blitz 1
  await finalizeBlitzWithAutoZeros(blitz1Id, 'Ana Luiza', 'ana_luiza');

  // Angélica cria Blitz 2
  verifyCode('160926'); // Angélica
  const session2 = await createBlitzSession({
    sector: 'MERCEARIA',
    user_name: 'Angélica',
    user_id: 'angelica'
  });
  const blitz2Id = session2.id;

  await importBlitzItemsWithHistory(blitz2Id, itemsImportB1);

  // Angélica encontra 5 unidades na Orelha
  await saveBlitzConferenceRecord({
    sessionId: blitz2Id,
    barcode: '7891111111111',
    requestedDate: '2026-12-31',
    newQuantity: 5,
    result: 'TEM',
    locations: [{ location: 'ORELHA', quantity: 5 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  // Validação Cenário 1
  const allConfs = await getAllFromStore('conferencias_blitz');
  const b1Confs = allConfs.filter(c => c.blitz_id === blitz1Id);
  const b2Confs = allConfs.filter(c => c.blitz_id === blitz2Id);

  const totalB1 = b1Confs.reduce((sum, c) => sum + (Number(c.quantidade) || 0), 0);
  const totalB2 = b2Confs.reduce((sum, c) => sum + (Number(c.quantidade) || 0), 0);

  assert.strictEqual(totalB1, 15, 'Total da Blitz 1 deve ser 15 un');
  assert.strictEqual(totalB2, 5, 'Total da Blitz 2 deve ser 5 un (e NÃO 20 un!)');
  assert.notStrictEqual(totalB2, 20, 'CRÍTICO: Total da Blitz 2 nunca pode ser 15 + 5 = 20!');

  console.log('✓ PASSOU CENÁRIO 1: Blitz 1 = 15 un (Ana Luiza) | Blitz 2 = 5 un (Angélica). Não houve soma acidental.\n');

  // -------------------------------------------------------------
  // CENÁRIO 2: PRODUTO NUNCA CONFERIDO
  // Esperado: Exibir 'NUNCA CONFERIDO', Quantidade atual = 0
  // -------------------------------------------------------------
  console.log('[CENÁRIO 2] Testando produto nunca conferido...');
  const prevConfNever = await getPreviousFinalizedBlitzConference({
    productId: 'prod_virgem_999',
    barcode: '7899999999999',
    expirationDate: '2027-05-20',
    currentBlitzId: blitz2Id
  });

  assert.strictEqual(prevConfNever, null, 'Produto nunca conferido deve retornar null como histórico');
  console.log('✓ PASSOU CENÁRIO 2: Produto virgem retorna null para histórico ("NUNCA CONFERIDO").\n');

  // -------------------------------------------------------------
  // CENÁRIO 3: PRODUTO COM HISTÓRICO ANTERIOR DE 20 UNIDADES
  // Nova Blitz iniciada: antes da contagem quantidade atual = 0.
  // Depois de contar 6 na Orelha: Blitz atual = 6, Histórico continua 20.
  // -------------------------------------------------------------
  console.log('[CENÁRIO 3] Testando referência histórica de 20 un e contagem atual de 6 un...');
  // Cria Blitz com 20 un para o Produto Y
  const sessionPrev = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Ana Luiza', user_id: 'ana_luiza' });
  await importBlitzItemsWithHistory(sessionPrev.id, [{ ean: '7892222222222', nome: 'Produto Y', data_validade: '2026-11-15' }]);
  await saveBlitzConferenceRecord({
    sessionId: sessionPrev.id,
    barcode: '7892222222222',
    requestedDate: '2026-11-15',
    newQuantity: 20,
    result: 'TEM',
    locations: [{ location: 'PRATELEIRA', quantity: 20 }],
    userId: 'ana_luiza',
    userName: 'Ana Luiza'
  });
  await finalizeBlitzWithAutoZeros(sessionPrev.id, 'Ana Luiza', 'ana_luiza');

  // Inicia nova Blitz
  const sessionNew = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Angélica', user_id: 'angelica' });
  await importBlitzItemsWithHistory(sessionNew.id, [{ ean: '7892222222222', nome: 'Produto Y', data_validade: '2026-11-15' }]);

  // Antes da contagem:
  const itemsBefore = await getBlitzItens(sessionNew.id);
  const itemBefore = itemsBefore.find(i => i.ean === '7892222222222');
  assert.strictEqual(Number(itemBefore.quantidade || 0), 0, 'Antes da contagem a quantidade da nova Blitz deve ser 0');
  assert.strictEqual(itemBefore.status, 'PENDENTE', 'Antes da contagem o status deve ser PENDENTE');

  // Histórico anterior deve informar 20 un
  const histRef = await getPreviousFinalizedBlitzConference({
    barcode: '7892222222222',
    expirationDate: '2026-11-15',
    currentBlitzId: sessionNew.id
  });
  assert.ok(histRef, 'Histórico deve ser encontrado');
  assert.strictEqual(histRef.quantity, 20, 'Histórico deve informar 20 un');

  // Angélica conta 6 un na Orelha
  await saveBlitzConferenceRecord({
    sessionId: sessionNew.id,
    barcode: '7892222222222',
    requestedDate: '2026-11-15',
    newQuantity: 6,
    result: 'TEM',
    locations: [{ location: 'ORELHA', quantity: 6 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  const itemsAfter = await getBlitzItens(sessionNew.id);
  const itemAfter = itemsAfter.find(i => i.ean === '7892222222222');
  assert.strictEqual(Number(itemAfter.quantidade), 6, 'Quantidade da Blitz atual deve ser 6 un');

  // Histórico permanece 20
  const histStill20 = await getPreviousFinalizedBlitzConference({
    barcode: '7892222222222',
    expirationDate: '2026-11-15',
    currentBlitzId: sessionNew.id
  });
  assert.strictEqual(histStill20.quantity, 20, 'Histórico continua sendo 20 un de referência anterior');

  console.log('✓ PASSOU CENÁRIO 3: Histórico = 20 un | Quantidade conferida na Blitz atual = 6 un.\n');

  // -------------------------------------------------------------
  // CENÁRIO 4: NA MESMA BLITZ - QUANTIDADE POR LOCAL
  // Conferência 1 -> Orelha = 5
  // Conferência 2 -> Prateleira = 4
  // Esperado: Total = 9 (5 + 4) e ambos os locais registrados.
  // -------------------------------------------------------------
  console.log('[CENÁRIO 4] Testando múltiplos locais na mesma Blitz (Orelha = 5 + Prateleira = 4 -> Total = 9)...');
  const sessionMultiLoc = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Angélica', user_id: 'angelica' });
  await importBlitzItemsWithHistory(sessionMultiLoc.id, [{ ean: '7893333333333', nome: 'Produto Z', data_validade: '2026-08-10' }]);

  // Passo 1: Orelha = 5
  await saveBlitzConferenceRecord({
    sessionId: sessionMultiLoc.id,
    barcode: '7893333333333',
    requestedDate: '2026-08-10',
    newQuantity: 5,
    result: 'TEM',
    locations: [{ location: 'ORELHA', quantity: 5 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  // Passo 2: Encontra mais 4 na Prateleira -> locations unificados: Orelha 5 + Prateleira 4
  await saveBlitzConferenceRecord({
    sessionId: sessionMultiLoc.id,
    barcode: '7893333333333',
    requestedDate: '2026-08-10',
    newQuantity: 9,
    result: 'TEM',
    locations: [
      { location: 'ORELHA', quantity: 5 },
      { location: 'PRATELEIRA', quantity: 4 }
    ],
    userId: 'angelica',
    userName: 'Angélica'
  });

  const bMultiItems = await getBlitzItens(sessionMultiLoc.id);
  const itMulti = bMultiItems.find(i => i.ean === '7893333333333');
  assert.strictEqual(Number(itMulti.quantidade), 9, 'Total deve ser 9 un');
  assert.strictEqual(itMulti.locations.length, 2, 'Deve conter 2 locais registrados');
  console.log('✓ PASSOU CENÁRIO 4: Orelha: 5 un + Prateleira: 4 un = Total 9 un com ambos os locais salvos.\n');

  // -------------------------------------------------------------
  // CENÁRIO 5: NA MESMA BLITZ - CORREÇÃO DO MESMO LOCAL
  // Conferência 1 -> Orelha = 5
  // Conferência 2 -> Orelha = 7 (correção)
  // Esperado: Total = 7 (e NÃO 12)
  // -------------------------------------------------------------
  console.log('[CENÁRIO 5] Testando correção no mesmo local (Orelha: 5 corrigido para 7 -> Total 7, e não 12)...');
  const sessionCorrect = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Angélica', user_id: 'angelica' });
  await importBlitzItemsWithHistory(sessionCorrect.id, [{ ean: '7894444444444', nome: 'Produto W', data_validade: '2026-09-01' }]);

  // Conferência 1: Orelha = 5
  await saveBlitzConferenceRecord({
    sessionId: sessionCorrect.id,
    barcode: '7894444444444',
    requestedDate: '2026-09-01',
    newQuantity: 5,
    result: 'TEM',
    locations: [{ location: 'ORELHA', quantity: 5 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  // Correção: Orelha = 7 (substituição da contagem do local)
  await saveBlitzConferenceRecord({
    sessionId: sessionCorrect.id,
    barcode: '7894444444444',
    requestedDate: '2026-09-01',
    newQuantity: 7,
    result: 'TEM',
    locations: [{ location: 'ORELHA', quantity: 7 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  const bCorrectItems = await getBlitzItens(sessionCorrect.id);
  const itCorrect = bCorrectItems.find(i => i.ean === '7894444444444');
  assert.strictEqual(Number(itCorrect.quantidade), 7, 'Total deve ser exatamente 7 un');
  assert.notStrictEqual(Number(itCorrect.quantidade), 12, 'Não pode somar 5 + 7 = 12!');
  console.log('✓ PASSOU CENÁRIO 5: Orelha corrigida para 7 un. Total é 7 un (substituição correta).\n');

  // -------------------------------------------------------------
  // CENÁRIO 6: PRODUTO NÃO ENCONTRADO / NÃO TEM
  // Blitz anterior = 10 unidades
  // Nova Blitz -> usuário marca 'NÃO TEM'
  // Esperado: Blitz atual = 0 unidades, Histórico informa que antes tinha 10.
  // -------------------------------------------------------------
  console.log('[CENÁRIO 6] Testando produto com 10 un antes que vira NÃO TEM na nova Blitz...');
  const sessionHad10 = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Ana Luiza', user_id: 'ana_luiza' });
  await importBlitzItemsWithHistory(sessionHad10.id, [{ ean: '7895555555555', nome: 'Produto K', data_validade: '2026-07-20' }]);
  await saveBlitzConferenceRecord({
    sessionId: sessionHad10.id,
    barcode: '7895555555555',
    requestedDate: '2026-07-20',
    newQuantity: 10,
    result: 'TEM',
    locations: [{ location: 'PRATELEIRA', quantity: 10 }],
    userId: 'ana_luiza',
    userName: 'Ana Luiza'
  });
  await finalizeBlitzWithAutoZeros(sessionHad10.id, 'Ana Luiza', 'ana_luiza');

  // Nova Blitz: Angélica marca NÃO TEM
  const sessionZero = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Angélica', user_id: 'angelica' });
  await importBlitzItemsWithHistory(sessionZero.id, [{ ean: '7895555555555', nome: 'Produto K', data_validade: '2026-07-20' }]);

  await saveBlitzConferenceRecord({
    sessionId: sessionZero.id,
    barcode: '7895555555555',
    requestedDate: '2026-07-20',
    previousQuantity: 10,
    newQuantity: 0,
    result: 'NAO_TEM',
    locations: [],
    userId: 'angelica',
    userName: 'Angélica'
  });

  const bZeroItems = await getBlitzItens(sessionZero.id);
  const itZero = bZeroItems.find(i => i.ean === '7895555555555');
  assert.strictEqual(Number(itZero.quantidade), 0, 'Blitz atual deve ser 0 unidades');
  assert.strictEqual(itZero.result, 'NAO_TEM', 'Resultado deve ser NAO_TEM');

  // Histórico anterior continua mostrando 10 un
  const histHad10 = await getPreviousFinalizedBlitzConference({
    barcode: '7895555555555',
    expirationDate: '2026-07-20',
    currentBlitzId: sessionZero.id
  });
  assert.strictEqual(histHad10.quantity, 10, 'Histórico continua informando 10 un da Blitz anterior');
  console.log('✓ PASSOU CENÁRIO 6: Blitz atual = 0 un (NÃO TEM) | Histórico anterior = 10 un.\n');

  // -------------------------------------------------------------
  // CENÁRIO 7: SEPARAÇÃO TOTAL POR VALIDADE
  // Validade A (10/05) -> 4 unidades
  // Validade B (15/05) -> 6 unidades
  // Esperado: Validade A = 4, Validade B = 6. Nunca somar como a mesma conferência.
  // -------------------------------------------------------------
  console.log('[CENÁRIO 7] Testando separação por validade (10/05 = 4 un, 15/05 = 6 un)...');
  const sessionVal = await createBlitzSession({ sector: 'MERCEARIA', user_name: 'Angélica', user_id: 'angelica' });
  await importBlitzItemsWithHistory(sessionVal.id, [
    { ean: '7896666666666', nome: 'Iogurte Teste', data_validade: '2026-05-10' },
    { ean: '7896666666666', nome: 'Iogurte Teste', data_validade: '2026-05-15' }
  ]);

  // Confere Validade A (10/05/2026) -> 4 un
  await saveBlitzConferenceRecord({
    sessionId: sessionVal.id,
    barcode: '7896666666666',
    requestedDate: '2026-05-10',
    newQuantity: 4,
    result: 'TEM',
    locations: [{ location: 'GELADEIRA', quantity: 4 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  // Confere Validade B (15/05/2026) -> 6 un
  await saveBlitzConferenceRecord({
    sessionId: sessionVal.id,
    barcode: '7896666666666',
    requestedDate: '2026-05-15',
    newQuantity: 6,
    result: 'TEM',
    locations: [{ location: 'GELADEIRA', quantity: 6 }],
    userId: 'angelica',
    userName: 'Angélica'
  });

  const bValItems = await getBlitzItens(sessionVal.id);
  const itValA = bValItems.find(i => i.ean === '7896666666666' && String(i.data_validade).includes('2026-05-10'));
  const itValB = bValItems.find(i => i.ean === '7896666666666' && String(i.data_validade).includes('2026-05-15'));

  assert.ok(itValA, 'Item da Validade A deve existir');
  assert.ok(itValB, 'Item da Validade B deve existir');
  assert.strictEqual(Number(itValA.quantidade), 4, 'Validade A deve ter 4 un');
  assert.strictEqual(Number(itValB.quantidade), 6, 'Validade B deve ter 6 un');
  assert.notStrictEqual(Number(itValA.quantidade), 10, 'Validade A não pode ter 10 un');
  assert.notStrictEqual(Number(itValB.quantidade), 10, 'Validade B não pode ter 10 un');

  console.log('✓ PASSOU CENÁRIO 7: Validade A = 4 un | Validade B = 6 un. Validades mantidas isoladas.\n');

  console.log('================================================================');
  console.log('🎉 TODOS OS 7 CENÁRIOS FORAM TESTADOS E PASSARAM COM SUCESSO!');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});
