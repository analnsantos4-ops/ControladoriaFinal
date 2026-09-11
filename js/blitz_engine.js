// ====================================================
// MOTOR INTELIGENTE DA BLITZ DE VALIDADE
// Especificação Completa e Definitiva - Ana Luiza
// ====================================================

import {
  formatDateBR,
  parseDateBRtoISO,
  parseStrictDateBR,
  isValidCalendarDate,
  getTodayISO,
  generateId,
  CORRIDORS,
  WEEKLY_CYCLES,
  WEEKLY_CYCLES_BY_USER,
  getWeeklyCycles,
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

import { getCurrentUser, getUserById } from './auth.js';

/**
 * 1. PARSER ROBUSTO DA LISTA DA BLITZ (Item 13 e 14 e Requisito 5)
 * Suporta:
 * - Arquivos CSV/TXT delimitados por vírgula (,), ponto-e-vírgula (;), tabulação (\t) ou barra vertical (|)
 * - Colunas: EAN, Nome, Validade, Quantidade, Corredor
 * - Detecção e descarte automático de linha de cabeçalho
 * - Formatos livres de varejo (ex: 7898530843159 - PACOCA DADINHO - 28/09/2026 - 12 UN)
 * - Validação estrita de data de calendário (rejeição de 31/02, 31/09 etc.)
 * - Chave composta: EAN + DATA_DE_VALIDADE
 * - Proteção e feedback de duplicidades e erros
 */
export function parseDelimitedOrStructuredInput(rawText, fallbackDateISO = null) {
  if (!rawText) return { items: [], stats: { success: 0, errors: 0, duplicates: 0, errorDetails: [] } };

  const rawLines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    return { items: [], stats: { success: 0, errors: 0, duplicates: 0, errorDetails: [] } };
  }

  const results = [];
  const seenCompositeKeys = new Set();
  const stats = {
    success: 0,
    errors: 0,
    duplicates: 0,
    errorDetails: []
  };

  // 1. Analisa se o arquivo tem delimitador regular (, ; \t |)
  const sampleLines = rawLines.slice(0, Math.min(rawLines.length, 6));
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };

  sampleLines.forEach(l => {
    for (const sep of [';', '\t', '|', ',']) {
      const parts = l.split(sep);
      if (parts.length >= 2) {
        counts[sep] += parts.length;
      }
    }
  });

  // Escolhe o separador com maior contagem regular
  let detectedSeparator = null;
  let maxCount = 0;
  for (const [sep, cnt] of Object.entries(counts)) {
    if (cnt > maxCount && cnt >= sampleLines.length * 2) {
      maxCount = cnt;
      detectedSeparator = sep;
    }
  }

  let startIndex = 0;
  let colEan = -1;
  let colNome = -1;
  let colValidade = -1;
  let colQtd = -1;
  let colCorredor = -1;

  if (detectedSeparator) {
    const firstLineCols = rawLines[0].split(detectedSeparator).map(c => c.trim().toLowerCase());
    const isHeader = firstLineCols.some(c => 
      c.includes('ean') || c.includes('cod') || c.includes('barr') || 
      c.includes('nom') || c.includes('prod') || c.includes('desc') || 
      c.includes('val') || c.includes('venc') || c.includes('data') || 
      c.includes('qtd') || c.includes('quant') || c.includes('corr') || c.includes('loc')
    );

    if (isHeader) {
      startIndex = 1;
      firstLineCols.forEach((col, idx) => {
        if (col.includes('ean') || col.includes('cod') || col.includes('barr')) colEan = idx;
        else if (col.includes('nom') || col.includes('prod') || col.includes('desc')) colNome = idx;
        else if (col.includes('val') || col.includes('venc') || col.includes('data')) colValidade = idx;
        else if (col.includes('qtd') || col.includes('quant') || col.includes('est') || col.includes('unid')) colQtd = idx;
        else if (col.includes('corr') || col.includes('loc') || col.includes('gond')) colCorredor = idx;
      });
    } else {
      // Tenta inferir colunas da primeira linha de dados
      firstLineCols.forEach((col, idx) => {
        const clean = col.replace(/[^0-9]/g, '');
        if (clean.length >= 7 && clean.length <= 14 && colEan === -1) {
          colEan = idx;
        } else if (/\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b/.test(col) && colValidade === -1) {
          colValidade = idx;
        } else if (/^\d+$/.test(col) && colQtd === -1 && clean.length < 5) {
          colQtd = idx;
        } else if (/[a-zA-ZÀ-ÿ]/.test(col) && colNome === -1) {
          colNome = idx;
        }
      });
    }
  }

  for (let i = startIndex; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) continue;

    let ean = '';
    let nome = '';
    let dateISO = '';
    let dateBR = '';
    let quantidade = 0;
    let corredor = '';

    if (detectedSeparator) {
      const parts = line.split(detectedSeparator).map(p => p.trim());
      if (parts.length >= 2) {
        // Usa mapeamento de colunas se detectado, senão inferência por campo
        if (colEan >= 0 && parts[colEan]) {
          ean = parts[colEan].replace(/[^0-9]/g, '');
        }
        if (colNome >= 0 && parts[colNome]) {
          nome = parts[colNome];
        }
        if (colValidade >= 0 && parts[colValidade]) {
          const strict = parseStrictDateBR(parts[colValidade]);
          if (strict) {
            dateISO = strict.iso;
            dateBR = strict.br;
          }
        }
        if (colQtd >= 0 && parts[colQtd]) {
          const qClean = parts[colQtd].replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
          quantidade = Math.max(0, Math.round(parseFloat(qClean) || 0));
        }
        if (colCorredor >= 0 && parts[colCorredor]) {
          corredor = parts[colCorredor];
        }

        // Se colunas não estavam mapeadas
        if (!ean || !nome || !dateISO) {
          parts.forEach(part => {
            const pClean = part.replace(/[*_~`]/g, '').trim();
            if (!ean && /^\d{7,14}$/.test(pClean)) {
              ean = pClean;
            } else if (!dateISO) {
              const strict = parseStrictDateBR(pClean);
              if (strict) {
                dateISO = strict.iso;
                dateBR = strict.br;
              }
            } else if (quantidade === 0 && /^\d+(?:[.,]\d+)?(?:\s*(?:unidades?|un|cx|pct))?$/i.test(pClean)) {
              const num = pClean.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.]/g, '');
              quantidade = Math.max(0, Math.round(parseFloat(num) || 0));
            } else if (!nome && /[a-zA-ZÀ-ÿ]/.test(pClean)) {
              nome = pClean;
            }
          });
        }
      }
    }

    // Se não foi delimitador ou faltou dados, tenta parser de linha de texto padrão
    if (!ean) {
      // Extrai data
      const dateMatch = line.match(/\b(\d{4})[/-](\d{2})[/-](\d{2})\b/) ||
                        line.match(/\b(\d{2})[/-](\d{2})[/-](\d{4})\b/) ||
                        line.match(/\b(\d{2})[/-](\d{2})[/-](\d{2})\b/);
      if (dateMatch) {
        const strict = parseStrictDateBR(dateMatch[0]);
        if (strict) {
          dateISO = strict.iso;
          dateBR = strict.br;
        }
      }

      let lineWithoutDate = line;
      if (dateMatch) {
        lineWithoutDate = line.replace(dateMatch[0], '').trim();
      }

      const eanStartMatch = lineWithoutDate.match(/^(\d{4,14})\s*[-–—:;\t, ]\s*(.*)$/);
      if (eanStartMatch) {
        ean = eanStartMatch[1].trim();
        nome = eanStartMatch[2].trim().replace(/^[-–—:;\t, ]+|[-–—:;\t, ]+$/g, '').trim();
      } else {
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
    }

    // Validações e Sanidade
    if (!ean || ean.length < 4) {
      stats.errors++;
      stats.errorDetails.push(`Linha ${i + 1}: Código de barras inválido ou ausente ("${line.substring(0, 30)}...")`);
      continue;
    }

    nome = (nome || `PRODUTO ${ean}`).toUpperCase().replace(/^[-–—:;\t, ]+|[-–—:;\t, ]+$/g, '').trim();

    // Se não encontrou data na linha, usa fallback
    if (!dateISO) {
      if (fallbackDateISO) {
        const strict = parseStrictDateBR(fallbackDateISO);
        if (strict) {
          dateISO = strict.iso;
          dateBR = strict.br;
        } else {
          dateISO = String(fallbackDateISO).split('T')[0];
          dateBR = formatDateBR(dateISO);
        }
      } else {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        dateISO = d.toISOString().split('T')[0];
        dateBR = formatDateBR(dateISO);
      }
    }

    // Chave composta EAN + DATA_DE_VALIDADE (Item 14 e 17)
    const compositeKey = `${ean}__${dateISO}`;
    if (seenCompositeKeys.has(compositeKey)) {
      stats.duplicates++;
      const existing = results.find(r => r.compositeKey === compositeKey);
      if (existing) {
        if (nome && nome.length > existing.nome.length && !existing.nome.includes(nome)) {
          existing.nome = nome;
          existing.descricao = nome;
        }
        if (quantidade > 0) {
          existing.quantidade = (existing.quantidade || 0) + quantidade;
        }
      }
      continue;
    }

    seenCompositeKeys.add(compositeKey);
    stats.success++;

    results.push({
      compositeKey,
      ean,
      nome,
      descricao: nome,
      dataValidade: dateISO,
      data_validade: dateISO,
      dataValidadeBR: dateBR,
      data_validade_br: dateBR,
      quantidade: quantidade || 0,
      corredor: corredor || ''
    });
  }

  return { items: results, stats };
}

export function parseBlitzInputList(rawText, fallbackDateISO = null) {
  const parsed = parseDelimitedOrStructuredInput(rawText, fallbackDateISO);
  // Mantém retrocompatibilidade total com retorno de Array + anexa stats
  const items = parsed.items;
  items.stats = parsed.stats;
  return items;
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
    let pastForThisItem = allPastConferences.filter(c => {
      const eanMatch = String(c.ean).trim() === String(item.ean).trim();
      const dateMatch = String(c.data_validade || '').split('T')[0] === String(item.dataValidade).split('T')[0];
      return eanMatch && dateMatch && c.blitz_id !== blitzId;
    });

    // Se não encontrou conferência com a mesma data exata, verifica se o produto já teve conferência anterior em outra data
    if (pastForThisItem.length === 0) {
      pastForThisItem = allPastConferences.filter(c => {
        const eanMatch = String(c.ean).trim() === String(item.ean).trim();
        return eanMatch && c.blitz_id !== blitzId;
      });
    }

    // Ordena do mais recente para o mais antigo
    pastForThisItem.sort((a, b) => new Date(b.conferido_em || 0) - new Date(a.conferido_em || 0));

    let isNew = pastForThisItem.length === 0;
    let previousQuantity = 0;
    let hadQuantityPreviously = false;
    let hadZeroPreviously = false;

    if (isNew) {
      // Se não havia conferência na blitz mas o produto já existia no estoque com unidades:
      if (product && Number(product.total_quantity) > 0) {
        isNew = false;
        previousQuantity = Number(product.total_quantity);
        hadQuantityPreviously = true;
        tinhamQuantidadeCount++;
        jaVerificadosCount++;
      } else {
        produtosNovosCount++;
      }
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
    total: importedItems.length,
    totalImportados: importedItems.length,
    novos: produtosNovosCount,
    produtosNovos: produtosNovosCount,
    jaVerificados: jaVerificadosCount,
    tinhamQuantidade: tinhamQuantidadeCount,
    tinhamZero: tinhamZeroCount,
    datasDistintas: distinctDatesSet.size,
    datasList: Array.from(distinctDatesSet).sort(),
    itens: importedItems,
    itensJaVerificados: importedItems.filter(i => !i.is_new_product),
    itensNovos: importedItems.filter(i => i.is_new_product)
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
  usuario = null,
  responsible_user_id = null,
  responsible_user_name = null,
  observacao = ''
}) {
  const db = await initDB();
  const now = new Date().toISOString();
  const numQtd = Number(quantidade) || 0;

  const activeUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
  const effUserId = responsible_user_id || (usuario === 'Angélica' ? 'angelica' : (activeUser ? activeUser.id : 'ana_luiza'));
  const effUserName = responsible_user_name || (usuario && usuario !== 'Ana Luiza' ? usuario : (effUserId === 'angelica' ? 'Angélica' : (activeUser ? activeUser.name : 'Ana Luiza')));

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
    usuario: effUserName,
    user_id: effUserId,
    responsible_user_id: effUserId,
    responsible_user_name: effUserName,
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
    blitzItem.user_id = effUserId;
    blitzItem.usuario = effUserName;
    blitzItem.responsible_user_id = effUserId;
    blitzItem.responsible_user_name = effUserName;
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
    user_name: effUserName,
    user_id: effUserId,
    responsible_user_id: effUserId,
    responsible_user_name: effUserName,
    corredor: corredor || (product ? product.corridor : ''),
    notes: observacao,
    checked_at: now
  };
  await putRecord('blitz_items', legacyItem);

  // Grava auditoria
  await recordAudit({
    blitz_id: blitzId,
    registro_id: confId,
    tabela: 'conferencias_blitz',
    acao: tipoConferencia === 'CORRECAO' ? 'CORRECAO_QUANTIDADE' : 'CONFERENCIA',
    responsible_user_id: effUserId,
    responsible_user_name: effUserName,
    detalhes: `${effUserName} conferiu ${numQtd} un do produto ${cleanEan} (Validade: ${dataValidade})`
  });

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
export async function finalizeBlitzWithAutoZeros(blitzId, usuario = null) {
  const db = await initDB();
  const now = new Date().toISOString();

  const currentUser = getCurrentUser();
  const effectiveUserId = (usuario && usuario.toLowerCase().includes('angelica')) ? 'angelica' : (currentUser?.id || 'ana_luiza');
  const effectiveUserName = (usuario && usuario !== 'Ana Luiza') ? usuario : (effectiveUserId === 'angelica' ? 'Angélica' : (currentUser?.name || 'Ana Luiza'));

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
      responsavel: session.responsible_user_name || session.user_name || effectiveUserName,
      responsible_user_id: session.responsible_user_id || effectiveUserId,
      responsible_user_name: session.responsible_user_name || effectiveUserName,
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
      usuario: effectiveUserName,
      userId: effectiveUserId,
      userName: effectiveUserName,
      observacao: 'Registrado automaticamente como 0 ao finalizar a Blitz'
    });
  }

  // Atualiza status da Blitz para FINALIZADA
  if (blitz) {
    blitz.status = 'FINALIZADA';
    blitz.finalized_at = now;
    blitz.finalized_by = effectiveUserName;
    blitz.finalized_by_user_id = effectiveUserId;
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
    session.finalized_at = now;
    session.finalized_by = effectiveUserName;
    session.finalized_by_user_id = effectiveUserId;
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
    blitz_id: blitzId,
    registro_id: blitzId,
    tabela: 'blitz',
    acao: 'FINALIZACAO',
    usuario: effectiveUserName,
    userId: effectiveUserId,
    userName: effectiveUserName,
    responsible_user_id: effectiveUserId,
    responsible_user_name: effectiveUserName,
    descricao: `Blitz finalizada por ${effectiveUserName}. Total de ${allItems.length} itens (${manualCount} conferidos manualmente, ${autoZeroCount} finalizados com zero automático)`
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
export async function getWeeklyRoutineStatus(userId = null) {
  const db = await initDB();
  const activeUser = userId ? getUserById(userId) : getCurrentUser();
  const activeUserId = activeUser ? activeUser.id : null;
  const userCycles = getWeeklyCycles(activeUserId);

  const todayDate = new Date();
  const dayOfWeek = todayDate.getDay(); // 0: Dom, 1: Seg ... 6: Sab
  const todayISO = getTodayISO();
  const currentCycle = getWeeklyCycleForDate(todayDate, activeUserId);

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

  // Mapeia o progresso para cada um dos 3 ciclos semanais da usuária ativa
  const cyclesProgress = await Promise.all(
    userCycles.map(async (cycle) => {
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
  const activeUserName = activeUser ? activeUser.name : 'Controladoria';
  if (delayedBlitz && currentCycle.id !== delayedBlitz.id && !currentCycle.isRestDay) {
    priorityAlert = {
      title: '🚨 Você tem uma pendência de Blitz',
      message: `A Blitz de ${delayedBlitz.label} ainda tem ${delayedBlitz.pendingCount} produtos pendentes, e hoje é dia de ${currentCycle.label}.`,
      suggestion: `Sugestão (${activeUserName}): Vamos terminar primeiro os ${delayedBlitz.pendingCount} produtos atrasados e depois continuar com ${currentCycle.label}.`,
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
  const [bItens, allPastConferences] = await Promise.all([
    getBlitzItens(blitzId),
    getAllPastConferences()
  ]);

  // Se blitz_itens vier vazio, busca fallback de blitz_items
  let items = bItens;
  if (!items || items.length === 0) {
    try {
      const { tx } = await getSafeTx(['blitz_items'], 'readonly');
      const legacyStore = tx.objectStore('blitz_items');
      const legIndex = legacyStore.index('blitz_session_id');
      const legList = await new Promise((res) => {
        const req = legIndex.getAll(blitzId);
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      });
      if (legList.length > 0) {
        items = legList.map(l => ({
          id: l.id,
          blitz_id: blitzId,
          ean: l.barcode,
          nome_produto: l.notes || `PRODUTO ${l.barcode}`,
          data_validade: l.requested_expiration_date,
          status: l.result === 'CONFERIDO' ? 'CONFERIDO' : (l.checked_at ? 'CONFERIDO' : 'PENDENTE'),
          quantidade: Number(l.total_quantity) || 0,
          previous_quantity: Number(l.previous_quantity) || 0,
          is_new_product: l.is_new_expiration === true,
          corredor: l.corridor || ''
        }));
      }
    } catch (_) {}
  }

  // Verifica se há histórico anterior disponível no sistema
  const pastConferencesFromOtherBlitzes = allPastConferences.filter(c => c.blitz_id !== blitzId);
  const anyItemHasPrev = (items || []).some(it => {
    return Number(it.previous_quantity) > 0 ||
           it.had_quantity_previously === true ||
           it.had_zero_previously === true ||
           (Array.isArray(it.previous_history) && it.previous_history.length > 0);
  });

  const hasPrevious = Boolean(pastConferencesFromOtherBlitzes.length > 0 || anyItemHasPrev);

  const produtosNovos = [];
  const passaramATerQtd = []; // voltaram a ter
  const continuamZerados = [];
  const aumentaram = [];
  const diminuiram = [];
  const zeraram = [];
  const grandeAumento = [];

  (items || []).forEach(it => {
    const barcode = String(it.ean || it.barcode || '').trim();
    const expDate = String(it.data_validade || it.requested_expiration_date || '').split('T')[0];

    // Se previous_quantity não estiver preenchido, tenta buscar de pastConferencesFromOtherBlitzes
    let prev = Number(it.previous_quantity);
    if (isNaN(prev) || (prev === 0 && !it.had_zero_previously)) {
      const matchPast = pastConferencesFromOtherBlitzes.find(c => {
        const bMatch = String(c.ean).trim() === barcode;
        const dMatch = !expDate || String(c.data_validade).split('T')[0] === expDate;
        return bMatch && dMatch;
      });
      if (matchPast) {
        prev = Number(matchPast.quantidade || 0);
      } else {
        prev = 0;
      }
    }

    const curr = Number(it.quantidade != null ? it.quantidade : it.total_quantity) || 0;
    const diff = curr - prev;
    const isConferido = it.status === 'CONFERIDO' || it.result === 'TEM' || it.result === 'NAO_TEM' || Boolean(it.conferido_em) || Boolean(it.checked_at);

    const cleanItem = {
      id: it.id,
      ean: barcode,
      barcode: barcode,
      name: it.nome_produto || it.product_name || it.nome || it.descricao || it.name || `PRODUTO ${barcode}`,
      nome_produto: it.nome_produto || it.product_name || it.nome || it.descricao || it.name || `PRODUTO ${barcode}`,
      prevQty: prev,
      currentQty: curr,
      diff: diff > 0 ? `+${diff}` : String(diff),
      diffNum: diff,
      isConferido,
      dataValidade: expDate,
      dataValidadeBR: expDate ? formatDateBR(expDate) : '--/--/----',
      corredor: it.corredor || it.corridor || ''
    };

    if (it.is_new_product || (!it.previous_history?.length && !it.had_quantity_previously && !it.had_zero_previously && prev === 0)) {
      produtosNovos.push(cleanItem);
    }

    if (isConferido) {
      if (prev === 0 && curr > 0) {
        passaramATerQtd.push(cleanItem);
      } else if (prev > 0 && curr === 0) {
        zeraram.push(cleanItem);
      } else if (prev === 0 && curr === 0) {
        continuamZerados.push(cleanItem);
      } else if (diff > 0 && prev > 0) {
        aumentaram.push(cleanItem);
      } else if (diff < 0 && prev > 0) {
        diminuiram.push(cleanItem);
      }

      if (diff >= 20 || (prev <= 5 && curr >= 20)) {
        grandeAumento.push(cleanItem);
      }
    }
  });

  // Identifica os responsáveis e datas da Blitz atual e da Blitz anterior
  let currentSession = null;
  let previousSession = null;
  try {
    currentSession = await getRecordById('blitz_sessions', blitzId) || await getRecordById('blitz', blitzId);
    const { tx } = await getSafeTx(['blitz_sessions', 'blitz'], 'readonly');
    const sStore = tx.objectStore('blitz_sessions');
    const allSess = await new Promise(res => {
      const r = sStore.getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => res([]);
    });
    const priorSessions = allSess
      .filter(s => s.id !== blitzId && (s.status === 'finalizada' || s.status === 'finished' || s.finished_at))
      .sort((a, b) => new Date(b.finished_at || b.started_at || 0) - new Date(a.finished_at || a.started_at || 0));
    
    previousSession = priorSessions.find(s => s.sector === currentSession?.sector) || priorSessions[0] || null;
  } catch (_) {}

  const currentResponsible = currentSession?.responsible_user_name || currentSession?.user_name || (currentSession?.responsible_user_id === 'angelica' ? 'Angélica' : 'Ana Luiza');
  const currentDate = currentSession?.start_date ? formatDateBR(currentSession.start_date) : (currentSession?.started_at ? formatDateBR(currentSession.started_at) : formatDateBR(getTodayISO()));

  let previousResponsible = previousSession?.responsible_user_name || previousSession?.user_name || 'Ana Luiza';
  let previousDate = previousSession?.start_date ? formatDateBR(previousSession.start_date) : (previousSession?.started_at ? formatDateBR(previousSession.started_at) : '--/--/----');

  if (!previousSession && pastConferencesFromOtherBlitzes.length > 0) {
    const p = pastConferencesFromOtherBlitzes[0];
    previousResponsible = p.responsible_user_name || p.usuario || (p.responsible_user_id === 'angelica' ? 'Angélica' : 'Ana Luiza');
    previousDate = p.conferido_em ? formatDateBR(p.conferido_em) : '--/--/----';
  }

  return {
    hasPrevious,
    currentResponsible,
    currentDate,
    previousResponsible,
    previousDate,
    novos: produtosNovos,
    produtosNovos,
    voltaram: passaramATerQtd,
    passaramATerQtd,
    zeraram,
    continuamZerados,
    aumentaram,
    diminuiram,
    grandeAumento,
    totalComparados: (items || []).length
  };
}

/**
 * 12. AUDITORIA PERMANENTE (Item 62)
 */
export async function recordAudit({
  registro_id = null,
  blitz_id = null,
  tabela = 'blitz_sessions',
  acao = 'OPERACAO',
  usuario = null,
  user_id = null,
  user_name = null,
  responsible_user_id = null,
  responsible_user_name = null,
  motivo = '',
  valor_anterior = null,
  novo_valor = null,
  descricao = '',
  detalhes = ''
}) {
  try {
    const active = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
    const effId = responsible_user_id || user_id || (usuario === 'Angélica' ? 'angelica' : (active ? active.id : 'ana_luiza'));
    const effName = responsible_user_name || user_name || (usuario && usuario !== 'Ana Luiza' ? usuario : (effId === 'angelica' ? 'Angélica' : (active ? active.name : 'Ana Luiza')));
    const now = new Date().toISOString();
    const finalDesc = descricao || detalhes || `${acao} realizada por ${effName}`;

    const record = {
      id: generateId('audit_'),
      registro_id: registro_id || blitz_id || generateId('reg_'),
      blitz_id: blitz_id || registro_id || null,
      tabela,
      acao,
      usuario: effName,
      user_id: effId,
      user_name: effName,
      responsible_user_id: effId,
      responsible_user_name: effName,
      motivo,
      valor_anterior,
      novo_valor,
      descricao: finalDesc,
      detalhes: finalDesc,
      data_hora: now,
      created_at: now
    };

    await putRecord('historico_alteracoes', record);
    try {
      await putRecord('auditoria_blitz', record);
    } catch (_) {}
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
  const allConfs = [];

  // 1. Coleta conferências da tabela 'conferencias_blitz'
  try {
    const { tx } = await getSafeTx(['conferencias_blitz'], 'readonly');
    const confStore = tx.objectStore('conferencias_blitz');
    const confs = await new Promise((resolve) => {
      const req = confStore.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    confs.forEach(c => {
      allConfs.push({
        id: c.id,
        blitz_id: c.blitz_id,
        ean: String(c.ean || c.barcode || '').trim(),
        data_validade: String(c.data_validade || c.requested_expiration_date || '').split('T')[0],
        quantidade: Number(c.quantidade != null ? c.quantidade : c.total_quantity) || 0,
        tipo_conferencia: c.tipo_conferencia || 'MANUAL',
        conferido_em: c.conferido_em || c.checked_at || c.created_at,
        usuario: c.usuario || c.user_name || 'Ana Luiza',
        corredor: c.corredor || ''
      });
    });
  } catch (_) {}

  // 2. Coleta conferências registradas na tabela oficial 'blitz_itens'
  try {
    const { tx } = await getSafeTx(['blitz_itens'], 'readonly');
    const bStore = tx.objectStore('blitz_itens');
    const bItens = await new Promise((resolve) => {
      const req = bStore.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    bItens.forEach(it => {
      if (it.status === 'CONFERIDO' || it.conferido_em || it.quantidade != null || it.total_quantity != null) {
        allConfs.push({
          id: it.id,
          blitz_id: it.blitz_id,
          ean: String(it.ean || it.barcode || '').trim(),
          data_validade: String(it.data_validade || it.requested_expiration_date || '').split('T')[0],
          quantidade: Number(it.quantidade != null ? it.quantidade : it.total_quantity) || 0,
          tipo_conferencia: 'BLITZ_ITEM',
          conferido_em: it.conferido_em || it.updated_at || it.created_at,
          usuario: it.usuario || 'Ana Luiza',
          corredor: it.corredor || ''
        });
      }
    });
  } catch (_) {}

  // 3. Coleta conferências registradas na tabela 'blitz_items' (espelho legado)
  try {
    const { tx } = await getSafeTx(['blitz_items'], 'readonly');
    const legacyStore = tx.objectStore('blitz_items');
    const legItems = await new Promise((resolve) => {
      const req = legacyStore.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    legItems.forEach(l => {
      if (l.result === 'CONFERIDO' || l.result === 'TEM' || l.result === 'NAO_TEM' || l.checked_at || l.total_quantity != null) {
        allConfs.push({
          id: l.id,
          blitz_id: l.blitz_session_id || l.blitz_id,
          ean: String(l.barcode || l.ean || '').trim(),
          data_validade: String(l.requested_expiration_date || l.data_validade || '').split('T')[0],
          quantidade: Number(l.total_quantity != null ? l.total_quantity : l.quantity) || 0,
          tipo_conferencia: 'LEGACY_BLITZ',
          conferido_em: l.checked_at || l.created_at,
          usuario: l.user_name || 'Ana Luiza',
          corredor: l.corridor || ''
        });
      }
    });
  } catch (_) {}

  // Ordena por conferido_em decrescente
  allConfs.sort((a, b) => new Date(b.conferido_em || 0) - new Date(a.conferido_em || 0));
  return allConfs;
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
