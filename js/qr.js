/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – QR Code (Generation + Scanning)
   ═══════════════════════════════════════════════════════════ */

const QR = (() => {
  let qrCodeInstance = null;
  let scannerInstance = null;
  let onScanCallback = null;

  /**
   * Generate a QR code for a member profile.
   * Encodes a URL like: https://yourapp.com/#connect/MEMBER_ID
   */
  function generate(containerId, memberId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    // Build the connection URL
    const baseUrl = window.location.origin + window.location.pathname;
    const url = `${baseUrl}#connect/${memberId}`;

    qrCodeInstance = new QRCode(container, {
      text: url,
      width: 220,
      height: 220,
      colorDark: '#1a1a1a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  /**
   * Start the QR scanner.
   */
  async function startScanner(containerId, onSuccess) {
    onScanCallback = onSuccess;

    const container = document.getElementById(containerId);
    container.innerHTML = '';

    scannerInstance = new Html5Qrcode(containerId);

    try {
      await scannerInstance.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          // Successfully scanned
          handleScan(decodedText);
        },
        (errorMessage) => {
          // Scan error (ignore, keep scanning)
        }
      );
    } catch (err) {
      console.error('QR Scanner error:', err);
      container.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #6b7280;">
          <p>Kamera-Zugriff nicht möglich.</p>
          <p style="font-size: 12px; margin-top: 8px;">
            Bitte erlaube den Kamera-Zugriff in deinen Browser-Einstellungen.
          </p>
        </div>
      `;
    }
  }

  /**
   * Stop the scanner.
   */
  async function stopScanner() {
    if (scannerInstance) {
      try {
        const state = scannerInstance.getState();
        // State 2 = SCANNING
        if (state === 2) {
          await scannerInstance.stop();
        }
      } catch (err) {
        // Ignore stop errors
      }
      scannerInstance = null;
    }
  }

  /**
   * Handle a scanned QR code.
   */
  function handleScan(decodedText) {
    // Stop scanning after first successful read
    stopScanner();

    // Extract member ID from URL
    // Expected format: https://.../#connect/MEMBER_ID
    const match = decodedText.match(/#connect\/([a-zA-Z0-9-]+)/);
    if (match && match[1]) {
      const memberId = match[1];
      if (onScanCallback) {
        onScanCallback(memberId);
      }
    } else {
      // Maybe it's just a plain member ID (UUID format)
      const trimmed = decodedText.trim();
      if (/^[a-f0-9-]{36}$/i.test(trimmed)) {
        if (onScanCallback) {
          onScanCallback(trimmed);
        }
      } else {
        App.toast('Ungültiger QR-Code', 'error');
      }
    }
  }

  return {
    generate,
    startScanner,
    stopScanner,
  };
})();
