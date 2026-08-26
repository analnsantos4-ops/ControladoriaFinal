// Módulo de Leitura e Scanner de Código de Barras Universal (Html5Qrcode + BarcodeDetector + ZXing)
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { BrowserMultiFormatReader } from '@zxing/library';
import { triggerHaptic, playBeep } from './utils.js';

let html5QrCode = null;
let isScanning = false;
let currentCameraFacing = 'environment'; // 'environment' = traseira, 'user' = frontal
let activeTorchState = false;
let fallbackStream = null;
let fallbackAnimationId = null;

// Formatos suportados para leitura ágil de produtos de varejo
const SUPPORTED_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.QR_CODE
];

/**
 * Inicia o scanner de código de barras na câmera
 * @param {HTMLElement|string} containerElementOrId 
 * @param {Function} onDetectedCallback 
 */
export async function startCameraScanner(containerElementOrId, onDetectedCallback) {
  await stopCameraScanner();
  isScanning = true;
  activeTorchState = false;

  const containerId = typeof containerElementOrId === 'string'
    ? containerElementOrId
    : (containerElementOrId?.id || 'scanner-reader-box');

  // Garante que o elemento container exista no DOM
  let containerEl = document.getElementById(containerId);
  if (!containerEl) {
    containerEl = document.getElementById('scanner-reader-box');
  }

  if (containerEl) {
    containerEl.innerHTML = '';
  }

  // 1. TENTA PRIMEIRO VIA HTML5-QRCODE (Nativo + WebCam + AutoFocus)
  try {
    html5QrCode = new Html5Qrcode(containerId, {
      formatsToSupport: SUPPORTED_FORMATS,
      verbose: false,
      useBarCodeDetectorIfSupported: true
    });

    const cameraConfig = { facingMode: currentCameraFacing };
    const scanConfig = {
      fps: 20,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        // Caixa de leitura proporcional para códigos de barra 1D
        const width = Math.min(Math.floor(viewfinderWidth * 0.88), 340);
        const height = Math.min(Math.floor(viewfinderHeight * 0.46), 180);
        return { width: Math.max(width, 220), height: Math.max(height, 120) };
      },
      aspectRatio: undefined,
      disableFlip: false
    };

    await html5QrCode.start(
      cameraConfig,
      scanConfig,
      (decodedText) => {
        if (isScanning && decodedText) {
          handleCodeDetected(decodedText, onDetectedCallback);
        }
      },
      () => {
        // Frame sem código detectado (normal)
      }
    );

    return { success: true };
  } catch (html5Error) {
    console.warn('Html5Qrcode start failed, attempting fallback stream scanner:', html5Error);
  }

  // 2. FALLBACK DIRETO VIA GETUSERMEDIA + ZXING / NATIVE BARCODE DETECTOR
  try {
    const videoEl = document.getElementById('scanner-video');
    if (!videoEl && containerEl) {
      containerEl.innerHTML = '<video id="scanner-video" playsinline autoplay muted style="width: 100%; height: 100%; object-fit: cover;"></video>';
    }
    const targetVideo = document.getElementById('scanner-video');

    if (!targetVideo) {
      throw new Error('Elemento de vídeo não encontrado para o scanner.');
    }

    const constraints = {
      video: {
        facingMode: { ideal: currentCameraFacing },
        width: { min: 640, ideal: 1280 },
        height: { min: 480, ideal: 720 }
      },
      audio: false
    };

    fallbackStream = await navigator.mediaDevices.getUserMedia(constraints);
    targetVideo.srcObject = fallbackStream;
    targetVideo.setAttribute('playsinline', 'true');
    await targetVideo.play();

    // Cria leitor ZXing e detector nativo se disponível
    const zxingReader = new BrowserMultiFormatReader();
    let nativeDetector = null;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        nativeDetector = new window.BarcodeDetector({
          formats: formats.length > 0 ? formats : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
        });
      } catch (_) {}
    }

    const offCanvas = document.createElement('canvas');
    const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

    let isBusy = false;
    const processFrame = async () => {
      if (!isScanning || !targetVideo || targetVideo.readyState < 2) {
        if (isScanning) {
          fallbackAnimationId = requestAnimationFrame(processFrame);
        }
        return;
      }

      if (!isBusy) {
        isBusy = true;
        let detected = null;

        // Detector nativo rápido
        if (nativeDetector) {
          try {
            const results = await nativeDetector.detect(targetVideo);
            if (results && results.length > 0 && results[0].rawValue) {
              detected = results[0].rawValue.trim();
            }
          } catch (_) {}
        }

        // ZXing Fallback
        if (!detected && zxingReader && offCtx) {
          try {
            const vw = targetVideo.videoWidth || 640;
            const vh = targetVideo.videoHeight || 480;
            if (offCanvas.width !== vw || offCanvas.height !== vh) {
              offCanvas.width = vw;
              offCanvas.height = vh;
            }
            offCtx.drawImage(targetVideo, 0, 0, vw, vh);
            const res = zxingReader.decodeFromImage(offCanvas);
            if (res && res.getText()) {
              detected = res.getText().trim();
            }
          } catch (_) {
            // ZXing lança exceção em frames sem código
          }
        }

        if (detected && isScanning) {
          handleCodeDetected(detected, onDetectedCallback);
          return;
        }

        isBusy = false;
      }

      if (isScanning) {
        fallbackAnimationId = requestAnimationFrame(processFrame);
      }
    };

    fallbackAnimationId = requestAnimationFrame(processFrame);
    return { success: true };
  } catch (finalError) {
    console.error('Erro final ao inicializar câmera do scanner:', finalError);
    isScanning = false;
    return {
      success: false,
      error: finalError.name === 'NotAllowedError'
        ? 'Permissão de câmera negada. Autorize o acesso nas configurações do navegador.'
        : 'Não foi possível acessar a câmera do dispositivo.'
    };
  }
}

/**
 * Para a execução do scanner e libera os recursos da câmera
 */
export async function stopCameraScanner() {
  isScanning = false;
  activeTorchState = false;

  if (fallbackAnimationId) {
    cancelAnimationFrame(fallbackAnimationId);
    fallbackAnimationId = null;
  }

  if (fallbackStream) {
    fallbackStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
    fallbackStream = null;
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

  if (fallbackStream) {
    const track = fallbackStream.getVideoTracks()[0];
    if (track && track.getCapabilities && track.getCapabilities().torch) {
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
  await stopCameraScanner();
  triggerHaptic(90);
  playBeep('success');
  if (typeof callback === 'function') {
    callback(barcode);
  }
}
