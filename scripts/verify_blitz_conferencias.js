// Teste de Verificação Automatizado: Test 33
// Valida que o produto X em Blitz A e Blitz B operam com isolamento total,
// que a conferência é estritamente delimitada pelo blitz_id E pela data_validade,
// e que o histórico nunca se contamina.

function formatDateBR(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).trim().split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
}

// Mock das coleções em memória simulando o banco de dados
const conferencias_blitz = [];
const blitz_itens = [];
const blitz_items = [];

function mockGetCurrentBlitzConferenceRecord(currentBlitzId, productId, barcode, requestedDate) {
  if (!currentBlitzId || (!productId && !barcode)) return null;
  const cleanBar = barcode ? String(barcode).trim() : null;
  const cleanExp = requestedDate ? String(requestedDate).trim().split('T')[0] : null;
  const cleanExpBR = cleanExp ? formatDateBR(cleanExp) : null;

  const matchConf = conferencias_blitz.find(c => {
    if (c.blitz_id !== currentBlitzId) return false;
    const eanMatch = cleanBar && String(c.ean || '').trim() === cleanBar;
    const idMatch = productId && c.produto_id === productId;
    if (!cleanExp) return eanMatch || idMatch;
    const dMatch = String(c.data_validade || '').split('T')[0] === cleanExp || formatDateBR(c.data_validade) === cleanExpBR;
    return (eanMatch || idMatch) && dMatch;
  });

  if (matchConf) {
    const qty = Number(matchConf.quantidade) || 0;
    return {
      blitzId: currentBlitzId,
      quantity: qty,
      total: qty,
      expirationDate: matchConf.data_validade,
      result: qty > 0 ? 'TEM' : 'NAO_TEM'
    };
  }

  const matchBItem = blitz_itens.find(it => {
    if (it.blitz_id !== currentBlitzId) return false;
    const eanMatch = cleanBar && String(it.ean || '').trim() === cleanBar;
    const idMatch = productId && it.produto_id === productId;
    if (!cleanExp) return (eanMatch || idMatch) && (it.status === 'CONFERIDO' || Boolean(it.conferido_em) || Number(it.quantidade) > 0);
    const dMatch = String(it.data_validade || '').split('T')[0] === cleanExp || formatDateBR(it.data_validade) === cleanExpBR;
    return (eanMatch || idMatch) && dMatch && (it.status === 'CONFERIDO' || Boolean(it.conferido_em) || Number(it.quantidade) > 0);
  });

  if (matchBItem) {
    const qty = Number(matchBItem.quantidade != null ? matchBItem.quantidade : matchBItem.total_quantity) || 0;
    return {
      blitzId: currentBlitzId,
      quantity: qty,
      total: qty,
      expirationDate: matchBItem.data_validade,
      result: qty > 0 ? 'TEM' : 'NAO_TEM'
    };
  }

  return null;
}

function runTest33() {
  console.log('=== INICIANDO TESTE 33: ISOLAMENTO DE BLITZ E VALIDADE ===');
  
  const productX = { id: 'prod-001', barcode: '7891000100101', name: 'LEITE INTEGRAL 1L' };
  const blitzA = 'blitz-sessao-A';
  const blitzB = 'blitz-sessao-B';
  const date1 = '2026-05-10';
  const date2 = '2026-06-20';

  // Passo 1: Na Blitz A, produto X na data1 é conferido com quantidade 12
  conferencias_blitz.push({
    id: 'conf-1',
    blitz_id: blitzA,
    produto_id: productX.id,
    ean: productX.barcode,
    data_validade: date1,
    quantidade: 12,
    conferido_em: new Date().toISOString()
  });

  // Teste 1.1: Consultar Produto X na Blitz A para date1 -> DEVE ACHAR
  const checkA1 = mockGetCurrentBlitzConferenceRecord(blitzA, productX.id, productX.barcode, date1);
  if (!checkA1 || checkA1.quantity !== 12) {
    throw new Error('Falha no Teste 1.1: Deveria encontrar conferência de 12 unidades na Blitz A data 1');
  }
  console.log('✔ Teste 1.1 PASSOU: Blitz A, data1 encontrada com 12 unidades');

  // Teste 1.2: Consultar Produto X na Blitz A para date2 (outra data) -> NÃO DEVE ACHAR (deve ser null)
  const checkA2 = mockGetCurrentBlitzConferenceRecord(blitzA, productX.id, productX.barcode, date2);
  if (checkA2 !== null) {
    throw new Error('Falha no Teste 1.2: Date2 não foi conferida na Blitz A, mas retornou conferência!');
  }
  console.log('✔ Teste 1.2 PASSOU: Blitz A, date2 não conferida retornou null');

  // Teste 1.3: Consultar Produto X na Blitz B para date1 -> NÃO DEVE ACHAR (não pode vazar da Blitz A para a Blitz B)
  const checkB1 = mockGetCurrentBlitzConferenceRecord(blitzB, productX.id, productX.barcode, date1);
  if (checkB1 !== null) {
    throw new Error('Falha no Teste 1.3: VAZAMENTO ENTRE BLITZ! Blitz B encontrou conferência que era da Blitz A!');
  }
  console.log('✔ Teste 1.3 PASSOU: Blitz B isolada, não enxerga conferência da Blitz A como conferida');

  // Passo 2: Na Blitz B, produto X na data1 é conferido com quantidade 0 (NÃO TEM)
  conferencias_blitz.push({
    id: 'conf-2',
    blitz_id: blitzB,
    produto_id: productX.id,
    ean: productX.barcode,
    data_validade: date1,
    quantidade: 0,
    conferido_em: new Date().toISOString()
  });

  // Teste 2.1: Consultar Blitz B para date1 -> DEVE ACHAR quantidade 0
  const checkB1After = mockGetCurrentBlitzConferenceRecord(blitzB, productX.id, productX.barcode, date1);
  if (!checkB1After || checkB1After.quantity !== 0) {
    throw new Error('Falha no Teste 2.1: Blitz B deveria ter 0 unidades registradas para date1');
  }
  console.log('✔ Teste 2.1 PASSOU: Blitz B tem conferência de 0 unidades');

  // Teste 2.2: Consultar Blitz A para date1 novamente -> DEVE CONTINUAR COM 12 (independência e integridade histórica)
  const checkA1After = mockGetCurrentBlitzConferenceRecord(blitzA, productX.id, productX.barcode, date1);
  if (!checkA1After || checkA1After.quantity !== 12) {
    throw new Error('Falha no Teste 2.2: Blitz A foi alterada pela Blitz B! Quebrou integridade histórica!');
  }
  console.log('✔ Teste 2.2 PASSOU: Blitz A mantém seus 12 originais sem alteração');

  console.log('====================================================');
  console.log('TODOS OS CRITÉRIOS DO TESTE 33 PASSARAM COM SUCESSO!');
  console.log('====================================================');
}

runTest33();
