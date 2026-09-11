// Sistema de Autenticação e Usuárias do Sistema
import { triggerHaptic } from './utils.js';

export const ACCESS_CODE = '2002'; // Senha de compatibilidade legado
export const MASTER_SECURITY_PIN = '200902'; // Senha Mestre para exclusões críticas e zerar banco

// Definição das Usuárias Oficiais do Sistema
export const SYSTEM_USERS = {
  ana_luiza: {
    id: 'ana_luiza',
    name: 'Ana Luiza',
    code: '1407',
    sectors: ['ALHO', 'MERCEARIA', 'BAZAR', 'BEBIDAS'],
    icon: '🟣',
    color: '#a855f7',
    badgeColor: 'rgba(168, 85, 247, 0.2)',
    textColor: '#c084fc'
  },
  angelica: {
    id: 'angelica',
    name: 'Angélica',
    code: '160926',
    sectors: ['MERCEARIA', 'PERFUMARIA', 'PRODUTOS DE LIMPEZA', 'LIMPEZA'],
    icon: '🟢',
    color: '#10b981',
    badgeColor: 'rgba(16, 185, 129, 0.2)',
    textColor: '#34d399'
  }
};

const SESSION_KEY = 'ana_luiza_auth_token';
const ACTIVE_USER_KEY = 'active_system_user_id';

export function isAuthenticated() {
  const token = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  return Boolean(token && token.startsWith('authenticated_session_'));
}

export function getCurrentUser() {
  const userId = sessionStorage.getItem(ACTIVE_USER_KEY) || localStorage.getItem(ACTIVE_USER_KEY);
  if (userId && SYSTEM_USERS[userId]) {
    return SYSTEM_USERS[userId];
  }
  // Fallback padrão seguro para Ana Luiza
  return SYSTEM_USERS.ana_luiza;
}

export function getUserById(userId) {
  if (!userId) return null;
  const cleanId = String(userId).trim().toLowerCase();
  if (cleanId === 'angelica' || cleanId.includes('ang')) return SYSTEM_USERS.angelica;
  return SYSTEM_USERS[cleanId] || SYSTEM_USERS.ana_luiza;
}

export function getAllowedSectorsForUser(userId = null) {
  const user = userId ? getUserById(userId) : getCurrentUser();
  return user ? [...user.sectors] : ['MERCEARIA'];
}

export function isSectorAllowedForUser(sector, userId = null) {
  if (!sector) return false;
  const cleanSector = String(sector).trim().toUpperCase();
  const allowed = getAllowedSectorsForUser(userId);
  return allowed.some(s => s === cleanSector || (cleanSector.includes('LIMPEZA') && s.includes('LIMPEZA')));
}

export function verifyCode(code) {
  if (!code) return false;
  const cleanCode = code.toString().trim();

  // Verifica Angélica (160926)
  if (cleanCode === SYSTEM_USERS.angelica.code) {
    sessionStorage.setItem(SESSION_KEY, 'authenticated_session_angelica');
    sessionStorage.setItem(ACTIVE_USER_KEY, SYSTEM_USERS.angelica.id);
    localStorage.setItem(SESSION_KEY, 'authenticated_session_angelica');
    localStorage.setItem(ACTIVE_USER_KEY, SYSTEM_USERS.angelica.id);
    triggerHaptic(50);
    return true;
  }

  // Verifica Ana Luiza (1407 ou legado 2002 ou PIN mestre)
  if (cleanCode === SYSTEM_USERS.ana_luiza.code || cleanCode === ACCESS_CODE || cleanCode === MASTER_SECURITY_PIN) {
    sessionStorage.setItem(SESSION_KEY, 'authenticated_session_ana_luiza');
    sessionStorage.setItem(ACTIVE_USER_KEY, SYSTEM_USERS.ana_luiza.id);
    localStorage.setItem(SESSION_KEY, 'authenticated_session_ana_luiza');
    localStorage.setItem(ACTIVE_USER_KEY, SYSTEM_USERS.ana_luiza.id);
    triggerHaptic(50);
    return true;
  }

  triggerHaptic(120);
  return false;
}

export function verifyMasterSecurityPin(pin) {
  if (!pin) return false;
  const cleanPin = pin.toString().trim();
  return cleanPin === MASTER_SECURITY_PIN;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ACTIVE_USER_KEY);
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(ACTIVE_USER_KEY);
}

