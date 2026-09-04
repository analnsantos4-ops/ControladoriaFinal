// Utilitários, Constantes e Helpers para Controladoria - Ana Luiza

export const SETORS = [
  'MERCEARIA',
  'ALHO',
  'PERFUMARIA',
  'LIMPEZA',
  'BEBIDAS',
  'BAZAR'
];

export const CORRIDORS = [
  'Corredor 1',
  'Corredor 2',
  'Corredor 3',
  'Corredor 4',
  'Corredor 5',
  'Corredor 6',
  'Corredor 7',
  'Corredor 8',
  'Corredor 9',
  'Corredor 10',
  'Corredor 11',
  'Corredor 12',
  'Corredor 13',
  'Corredor 14',
  'Adega',
  'Perfumaria',
  'Zona do Alho'
];

export const LOCATIONS = [
  'DEPÓSITO',
  'GELADEIRA',
  'PRATELEIRA',
  'PONTA DE GÔNDOLA',
  'ORELHA',
  'ILHA',
  'CARRINHO NA FRENTE DE LOJA'
];

export const LOCATION_SHORT_NAMES = {
  'DEPÓSITO': 'Depósito',
  'GELADEIRA': 'Geladeira',
  'PRATELEIRA': 'Prateleira',
  'PONTA DE GÔNDOLA': 'P. Gôndola',
  'ORELHA': 'Orelha',
  'ILHA': 'Ilha',
  'CARRINHO NA FRENTE DE LOJA': 'Carrinho Frente Loja',
  'CARRINHO': 'Carrinho Frente Loja',
  'FRENTE DE LOJA': 'Carrinho Frente Loja'
};

export const BLITZ_SECTORS = [
  { id: 'mercearia', label: 'Mercearia', icon: '🛒', desc: 'Mercearia em geral, alimentos secos e matinais', schedule: 'Segunda a Quarta' },
  { id: 'bazar', label: 'Bazar', icon: '🧺', desc: 'Utilidades domésticas, descartáveis e bazar', schedule: 'Quinta-feira' },
  { id: 'bebidas', label: 'Bebidas', icon: '🍾', desc: 'Bebidas, adega, sucos, refrigerantes e cervejas', schedule: 'Sexta e Sábado' },
  { id: 'alho', label: 'Alho', icon: '🧄', desc: 'Alho a granel, encartelado e processados', schedule: 'Setor Complementar' },
  { id: 'perfumaria', label: 'Perfumaria', icon: '🧴', desc: 'Higiene pessoal, cosméticos e cuidados', schedule: 'Setor Complementar' },
  { id: 'limpeza', label: 'Limpeza', icon: '🧹', desc: 'Produtos químicos, sabões e saneantes', schedule: 'Setor Complementar' }
];

export const BLITZ_LOCATIONS = [
  'Área de venda',
  'Depósito',
  'Geladeira',
  'Prateleira',
  'Ponta de gôndola',
  'Orelha',
  'Ilha',
  'Carrinho frente de loja',
  'Outros'
];

export const BLITZ_TYPES = BLITZ_SECTORS.map(s => ({
  id: s.id,
  label: s.label,
  sector: s.label.toUpperCase(),
  icon: s.icon,
  desc: s.desc,
  schedule: s.schedule
}));

export function getSuggestedBlitzType() {
  const day = new Date().getDay(); // 0: Dom, 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sab
  // Cronograma oficial Ana Luiza:
  // Segunda até quarta - mercearia
  if (day >= 1 && day <= 3) return 'mercearia';
  // Quinta - Bazar
  if (day === 4) return 'bazar';
  // Sexta e sábado - bebida
  if (day === 5 || day === 6) return 'bebidas';
  // Domingo (ou padrão): Mercearia
  return 'mercearia';
}

/**
 * Calcula o tempo decorrido dinamicamente conforme regra da Blitz Semanal:
 * - "Hoje"
 * - "Há 1 dia"
 * - "Há X dias"
 * - "Há 1 semana" (7 dias)
 * - "Há 2 semanas" (14 dias)
 * - "Há X semanas"
 * - "Há 1 mês" (30 dias)
 * - "Há X meses"
 */
