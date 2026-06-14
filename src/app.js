import { initStrudel, evaluate, renderPatternAudio, hush, samples, silence } from '@strudel/web';
import { cleanupDraw, __pianoroll } from '@strudel/draw';

const codeEl = document.getElementById('code');
const durationEl = document.getElementById('duration');
const cpmEl = document.getElementById('cpm');
const filenameEl = document.getElementById('filename');
const previewBtn = document.getElementById('previewBtn');
const exportBtn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');
let isPreviewing = false;
let isExporting = false;
const exportPreRollSeconds = 0.5;

// --- Visualization ---
const vizCanvas = document.getElementById('viz-canvas');
const vizCtx = vizCanvas.getContext('2d');

function resizeVizCanvas() {
  const dpr = window.devicePixelRatio || 1;
  vizCanvas.width = vizCanvas.clientWidth * dpr;
  vizCanvas.height = vizCanvas.clientHeight * dpr;
}
resizeVizCanvas();
window.addEventListener('resize', resizeVizCanvas);

let vizRafId = null;
let vizMemory = [];
let vizLastQueryEnd = 0;
let vizPattern = null;
let vizCps = 0.5;

function startVisualization(pattern) {
  if (!pattern || pattern === silence) return;
  resizeVizCanvas();
  stopVisualization(); // 清理上一次

  const cpm = Number(cpmEl.value) || 30;
  vizCps = cpm / 60;
  vizPattern = pattern;

  const cycles = 4;
  const playhead = 0.5;
  const to = cycles * (1 - playhead);
  const hideNegative = 1;
  const inFrame = (hap, t) => (!hideNegative || hap.whole.begin >= 0) && hap.isWithinTime(t - cycles * playhead, t + to);

  // 初始查询
  vizMemory = pattern.queryArc(0, to).filter((h) => h.hasOnset());
  vizLastQueryEnd = to;

  function animate() {
    if (!vizPattern) return;
    const nowSec = performance.now() / 1000;
    const currentCycle = nowSec * vizCps;
    const t = currentCycle + to;

    // 增量查询
    if (t > vizLastQueryEnd) {
      const newHaps = vizPattern.queryArc(vizLastQueryEnd, t).filter((h) => h.hasOnset());
      vizMemory = vizMemory.concat(newHaps);
      vizLastQueryEnd = t;
    }

    // 清理远处的 hap
    vizMemory = vizMemory.filter((h) => h.whole.end >= currentCycle - cycles);

    // 渲染
    const visible = vizMemory.filter((hap) => inFrame(hap, currentCycle));
    __pianoroll({
      time: currentCycle,
      ctx: vizCtx,
      haps: visible,
      cycles,
      playhead,
      fold: 1,
      labels: 1,
      fill: 1,
      fillActive: 1,
      active: '#60a5fa',
      inactive: '#374151',
      background: '#020617',
      playheadColor: '#e5e7eb',
      hideNegative,
      id: 0,
    });

    vizRafId = requestAnimationFrame(animate);
  }

  vizRafId = requestAnimationFrame(animate);
}

function stopVisualization() {
  if (vizRafId != null) {
    cancelAnimationFrame(vizRafId);
    vizRafId = null;
  }
  vizPattern = null;
  cleanupDraw(false, 'viz');
  vizCtx.clearRect(0, 0, vizCanvas.width, vizCanvas.height);
}

function setPreviewing(value) {
  isPreviewing = value;
  previewBtn.textContent = value ? '停止试听' : '试听';
}

