// Gerenciador de Interface, Telas, Modais e Toasts
import { playBeep, triggerHaptic } from './utils.js';
import { startCameraScanner, stopCameraScanner, toggleTorch, switchCamera, toggleCameraZoom } from './scanner.js';

let activeViewId = 'view-login';

export function showView(viewId) {
  const views = document.querySelectorAll('.app-view');
  views.forEach((v) => {
    v.classList.remove('active');
  });

  const target = document.getElementById(viewId);
  if (target) {
    target.classList.add('active');
    activeViewId = viewId;
    window.scrollTo(0, 0);
  }
}

export function getActiveView() {
  return activeViewId;
}

// Sistema de Notificações Toast
let toastTimeout = null;

export function showToast(message, type = 'info', duration = 3200) {
  let toastEl = document.getElementById('app-toast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'app-toast';
    toastEl.className = 'app-toast';
    document.body.appendChild(toastEl);
  }

  // Define ícone/prefixo baseado no tipo
  let icon = '●';
  if (type === 'success') icon = '✓';
  else if (type === 'warning') icon = '⚠';
  else if (type === 'sync') icon = '↻';
  else if (type === 'offline') icon = '●';

  toastEl.innerHTML = `<span class="toast-icon">${icon}</span> <span class="toast-text">${message}</span>`;
  toastEl.className = `app-toast toast-${type} show`;

  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, duration);
}

