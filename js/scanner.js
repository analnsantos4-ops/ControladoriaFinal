// Módulo de Leitura e Scanner de Código de Barras de Alta Precisão e Confiabilidade
// Especializado em produtos de varejo (EAN-13, EAN-8 Coca-Cola, UPC, Code 128)
import Quagga from '@ericblade/quagga2';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { BrowserMultiFormatReader } from '@zxing/library';
import { triggerHaptic, playBeep } from './utils.js';
import { showToast } from './ui.js';

let isScanning = false;
let isQuaggaRunning = false;
let html5QrCode = null;
let currentCameraFacing = 'environment'; // 'environment' ou 'user'
let activeTorchState = false;
let currentZoomLevel = 1.0;
let onDetectedCallbackRef = null;

// Sistema de confirmação de leitura consistente (evita leituras aleatórias/ruído)
let lastCandidateCode = '';
let candidateMatchCount = 0;
let lastCandidateTime = 0;
const REQUIRED_CONSECUTIVE_MATCHES = 2; // Exige 2 quadros iguais consecutivos

// Leitores focados exclusivamente nos formatos reais de varejo (sem 2of5/code39 que geram falso-positivo)
const QUAGGA_READERS = [
  'ean_reader',       // EAN-13 (Padrão mundial de produtos)
  'ean_8_reader',     // EAN-8 (Coca-Cola, latas, pequenos itens)
  'upc_reader',       // UPC-A (12 dígitos)
  'upc_e_reader',     // UPC-E (6/8 dígitos)
  'code_128_reader'   // Code 128 (etiquetas de gôndola e caixas)
];

const HTML5_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.QR_CODE
];

/**
 * Validador de Checksum de Código de Barras (EAN-13, EAN-8, UPC-A)
 * Garante que qualquer leitura numérica seja 100% matemática e legítima
 */
export function isValidBarcodeChecksum(code) {
  if (!code || typeof code !== 'string') return false;
  const clean = code.trim();

  // Se não for puramente numérico (ex: Code 128 alfanumérico ou QR), aceita se tamanho razoável
  if (!/^\d+$/.test(clean)) {
    return clean.length >= 4;
  }

  // EAN-8, UPC-A (12), EAN-13, ITF-14
  if (clean.length === 8 || clean.length === 12 || clean.length === 13 || clean.length === 14) {
    const digits = clean.split('').map(Number);
    const checkDigit = digits.pop();
    
    // Algoritmo Modulo 10 ponderado da direita para esquerda
    const reversed = digits.reverse();
    let sum = 0;
    for (let i = 0; i < reversed.length; i++) {
      sum += (i % 2 === 0) ? reversed[i] * 3 : reversed[i];
    }
    const calculatedCheck = (10 - (sum % 10)) % 10;
    return calculatedCheck === checkDigit;
  }

  // Outros formatos numéricos (ex: UPC-E de 6 dígitos)
  return clean.length >= 6;
}

/**
 * Filtro de consistência: exige confirmação entre quadros para evitar leituras fantasmas
 */
function verifyAndProcessCandidate(rawCode, onDetectedCallback) {
  if (!isScanning) return;
  if (!rawCode) return;

  const code = String(rawCode).trim();
  if (!isValidBarcodeChecksum(code)) {
    return; // Código inválido ou ruído descartado
  }

  const now = Date.now();

  if (code === lastCandidateCode && (now - lastCandidateTime < 600)) {
    candidateMatchCount++;
  } else {
    lastCandidateCode = code;
    candidateMatchCount = 1;
  }
  lastCandidateTime = now;

  // Se atingiu a quantidade necessária de confirmações consecutivas
  if (candidateMatchCount >= REQUIRED_CONSECUTIVE_MATCHES) {
    handleCodeDetected(code, onDetectedCallback);
  }
}

/**
 * Inicia o scanner de código de barras
 * @param {HTMLElement|string} containerElementOrId 
 * @param {Function} onDetectedCallback 
 */
