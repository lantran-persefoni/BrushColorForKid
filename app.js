// ===== Brush Color for Kids - Main App =====

(function () {
  'use strict';

  // ---- Constants ----
  const MAX_IMAGE_SIZE = 1024;
  const FILL_TOLERANCE = 60;       // how different a pixel can be from target and still get filled
  const BLACK_THRESHOLD = 80;      // pixels darker than this are treated as black outline
  const MAX_UNDO_STATES = 15;

  // ---- DOM refs ----
  const screenSelect = document.getElementById('screen-select');
  const screenCanvas = document.getElementById('screen-canvas');
  const canvasContainer = document.getElementById('canvas-container');
  const canvas = document.getElementById('coloring-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const fileInput = document.getElementById('file-input');
  const workingIndicator = document.getElementById('working-indicator');

  // Toolbar
  const paletteRow = document.getElementById('palette-row');
  const btnEraser = document.getElementById('btn-eraser');
  const btnUndo = document.getElementById('btn-undo');
  const btnSave = document.getElementById('btn-save');
  const btnReset = document.getElementById('btn-reset');
  const btnClose = document.getElementById('btn-close');
  const customColorInput = document.getElementById('custom-color');

  // Modals
  const saveModal = document.getElementById('save-modal');
  const savePreview = document.getElementById('save-preview');
  const saveModalClose = document.getElementById('save-modal-close');
  const resetModal = document.getElementById('reset-modal');
  const resetCancel = document.getElementById('reset-cancel');
  const resetConfirm = document.getElementById('reset-confirm');

  // ---- State ----
  let currentColor = '#FF6B6B';
  let isEraser = false;
  let originalImageData = null;   // untouched copy for reset
  let undoStack = [];
  let imageWidth = 0;
  let imageHeight = 0;

  // ---- Screen navigation ----
  function showScreen(screen) {
    screenSelect.classList.remove('active');
    screenCanvas.classList.remove('active');
    screen.classList.add('active');
  }

  // ---- Image loading ----
  function loadImage(src) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      // Show the canvas screen FIRST so the container has real dimensions
      showScreen(screenCanvas);
      // Use rAF to ensure layout has been computed after screen switch
      requestAnimationFrame(function () {
        setupCanvas(img);
      });
    };
    img.onerror = function () {
      alert('Could not load image. Please try another.');
    };
    img.src = src;
  }

  function loadFileImage(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      loadImage(e.target.result);
    };
    reader.readAsDataURL(file);
  }

  function setupCanvas(img) {
    // Scale image to fit MAX_IMAGE_SIZE
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    const longest = Math.max(w, h);
    if (longest > MAX_IMAGE_SIZE) {
      const scale = MAX_IMAGE_SIZE / longest;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    imageWidth = w;
    imageHeight = h;

    // Handle devicePixelRatio for sharp rendering
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    // Set initial CSS size to the logical size
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    // Apply DPR transform so drawing commands use logical coordinates
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Draw image onto canvas
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // Store original state (full-resolution pixel data)
    originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoStack = [];

    // Now fit the canvas CSS size to the visible container
    fitCanvasInContainer();
  }

  function fitCanvasInContainer() {
    const containerW = canvasContainer.clientWidth;
    const containerH = canvasContainer.clientHeight;

    // Guard: if container isn't visible yet, skip (resize handler will fix later)
    if (containerW === 0 || containerH === 0 || imageWidth === 0 || imageHeight === 0) return;

    const scaleX = containerW / imageWidth;
    const scaleY = containerH / imageHeight;
    const scale = Math.min(scaleX, scaleY);

    canvas.style.width = Math.round(imageWidth * scale) + 'px';
    canvas.style.height = Math.round(imageHeight * scale) + 'px';
  }

  // ---- Color palette ----
  function selectColor(hex) {
    currentColor = hex;
    isEraser = false;
    btnEraser.classList.remove('active');

    // Update active swatch
    paletteRow.querySelectorAll('.color-swatch').forEach(function (sw) {
      sw.classList.toggle('active', sw.dataset.color === hex);
    });
  }

  // ---- Flood fill (iterative scanline) ----
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function getPixel(data, w, x, y) {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  function setPixel(data, w, x, y, r, g, b, a) {
    const i = (y * w + x) * 4;
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }

  function isBlackish(r, g, b) {
    return r < BLACK_THRESHOLD && g < BLACK_THRESHOLD && b < BLACK_THRESHOLD;
  }

  function colorMatch(r1, g1, b1, a1, r2, g2, b2, a2, tol) {
    return (
      Math.abs(r1 - r2) <= tol &&
      Math.abs(g1 - g2) <= tol &&
      Math.abs(b1 - b2) <= tol &&
      Math.abs(a1 - a2) <= tol
    );
  }

  function floodFill(startX, startY, fillColor) {
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(startX * dpr);
    const py = Math.round(startY * dpr);
    const w = canvas.width;
    const h = canvas.height;

    if (px < 0 || px >= w || py < 0 || py >= h) return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    const target = getPixel(data, w, px, py);
    const tR = target[0], tG = target[1], tB = target[2], tA = target[3];

    // Don't fill black outlines
    if (isBlackish(tR, tG, tB)) return;

    const [fR, fG, fB] = hexToRgb(fillColor);
    const fA = 255;

    // Don't fill if target is already the fill color
    if (colorMatch(tR, tG, tB, tA, fR, fG, fB, fA, 5)) return;

    // Save undo state BEFORE filling
    pushUndo();

    const tol = FILL_TOLERANCE;
    const visited = new Uint8Array(w * h);

    function canFill(x, y) {
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      const idx = y * w + x;
      if (visited[idx]) return false;
      const i = idx * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (isBlackish(r, g, b)) return false;
      return colorMatch(r, g, b, a, tR, tG, tB, tA, tol);
    }

    // Scanline flood fill with stack
    const stack = [[px, py]];
    visited[py * w + px] = 1;

    while (stack.length > 0) {
      const [sx, sy] = stack.pop();

      // Find left boundary
      let left = sx;
      while (left > 0 && canFill(left - 1, sy)) {
        left--;
        visited[sy * w + left] = 1;
      }

      // Find right boundary
      let right = sx;
      while (right < w - 1 && canFill(right + 1, sy)) {
        right++;
        visited[sy * w + right] = 1;
      }

      // Fill the scanline
      for (let x = left; x <= right; x++) {
        setPixel(data, w, x, sy, fR, fG, fB, fA);
        visited[sy * w + x] = 1;
      }

      // Check above and below scanline
      for (let x = left; x <= right; x++) {
        if (sy > 0 && canFill(x, sy - 1)) {
          visited[(sy - 1) * w + x] = 1;
          stack.push([x, sy - 1]);
        }
        if (sy < h - 1 && canFill(x, sy + 1)) {
          visited[(sy + 1) * w + x] = 1;
          stack.push([x, sy + 1]);
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  function eraseFill(startX, startY) {
    // Eraser: restores original pixel colors in the tapped region
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round(startX * dpr);
    const py = Math.round(startY * dpr);
    const w = canvas.width;
    const h = canvas.height;

    if (px < 0 || px >= w || py < 0 || py >= h) return;

    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;
    const origData = originalImageData.data;

    const target = getPixel(data, w, px, py);
    const tR = target[0], tG = target[1], tB = target[2], tA = target[3];

    // Don't erase black outlines
    if (isBlackish(tR, tG, tB)) return;

    // Check if already matches original
    const origTarget = getPixel(origData, w, px, py);
    if (colorMatch(tR, tG, tB, tA, origTarget[0], origTarget[1], origTarget[2], origTarget[3], 5)) return;

    pushUndo();

    const tol = FILL_TOLERANCE;
    const visited = new Uint8Array(w * h);

    function canFill(x, y) {
      if (x < 0 || x >= w || y < 0 || y >= h) return false;
      const idx = y * w + x;
      if (visited[idx]) return false;
      const i = idx * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (isBlackish(r, g, b)) return false;
      return colorMatch(r, g, b, a, tR, tG, tB, tA, tol);
    }

    const stack = [[px, py]];
    visited[py * w + px] = 1;

    while (stack.length > 0) {
      const [sx, sy] = stack.pop();

      let left = sx;
      while (left > 0 && canFill(left - 1, sy)) {
        left--;
        visited[sy * w + left] = 1;
      }

      let right = sx;
      while (right < w - 1 && canFill(right + 1, sy)) {
        right++;
        visited[sy * w + right] = 1;
      }

      for (let x = left; x <= right; x++) {
        // Restore original pixel
        const oi = (sy * w + x) * 4;
        setPixel(data, w, x, sy, origData[oi], origData[oi + 1], origData[oi + 2], origData[oi + 3]);
        visited[sy * w + x] = 1;
      }

      for (let x = left; x <= right; x++) {
        if (sy > 0 && canFill(x, sy - 1)) {
          visited[(sy - 1) * w + x] = 1;
          stack.push([x, sy - 1]);
        }
        if (sy < h - 1 && canFill(x, sy + 1)) {
          visited[(sy + 1) * w + x] = 1;
          stack.push([x, sy + 1]);
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  // ---- Undo ----
  function pushUndo() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_UNDO_STATES) {
      undoStack.shift();
    }
  }

  function undo() {
    if (undoStack.length === 0) return;
    const state = undoStack.pop();
    ctx.putImageData(state, 0, 0);
  }

  // ---- Canvas tap handler ----
  function handleCanvasTap(e) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Convert to canvas CSS coordinates
    const cssX = clientX - rect.left;
    const cssY = clientY - rect.top;

    // Scale from CSS size to logical canvas size
    const scaleX = imageWidth / rect.width;
    const scaleY = imageHeight / rect.height;
    const canvasX = Math.round(cssX * scaleX);
    const canvasY = Math.round(cssY * scaleY);

    showWorking();

    // Use requestAnimationFrame + setTimeout to let the indicator show
    requestAnimationFrame(function () {
      setTimeout(function () {
        if (isEraser) {
          eraseFill(canvasX, canvasY);
        } else {
          floodFill(canvasX, canvasY, currentColor);
        }
        hideWorking();
      }, 10);
    });
  }

  function showWorking() {
    workingIndicator.classList.remove('hidden');
  }

  function hideWorking() {
    workingIndicator.classList.add('hidden');
  }

  // ---- Save ----
  function saveImage() {
    const dataURL = canvas.toDataURL('image/png');
    savePreview.src = dataURL;
    saveModal.classList.remove('hidden');
  }

  // ---- Reset ----
  function resetCanvas() {
    if (!originalImageData) return;
    ctx.putImageData(originalImageData, 0, 0);
    undoStack = [];
  }

  // ---- Event listeners ----

  // Sample image buttons
  document.querySelectorAll('.sample-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      loadImage(btn.dataset.sample);
    });
  });

  // File upload
  fileInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) {
      loadFileImage(e.target.files[0]);
      // Reset so same file can be re-selected
      e.target.value = '';
    }
  });

  // Canvas touch/click
  canvas.addEventListener('pointerdown', handleCanvasTap, { passive: false });

  // Prevent scrolling on canvas
  canvasContainer.addEventListener('touchmove', function (e) {
    e.preventDefault();
  }, { passive: false });

  // Color palette clicks
  paletteRow.addEventListener('click', function (e) {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    if (swatch.classList.contains('custom-color-swatch')) return; // handled below
    if (swatch.dataset.color) {
      selectColor(swatch.dataset.color);
    }
  });

  // Custom color picker — button opens the native color input
  var customColorBtn = document.getElementById('custom-color-btn');

  customColorBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    customColorInput.click();
  });

  customColorInput.addEventListener('input', function () {
    var hex = customColorInput.value;
    currentColor = hex;
    isEraser = false;
    btnEraser.classList.remove('active');
    // Update custom button background to show chosen color
    customColorBtn.style.background = hex;
    // Mark custom as active, deactivate others
    paletteRow.querySelectorAll('.color-swatch').forEach(function (sw) {
      sw.classList.remove('active');
    });
    customColorBtn.classList.add('active');
  });

  // Eraser toggle
  btnEraser.addEventListener('click', function () {
    isEraser = !isEraser;
    btnEraser.classList.toggle('active', isEraser);
    if (isEraser) {
      paletteRow.querySelectorAll('.color-swatch').forEach(function (sw) {
        sw.classList.remove('active');
      });
    } else {
      selectColor(currentColor);
    }
  });

  // Undo
  btnUndo.addEventListener('click', undo);

  // Save
  btnSave.addEventListener('click', saveImage);

  // Save modal close
  saveModalClose.addEventListener('click', function () {
    saveModal.classList.add('hidden');
  });
  saveModal.addEventListener('click', function (e) {
    if (e.target === saveModal) saveModal.classList.add('hidden');
  });

  // Reset
  btnReset.addEventListener('click', function () {
    resetModal.classList.remove('hidden');
  });
  resetCancel.addEventListener('click', function () {
    resetModal.classList.add('hidden');
  });
  resetConfirm.addEventListener('click', function () {
    resetCanvas();
    resetModal.classList.add('hidden');
  });
  resetModal.addEventListener('click', function (e) {
    if (e.target === resetModal) resetModal.classList.add('hidden');
  });

  // Close (back to selection)
  btnClose.addEventListener('click', function () {
    showScreen(screenSelect);
    // Clean up
    undoStack = [];
    originalImageData = null;
  });

  // Handle window resize
  window.addEventListener('resize', function () {
    if (imageWidth > 0) fitCanvasInContainer();
  });

  // ---- PWA Service Worker registration ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('service-worker.js').catch(function (err) {
        console.log('SW registration failed:', err);
      });
    });
  }

})();
