// Módulo de Leitura e Scanner de Código de Barras Universal (ZXing + BarcodeDetector)
import { BrowserMultiFormatReader, DecodeHintType, BarcodeFormat } from '@zxing/library';
import { triggerHaptic, playBeep } from './utils.js';

let videoStream = null;
let scanAnimationId = null;
let zxingReader = null;
let nativeDetector = null;
let isScanning = false;
let isBusyProcessingFrame = false;
let currentCameraFacing = 'environment'; // environment = traseira

// Configura formatos suportados
const hints = new Map();
hints.set(DecodeHintType.POSSIBLE_FORMATS, [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE
]);
hints.set(DecodeHintType.TRY_HARDER, true);

// Obter leitor ZXing singleton
function getZXingReader() {
  if (!zxingReader) {
    zxingReader = new BrowserMultiFormatReader(hints);
  }
  return zxingReader;
}

// Obter detector nativo se disponível no navegador
async function getNativeDetector() {
  if (nativeDetector) return nativeDetector;
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      nativeDetector = new window.BarcodeDetector({
        formats: supported.length > 0 ? supported : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
      });
      return nativeDetector;
    } catch (e) {
      console.warn('Falha ao inicializar BarcodeDetector nativo:', e);
    }
  }
  return null;
}

// Canvas auxiliar para captura rápida de frames
let offscreenCanvas = null;
let offscreenCtx = null;

function getCanvas(width, height) {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (offscreenCanvas.width !== width || offscreenCanvas.height !== height) {
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
  }
  return { canvas: offscreenCanvas, ctx: offscreenCtx };
}

export async function startCameraScanner(videoElement, onDetectedCallback) {
  stopCameraScanner();
  isScanning = true;
  isBusyProcessingFrame = false;

  try {
    const constraints = {
      video: {
        facingMode: { ideal: currentCameraFacing },
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 }
      },
      audio: false
    };

    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = videoStream;
    videoElement.setAttribute('playsinline', 'true');
    await videoElement.play();

    const detector = await getNativeDetector();
    const reader = getZXingReader();

    const scanFrame = async () => {
      if (!isScanning || !videoElement || videoElement.readyState < 2) {
        if (isScanning) {
          scanAnimationId = requestAnimationFrame(scanFrame);
        }
        return;
      }

      if (!isBusyProcessingFrame) {
        isBusyProcessingFrame = true;
        let detectedBarcode = null;

        // 1. Tenta detecção nativa ultrarrápida (Android / Chrome)
        if (detector) {
          try {
            const barcodes = await detector.detect(videoElement);
            if (barcodes && barcodes.length > 0 && barcodes[0].rawValue) {
              detectedBarcode = barcodes[0].rawValue.trim();
            }
          } catch (_) {}
        }

        // 2. Se a nativa não detectou ou não existe (ex: iPhone/Safari), usa ZXing
        if (!detectedBarcode && reader) {
          try {
            const vw = videoElement.videoWidth || 640;
            const vh = videoElement.videoHeight || 480;
            const { canvas, ctx } = getCanvas(vw, vh);
            
            if (ctx) {
              ctx.drawImage(videoElement, 0, 0, vw, vh);
              const result = reader.decodeFromCanvas(canvas);
              if (result && result.getText()) {
                detectedBarcode = result.getText().trim();
              }
            }
          } catch (_) {
            // ZXing lança exceção quando não encontra código no frame (comportamento normal)
          }
        }

        if (detectedBarcode && isScanning) {
          handleCodeDetected(detectedBarcode, onDetectedCallback);
          return;
        }

        isBusyProcessingFrame = false;
      }

      if (isScanning) {
        scanAnimationId = requestAnimationFrame(scanFrame);
      }
    };

    scanAnimationId = requestAnimationFrame(scanFrame);
    return { success: true };
  } catch (error) {
    console.error('Erro ao acessar câmera:', error);
    isScanning = false;
    return {
      success: false,
      error: error.name === 'NotAllowedError'
        ? 'Permissão de câmera negada. Autorize o acesso à câmera nas configurações do navegador.'
        : 'Não foi possível acessar a câmera do dispositivo.'
    };
  }
}

export function stopCameraScanner() {
  isScanning = false;
  isBusyProcessingFrame = false;
  if (scanAnimationId) {
    cancelAnimationFrame(scanAnimationId);
    scanAnimationId = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
    videoStream = null;
  }
}

export async function toggleTorch(turnOn) {
  if (!videoStream) return false;
  const track = videoStream.getVideoTracks()[0];
  if (track && track.getCapabilities && track.getCapabilities().torch) {
    try {
      await track.applyConstraints({
        advanced: [{ torch: turnOn }]
      });
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
}

export function switchCamera(videoElement, onDetectedCallback) {
  currentCameraFacing = currentCameraFacing === 'environment' ? 'user' : 'environment';
  return startCameraScanner(videoElement, onDetectedCallback);
}

function handleCodeDetected(barcode, callback) {
  stopCameraScanner();
  triggerHaptic(80);
  playBeep('success');
  if (typeof callback === 'function') {
    callback(barcode);
  }
}
