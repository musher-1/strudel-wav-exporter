#!/usr/bin/env node
import { Command } from 'commander';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function sanitizeBasename(name) {
  return String(name || 'strudel-output').replace(/[\\/:*?"<>|]+/g, '-').replace(/\.wav$/i, '') || 'strudel-output';
}

async function main() {
  const program = new Command();
  program
    .name('strudel-export')
    .description('把 Strudel 代码导出为 WAV 文件')
    .argument('<input>', 'Strudel 代码文件，例如 beat.js')
    .option('-d, --duration <seconds>', '导出时长，秒', '16')
    .option('--cpm <cyclesPerMinute>', '速度，cycles per minute，Strudel 默认是 30', '30')
    .option('-o, --out <file>', '输出 wav 文件路径', 'strudel-output.wav')
    .option('--headed', '显示浏览器窗口，便于排错', false)
    .parse(process.argv);

  const input = program.args[0];
  const opts = program.opts();
  const duration = Number(opts.duration);
  const cpm = Number(opts.cpm);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('--duration 必须是大于 0 的数字');
  if (!Number.isFinite(cpm) || cpm <= 0) throw new Error('--cpm 必须是大于 0 的数字');

  const code = await readFile(path.resolve(input), 'utf8');
  const outPath = path.resolve(opts.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  const filename = sanitizeBasename(path.basename(outPath));

  const server = await createServer({
    root,
    server: { host: '127.0.0.1', port: 0 },
    logLevel: process.env.DEBUG ? 'info' : 'silent'
  });

  let browser;
  try {
    await server.listen();
    const info = server.httpServer.address();
    const url = `http://127.0.0.1:${info.port}/`;

    browser = await chromium.launch({
      headless: !opts.headed,
      executablePath: process.env.CHROME_PATH || '/usr/local/bin/google-chrome',
      args: ['--autoplay-policy=no-user-gesture-required']
    });
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on('console', (msg) => process.env.DEBUG && console.log('[browser]', msg.type(), msg.text()));
    page.on('pageerror', (err) => console.error('[browser error]', err.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__STRudelReady && window.__STRudelExportWav, null, { timeout: 60000 });
    await page.evaluate(() => window.__STRudelReady);

    console.log(`正在导出 WAV：${duration}s -> ${outPath}`);
    const downloadPromise = page.waitForEvent('download', { timeout: Math.max(120000, duration * 10000) });
    await page.evaluate(({ code, duration, cpm, filename }) => window.__STRudelExportWav({ code, duration, cpm, filename }), { code, duration, cpm, filename });
    const download = await downloadPromise;
    await download.saveAs(outPath);
    console.log(`完成：${outPath}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`失败：${err.message || err}`);
  process.exit(1);
});
