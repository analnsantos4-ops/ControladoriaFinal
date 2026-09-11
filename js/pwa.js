// Gerenciamento de Instalação PWA (Android e iPhone)
// Controladoria / Blitz de Validade
import { showToast } from './ui.js';

let deferredPrompt = null;

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || 
         window.navigator.standalone === true ||
         document.referrer.includes('android-app://');
}

export function isIOS() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua);
}

export function isAndroid() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /android/.test(ua);
}

export function initPWAInstallFlow() {
  // Captura o evento beforeinstallprompt no Android e Chromium
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] beforeinstallprompt capturado com sucesso');
    updateInstallButtonsUI();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    console.log('[PWA] Aplicativo instalado com sucesso');
    showToast('✓ Aplicativo instalado com sucesso na tela inicial!', 'success', 4000);
    updateInstallButtonsUI();
  });

  // Atualiza estado dos botões de instalação
  updateInstallButtonsUI();
}

export function updateInstallButtonsUI() {
  const installed = isStandalone();
  const installBtns = document.querySelectorAll('.btn-pwa-install, #btn-header-install-app');

  installBtns.forEach((btn) => {
    if (installed) {
      btn.style.display = 'none';
    } else {
      btn.style.display = 'inline-flex';
    }
  });

  const loginBanner = document.getElementById('login-pwa-install-banner');
  if (loginBanner) {
    loginBanner.style.display = installed ? 'none' : 'block';
  }
}

/**
 * Dispara o prompt de instalação nativo ou abre o guia para iOS
 */
export async function promptInstallApp() {
  if (isStandalone()) {
    showToast('O aplicativo já está instalado no seu dispositivo!', 'info', 3000);
    return;
  }

  if (deferredPrompt) {
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] Escolha do usuário: ${outcome}`);
      deferredPrompt = null;
    } catch (err) {
      console.warn('[PWA] Erro ao invocar prompt nativo:', err);
      openInstallGuideModal();
    }
  } else {
    openInstallGuideModal();
  }
}

/**
 * Modal com instruções visuais completas de instalação para iPhone e Android
 */
export function openInstallGuideModal() {
  let modal = document.getElementById('modal-pwa-install-guide');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-pwa-install-guide';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const isApple = isIOS();
  const title = isApple ? 'Instalação no iPhone (iOS)' : 'Instalação no Celular / Android';

  modal.innerHTML = `
    <div class="modal-backdrop" id="modal-pwa-backdrop"></div>
    <div class="modal-card" style="padding: 20px; max-width: 440px; width: 92%; box-sizing: border-box;">
      <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #27272a; padding-bottom: 12px; margin-bottom: 14px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <img src="/icons/icon-192.png" alt="Controladoria" style="width: 38px; height: 38px; border-radius: 10px; border: 1px solid #10b981; object-fit: cover;" />
          <div>
            <h3 style="margin: 0; font-size: 1.05rem; font-weight: 900; color: #f4f4f5;">${title}</h3>
            <span style="font-size: 0.72rem; color: #10b981; font-weight: 700;">CONTROLADORIA / BLITZ</span>
          </div>
        </div>
        <button type="button" id="btn-close-pwa-modal-x" class="btn-icon-control" style="width: 32px; height: 32px; font-size: 1rem;">✕</button>
      </div>

      <div style="font-size: 0.82rem; color: #d4d4d8; line-height: 1.5; margin-bottom: 14px;">
        Instale este aplicativo diretamente na tela inicial do seu celular para utilizar com <strong>desempenho máximo</strong> e funcionamento <strong>100% offline</strong> na loja.
      </div>

      ${isApple ? `
        <!-- Passo a Passo para iPhone / Safari -->
        <div style="background: #18181d; border: 1px solid #272730; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="width: 26px; height: 26px; border-radius: 50%; background: #10b981; color: #022c22; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">1</div>
            <div style="font-size: 0.82rem; color: #f4f4f5;">
              Toque no botão <strong>Compartilhar</strong> do Safari (o ícone de quadrado com uma seta para cima <span style="font-size: 1.1rem; line-height: 1;">⎋</span> na barra inferior).
            </div>
          </div>
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="width: 26px; height: 26px; border-radius: 50%; background: #10b981; color: #022c22; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">2</div>
            <div style="font-size: 0.82rem; color: #f4f4f5;">
              Role a lista de opções e toque em <strong>"Adicionar à Tela de Início"</strong> (ícone <span style="font-size: 1rem;">➕</span>).
            </div>
          </div>
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="width: 26px; height: 26px; border-radius: 50%; background: #10b981; color: #022c22; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">3</div>
            <div style="font-size: 0.82rem; color: #f4f4f5;">
              No canto superior direito, confirme tocando em <strong>"Adicionar"</strong>.
            </div>
          </div>
        </div>
      ` : `
        <!-- Passo a Passo para Android / Chrome / Edge -->
        <div style="background: #18181d; border: 1px solid #272730; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
          ${deferredPrompt ? `
            <div style="text-align: center; padding: 6px 0;">
              <button type="button" id="btn-trigger-pwa-native" class="btn-primary" style="width: 100%; height: 46px; font-weight: 900; font-size: 0.92rem; justify-content: center;">
                📲 INSTALAR AGORA NO DISPOSITIVO
              </button>
            </div>
          ` : `
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <div style="width: 26px; height: 26px; border-radius: 50%; background: #10b981; color: #022c22; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">1</div>
              <div style="font-size: 0.82rem; color: #f4f4f5;">
                No menu do navegador (3 pontinhos no canto superior direito <strong>⋮</strong>).
              </div>
            </div>
            <div style="display: flex; align-items: flex-start; gap: 10px;">
              <div style="width: 26px; height: 26px; border-radius: 50%; background: #10b981; color: #022c22; font-weight: 900; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; flex-shrink: 0;">2</div>
              <div style="font-size: 0.82rem; color: #f4f4f5;">
                Selecione a opção <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.
              </div>
            </div>
          `}
        </div>
      `}

      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button type="button" id="btn-close-pwa-modal" class="btn-secondary" style="height: 40px; padding: 0 16px; font-size: 0.85rem; font-weight: 800;">
          Entendi
        </button>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const close = () => modal.classList.remove('open');
  modal.querySelector('#modal-pwa-backdrop')?.addEventListener('click', close);
  modal.querySelector('#btn-close-pwa-modal-x')?.addEventListener('click', close);
  modal.querySelector('#btn-close-pwa-modal')?.addEventListener('click', close);

  modal.querySelector('#btn-trigger-pwa-native')?.addEventListener('click', async () => {
    close();
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
    }
  });
}