// Modal de visualização de foto em tamanho maior
export function openPhotoModal(imageSrc, title = 'Foto do Produto') {
  let modal = document.getElementById('photo-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'photo-modal';
    modal.className = 'photo-modal';
    modal.innerHTML = `
      <div class="photo-modal-backdrop" id="photo-modal-backdrop"></div>
      <div class="photo-modal-card">
        <div class="photo-modal-header">
          <span class="photo-modal-title" id="photo-modal-title"></span>
          <button class="btn-close-modal" id="photo-modal-close">✕</button>
        </div>
        <div class="photo-modal-body">
          <img id="photo-modal-img" src="" alt="Produto" />
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('photo-modal-close').addEventListener('click', () => {
      modal.classList.remove('open');
    });
    document.getElementById('photo-modal-backdrop').addEventListener('click', () => {
      modal.classList.remove('open');
    });
  }

  document.getElementById('photo-modal-title').textContent = title;
  document.getElementById('photo-modal-img').src = imageSrc;
  modal.classList.add('open');
}

// Feedback haptic e áudio para botões principais
export function setupButtonFeedbacks() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button, .action-card, .btn-primary, .btn-secondary, .quick-btn');
    if (btn) {
      triggerHaptic(20);
    }
  });
}

// Modal de Confirmação com Senha de Segurança (2002)
export function promptSecurityPin(actionTitle, actionWarning, onConfirmed) {
  let modal = document.getElementById('security-pin-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'security-pin-modal';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-backdrop" id="security-pin-backdrop"></div>
    <div class="modal-card">
      <div class="modal-header-danger">
        <span class="danger-icon">🔒</span>
        <div>
          <h3 class="modal-title" id="sec-pin-title">${actionTitle}</h3>
          <p class="modal-subtitle">Confirmação de Segurança</p>
        </div>
      </div>

      <div class="security-pin-body">
        <p class="security-warning-text" id="sec-pin-warning">${actionWarning}</p>
        <p class="security-pin-instruction">Digite a senha de autorização (4 dígitos):</p>
        
        <form id="form-sec-pin" autocomplete="off">
          <div class="pin-input-wrapper">
            <input
              type="password"
              id="security-pin-input"
              class="login-pin-field"
              maxlength="4"
              inputmode="numeric"
              placeholder="••••"
              autocomplete="one-time-code"
              required
            />
          </div>

          <div id="sec-pin-error" class="login-error-text hidden">⚠ Senha incorreta!</div>

          <!-- Teclado Numérico Virtual para Facilitar -->
          <div class="virtual-numpad sec-numpad">
            <button type="button" class="btn-sec-num" data-val="1">1</button>
            <button type="button" class="btn-sec-num" data-val="2">2</button>
            <button type="button" class="btn-sec-num" data-val="3">3</button>
            <button type="button" class="btn-sec-num" data-val="4">4</button>
            <button type="button" class="btn-sec-num" data-val="5">5</button>
            <button type="button" class="btn-sec-num" data-val="6">6</button>
            <button type="button" class="btn-sec-num" data-val="7">7</button>
            <button type="button" class="btn-sec-num" data-val="8">8</button>
            <button type="button" class="btn-sec-num" data-val="9">9</button>
            <button type="button" class="btn-sec-num btn-numpad-action" data-val="clear">C</button>
            <button type="button" class="btn-sec-num" data-val="0">0</button>
            <button type="button" class="btn-sec-num btn-numpad-action" data-val="backspace">⌫</button>
          </div>

          <div class="modal-actions-stacked">
            <button type="submit" class="btn-danger-block" id="btn-sec-confirm">
              AUTORIZAR E APAGAR
            </button>
            <button type="button" class="btn-secondary" id="btn-sec-cancel">
              CANCELAR
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const pinField = document.getElementById('security-pin-input');
  const errorMsg = document.getElementById('sec-pin-error');
  const form = document.getElementById('form-sec-pin');

  if (pinField) {
    pinField.value = '';
    setTimeout(() => pinField.focus(), 100);
  }

  // Teclado virtual
  modal.querySelectorAll('.btn-sec-num').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (pinField) {
        if (val === 'clear') {
          pinField.value = '';
        } else if (val === 'backspace') {
          pinField.value = pinField.value.slice(0, -1);
        } else if (pinField.value.length < 4) {
          pinField.value += val;
        }
      }
    });
  });

  const closeModal = () => modal.classList.remove('open');
  document.getElementById('security-pin-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-sec-cancel')?.addEventListener('click', closeModal);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = pinField ? pinField.value.trim() : '';
    if (entered === '2002') {
      modal.classList.remove('open');
      if (typeof onConfirmed === 'function') {
        onConfirmed();
      }
    } else {
      if (errorMsg) {
        errorMsg.textContent = '⚠ Senha incorreta! Acesso negado.';
        errorMsg.classList.remove('hidden');
      }
      triggerHaptic(50);
      if (pinField) {
        pinField.value = '';
        pinField.focus();
      }
    }
  });
}

// Modal de Confirmação com Código de Barras para Envio para Triagem
export function promptTriageBarcodeConfirmation({ product, expiration, onConfirmed }) {
  let modal = document.getElementById('triage-barcode-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'triage-barcode-modal';
    modal.className = 'custom-modal';
    document.body.appendChild(modal);
  }

  const expDateBR = expiration && expiration.expiration_date ? expiration.expiration_date : '';
  const expectedBarcode = (product.barcode || '').trim();

  modal.innerHTML = `
    <div class="modal-backdrop" id="triage-barcode-backdrop"></div>
    <div class="modal-card">
      <div class="modal-header-triage">
        <span class="triage-header-icon">📦</span>
        <div style="flex: 1;">
          <h3 class="modal-title">Confirmar Envio para Triagem</h3>
          <p class="modal-subtitle">Retirada de Lote da Área de Venda</p>
        </div>
        <button type="button" id="btn-triage-modal-close-x" class="btn-icon-control" style="font-size: 1rem; width: 32px; height: 32px;">✕</button>
      </div>

      <div class="triage-modal-body">
        <!-- Card Resumo do Produto Selecionado -->
        <div class="triage-target-product-card">
          <div class="triage-prod-thumb-box">
            ${
              product.image
                ? `<img src="${product.image}" alt="${product.name}" class="triage-prod-thumb" />`
                : `<span class="triage-no-thumb">FOTO</span>`
            }
          </div>
          <div class="triage-prod-info">
            <h4 class="triage-prod-name">${product.name}</h4>
            <div class="triage-prod-meta">
              <span class="loc-badge sector">${product.sector || 'MERCEARIA'}</span>
              <span class="loc-badge corridor">${product.corridor || 'CORREDOR 01'}</span>
            </div>
            ${
              expDateBR
                ? `<div class="triage-exp-date-pill">📅 Lote Vencimento: <strong>${expDateBR}</strong></div>`
                : ''
            }
          </div>
        </div>

        <div class="triage-info-box">
          <p class="triage-instruction-text">
            ⚠️ Aponte a câmera para o código de barras ou digite/bipe para confirmar a retirada do lote:
          </p>
        </div>

        <!-- Opção 1: Leitor de Câmera Integrado -->
        <div class="triage-camera-section">
          <button type="button" id="btn-triage-open-camera" class="btn-triage-cam-toggle">
            <span class="btn-cam-icon">📷</span>
            <span id="triage-cam-toggle-text">LER CÓDIGO COM A CÂMERA</span>
          </button>

          <!-- Viewport da Câmera no Modal (Oculto inicialmente) -->
          <div id="triage-camera-wrapper" class="triage-camera-wrapper hidden">
            <div class="triage-camera-top-toolbar">
              <button type="button" id="btn-triage-cam-zoom" class="btn-icon-control mini" title="Zoom">1x</button>
              <button type="button" id="btn-triage-cam-torch" class="btn-icon-control mini" title="Lanterna">⚡</button>
              <button type="button" id="btn-triage-cam-switch" class="btn-icon-control mini" title="Alternar Câmera">🔄</button>
              <button type="button" id="btn-triage-cam-close" class="btn-icon-control mini" title="Fechar Câmera">✕</button>
            </div>
            <div class="triage-scanner-viewport">
              <div id="triage-scanner-box" class="triage-scanner-box"></div>
              <div class="scanner-overlay" style="pointer-events: none;">
                <div class="scanner-target-box" style="max-width: 260px; max-height: 110px;">
                  <div class="scanner-laser-line"></div>
                  <span class="target-corner top-left"></span>
                  <span class="target-corner top-right"></span>
                  <span class="target-corner bottom-left"></span>
                  <span class="target-corner bottom-right"></span>
                </div>
                <p class="scanner-instruction-text" style="font-size: 0.72rem;">Enquadre o código de barras</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Opção 2: Entrada Manual / Leitor Físico -->
        <form id="form-triage-barcode" autocomplete="off">
          <div class="form-group" style="margin-bottom: 8px;">
            <label for="triage-barcode-input" style="font-size: 0.78rem; font-weight: 700; color: #a1a1aa; display: block; margin-bottom: 4px;">
              Ou digite o código de barras:
            </label>
            <input
              type="text"
              id="triage-barcode-input"
              class="form-input"
              placeholder="Digite ou bipe o código..."
              autocomplete="off"
              inputmode="numeric"
              required
              style="font-family: monospace; font-size: 1.15rem; font-weight: 800; text-align: center; color: #eab308; letter-spacing: 1px;"
            />
          </div>

          <div id="triage-barcode-error" class="login-error-text hidden" style="margin-bottom: 10px; font-size: 0.82rem; line-height: 1.4; color: #ef4444; background: rgba(239, 68, 68, 0.12); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.3);"></div>

          <div class="modal-actions-stacked">
            <button type="submit" class="btn-primary" id="btn-triage-barcode-confirm" style="height: 46px; background: #eab308; color: #000; font-weight: 800;">
              📦 CONFIRMAR E ENVIAR PARA TRIAGEM
            </button>
            <button type="button" class="btn-secondary" id="btn-triage-barcode-cancel" style="height: 42px;">
              CANCELAR
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  modal.classList.add('open');

  const barcodeInput = document.getElementById('triage-barcode-input');
  const errorMsg = document.getElementById('triage-barcode-error');
  const form = document.getElementById('form-triage-barcode');
  const btnOpenCamera = document.getElementById('btn-triage-open-camera');
  const cameraWrapper = document.getElementById('triage-camera-wrapper');
  const btnCloseCam = document.getElementById('btn-triage-cam-close');
  const btnTorchCam = document.getElementById('btn-triage-cam-torch');
  const btnSwitchCam = document.getElementById('btn-triage-cam-switch');
  const btnZoomCam = document.getElementById('btn-triage-cam-zoom');

  let isCameraActive = false;
  let isTorchOn = false;

  const stopActiveCamera = async () => {
    if (isCameraActive) {
      isCameraActive = false;
      await stopCameraScanner();
      if (cameraWrapper) cameraWrapper.classList.add('hidden');
      if (btnOpenCamera) {
        btnOpenCamera.classList.remove('active');
        btnOpenCamera.innerHTML = '<span class="btn-cam-icon">📷</span><span>LER CÓDIGO COM A CÂMERA</span>';
      }
    }
  };

  const closeModal = async () => {
    await stopActiveCamera();
    modal.classList.remove('open');
  };

  document.getElementById('triage-barcode-backdrop')?.addEventListener('click', closeModal);
  document.getElementById('btn-triage-barcode-cancel')?.addEventListener('click', closeModal);
  document.getElementById('btn-triage-modal-close-x')?.addEventListener('click', closeModal);

  if (barcodeInput) {
    barcodeInput.value = '';
    setTimeout(() => barcodeInput.focus(), 150);
  }

  // Validador central de código (usado pela câmera e pelo formulário)
  const validateAndConfirmCode = async (entered) => {
    const cleanEntered = (entered || '').trim();
    if (!cleanEntered) {
      if (errorMsg) {
        errorMsg.textContent = '⚠ Digite ou aponte a câmera para o código de barras do produto.';
        errorMsg.classList.remove('hidden');
      }
      return;
    }

    if (cleanEntered.toLowerCase() === expectedBarcode.toLowerCase()) {
      await stopActiveCamera();
      modal.classList.remove('open');
      triggerHaptic(60);
      playBeep('success');
      if (typeof onConfirmed === 'function') {
        onConfirmed();
      }
    } else {
      triggerHaptic(120);
      playBeep('warning');
      if (errorMsg) {
        errorMsg.innerHTML = `❌ <strong>Código incorreto!</strong><br>O código lido (<code>${cleanEntered}</code>) não corresponde ao produto selecionado (<strong>${product.name}</strong>).`;
        errorMsg.classList.remove('hidden');
      }
      if (barcodeInput) {
        barcodeInput.value = cleanEntered;
        barcodeInput.focus();
      }
    }
  };

  // Câmera no Modal
  btnOpenCamera?.addEventListener('click', async () => {
    if (isCameraActive) {
      await stopActiveCamera();
      return;
    }

    if (errorMsg) errorMsg.classList.add('hidden');
    cameraWrapper.classList.remove('hidden');
    btnOpenCamera.classList.add('active');
    btnOpenCamera.innerHTML = '<span class="btn-cam-icon">⏹</span><span>FECHAR CÂMERA</span>';
    isCameraActive = true;

    try {
      const res = await startCameraScanner('triage-scanner-box', (scannedCode) => {
        validateAndConfirmCode(scannedCode);
      });

      if (!res.success && res.error) {
        showToast(res.error, 'warning', 4000);
        await stopActiveCamera();
      }
    } catch (camErr) {
      console.warn('Erro ao abrir câmera na triagem:', camErr);
      showToast('Câmera indisponível. Digite o código manualmente.', 'warning');
      await stopActiveCamera();
    }
  });

  btnCloseCam?.addEventListener('click', stopActiveCamera);

  btnTorchCam?.addEventListener('click', async () => {
    isTorchOn = !isTorchOn;
    await toggleTorch(isTorchOn);
    if (btnTorchCam) {
      btnTorchCam.style.background = isTorchOn ? '#eab308' : '#27272a';
      btnTorchCam.style.color = isTorchOn ? '#000' : '#f4f4f5';
    }
  });

  btnSwitchCam?.addEventListener('click', async () => {
    await switchCamera('triage-scanner-box', (scannedCode) => {
      validateAndConfirmCode(scannedCode);
    });
  });

  btnZoomCam?.addEventListener('click', async () => {
    const newZoom = await toggleCameraZoom();
    if (btnZoomCam) {
      btnZoomCam.textContent = `${newZoom.toFixed(1).replace('.0', '')}x`;
    }
  });

  // Submissão manual
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const entered = barcodeInput ? barcodeInput.value.trim() : '';
    validateAndConfirmCode(entered);
  });
}