export async function startCameraScanner(containerElementOrId, onDetectedCallback) {
  await stopCameraScanner();
  isScanning = true;
  activeTorchState = false;
  currentZoomLevel = 1.0;
  lastCandidateCode = '';
  candidateMatchCount = 0;
  lastCandidateTime = 0;
  onDetectedCallbackRef = onDetectedCallback;

  updateZoomButtonUI(1.0);

  // Aguarda 60ms para layout DOM estar pronto
  await new Promise((r) => setTimeout(r, 60));
  if (!isScanning) return { success: false };

  const containerId = typeof containerElementOrId === 'string'
    ? containerElementOrId
    : (containerElementOrId?.id || 'scanner-reader-box');

  const containerEl = document.getElementById(containerId) || document.getElementById('scanner-reader-box');
  if (containerEl) {
    containerEl.innerHTML = '';
  }

  // =========================================================================
  // MOTOR 1: Quagga2 com validação matemática e 2 quadros de confirmação
  // =========================================================================
  try {
    const quaggaSuccess = await startQuaggaScanner(containerEl, onDetectedCallback);
    if (quaggaSuccess) {
      return { success: true };
    }
  } catch (quaggaErr) {
    console.warn('[Scanner] Quagga2 falhou, iniciando Html5Qrcode:', quaggaErr);
  }

  if (!isScanning) return { success: false };

  // =========================================================================
  // MOTOR 2: Fallback Html5Qrcode
  // =========================================================================
  try {
    if (containerEl) {
      containerEl.innerHTML = '';
    }

    html5QrCode = new Html5Qrcode(containerId, {
      formatsToSupport: HTML5_FORMATS,
      verbose: false,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: true
      }
    });

    const cameraConfig = { facingMode: currentCameraFacing };
    const scanConfig = {
      fps: 20,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const width = Math.min(Math.floor(viewfinderWidth * 0.90), 450);
        const height = Math.min(Math.floor(viewfinderHeight * 0.55), 200);
        return { width: Math.max(width, 240), height: Math.max(height, 120) };
      },
      aspectRatio: 1.777778,
      disableFlip: false
    };

    await html5QrCode.start(
      cameraConfig,
      scanConfig,
      (decodedText) => {
        if (decodedText && isScanning) {
          verifyAndProcessCandidate(decodedText, onDetectedCallback);
        }
      },
      () => {}
    );

    return { success: true };
  } catch (html5Error) {
    console.error('[Scanner] Erro ao iniciar câmera:', html5Error);
    isScanning = false;
    return {
      success: false,
      error: html5Error.name === 'NotAllowedError'
        ? 'Permissão da câmera foi negada. Permita o acesso nas configurações do navegador.'
        : 'Câmera indisponível. Você pode digitar o código ou enviar uma foto.'
    };
  }
}

/**
 * Inicia o motor Quagga2 com filtragem de ruído
 */
function startQuaggaScanner(containerEl, onDetectedCallback) {
  return new Promise((resolve) => {
    try {
      Quagga.init({
        inputStream: {
          name: 'Live',
          type: 'LiveStream',
          target: containerEl,
          constraints: {
            facingMode: currentCameraFacing,
            width: { min: 640, ideal: 1280 },
            height: { min: 480, ideal: 720 },
            aspectRatio: { min: 1, max: 2 }
          },
          area: {
            top: '10%',
            right: '8%',
            left: '8%',
            bottom: '10%'
          }
        },
        locator: {
          patchSize: 'medium',
          halfSample: true
        },
        numOfWorkers: navigator.hardwareConcurrency ? Math.min(navigator.hardwareConcurrency, 4) : 2,
        frequency: 15,
        decoder: {
          readers: QUAGGA_READERS,
          multiple: false
        },
        locate: true
      }, (err) => {
        if (err) {
          console.warn('[Quagga] Erro no init:', err);
          isQuaggaRunning = false;
          resolve(false);
          return;
        }

        if (!isScanning) {
          try { Quagga.stop(); } catch (_) {}
          resolve(false);
          return;
        }

        try {
          Quagga.start();
          isQuaggaRunning = true;

          Quagga.onDetected((data) => {
            if (!isScanning) return;
            if (data && data.codeResult && data.codeResult.code) {
              // Verifica taxa de erro média do decodificador
              if (Array.isArray(data.codeResult.decodedCodes)) {
                const errors = data.codeResult.decodedCodes
                  .filter((x) => x && typeof x.error === 'number')
                  .map((x) => x.error);
                if (errors.length > 0) {
                  const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
                  if (avgError > 0.15) {
                    return; // Descarta leituras com alta margem de incerteza
                  }
                }
              }

              const code = String(data.codeResult.code).trim();
              verifyAndProcessCandidate(code, onDetectedCallback);
            }
          });

          resolve(true);
        } catch (startErr) {
          console.warn('[Quagga] Erro no start:', startErr);
          isQuaggaRunning = false;
          resolve(false);
        }
      });
    } catch (e) {
      console.warn('[Quagga] Exception:', e);
      resolve(false);
    }
  });
}

/**
 * Escaneia uma imagem/foto selecionada pelo usuário (Galeria ou Câmera)
 * @param {File|Blob} file 
 * @param {Function} onDetectedCallback 
 */
