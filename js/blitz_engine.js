// ====================================================
// MOTOR INTELIGENTE DA BLITZ DE VALIDADE
// Especificação Completa e Definitiva - Ana Luiza
// ====================================================

import {
  formatDateBR,
  parseDateBRtoISO,
  getTodayISO,
  generateId,
  CORRIDORS,
  WEEKLY_CYCLES,
  getWeeklyCycleForDate
} from './utils.js';

import {
  initDB,
  getProductByBarcode,
  saveProduct,
  getAllProducts,
  saveInventoryCounts,
  getProductExpirations,
  saveProductExpiration,
  getExpirationByProductAndDate
} from './db.js';

/**
 * 1. PARSER ROBUSTO DA LISTA DA BLITZ (Item 13 e 14)
 * Suporta formatos:
 * - 7898530843159 - PACOCA DADINHO ZERO QUADRADA 144G - 28/09/2026
 * - 7897115108805 - PACOCA ROLHA AMENDUPA 1,005KG - 30/09/2026
 * - 7891910020065 - BISCOITO 130G - 14/09/2026
 * - Com tabs, ponto-e-vírgula ou vírgula
 * - Garante chave composta: EAN + DATA_DE_VALIDADE
 * - Proteção contra duplicidades (Item 17): Nunca duplica o mesmo EAN + DATA_DE_VALIDADE
 */
export function parseBlitzInputList(rawText, fallbackDateISO = null) {
  if (!rawText) return [];
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const results = [];
  const seenCompositeKeys = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    let ean = '';
    let nome = '';
    let dataValidade = '';

    // Procura padrão de data DD/MM/AAAA, DD/MM/AA ou AAAA-MM-DD na linha
    const dateMatch = line.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/) ||
                      line.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/) ||
                      line.match(/\b(\d{2})[/-](\d{2})[/-](\d{2})\b/);
    let dateISO = '';
    let dateBR = '';

    if (dateMatch) {
      if (dateMatch[1].length === 4) {
        // AAAA-MM-DD
        dateISO = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
        dateBR = `${dateMatch[3]}/${dateMatch[2]}/${dateMatch[1]}`;
      } else if (dateMatch[3].length === 4) {
        // DD/MM/AAAA
        dateBR = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;
        dateISO = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      } else {
        // DD/MM/AA -> converte AA para 20AA (ex: 26 -> 2026)
        const yy = parseInt(dateMatch[3], 10);
        const yyyy = yy < 50 ? (2000 + yy) : (1900 + yy);
        dateBR = `${dateMatch[1]}/${dateMatch[2]}/${yyyy}`;
        dateISO = `${yyyy}-${dateMatch[2]}-${dateMatch[1]}`;
      }
    }

    // Remove a data da linha para extrair EAN e Nome
    let lineWithoutDate = line;
    if (dateMatch) {
      lineWithoutDate = line.replace(dateMatch[0], '').trim();
    }

    // Extrai EAN (4 a 14 dígitos consecutivos)
    // Tenta primeiro no início
    const eanStartMatch = lineWithoutDate.match(/^(\d{4,14})\s*[-–—:;\t, ]\s*(.*)$/);
    if (eanStartMatch) {
      ean = eanStartMatch[1].trim();
      nome = eanStartMatch[2].trim().replace(/^[-–—:;\t, ]+|[-–—:;\t, ]+$/g, '').trim();
    } else {
      // Tenta EAN em qualquer posição
      const eanAnyMatch = lineWithoutDate.match(/\b(\d{7,14})\b/);
      if (eanAnyMatch) {
        ean = eanAnyMatch[1].trim();
        nome = lineWithoutDate.replace(ean, '').replace(/^[-–—:;\t, ]+|[-–—:;\t, ]+$/g, '').trim();
      } else {
        const onlyDigits = lineWithoutDate.match(/^(\d{4,14})$/);
        if (onlyDigits) {
          ean = onlyDigits[1].trim();
          nome = `PRODUTO ${ean}`;
        }
      }
    }

    // Limpa nome
    nome = (nome || '').toUpperCase().replace(/^[-–—:;\t, ]+|[-–—:;\t, ]+$/g, '').trim();
    if (!nome && ean) {
      nome = `PRODUTO ${ean}`;
    }

    if (!ean) continue;

    // Se não encontrou data na linha, usa a data informada no período ou data padrão (30 dias)
    if (!dateISO) {
      if (fallbackDateISO) {
        dateISO = String(fallbackDateISO).includes('/') ? parseDateBRtoISO(fallbackDateISO) : String(fallbackDateISO).trim().split('T')[0];
        dateBR = formatDateBR(dateISO);
      } else {
        // Data padrão hoje + 30 dias
        const d = new Date();
        d.setDate(d.getDate() + 30);
        dateISO = d.toISOString().split('T')[0];
        dateBR = formatDateBR(dateISO);
      }
    }

    // Chave composta EAN + DATA_DE_VALIDADE (Item 14 e 17)
    const compositeKey = `${ean}__${dateISO}`;
    if (seenCompositeKeys.has(compositeKey)) {
      // Atualiza nome se a versão atual tiver um nome mais completo
      const existing = results.find(r => r.compositeKey === compositeKey);
      if (existing && nome && nome.length > existing.nome.length) {
        existing.nome = nome;
      }
      continue; // Ignora duplicidade
    }

    seenCompositeKeys.add(compositeKey);
    results.push({
      compositeKey,
      ean,
      nome,
      descricao: nome,
      dataValidade: dateISO,
      data_validade: dateISO,
      dataValidadeBR: dateBR,
      data_validade_br: dateBR
    });
  }

  return results;
}

/**
 * 2. CRIAÇÃO DE REGISTRO NA TABELA 'blitz' (Item 12)
 */
