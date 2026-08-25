// Sistema de Autenticação Rápida - Código 2009
import { triggerHaptic, playBeep } from './utils.js';

const ACCESS_CODE = '2009';
const SESSION_KEY = 'ana_luiza_auth_token';

export function isAuthenticated() {
  return sessionStorage.getItem(SESSION_KEY) === 'authenticated_session_2009';
}

export function verifyCode(code) {
  if (!code) return false;
  const cleanCode = code.toString().trim();
  if (cleanCode === ACCESS_CODE) {
    sessionStorage.setItem(SESSION_KEY, 'authenticated_session_2009');
    playBeep('success');
    triggerHaptic(50);
    return true;
  } else {
    playBeep('warning');
    triggerHaptic(120);
    return false;
  }
}

export function logout() {
  sessionStorage.removeItem(SESSION_KEY);
}