function stopPreview(status = '已停止试听。') {
  try { hush(); } catch {}
  stopVisualization();
  setPreviewing(false);
  if (status) setStatus(status);
}

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`;
}

function sanitizeFilename(name) {
  return String(name || 'strudel-output').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.wav$/i, '') || 'strudel-output';
}

async function initEngine({ silent = false } = {}) {
  await initStrudel({
    prebake: async () => {
      try {
        await samples('github:tidalcycles/dirt-samples');
      } catch (err) {
        console.warn('sample preload failed:', err);
      }
    }
  });
  if (!silent) setStatus('初始化完成。输入代码后可以先试听，也可以直接导出 WAV。', 'ok');
}

async function init() {
  try {
    await initEngine();
  } catch (err) {
    console.error(err);
    setStatus(`初始化失败：${err.message || err}`, 'err');
  }
}

async function buildPattern({ code, cpm = 30, setAsCurrent = false }) {
  if (!code || !code.trim()) throw new Error('代码不能为空');
  if (!Number.isFinite(cpm) || cpm <= 0) throw new Error('CPM 必须大于 0');
  // 统一试听和导出的入口：都把当前 UI 的 CPM 注入代码，避免两边速度/状态不一致。
  const codeWithTempo = `setcpm(${cpm})\n${code}`;
  const pattern = await evaluate(codeWithTempo, setAsCurrent, true);
  if (!pattern) throw new Error('代码没有返回有效的 Strudel pattern');
  return pattern;
}

async function preview({ code, cpm = 30 }) {
  const pattern = await buildPattern({ code, cpm, setAsCurrent: true });
  startVisualization(pattern);
}

async function renderPatternAudioBlob(pattern, cps, beginCycle, endCycle) {
  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const originalCreateElement = document.createElement.bind(document);
  let capturedBlob = null;

  URL.createObjectURL = (blob) => {
    capturedBlob = blob;
    return originalCreateObjectURL(blob);
  };

  document.createElement = (tagName, options) => {
    const element = originalCreateElement(tagName, options);
    if (String(tagName).toLowerCase() === 'a') {
      element.click = () => {};
    }
    return element;
  };

  try {
    await renderPatternAudio(pattern, cps, beginCycle, endCycle, 44100, 512, false, '__strudel-temp-export');
  } finally {
    URL.createObjectURL = originalCreateObjectURL;
    document.createElement = originalCreateElement;
  }

  if (!capturedBlob) throw new Error('没有捕获到导出的 WAV 数据');
  return capturedBlob;
}

async function cropWavBlob(blob, startSeconds, durationSeconds) {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const channels = view.getUint16(22, true);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const bytesPerFrame = channels * bitsPerSample / 8;
  const dataOffset = 44;
  const dataSize = view.getUint32(40, true);
  const startFrame = Math.max(0, Math.floor(startSeconds * sampleRate));
  const requestedFrames = Math.max(0, Math.floor(durationSeconds * sampleRate));
  const availableFrames = Math.floor(dataSize / bytesPerFrame) - startFrame;
  const frames = Math.max(0, Math.min(requestedFrames, availableFrames));
  const outputDataSize = frames * bytesPerFrame;
  const output = new ArrayBuffer(dataOffset + outputDataSize);
  const outputBytes = new Uint8Array(output);
  outputBytes.set(new Uint8Array(buffer, 0, dataOffset), 0);
  outputBytes.set(new Uint8Array(buffer, dataOffset + startFrame * bytesPerFrame, outputDataSize), dataOffset);
  const outputView = new DataView(output);
  outputView.setUint32(4, 36 + outputDataSize, true);
  outputView.setUint32(40, outputDataSize, true);
  return new Blob([output], { type: 'audio/wav' });
}

function makeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
}

function downloadBlob(blob, filename) {
  const finalFilename = `${filename}-${makeTimestamp()}.wav`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = finalFilename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return finalFilename;
}

async function exportWav({ code, duration, cpm = 30, filename }) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('导出时长必须大于 0 秒');
  // 导出只需要拿到 pattern，不要把它设成实时试听 pattern，避免影响正在播放的 scheduler。
  const pattern = await buildPattern({ code, cpm, setAsCurrent: false });

  const cps = cpm / 60;
  const preRollCycles = exportPreRollSeconds * cps;
  const endCycle = duration * cps;
  const rawBlob = await renderPatternAudioBlob(pattern, cps, -preRollCycles, endCycle);
  const croppedBlob = await cropWavBlob(rawBlob, exportPreRollSeconds, duration);
  return downloadBlob(croppedBlob, filename);
}

previewBtn.addEventListener('click', async () => {
  if (isExporting) return;
  if (isPreviewing) {
    stopPreview('已停止试听。');
    return;
  }

  previewBtn.disabled = true;
  try {
    const code = codeEl.value;
    const cpm = Number(cpmEl.value);
    setStatus('正在试听当前代码...');
    await preview({ code, cpm });
    setPreviewing(true);
    setStatus('正在试听当前代码。修改代码后再次点击“停止试听”，再点“试听”即可更新播放。', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`试听失败：${err.message || err}`, 'err');
  } finally {
    previewBtn.disabled = false;
  }
});

exportBtn.addEventListener('click', async () => {
  isExporting = true;
  exportBtn.disabled = true;
  previewBtn.disabled = true;
  if (isPreviewing) {
    stopPreview('导出前已自动停止试听。');
  }
  try {
    const code = codeEl.value;
    const duration = Number(durationEl.value);
    const cpm = Number(cpmEl.value);
    const filename = sanitizeFilename(filenameEl.value);
    setStatus('正在渲染 WAV，请稍等... 较长音频可能需要几十秒。');
    const downloadedFilename = await exportWav({ code, duration, cpm, filename });
    // renderPatternAudio 会切换 WebAudio context。导出后重新初始化一次，保证后续试听还能正常工作。
    await initEngine({ silent: true });
    setPreviewing(false);
    setStatus(`完成：${downloadedFilename} 已开始下载。可以继续点击“试听”。`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(`导出失败：${err.message || err}`, 'err');
  } finally {
    isExporting = false;
    exportBtn.disabled = false;
    previewBtn.disabled = false;
  }
});

const readyPromise = init();
window.__STRudelReady = readyPromise;

// 给命令行版本使用。Playwright 会调用这个函数。
window.__STRudelExportWav = async ({ code, duration = 16, cpm = 30, filename = 'strudel-output' }) => {
  await readyPromise;
  await exportWav({ code, duration: Number(duration), cpm: Number(cpm), filename: sanitizeFilename(filename) });
  return true;
};