export async function createBlitzRecord({
  data_inicio = null,
  data_fim = null,
  setor = 'MERCEARIA',
  responsavel = 'Ana Luiza',
  observacao = ''
}) {
  const db = await initDB();
  const id = generateId('blitz_');
  const now = new Date().toISOString();

  const record = {
    id,
    data_inicio: data_inicio || getTodayISO(),
    data_fim: data_fim || getTodayISO(),
    setor: String(setor || 'MERCEARIA').toUpperCase(),
    responsavel: responsavel || 'Ana Luiza',
    status: 'EM_ANDAMENTO', // 'EM_ANDAMENTO', 'FINALIZADA', 'REABERTA'
    observacao: observacao || '',
    created_at: now,
    updated_at: now,
    finalized_at: null
  };

  // Salva na tabela blitz
  await putRecord('blitz', record);

  // Espelha na tabela blitz_sessions para compatibilidade total com o restante do sistema
  const sessionMirror = {
    id,
    blitz_type: 'periodo',
    sector: record.setor,
    user_name: record.responsavel,
    status: 'active',
    start_date: record.data_inicio,
    end_date: record.data_fim,
    period_label: `${formatDateBR(record.data_inicio)} → ${formatDateBR(record.data_fim)}`,
    notes: record.observacao,
    started_at: now,
    finished_at: null
  };
  await putRecord('blitz_sessions', sessionMirror);

  // Registra no histórico de auditoria (Item 62)
  await recordAudit({
    registro_id: id,
    tabela: 'blitz',
    acao: 'CRIACAO',
    usuario: record.responsavel,
    descricao: `Blitz criada para o setor ${record.setor} de ${formatDateBR(record.data_inicio)} a ${formatDateBR(record.data_fim)}`
  });

  return record;
}

/**
 * 3. IMPORTAÇÃO DOS ITENS COM BUSCA DE HISTÓRICO ANTERIOR (Item 13, 14, 15, 16, 17)
 */
