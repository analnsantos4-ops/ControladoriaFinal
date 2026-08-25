// Módulo de Leitura e Scanner de Código de Barras
import { triggerHaptic, playBeep } from './utils.js';

let videoStream = null;
let scanAnimationId = null;
let barcodeDetector = null;
let isScanning = false;
let currentCameraFacing = 'environment'; // environment = traseira

// Inicializa o detector nativo de código de barras se suportado
async function getDetector() {
  if (barcodeDetector) return barcodeDetector;
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      barcodeDetector = new window.BarcodeDetector({
        formats: formats.length > 0 ? formats : ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
      });
      return barcodeDetector;
    } catch (e) {
      console.warn('BarcodeDetector format check warning:', e);
      barcodeDetector = new window.BarcodeDetector();
      return barcodeDetector;
    }
  }
  return null;
}

export async function startCameraScanner(videoElement, onDetectedCallback) {
  stopCameraScanner();
  isScanning = true;

  try {
    const constraints = {
      video: {
        facingMode: { ideal: currentCameraFacing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        focusMode: { ideal: 'continuous' }
      },
      audio: false
    };

    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    videoElement.srcObject = videoStream;
    await videoElement.play();

    const detector = await getDetector();

    const scanFrame = async () => {
      if (!isScanning || !videoElement || videoElement.readyState < 2) {
        if (isScanning) {
          scanAnimationId = requestAnimationFrame(scanFrame);
        }
        return;
      }

      if (detector) {
        try {
          const barcodes = await detector.detect(videoElement);
          if (barcodes && barcodes.length > 0) {
            const detectedCode = barcodes[0].rawValue;
            if (detectedCode && detectedCode.trim().length > 0) {
              handleCodeDetected(detectedCode.trim(), onDetectedCallback);
              return;
            }
          }
        } catch (err) {
          // Frame skip
        }
      }

      scanAnimationId = requestAnimationFrame(scanFrame);
    };

    scanAnimationId = requestAnimationFrame(scanFrame);
    return { success: true };
  } catch (error) {
    console.error('Erro ao acessar câmera:', error);
    return {
      success: false,
      error: error.name === 'NotAllowedError' ? 'Permissão de câmera negada' : 'Não foi possível acessar a câmera traseira'
    };
  }
}

export function stopCameraScanner() {
  isScanning = false;
  if (scanAnimationId) {
    cancelAnimationFrame(scanAnimationId);
    scanAnimationId = null;
  }
  if (videoStream) {
    videoStream.getTracks().forEach((track) => track.stop());
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