export function formatTimeAgoDynamic(dateStrOrISO) {
  if (!dateStrOrISO) return '';
  const targetDate = new Date(dateStrOrISO);
  if (isNaN(targetDate.getTime())) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const refDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());

  const diffMs = today.getTime() - refDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) {
    return 'Hoje';
  } else if (diffDays === 1) {
    return 'Há 1 dia';
  } else if (diffDays < 7) {
    return `Há ${diffDays} dias`;
  } else if (diffDays === 7) {
    return 'Há 1 semana';
  } else if (diffDays === 14) {
    return 'Há 2 semanas';
  } else if (diffDays === 21) {
    return 'Há 3 semanas';
  } else if (diffDays >= 28 && diffDays <= 31) {
    return 'Há 1 mês';
  } else if (diffDays > 31 && diffDays < 60) {
    return 'Há 1 mês';
  } else if (diffDays >= 60) {
    const months = Math.floor(diffDays / 30);
    return `Há ${months} meses`;
  } else {
    const weeks = Math.floor(diffDays / 7);
    return `Há ${weeks} semanas`;
  }
}

/**
 * Retorna data formatada com dia da semana:
 * Ex: "02/09/2026 — quarta-feira"
 */
export function formatDateWithWeekday(dateStrOrISO) {
  if (!dateStrOrISO) return '';
  const d = new Date(dateStrOrISO);
  if (isNaN(d.getTime())) return '';
  const weekdays = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado'
  ];
  const dateFormatted = d.toLocaleDateString('pt-BR');
  const weekday = weekdays[d.getDay()];
  return `${dateFormatted} — ${weekday}`;
}

// Gera ID único
export function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Data atual no formato ISO YYYY-MM-DD
export function getTodayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Data formatada para visualização DD/MM/AAAA
export function formatDateBR(dateString) {
  if (!dateString) return '--/--/----';
  const clean = String(dateString).trim().split('T')[0];
  if (!clean) return '--/--/----';
  // If ISO YYYY-MM-DD
  if (clean.includes('-')) {
    const parts = clean.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
  }
  return clean;
}

// Converte DD/MM/AAAA para ISO YYYY-MM-DD
export function parseDateBRtoISO(dateStringBR) {
  if (!dateStringBR) return '';
  const clean = String(dateStringBR).trim().split('T')[0];
  if (clean.includes('/')) {
    const parts = clean.split('/');
    if (parts.length === 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      return `${year}-${month}-${day}`;
    }
  }
  return clean;
}

// Retorna diferença de dias até a validade
export function getDaysUntilExpiration(expirationDateISO) {
  if (!expirationDateISO) return 999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  let expDate;
  if (expirationDateISO.includes('/')) {
    const [d, m, y] = expirationDateISO.split('/');
    expDate = new Date(Number(y), Number(m) - 1, Number(d));
  } else {
    const [y, m, d] = expirationDateISO.split('-');
    expDate = new Date(Number(y), Number(m) - 1, Number(d));
  }
  expDate.setHours(0, 0, 0, 0);

  const diffTime = expDate.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// Retorna saudação baseada na hora do dia
export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) {
    return 'Bom dia, Ana Luiza! ☀️';
  } else if (hour < 18) {
    return 'Boa tarde, Ana Luiza! 👋';
  } else {
    return 'Boa noite, Ana Luiza! 🌙';
  }
}

// Retorna texto da data completa em português
export function getFormattedFullDate() {
  const now = new Date();
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const str = now.toLocaleDateString('pt-BR', options);
  // Capitalize first letter
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Compressão de imagem do produto no cliente
export async function compressImage(fileOrDataUrl, maxWidth = 600, maxHeight = 600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = (err) => reject(err);

    if (typeof fileOrDataUrl === 'string') {
      img.src = fileOrDataUrl;
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        img.src = e.target.result;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(fileOrDataUrl);
    }
  });
}

// Cria miniatura compacta (120x120)
export async function createThumbnail(fileOrDataUrl) {
  return compressImage(fileOrDataUrl, 120, 120, 0.65);
}

// Feedback tátil (Vibração)
export function triggerHaptic(duration = 80) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(duration);
    } catch (e) {
      // Ignorar erros de vibração caso navegador bloqueie
    }
  }
}

// Feedback sonoro sintetizado (Bip do leitor)
let audioCtx = null;
export function playBeep(type = 'success') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'success') {
      osc.frequency.setValueAtTime(1200, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.12);
    } else if (type === 'warning') {
      osc.frequency.setValueAtTime(400, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
      osc.start(audioCtx.currentTime);
      osc.stop(audioCtx.currentTime + 0.2);
    }
  } catch (e) {
    // Ignora se áudio não estiver inicializado
  }
}

// Formata números com separador de milhar brasileiro
export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return Number(num).toLocaleString('pt-BR');
}

/**
 * Síntese de voz desativada por solicitação do usuário
 */
export function speakText(text) {
  // Desativado por solicitação do usuário
}