export async function importBlitzItemsWithHistory(blitzId, parsedItems, defaultSector = 'MERCEARIA') {
  if (!blitzId || !Array.isArray(parsedItems) || parsedItems.length === 0) {
    return {
      totalImportados: 0,
      produtosNovos: 0,
      jaVerificados: 0,
      tinhamQuantidade: 0,
      tinhamZero: 0,
      datasDistintas: 0,
      itens: []
    };
  }

  const db = await initDB();
  const blitz = await getRecordById('blitz', blitzId);
  const setor = blitz ? blitz.setor : defaultSector;

  // Busca todas as conferências anteriores de todas as blitzes finalizadas ou anteriores
  const allPastConferences = await getAllPastConferences();

  let produtosNovosCount = 0;
  let jaVerificadosCount = 0;
  let tinhamQuantidadeCount = 0;
  let tinhamZeroCount = 0;
  const distinctDatesSet = new Set();
  const importedItems = [];

  for (const item of parsedItems) {
    distinctDatesSet.add(item.dataValidade);

    // 1. Garante que o produto existe na tabela 'products'
    let product = await getProductByBarcode(item.ean);
    if (!product) {
      product = await saveProduct({
        barcode: item.ean,
        name: item.nome,
        sector: setor,
        corridor: '',
        status: 'LISTA DE BLITZ'
      });
    } else if (item.nome && (!product.name || product.name.startsWith('PRODUTO '))) {
      product.name = item.nome;
      product.sector = product.sector || setor;
      await saveProduct(product);
    }

    // 2. Busca histórico anterior desta combinação EXATA: EAN + DATA_DE_VALIDADE (Item 15)
    const pastForThisItem = allPastConferences.filter(c => {
      const eanMatch = String(c.ean).trim() === String(item.ean).trim();
      const dateMatch = String(c.data_validade || '').split('T')[0] === String(item.dataValidade).split('T')[0];
      return eanMatch && dateMatch && c.blitz_id !== blitzId;
    });

    // Ordena do mais recente para o mais antigo
    pastForThisItem.sort((a, b) => new Date(b.conferido_em || 0) - new Date(a.conferido_em || 0));

    const isNew = pastForThisItem.length === 0;
    let previousQuantity = 0;
    let hadQuantityPreviously = false;
    let hadZeroPreviously = false;

    if (isNew) {
      produtosNovosCount++;
    } else {
      jaVerificadosCount++;
      previousQuantity = Number(pastForThisItem[0].quantidade || 0);
      if (previousQuantity > 0) {
        tinhamQuantidadeCount++;
        hadQuantityPreviously = true;
      } else {
        tinhamZeroCount++;
        hadZeroPreviously = true;
      }
    }

    // Histórico formatado para exibição rápida: ex: ["01/09: 0 un", "05/09: 15 un"] (Item 15 e 20)
    const historyList = pastForThisItem.slice(0, 5).reverse().map(c => {
      const d = formatDateBR(c.conferido_em || c.created_at || '').split(' ')[0];
      return {
        data: d,
        quantidade: Number(c.quantidade || 0),
        texto: `${d}: ${Number(c.quantidade || 0)} un`,
        usuario: c.usuario || 'Ana Luiza',
        local: c.corredor || ''
      };
    });

    // Verifica se já existe esse item nesta mesma Blitz para não duplicar (Item 17)
    const existingInThisBlitz = await getItemByBlitzEanAndDate(blitzId, item.ean, item.dataValidade);

    const blitzItemRecord = {
      id: existingInThisBlitz ? existingInThisBlitz.id : generateId('bitem_'),
      blitz_id: blitzId,
      produto_id: product ? product.id : null,
      ean: item.ean,
      nome_produto: item.nome,
      data_validade: item.dataValidade,
      data_validade_br: item.dataValidadeBR,
      status: existingInThisBlitz ? existingInThisBlitz.status : 'PENDENTE', // 'PENDENTE' ou 'CONFERIDO'
      is_new_product: isNew,
      previous_quantity: previousQuantity,
      had_quantity_previously: hadQuantityPreviously,
      had_zero_previously: hadZeroPreviously,
      previous_history: historyList,
      corredor: product ? (product.corridor || '') : '',
      foto_url: product ? (product.photo_url || '') : '',
      created_at: existingInThisBlitz ? existingInThisBlitz.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await putRecord('blitz_itens', blitzItemRecord);

    // Também cria ou atualiza em blitz_items para compatibilidade
    const legacyItemMirror = {
      id: blitzItemRecord.id,
      blitz_session_id: blitzId,
      product_id: product ? product.id : null,
      barcode: item.ean,
      sector: setor,
      requested_expiration_date: item.dataValidade,
      previous_quantity: previousQuantity,
      total_quantity: existingInThisBlitz ? (existingInThisBlitz.total_quantity || 0) : 0,
      difference: existingInThisBlitz ? (existingInThisBlitz.difference || 0) : -previousQuantity,
      result: existingInThisBlitz ? (existingInThisBlitz.result || 'PENDENTE') : 'PENDENTE',
      locations: existingInThisBlitz ? (existingInThisBlitz.locations || []) : [],
      user_name: 'Ana Luiza',
      is_new_expiration: isNew,
      notes: '',
      corridor: blitzItemRecord.corredor,
      checked_at: existingInThisBlitz ? existingInThisBlitz.checked_at : null,
      created_at: blitzItemRecord.created_at
    };
    await putRecord('blitz_items', legacyItemMirror);

    importedItems.push(blitzItemRecord);
  }

  // Registra auditoria da importação
  await recordAudit({
    registro_id: blitzId,
    tabela: 'blitz_itens',
    acao: 'IMPORTACAO',
    usuario: blitz ? blitz.responsavel : 'Ana Luiza',
    descricao: `Importados ${importedItems.length} itens (${produtosNovosCount} novos, ${jaVerificadosCount} verificados anteriormente)`
  });

  return {
    totalImportados: importedItems.length,
    produtosNovos: produtosNovosCount,
    jaVerificados: jaVerificadosCount,
    tinhamQuantidade: tinhamQuantidadeCount,
    tinhamZero: tinhamZeroCount,
    datasDistintas: distinctDatesSet.size,
    datasList: Array.from(distinctDatesSet).sort(),
    itens: importedItems
  };
}

/**
 * 4. BUSCA ITENS DA BLITZ ATUAL
 */
export async function getBlitzItens(blitzId) {
  if (!blitzId) return [];
  const db = await initDB();
  try {
    const { tx } = await getSafeTx(['blitz_itens', 'products', 'blitz_items'], 'readonly');
    const bStore = tx.objectStore('blitz_itens');
    const index = bStore.index('blitz_id');

    // Carrega produtos para resolver nomes e códigos faltantes
    let prodMap = new Map();
    let prodIdMap = new Map();
    try {
      const prodStore = tx.objectStore('products');
      const allProdsReq = prodStore.getAll();
      const allProds = await new Promise(r => {
        allProdsReq.onsuccess = () => r(allProdsReq.result || []);
        allProdsReq.onerror = () => r([]);
      });
      allProds.forEach(p => {
        if (p.barcode) prodMap.set(String(p.barcode).trim(), p);
        if (p.id) prodIdMap.set(p.id, p);
      });
    } catch (err) {}

    return new Promise((resolve) => {
      const req = index.getAll(blitzId);
      req.onsuccess = async () => {
        const rawItems = req.result || [];
        if (rawItems.length === 0) {
          // Se não houver em blitz_itens, tenta blitz_items legada
          const legacy = await getLegacyBlitzItems(blitzId);
          resolve(legacy);
          return;
        }

        const items = rawItems.map(it => {
          let barcode = String(it.ean || it.barcode || '').trim();
          let prodId = it.produto_id || it.product_id || null;
          
          let p = null;
          if (barcode && barcode !== 'undefined') {
            p = prodMap.get(barcode);
          }
          if (!p && prodId) {
            p = prodIdMap.get(prodId);
          }

          if (p) {
            if (!barcode || barcode === 'undefined') barcode = p.barcode || '';
            if (!prodId) prodId = p.id;
          }

          let name = String(it.nome_produto || it.nome || it.descricao || it.name || '').trim();
          if (!name || name.includes('undefined') || name.startsWith('PRODUTO ')) {
            if (p?.name && !p.name.includes('undefined')) {
              name = p.name;
            }
          }
          if (!name && barcode && barcode !== 'undefined') {
            name = `PRODUTO ${barcode}`;
          }
          if (!name) {
            name = 'PRODUTO EM CONFERÊNCIA';
          }

          const expDate = it.data_validade || it.requested_expiration_date || '';
          const dateBR = it.data_validade_br || (expDate ? formatDateBR(expDate) : '--/--/----');
          const isConferred = it.status === 'CONFERIDO' || it.status === 'conferido' || Boolean(it.conferido_em);

          return {
            ...it,
            ean: barcode,
            barcode: barcode,
            nome_produto: name,
            nome: name,
            name: name,
            descricao: name,
            produto_id: prodId,
            product_id: prodId,
            data_validade: expDate,
            requested_expiration_date: expDate,
            data_validade_br: dateBR,
            corredor: it.corredor || p?.corridor || '',
            status: isConferred ? 'CONFERIDO' : 'PENDENTE',
            isConferred: isConferred,
            quantidade: Number(it.quantidade || it.total_quantity) || 0,
            total_quantity: Number(it.quantidade || it.total_quantity) || 0
          };
        });

        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return getLegacyBlitzItems(blitzId);
  }
}

/**
 * 5. SALVAR CONFERÊNCIA DA BLITZ (Item 18 a 25)
 * Atualiza blitz_item para 'CONFERIDO'
 * Salva conferência em 'conferencias_blitz'
 * Lembra e grava o corredor no cadastro permanente (Item 21)
 * Atualiza estoque e contagens
 */
export async function saveBlitzConference({
  blitzId,
  itemId,
  ean,
  dataValidade,
  quantidade = 0,
  tipoConferencia = 'MANUAL', // 'MANUAL', 'ZERO_AUTOMATICO', 'CORRECAO'
  corredor = '',
  locations = [], // [{ location: 'Prateleira', quantity: 18 }, { location: 'Depósito', quantity: 42 }]
  fotoUrl = '',
  usuario = 'Ana Luiza',
  observacao = ''
}) {
  const db = await initDB();
  const now = new Date().toISOString();
  const numQtd = Number(quantidade) || 0;

  // 1. Busca o item da Blitz
  let blitzItem = null;
  if (itemId) {
    blitzItem = await getRecordById('blitz_itens', itemId);
  }
  if (!blitzItem && blitzId && ean && dataValidade) {
    blitzItem = await getItemByBlitzEanAndDate(blitzId, ean, dataValidade);
  }

  // 2. Busca ou cria o produto
  let product = await getProductByBarcode(ean);
  if (!product) {
    product = await saveProduct({
      barcode: ean,
      name: blitzItem ? blitzItem.nome_produto : `PRODUTO ${ean}`,
      sector: 'MERCEARIA',
      corridor: corredor || 'Corredor 1',
      status: 'VERIFICADO'
    });
  } else {
    // Memória do corredor (Item 21): atualiza o corredor permanente do produto se informado
    if (corredor && product.corridor !== corredor) {
      product.corridor = corredor;
      product.updated_at = now;
      await saveProduct(product);
    }
    if (product.status !== 'VERIFICADO') {
      product.status = 'VERIFICADO';
      product.updated_at = now;
      await saveProduct(product);
    }
  }

  // Se veio foto, salva foto_url no produto permanente
  if (fotoUrl && product && !product.photo_url) {
    product.photo_url = fotoUrl;
    product.updated_at = now;
    await saveProduct(product);
  }

  const previousQty = blitzItem ? Number(blitzItem.previous_quantity || 0) : 0;
  const diff = numQtd - previousQty;

  // 3. Salva a conferência em conferencias_blitz (reutiliza e substitui conferência da Blitz atual se já existir)
  const existingConfs = await getConferencesByBlitzId(blitzId);
  const cleanEan = String(ean).trim();
  const cleanDateStr = String(dataValidade).split('T')[0];
  const existingConf = existingConfs.find(c => 
    String(c.ean).trim() === cleanEan &&
    String(c.data_validade || '').split('T')[0] === cleanDateStr
  );

  const confId = existingConf ? existingConf.id : generateId('conf_');
  const conferenceRecord = {
    id: confId,
    blitz_id: blitzId,
    blitz_item_id: blitzItem ? blitzItem.id : (existingConf ? existingConf.blitz_item_id : (itemId || generateId('bitem_'))),
    produto_id: product ? product.id : null,
    ean: cleanEan,
    data_validade: dataValidade,
    quantidade: numQtd,
    quantidade_anterior: previousQty,
    diferenca: diff,
    tipo_conferencia: tipoConferencia,
    corredor: corredor || (product ? product.corridor : ''),
    locations: locations,
    foto_url: fotoUrl || (product ? (product.photo_url || '') : ''),
    usuario: usuario || 'Ana Luiza',
    conferido_em: now,
    observacao: observacao || ''
  };
  await putRecord('conferencias_blitz', conferenceRecord);

  // 4. Atualiza blitz_itens para CONFERIDO
  if (blitzItem) {
    blitzItem.status = 'CONFERIDO';
    blitzItem.quantidade = numQtd;
    blitzItem.locations = locations;
    blitzItem.corredor = corredor || (product ? product.corridor : blitzItem.corredor);
    blitzItem.tipo_conferencia = tipoConferencia;
    blitzItem.conferido_em = now;
    blitzItem.updated_at = now;
    await putRecord('blitz_itens', blitzItem);
  }

  // 5. Espelha em blitz_items para relatórios e sincronização legada (reutiliza id se já existir)
  const legacyStore = await getLegacyBlitzItems(blitzId);
  const existingLegacy = legacyStore.find(l => 
    String(l.barcode || '').trim() === cleanEan &&
    String(l.requested_expiration_date || '').split('T')[0] === cleanDateStr
  );

  const legacyItem = {
    id: blitzItem ? blitzItem.id : (existingLegacy ? existingLegacy.id : conferenceRecord.blitz_item_id),
    blitz_session_id: blitzId,
    product_id: product ? product.id : null,
    barcode: cleanEan,
    sector: product ? product.sector : 'MERCEARIA',
    requested_expiration_date: dataValidade,
    previous_quantity: previousQty,
    total_quantity: numQtd,
    difference: diff,
    result: numQtd > 0 ? 'TEM' : 'NAO_TEM',
    locations: locations,
    user_name: usuario,
    corridor: corredor || (product ? product.corridor : ''),
    notes: observacao,
    checked_at: now
  };
  await putRecord('blitz_items', legacyItem);

  // 6. Atualiza o estoque físico atual no cadastro permanente (inventory_counts e product_expirations)
  if (product && product.id && dataValidade) {
    try {
      let expRecord = await getExpirationByProductAndDate(product.id, dataValidade);
      if (!expRecord) {
        const res = await saveProductExpiration(product.id, dataValidade);
        expRecord = res.expiration;
      }
      if (expRecord && expRecord.id) {
        const locMap = {};
        if (locations && locations.length > 0) {
          locations.forEach(l => {
            const name = String(l.location || '').toUpperCase();
            locMap[name] = (locMap[name] || 0) + (Number(l.quantity) || 0);
          });
        } else {
          locMap['DEPÓSITO'] = 0;
          locMap['PRATELEIRA'] = numQtd;
        }
        await saveInventoryCounts(product.id, expRecord.id, locMap, blitzId);
      }
    } catch (e) {
      console.warn('[BlitzEngine] Aviso ao atualizar contagem de estoque:', e);
    }
  }

  return { conferenceRecord, blitzItem };
}

/**
 * 6. REGRA MÁXIMA DA BLITZ: FINALIZAR COM ZERO AUTOMÁTICO (Item 1, 28, 30)
 * Todos os itens PENDENTES viram quantidade = 0 e tipo_conferencia = 'ZERO_AUTOMATICO'.
 * Blitz vira 'FINALIZADA'.
 */
export async function finalizeBlitzWithAutoZeros(blitzId, usuario = 'Ana Luiza') {
  const db = await initDB();
  const now = new Date().toISOString();

  let blitz = await getRecordById('blitz', blitzId);
  let session = await getRecordById('blitz_sessions', blitzId);

  if (!blitz && !session) {
    // Tenta encontrar por busca geral se o id sofreu alguma alteração
    const allB = await getAllBlitzRecords();
    const foundB = allB.find(b => b.id === blitzId);
    if (foundB) blitz = foundB;
  }

  if (!blitz && session) {
    // Auto-cria espelho em blitz se tiver sido criada via session
    blitz = {
      id: session.id,
      data_inicio: session.start_date,
      data_fim: session.end_date,
      setor: session.sector || 'MERCEARIA',
      responsavel: session.user_name || usuario,
      status: 'EM_ANDAMENTO',
      observacao: session.period_label || '',
      created_at: session.created_at || now,
      updated_at: now
    };
    await putRecord('blitz', blitz);
  }

  if (!blitz && !session) {
    throw new Error('Blitz não encontrada');
  }

  const isAlreadyFinalized = (blitz && (blitz.status === 'FINALIZADA' || blitz.status === 'finalizada')) ||
                             (session && (session.status === 'finalizada' || session.status === 'finished'));

  // Busca todos os itens da Blitz
  const allItems = await getBlitzItens(blitzId);

  if (isAlreadyFinalized) {
    const conferidosList = allItems.filter(it => it.status === 'CONFERIDO' || it.conferido_em);
    const comQtdCount = conferidosList.filter(it => Number(it.quantidade || it.total_quantity) > 0).length;
    const zeradosCount = allItems.length - comQtdCount;
    return {
      alreadyFinalized: true,
      total: allItems.length,
      totalItens: allItems.length,
      conferidos: conferidosList.length,
      conferidosManualmente: conferidosList.length,
      autoZerados: allItems.length - conferidosList.length,
      zerosAutomaticos: allItems.length - conferidosList.length,
      comQtd: comQtdCount,
      zerados: zeradosCount
    };
  }

  const pendentes = allItems.filter(it => it.status !== 'CONFERIDO' && !it.conferido_em);

  // Transforma cada item pendente em ZERO_AUTOMATICO (itens já CONFERIDOS NÃO são alterados!)
  for (const item of pendentes) {
    await saveBlitzConference({
      blitzId,
      itemId: item.id,
      ean: item.ean,
      dataValidade: item.data_validade,
      quantidade: 0,
      tipoConferencia: 'ZERO_AUTOMATICO',
      corredor: item.corredor || '',
      locations: [],
      usuario: usuario,
      observacao: 'Registrado automaticamente como 0 ao finalizar a Blitz'
    });
  }

  // Atualiza status da Blitz para FINALIZADA
  if (blitz) {
    blitz.status = 'FINALIZADA';
    blitz.finalized_at = now;
    blitz.updated_at = now;
    await putRecord('blitz', blitz);
  }

  // Atualiza também blitz_sessions
  if (!session && blitz) {
    session = await getRecordById('blitz_sessions', blitzId);
  }
  if (session) {
    session.status = 'finalizada';
    session.finished_at = now;
    session.updated_at = now;
    await putRecord('blitz_sessions', session);
  }

  const manualCount = allItems.length - pendentes.length;
  const autoZeroCount = pendentes.length;
  const itemsComEstoque = allItems.filter(it => {
    if (it.status !== 'CONFERIDO' && !it.conferido_em) return false;
    return Number(it.quantidade !== undefined ? it.quantidade : it.total_quantity) > 0;
  }).length;
  const itemsZerados = allItems.length - itemsComEstoque;

  // Registra auditoria da finalização
  await recordAudit({
    registro_id: blitzId,
    tabela: 'blitz',
    acao: 'FINALIZACAO',
    usuario,
    descricao: `Blitz finalizada. Total de ${allItems.length} itens (${manualCount} conferidos manualmente, ${autoZeroCount} finalizados com zero automático)`
  });

  return {
    total: allItems.length,
    totalItens: allItems.length,
    conferidos: manualCount,
    conferidosManualmente: manualCount,
    autoZerados: autoZeroCount,
    zerosAutomaticos: autoZeroCount,
    comQtd: itemsComEstoque,
    zerados: itemsZerados
  };
}

/**
 * 7. REABERTURA DE BLITZ COM AUDITORIA (Item 31)
 */
export async function reopenBlitzRecord(blitzId, usuario = 'Ana Luiza', motivo = '') {
  const db = await initDB();
  const now = new Date().toISOString();

  const blitz = await getRecordById('blitz', blitzId);
  if (!blitz) throw new Error('Blitz não encontrada');

  blitz.status = 'REABERTA';
  blitz.finalized_at = null;
  blitz.updated_at = now;
  await putRecord('blitz', blitz);

  const session = await getRecordById('blitz_sessions', blitzId);
  if (session) {
    session.status = 'active';
    session.finished_at = null;
    await putRecord('blitz_sessions', session);
  }

  await recordAudit({
    registro_id: blitzId,
    tabela: 'blitz',
    acao: 'REABERTURA',
    usuario,
    motivo,
    descricao: `Blitz reaberta por ${usuario}. Motivo: ${motivo || 'Revisão de itens'}`
  });

  return blitz;
}

/**
 * 8. CORREÇÃO DE QUANTIDADE COM AUDITORIA (Item 29)
 */
export async function correctConferenceQuantity({
  blitzId,
  itemId,
  newQuantity,
  usuario = 'Ana Luiza',
  motivo = ''
}) {
  const db = await initDB();
  const now = new Date().toISOString();

  const item = await getRecordById('blitz_itens', itemId);
  if (!item) throw new Error('Item não encontrado');

  const oldQuantity = Number(item.quantidade || 0);
  const correctedQty = Number(newQuantity) || 0;

  // Salva alteração no item
  item.quantidade = correctedQty;
  item.tipo_conferencia = 'CORRECAO';
  item.updated_at = now;
  await putRecord('blitz_itens', item);

  // Registra nova conferência do tipo CORRECAO
  await saveBlitzConference({
    blitzId,
    itemId: item.id,
    ean: item.ean,
    dataValidade: item.data_validade,
    quantidade: correctedQty,
    tipoConferencia: 'CORRECAO',
    corredor: item.corredor,
    locations: [{ location: 'Área de venda', quantity: correctedQty }],
    usuario,
    observacao: `Correção de quantidade de ${oldQuantity} para ${correctedQty}. Motivo: ${motivo}`
  });

  // Registra no histórico de alterações (Item 29 e 62)
  await recordAudit({
    registro_id: item.id,
    tabela: 'conferencias_blitz',
    acao: 'CORRECAO_QUANTIDADE',
    usuario,
    motivo,
    valor_anterior: oldQuantity,
    novo_valor: correctedQty,
    descricao: `Quantidade alterada de ${oldQuantity} para ${correctedQty}. Motivo: ${motivo}`
  });

  return item;
}

/**
 * 9. CÁLCULO DE RITMO, PROGRESSO E PREVISÃO DE TÉRMINO (Items 4, 6, 7, 8, 9, 32)
 */
export async function calculateBlitzMetrics(blitzId) {
  const allItems = await getBlitzItens(blitzId);
  const blitz = await getRecordById('blitz', blitzId) || await getRecordById('blitz_sessions', blitzId);

  const total = allItems.length;
  const conferidos = allItems.filter(it => it.status === 'CONFERIDO').length;
  const pendentes = total - conferidos;
  const comQuantidade = allItems.filter(it => it.status === 'CONFERIDO' && Number(it.quantidade || 0) > 0).length;
  const comZero = allItems.filter(it => it.status === 'CONFERIDO' && Number(it.quantidade || 0) === 0).length;
  const percentual = total > 0 ? Math.round((conferidos / total) * 100) : 0;

  // Calcula ritmo (itens por hora) com base nas conferências
  const conferences = await getConferencesByBlitzId(blitzId);
  let itensPorHora = 0;
  let tempoEstimadoMinutos = 0;
  let previsaoTexto = 'Calculando...';

  if (conferences.length >= 2) {
    const timestamps = conferences
      .map(c => new Date(c.conferido_em || c.created_at).getTime())
      .filter(t => !isNaN(t))
      .sort((a, b) => a - b);

    if (timestamps.length >= 2) {
      const duracaoHoras = (timestamps[timestamps.length - 1] - timestamps[0]) / (1000 * 60 * 60);
      if (duracaoHoras > 0.05) {
        itensPorHora = Math.round(conferences.length / duracaoHoras);
      }
    }
  }

  if (itensPorHora === 0 && conferidos > 0) {
    itensPorHora = 40; // Ritmo médio padrão de celular: ~40 prods/h
  }

  if (itensPorHora > 0 && pendentes > 0) {
    tempoEstimadoMinutos = Math.round((pendentes / itensPorHora) * 60);
    if (tempoEstimadoMinutos < 60) {
      previsaoTexto = `~${tempoEstimadoMinutos} minutos`;
    } else {
      const h = Math.floor(tempoEstimadoMinutos / 60);
      const m = tempoEstimadoMinutos % 60;
      previsaoTexto = `~${h}h ${m > 0 ? `${m}m` : ''}`;
    }
  } else if (pendentes === 0 && total > 0) {
    previsaoTexto = 'Concluída!';
  }

  // Status de Ritmo: ADIANTADA, NO_RITMO, ATENCAO, ATRASADA
  let ritmoStatus = 'NO_RITMO'; // 'ADIANTADA', 'NO_RITMO', 'ATENCAO', 'ATRASADA'
  let ritmoLabel = 'No ritmo';
  let ritmoBadgeClass = 'green-badge';

  const hoje = getTodayISO();
  const dataFim = blitz ? (blitz.data_fim || blitz.end_date || hoje) : hoje;

  if (blitz && blitz.status === 'FINALIZADA') {
    ritmoStatus = 'CONCLUIDA';
    ritmoLabel = 'Concluída';
    ritmoBadgeClass = 'green-badge';
  } else if (dataFim < hoje && pendentes > 0) {
    ritmoStatus = 'ATRASADA';
    ritmoLabel = 'Atrasada';
    ritmoBadgeClass = 'red-badge';
  } else if (dataFim === hoje && pendentes > 30 && percentual < 50) {
    ritmoStatus = 'ATENCAO';
    ritmoLabel = 'Atenção';
    ritmoBadgeClass = 'orange-badge';
  } else if (percentual >= 80 || (dataFim > hoje && percentual >= 50)) {
    ritmoStatus = 'ADIANTADA';
    ritmoLabel = 'Adiantada';
    ritmoBadgeClass = 'green-badge';
  } else {
    ritmoStatus = 'NO_RITMO';
    ritmoLabel = 'No ritmo';
    ritmoBadgeClass = 'green-badge';
  }

  return {
    total,
    conferidos,
    pendentes,
    comQuantidade,
    comZero,
    comQtd: comQuantidade,
    zerados: comZero,
    percentual,
    itensPorHora,
    tempoEstimadoMinutos,
    previsaoTexto,
    previsaoTermino: previsaoTexto,
    ritmoStatus,
    ritmoLabel,
    ritmoBadgeClass,
    ritmoCor: ritmoStatus === 'ATRASADA' ? '#ef4444' : ritmoStatus === 'ATENCAO' ? '#f59e0b' : '#10b981'
  };
}

/**
 * Retorna métricas formatadas e com cores para o Dashboard da Blitz
 */
export async function calculateBlitzPaceMetrics(blitzId) {
  return calculateBlitzMetrics(blitzId);
}

/**
 * Busca itens da lista da Blitz ativa
 */
export async function getSessionBlitzItems(blitzId) {
  return getBlitzItens(blitzId);
}

/**
 * 10. ANÁLISE COMPLETA DA SEMANA E DETECÇÃO DE ATRASO (Items 2, 3, 4, 5, 10, 11)
 */
export async function getWeeklyRoutineStatus() {
  const db = await initDB();
  const todayDate = new Date();
  const dayOfWeek = todayDate.getDay(); // 0: Dom, 1: Seg ... 6: Sab
  const todayISO = getTodayISO();
  const currentCycle = getWeeklyCycleForDate(todayDate);

  // Busca todas as blitzes
  const allBlitzes = await getAllRecords('blitz');
  const allSessions = await getAllRecords('blitz_sessions');
  const mergedBlitzes = [...allBlitzes];

  // Adiciona sessões que possam não estar na tabela nova
  allSessions.forEach(s => {
    if (!mergedBlitzes.some(b => b.id === s.id)) {
      mergedBlitzes.push({
        id: s.id,
        setor: s.sector || 'MERCEARIA',
        data_inicio: s.start_date || s.started_at?.split('T')[0] || todayISO,
        data_fim: s.end_date || todayISO,
        status: s.status === 'finished' ? 'FINALIZADA' : 'EM_ANDAMENTO',
        responsavel: s.user_name || 'Ana Luiza',
        created_at: s.started_at || new Date().toISOString()
      });
    }
  });

  // Mapeia o progresso para cada um dos 3 ciclos semanais
  const cyclesProgress = await Promise.all(
    WEEKLY_CYCLES.map(async (cycle) => {
      // Busca a blitz mais recente vinculada aos setores deste ciclo
      const matching = mergedBlitzes.filter(b => {
        const sectorUpper = String(b.setor || '').toUpperCase();
        return cycle.sectors.some(s => sectorUpper.includes(s));
      });

      matching.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      const latestBlitz = matching[0] || null;

      if (!latestBlitz) {
        return {
          ...cycle,
          hasBlitz: false,
          statusLabel: 'Aguardando',
          statusText: 'Ainda não iniciada',
          badgeClass: 'gray-badge',
          percent: 0,
          pendingCount: 0,
          totalCount: 0,
          isCurrent: cycle.id === currentCycle.id
        };
      }

      const metrics = await calculateBlitzMetrics(latestBlitz.id);
      const isFinished = latestBlitz.status === 'FINALIZADA' || latestBlitz.status === 'finished';

      let statusLabel = 'Em andamento';
      let statusText = `${metrics.conferidos} de ${metrics.total} conferidos`;
      let badgeClass = 'blue-badge';

      if (isFinished) {
        statusLabel = 'Concluída';
        statusText = '100% finalizada';
        badgeClass = 'green-badge';
      } else if (metrics.ritmoStatus === 'ATRASADA') {
        statusLabel = 'Atrasada';
        statusText = `${metrics.pendentes} produtos pendentes`;
        badgeClass = 'red-badge';
      } else if (metrics.percentual >= 80) {
        statusLabel = 'Quase concluída';
        statusText = `${metrics.pendentes} produtos faltando`;
        badgeClass = 'green-badge';
      }

      return {
        ...cycle,
        hasBlitz: true,
        blitzId: latestBlitz.id,
        blitz: latestBlitz,
        statusLabel,
        statusText,
        badgeClass,
        percent: metrics.percentual,
        pendingCount: metrics.pendentes,
        totalCount: metrics.total,
        metrics,
        isFinished,
        isCurrent: cycle.id === currentCycle.id
      };
    })
  );

  // DETECÇÃO INTELIGENTE DE ATRASO (Item 5)
  // Verifica se existe alguma Blitz de dias anteriores que ainda está em andamento com pendências
  let delayedBlitz = null;
  for (const c of cyclesProgress) {
    if (c.hasBlitz && !c.isFinished && c.pendingCount > 0) {
      // Se o ciclo já passou (os dias eram anteriores ao dia de hoje na semana)
      const isPastCycle = c.days.every(d => d < dayOfWeek && dayOfWeek !== 0);
      const isPastEndDate = c.blitz && c.blitz.data_fim && c.blitz.data_fim < todayISO;
      if (isPastCycle || isPastEndDate) {
        delayedBlitz = c;
        break;
      }
    }
  }

  // PRIORIDADE INTELIGENTE (Item 11)
  let priorityAlert = null;
  if (delayedBlitz && currentCycle.id !== delayedBlitz.id && !currentCycle.isRestDay) {
    priorityAlert = {
      title: '🚨 Você tem uma pendência de Blitz',
      message: `A Blitz de ${delayedBlitz.label} ainda tem ${delayedBlitz.pendingCount} produtos pendentes, e hoje é dia de ${currentCycle.label}.`,
      suggestion: `Sugestão da Ana Luiza: Vamos terminar primeiro os ${delayedBlitz.pendingCount} produtos atrasados e depois continuar com ${currentCycle.label}.`,
      delayedCycle: delayedBlitz,
      currentCycle: currentCycle
    };
  }

  return {
    todayISO,
    dayOfWeek,
    currentCycle,
    cyclesProgress,
    delayedBlitz,
    priorityAlert
  };
}

/**
 * 11. RELATÓRIO: O QUE MUDOU DESDE A ÚLTIMA BLITZ? (Item 38)
 */
export async function getWhatChangedAnalysis(blitzId) {
  const items = await getBlitzItens(blitzId);

  const produtosNovos = [];
  const passaramATerQtd = [];
  const continuamZerados = [];
  const aumentaram = [];
  const diminuiram = [];
  const grandeAumento = [];

  items.forEach(it => {
    const prev = Number(it.previous_quantity || 0);
    const curr = Number(it.quantidade || 0);
    const diff = curr - prev;

    if (it.is_new_product) {
      produtosNovos.push(it);
    }

    if (prev === 0 && curr > 0) {
      passaramATerQtd.push(it);
    }

    if (prev === 0 && curr === 0 && it.status === 'CONFERIDO') {
      continuamZerados.push(it);
    }

    if (diff > 0 && prev > 0) {
      aumentaram.push(it);
    }

    if (diff < 0) {
      diminuiram.push(it);
    }

    // Grande aumento: exemplo: tinha <= 5 e agora tem >= 20, ou aumentou mais de 20 unidades
    if (diff >= 20 || (prev <= 5 && curr >= 20)) {
      grandeAumento.push(it);
    }
  });

  return {
    produtosNovos,
    passaramATerQtd,
    continuamZerados,
    aumentaram,
    diminuiram,
    grandeAumento
  };
}

/**
 * 12. AUDITORIA PERMANENTE (Item 62)
 */
export async function recordAudit({
  registro_id,
  tabela,
  acao,
  usuario = 'Ana Luiza',
  motivo = '',
  valor_anterior = null,
  novo_valor = null,
  descricao = ''
}) {
  try {
    const record = {
      id: generateId('audit_'),
      registro_id,
      tabela,
      acao,
      usuario,
      motivo,
      valor_anterior,
      novo_valor,
      descricao,
      created_at: new Date().toISOString()
    };
    await putRecord('historico_alteracoes', record);
  } catch (e) {
    console.warn('[Audit] Aviso ao gravar auditoria:', e);
  }
}

// ----------------------------------------------------
// HELPERS INTERNOS DE BANCO DE DADOS
// ----------------------------------------------------

async function putRecord(storeName, record) {
  const db = await initDB();
  const { tx } = await getSafeTx([storeName], 'readwrite');
  const store = tx.objectStore(storeName);
  return new Promise((resolve, reject) => {
    const req = store.put(record);
    req.onsuccess = () => resolve(record);
    req.onerror = (e) => reject(e.target?.error || e);
  });
}

async function getRecordById(storeName, id) {
  if (!id) return null;
  const db = await initDB();
  try {
    const { tx } = await getSafeTx([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function getAllRecords(storeName) {
  const db = await initDB();
  try {
    const { tx } = await getSafeTx([storeName], 'readonly');
    const store = tx.objectStore(storeName);
    return new Promise((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

async function getItemByBlitzEanAndDate(blitzId, ean, dateISO) {
  const db = await initDB();
  try {
    const { tx } = await getSafeTx(['blitz_itens'], 'readonly');
    const store = tx.objectStore('blitz_itens');
    const index = store.index('blitz_ean_data');
    return new Promise((resolve) => {
      const req = index.get([blitzId, ean, dateISO]);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function getAllPastConferences() {
  const db = await initDB();
  try {
    const { tx } = await getSafeTx(['conferencias_blitz', 'blitz_items'], 'readonly');
    const confStore = tx.objectStore('conferencias_blitz');
    return new Promise((resolve) => {
      const req = confStore.getAll();
      req.onsuccess = async () => {
        const confs = req.result || [];
        if (confs.length > 0) {
          resolve(confs);
        } else {
          // Fallback para blitz_items legado
          const legacyStore = tx.objectStore('blitz_items');
          const legacyReq = legacyStore.getAll();
          legacyReq.onsuccess = () => {
            const leg = legacyReq.result || [];
            const mapped = leg.map(l => ({
              id: l.id,
              blitz_id: l.blitz_session_id,
              ean: l.barcode,
              data_validade: l.requested_expiration_date,
              quantidade: l.total_quantity,
              tipo_conferencia: 'MANUAL',
              conferido_em: l.checked_at || l.created_at,
              usuario: l.user_name || 'Ana Luiza',
              corredor: l.corridor || ''
            }));
            resolve(mapped);
          };
          legacyReq.onerror = () => resolve([]);
        }
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

async function getConferencesByBlitzId(blitzId) {
  const db = await initDB();
  try {
    const { tx } = await getSafeTx(['conferencias_blitz'], 'readonly');
    const store = tx.objectStore('conferencias_blitz');
    const index = store.index('blitz_id');
    return new Promise((resolve) => {
      const req = index.getAll(blitzId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

async function getLegacyBlitzItems(blitzId) {
  const db = await initDB();
  try {
    const { tx } = await getSafeTx(['blitz_items', 'products'], 'readonly');
    const store = tx.objectStore('blitz_items');
    const index = store.index('blitz_session_id');

    let prodMap = new Map();
    let prodIdMap = new Map();
    try {
      const prodStore = tx.objectStore('products');
      const allProdsReq = prodStore.getAll();
      const allProds = await new Promise(r => {
        allProdsReq.onsuccess = () => r(allProdsReq.result || []);
        allProdsReq.onerror = () => r([]);
      });
      allProds.forEach(p => {
        if (p.barcode) prodMap.set(String(p.barcode).trim(), p);
        if (p.id) prodIdMap.set(p.id, p);
      });
    } catch (err) {}

    return new Promise((resolve) => {
      const req = index.getAll(blitzId);
      req.onsuccess = () => {
        const items = (req.result || []).map(it => {
          let barcode = String(it.barcode || it.ean || '').trim();
          let prodId = it.product_id || it.produto_id || null;
          let p = null;
          if (barcode && barcode !== 'undefined') p = prodMap.get(barcode);
          if (!p && prodId) p = prodIdMap.get(prodId);

          if (p) {
            if (!barcode || barcode === 'undefined') barcode = p.barcode || '';
            if (!prodId) prodId = p.id;
          }

          let name = String(it.nome_produto || it.nome || it.descricao || it.name || it.notes || '').trim();
          if (!name || name.includes('undefined') || name.startsWith('PRODUTO ')) {
            if (p?.name && !p.name.includes('undefined')) {
              name = p.name;
            }
          }
          if (!name && barcode && barcode !== 'undefined') {
            name = `PRODUTO ${barcode}`;
          }
          if (!name) {
            name = 'PRODUTO EM CONFERÊNCIA';
          }

          const expDate = it.requested_expiration_date || it.data_validade || '';
          const isConferred = it.result === 'TEM' || it.result === 'NAO_TEM' || it.status === 'CONFERIDO' || it.status === 'conferido' || Boolean(it.checked_at);

          return {
            ...it,
            id: it.id,
            blitz_id: it.blitz_session_id || it.blitz_id,
            blitz_session_id: it.blitz_session_id || it.blitz_id,
            produto_id: prodId,
            product_id: prodId,
            ean: barcode,
            barcode: barcode,
            nome_produto: name,
            nome: name,
            name: name,
            descricao: name,
            data_validade: expDate,
            requested_expiration_date: expDate,
            data_validade_br: formatDateBR(expDate),
            status: isConferred ? 'CONFERIDO' : 'PENDENTE',
            isConferred: isConferred,
            is_new_product: it.is_new_expiration || false,
            previous_quantity: it.previous_quantity || 0,
            quantidade: it.total_quantity || 0,
            total_quantity: it.total_quantity || 0,
            corredor: it.corridor || p?.corridor || '',
            locations: it.locations || [],
            conferido_em: it.checked_at
          };
        });
        resolve(items);
      };
      req.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

async function getSafeTx(storeNames, mode = 'readonly') {
  const db = await initDB();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const validNames = names.filter(n => db.objectStoreNames.contains(n));
  if (validNames.length === 0) {
    throw new Error(`Nenhum store válido encontrado entre: ${names.join(', ')}`);
  }
  const tx = db.transaction(validNames, mode);
  return { db, tx };
}

export async function repairBlitzSessionData(blitzId) {
  if (!blitzId) return;
  try {
    const db = await initDB();
    const { tx } = await getSafeTx(['blitz_itens', 'blitz_items', 'products'], 'readwrite');
    const bStore = tx.objectStore('blitz_itens');
    const legStore = tx.objectStore('blitz_items');
    const prodStore = tx.objectStore('products');

    // 1. Coleta produtos
    const allProdsReq = prodStore.getAll();
    const allProds = await new Promise(r => {
      allProdsReq.onsuccess = () => r(allProdsReq.result || []);
      allProdsReq.onerror = () => r([]);
    });

    const prodMap = new Map();
    const prodIdMap = new Map();
    for (const p of allProds) {
      if (p.barcode && p.barcode !== 'undefined') {
        prodMap.set(String(p.barcode).trim(), p);
      }
      if (p.id) {
        prodIdMap.set(p.id, p);
      }
      // Remove produtos inválidos com "undefined" no barcode
      if (p.barcode === 'undefined' || p.barcode === '' || p.name === 'PRODUTO undefined') {
        try { prodStore.delete(p.id); } catch (_) {}
      }
    }

    // 2. Coleta itens em blitz_itens
    const bIndex = bStore.index('blitz_id');
    const bReq = bIndex.getAll(blitzId);
    const bItems = await new Promise(r => {
      bReq.onsuccess = () => r(bReq.result || []);
      bReq.onerror = () => r([]);
    });

    // 3. Coleta itens em blitz_items (legado)
    const legIndex = legStore.index('blitz_session_id');
    const legReq = legIndex.getAll(blitzId);
    const legItems = await new Promise(r => {
      legReq.onsuccess = () => r(legReq.result || []);
      legReq.onerror = () => r([]);
    });

    const legById = new Map();
    for (const l of legItems) {
      if (l.id) legById.set(l.id, l);
    }

    for (const item of bItems) {
      let changed = false;
      let barcode = String(item.ean || item.barcode || '').trim();
      let prodId = item.produto_id || item.product_id || null;

      if (barcode === 'undefined') barcode = '';

      const leg = legById.get(item.id);
      if (!barcode && leg?.barcode && leg.barcode !== 'undefined') {
        barcode = leg.barcode;
        changed = true;
      }

      let p = null;
      if (barcode) p = prodMap.get(barcode);
      if (!p && prodId) p = prodIdMap.get(prodId);

      if (p) {
        if (!barcode) barcode = p.barcode || '';
        if (!prodId) prodId = p.id;
      }

      let name = String(item.nome_produto || item.nome || item.descricao || item.name || '').trim();
      if (!name || name.includes('undefined') || name.startsWith('PRODUTO ')) {
        if (p?.name && !p.name.includes('undefined')) {
          name = p.name;
          changed = true;
        }
      }

      if (barcode && (item.barcode !== barcode || item.ean !== barcode)) {
        item.barcode = barcode;
        item.ean = barcode;
        changed = true;
      }
      if (name && (item.nome_produto !== name || item.nome !== name)) {
        item.nome_produto = name;
        item.nome = name;
        item.name = name;
        item.descricao = name;
        changed = true;
      }
      if (prodId && (item.produto_id !== prodId || item.product_id !== prodId)) {
        item.produto_id = prodId;
        item.product_id = prodId;
        changed = true;
      }

      if (changed) {
        bStore.put(item);
      }
    }
  } catch (err) {
    console.warn('Non-blocking repair error:', err);
  }
}
