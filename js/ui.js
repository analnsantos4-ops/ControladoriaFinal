// Gerenciador de Interface, Telas, Modais e Toasts
import { playBeep, triggerHaptic } from './utils.js';

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

// Modal de Confirmação com Senha de Segurança (2009)
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