export async function scanBarcodeFromImageFile(file, onDetectedCallback) {
  if (!file) return false;

  showToast('Lendo código de barras da foto...', 'sync', 1500);
  const cb = onDetectedCallback || onDetectedCallbackRef;

  const fileUrl = URL.createObjectURL(file);

  // 1. Tenta decodificar com Quagga2 decodeSingle (especialista em códigos 1D)
  try {
    const quaggaResult = await new Promise((resolve) => {
      Quagga.decodeSingle({
        src: fileUrl,
        numOfWorkers: 0,
        decoder: {
          readers: QUAGGA_READERS
        },
        locate: true
      }, (res) => {
        if (res && res.codeResult && res.codeResult.code) {
          const c = String(res.codeResult.code).trim();
          if (isValidBarcodeChecksum(c)) {
            resolve(c);
            return;
          }
        }
        resolve(null);
      });
    });

    if (quaggaResult) {
      URL.revokeObjectURL(fileUrl);
      handleCodeDetected(quaggaResult, cb);
      return true;
    }
  } catch (_) {}

  // 2. Tenta com ZXing
  try {
    const zxing = new BrowserMultiFormatReader();
    const result = await zxing.decodeFromImageUrl(fileUrl);
    if (result && result.getText()) {
      const c = result.getText().trim();
      if (isValidBarcodeChecksum(c)) {
        URL.revokeObjectURL(fileUrl);
        handleCodeDetected(c, cb);
        return true;
      }
    }
  } catch (_) {}

  URL.revokeObjectURL(fileUrl);

  // 3. Tenta com Html5Qrcode scanFile
  try {
    const tempScanner = new Html5Qrcode('scanner-reader-box', {
      formatsToSupport: HTML5_FORMATS,
      verbose: false
    });
    const text = await tempScanner.scanFile(file, false);
    if (text) {
      const c = text.trim();
      if (isValidBarcodeChecksum(c)) {
        handleCodeDetected(c, cb);
        return true;
      }
    }
  } catch (_) {}

  showToast('Nenhum código de barras válido identificado. Tente aproximar ou digitar.', 'warning', 3500);
  return false;
}

/**
 * Para a execução do scanner e libera os recursos da câmera
 */
export async function stopCameraScanner() {
  isScanning = false;
  activeTorchState = false;
  lastCandidateCode = '';
  candidateMatchCount = 0;

  if (isQuaggaRunning) {
    try {
      Quagga.offDetected();
      Quagga.stop();
    } catch (_) {}
    isQuaggaRunning = false;
  }

  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
      html5QrCode.clear();
    } catch (_) {}
    html5QrCode = null;
  }

  const containerEl = document.getElementById('scanner-reader-box');
  if (containerEl) {
    containerEl.innerHTML = '';
  }
}

/**
 * Alterna a lanterna do aparelho (torch)
 * @param {boolean} turnOn 
 */
export async function toggleTorch(turnOn) {
  activeTorchState = turnOn;

  if (html5QrCode && html5QrCode.isScanning) {
    try {
      await html5QrCode.applyVideoConstraints({
        advanced: [{ torch: turnOn }]
      });
      return true;
    } catch (_) {}
  }

  const video = document.querySelector('#scanner-reader-box video');
  if (video && video.srcObject) {
    const track = video.srcObject.getVideoTracks()[0];
    if (track && typeof track.applyConstraints === 'function') {
      try {
        await track.applyConstraints({
          advanced: [{ torch: turnOn }]
        });
        return true;
      } catch (_) {}
    }
  }

  return false;
}

/**
 * Alterna o Zoom da Câmera (1x -> 2x -> 1x)
 */
export async function toggleCameraZoom() {
  const targetZoom = currentZoomLevel >= 1.9 ? 1.0 : 2.0;

  const vid = document.querySelector('#scanner-reader-box video');
  if (vid) {
    vid.style.transform = targetZoom > 1 ? `scale(${targetZoom})` : 'none';
    vid.style.transformOrigin = 'center center';
    currentZoomLevel = targetZoom;
    updateZoomButtonUI(currentZoomLevel, true);
    return currentZoomLevel;
  }

  return 1.0;
}

function updateZoomButtonUI(zoomLevel) {
  const btnZoom = document.getElementById('btn-scanner-zoom');
  if (btnZoom) {
    btnZoom.textContent = `${zoomLevel.toFixed(1).replace('.0', '')}x`;
    btnZoom.title = `Zoom: ${zoomLevel}x`;
    btnZoom.style.opacity = '1';
  }
}

/**
 * Alterna entre a câmera traseira e a câmera frontal
 * @param {HTMLElement|string} containerElementOrId 
 * @param {Function} onDetectedCallback 
 */
export async function switchCamera(containerElementOrId, onDetectedCallback) {
  currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
  return startCameraScanner(containerElementOrId, onDetectedCallback);
}

/**
 * Trata o código de barras detectado com feedback tátil e sonoro
 * @param {string} barcode 
 * @param {Function} callback 
 */
async function handleCodeDetected(barcode, callback) {
  if (!isScanning) return;
  isScanning = false;
  await stopCameraScanner();
  triggerHaptic(90);
  playBeep('success');
  if (typeof callback === 'function') {
    callback(barcode);
  }
}




