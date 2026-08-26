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
let zxingReaderInstance = null;

// Formatos suportados para leitura ágil de produtos de varejo (1D e 2D)
const ALL_BARCODE_FORMATS = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.UPC_EAN_EXTENSION,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.DATA_MATRIX
];

/**
 * Inicia o scanner de código de barras na câmera com resiliência multi-engine
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

  let containerEl = document.getElementById(containerId) || document.getElementById('scanner-reader-box');

  if (containerEl) {
    containerEl.innerHTML = '';
  }

  // Aguarda 60ms para garantir que o container DOM esteja visível e com dimensões calculadas
  await new Promise((r) => setTimeout(r, 60));

  if (!isScanning) return { success: false };

  // =========================================================================
  // MOTOR 1: Html5Qrcode (Autofocus + BarcodeDetector nativo + WebCam Stream)
  // =========================================================================
  try {
    html5QrCode = new Html5Qrcode(containerId, {
      formatsToSupport: ALL_BARCODE_FORMATS,
      verbose: false,
      useBarCodeDetectorIfSupported: true
    });

    const cameraConfig = { 
  facingMode: currentCameraFacing,
  // Adicionamos resolução ideal para melhorar o foco em códigos pequenos
  width: { ideal: 1280 },
  height: { ideal: 720 }
};
const scanConfig = {
  fps: 30, // Mais fotos por segundo para não perder o código em movimento
  qrbox: (viewfinderWidth, viewfinderHeight) => {
    // Deixamos a caixa mais larga e mais baixa (ideal para códigos de barras deitados)
    const width = Math.min(Math.floor(viewfinderWidth * 0.85), 450);
    const height = Math.min(Math.floor(viewfinderHeight * 0.35), 160);
    return { width: Math.max(width, 260), height: Math.max(height, 100) };
  },
  aspectRatio: 1.777778, // Força proporção 16:9 que ajuda a focar em latas e caixas
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
        // Frame sem código detectado (normal durante varredura)
      }
    );

    return { success: true };
  } catch (html5Error) {
    console.warn('Html5Qrcode primário não iniciou, usando fallback direto de câmera:', html5Error);
    if (html5QrCode) {
      try {
        html5QrCode.clear();
      } catch (_) {}
      html5QrCode = null;
    }
  }

  if (!isScanning) return { success: false };

  // =========================================================================
  // MOTOR 2: Fallback Direto via getUserMedia + BarcodeDetector Nativo / ZXing
  // =========================================================================
  try {
    if (!containerEl) {
      containerEl = document.getElementById('scanner-viewport-container');
    }
    if (!containerEl) {
      throw new Error('Container do scanner não disponível');
    }

    containerEl.innerHTML = `
      <video id="scanner-direct-video" playsinline autoplay muted style="width: 100%; height: 100%; object-fit: cover; display: block;"></video>
    `;

    const targetVideo = document.getElementById('scanner-direct-video');
    if (!targetVideo) {
      throw new Error('Elemento de vídeo não pôde ser criado.');
    }

    const constraints = {
      video: {
        facingMode: { ideal: currentCameraFacing },
        width: { min: 640, ideal: 1280 },
        height: { min: 480, ideal: 720 },
        focusMode: { ideal: 'continuous' }
      },
      audio: false
    };

    fallbackStream = await navigator.mediaDevices.getUserMedia(constraints);
    targetVideo.srcObject = fallbackStream;
    targetVideo.setAttribute('playsinline', 'true');
    targetVideo.setAttribute('autoplay', 'true');
    targetVideo.setAttribute('muted', 'true');
    await targetVideo.play();

    // 1. Detector nativo do navegador se presente
    let nativeDetector = null;
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        nativeDetector = new window.BarcodeDetector({
          formats: supported && supported.length > 0 ? supported : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
        });
      } catch (_) {}
    }

    // 2. ZXing Continuous MultiFormat Reader
    zxingReaderInstance = new BrowserMultiFormatReader();

    let isProcessing = false;
    const processDirectLoop = async () => {
      if (!isScanning || !targetVideo) return;

      if (targetVideo.readyState >= 2 && !isProcessing) {
        isProcessing = true;
        let foundCode = null;

        // Tenta BarcodeDetector nativo
        if (nativeDetector) {
          try {
            const barcodes = await nativeDetector.detect(targetVideo);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              foundCode = barcodes[0].rawValue.trim();
            }
          } catch (_) {}
        }

        if (foundCode && isScanning) {
          handleCodeDetected(foundCode, onDetectedCallback);
          return;
        }

        isProcessing = false;
      }

      if (isScanning) {
        fallbackAnimationId = requestAnimationFrame(processDirectLoop);
      }
    };

    fallbackAnimationId = requestAnimationFrame(processDirectLoop);

    // Conecta o ZXing para decodificar continuamente o elemento de vídeo
    try {
      zxingReaderInstance.decodeFromVideoElementContinuously(targetVideo, (result, err) => {
        if (result && isScanning) {
          const text = result.getText();
          if (text) {
            handleCodeDetected(text.trim(), onDetectedCallback);
          }
        }
      });
    } catch (_) {}

    return { success: true };
  } catch (finalError) {
    console.error('Erro ao iniciar câmera no scanner:', finalError);
    isScanning = false;
    return {
      success: false,
      error: finalError.name === 'NotAllowedError'
        ? 'Permissão da câmera foi negada. Permita o acesso à câmera nas configurações do navegador.'
        : 'Câmera não disponível no momento. Digite o código de barras abaixo.'
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

  if (zxingReaderInstance) {
    try {
      zxingReaderInstance.reset();
      zxingReaderInstance.stopContinuousDecode();
    } catch (_) {}
    zxingReaderInstance = null;
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
  if (!isScanning) return;
  isScanning = false;
  await stopCameraScanner();
  triggerHaptic(90);
  playBeep('success');
  if (typeof callback === 'function') {
    callback(barcode);
  }
}

