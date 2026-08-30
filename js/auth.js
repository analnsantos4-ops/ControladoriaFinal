// Sistema de Autenticação e Códigos de Segurança
import { triggerHaptic, playBeep } from './utils.js';

export const ACCESS_CODE = '2002'; // Senha de Acesso Rápido
export const MASTER_SECURITY_PIN = '200902'; // Senha Mestre para exclusões críticas e zerar banco

const SESSION_KEY = 'ana_luiza_auth_token';

export function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === 'authenticated_session_2002';
}

export function verifyCode(code) {
  if (!code) return false;
  const cleanCode = code.toString().trim();
  if (cleanCode === ACCESS_CODE || cleanCode === MASTER_SECURITY_PIN) {
    sessionStorage.setItem(SESSION_KEY, 'authenticated_session_2002');
    playBeep('success');
    triggerHaptic(50);
    return true;
  } else {
    playBeep('warning');
    triggerHaptic(120);
    return false;
  }
}

export function verifyMasterSecurityPin(pin) {
  if (!pin) return false;
  const cleanPin = pin.toString().trim();
  return cleanPin === MASTER_SECURITY_PIN;
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
