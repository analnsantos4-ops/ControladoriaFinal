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
  'CORREDOR 01',
  'CORREDOR 02',
  'CORREDOR 03',
  'CORREDOR 04',
  'CORREDOR 05',
  'CORREDOR 06',
  'CORREDOR 07',
  'CORREDOR 08',
  'CORREDOR 09',
  'CORREDOR 10',
  'CORREDOR 11',
  'CORREDOR 12',
  'CORREDOR 13',
  'CORREDOR 14',
  'ADEGA'
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

export const BLITZ_TYPES = [
  {
    id: 'alho_mercearia',
    label: 'Alho e Mercearia',
    sector: 'MERCEARIA',
    icon: '🧄🛒',
    days: [1, 2, 3],
    daysLabel: 'Segunda a Quarta-feira',
    desc: 'Alho e Mercearia (Segunda a Quarta-feira)'
  },
  {
    id: 'bazar',
    label: 'Bazar',
    sector: 'BAZAR',
    icon: '🧺',
    days: [4],
    daysLabel: 'Quinta-feira',
    desc: 'Bazar e Utilidades (Quinta-feira)'
  },
  {
    id: 'bebidas',
    label: 'Bebidas',
    sector: 'BEBIDAS',
    icon: '🍾',
    days: [5, 6],
    daysLabel: 'Sexta-feira e Sábado',
    desc: 'Bebidas e Adega (Sexta-feira e Sábado)'
  },
  {
    id: 'alho',
    label: 'Apenas Alho',
    sector: 'ALHO',
    icon: '🧄',
    days: [1, 2, 3],
    daysLabel: 'Segunda a Quarta-feira',
    desc: 'Conferência específica do setor de Alho'
  },
  {
    id: 'mercearia',
    label: 'Apenas Mercearia',
    sector: 'MERCEARIA',
    icon: '🛒',
    days: [1, 2, 3],
    daysLabel: 'Segunda a Quarta-feira',
    desc: 'Conferência específica da Mercearia'
  }
];

export function getSuggestedBlitzType() {
  const day = new Date().getDay(); // 0: Dom, 1: Seg, 2: Ter, 3: Qua, 4: Qui, 5: Sex, 6: Sab
  if (day === 4) return 'bazar'; // Quinta-feira: Bazar
  if (day === 5 || day === 6) return 'bebidas'; // Sexta-feira e Sábado: Bebidas
  return 'alho_mercearia'; // Segunda a Quarta-feira (e Domingo): Alho e Mercearia
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
  // If ISO YYYY-MM-DD
  if (dateString.includes('-')) {
    const parts = dateString.split('-');
    if (parts.length === 3) {
      return `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
    }
  }
  return dateString;
}

// Converte DD/MM/AAAA para ISO YYYY-MM-DD
export function parseDateBRtoISO(dateStringBR) {
  if (!dateStringBR) return '';
  if (dateStringBR.includes('/')) {
    const parts = dateStringBR.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  return dateStringBR;
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
