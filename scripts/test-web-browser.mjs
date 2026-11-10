// Run against a Creator Web build of examples/web/creator{2,3}.ts.
// PLAYWRIGHT_MODULE may point to a temporary playwright-core installation.
// All HTTP traffic is restricted to this test's loopback server.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { unzipSync, inflateRawSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(process.argv[2]);
const packets = [];
const resources = [];
const replayRecords = [];
const browserErrors = [];
const consoleErrors = [];
const initialize = await readFile(path.join(root, 'cocos-sdk-web/initialize.js'), 'utf8');
const configuration = JSON.parse(initialize.slice(initialize.indexOf('(') + 1, initialize.lastIndexOf(')')));
const replayEnabled = !!configuration.web.replay;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm', '.css': 'text/css' };
let origin;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (request.method === 'POST') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    packets.push({ path: url.pathname, bytes: body.length });
    if (url.pathname.endsWith('/replay')) {
      try {
        const form = await new Response(body, { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
        const bytes = Buffer.from(await form.get('segment').arrayBuffer());
        let decoded;
        try { decoded = unzipSync(bytes); } catch { decoded = inflateRawSync(bytes); }
        replayRecords.push(...JSON.parse(decoded.toString()).records);
      } catch (error) { browserErrors.push('Replay payload decode failed: ' + error.message); }
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{}'); return;
  }
  if (url.pathname === '/sample-resource') {
    resources.push(request.headers);
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"ok":true}'); return;
  }
  if (url.pathname.endsWith('/cocos-sdk-web/initialize.js')) {
    configuration.web.datakitOrigin = origin;
    delete configuration.web.site; delete configuration.web.clientToken;
    configuration.web.allowedTracingUrls = [origin + '/sample-resource'];
    if (replayEnabled) configuration.web.replay.canvasPrivacy = 'allow';
    const instrument = `window.__webEvents=[]; ['TRUEWATCH_RUM','TRUEWATCH_LOGS'].forEach(function(name) { var api=window[name]; if(!api)return; var init=api.init; api.init=function(config){var filter=config.beforeSend;config.beforeSend=function(event,context){var keep=filter?filter(event,context):true;if(keep!==false)window.__webEvents.push(JSON.parse(JSON.stringify(event)));return keep;};return init.call(api,config);}; });\n`;
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end(instrument + 'CocosWebSDK.bootstrapWeb(' + JSON.stringify(configuration) + ');'); return;
  }
  try {
    const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
let browser;
let page;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--renderer-process-limit=1', '--num-raster-threads=1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 500)); });
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__cocosWebSample?.ready === true, undefined, { timeout: 45000 });
  await page.waitForFunction(() => window.__webEvents.some(event => event.type === 'resource' && event.resource?.url?.endsWith('/sample-resource')), undefined, { timeout: 15000 });
  const events = await page.evaluate(() => window.__webEvents);
  assert.ok(events.some(event => event.type === 'view' && event.view?.name === 'CocosWebSample'), 'Cocos view was not collected');
  assert.ok(events.some(event => event.type === 'action' && JSON.stringify(event).includes('web_sample_started')), 'Manual action missing');
  assert.ok(events.some(event => event.type === 'error' && JSON.stringify(event).includes('Web sample error')), 'Manual error missing');
  assert.ok(events.some(event => event.message === 'Web sample started'), 'Custom log missing');
  assert.ok(events.some(event => event.user?.id === 'web-sample'), 'Bound identity missing');
  assert.equal(events.filter(event => event.type === 'resource' && event.resource?.url?.endsWith('/sample-resource')).length, 1, 'Duplicate resource');
  assert.equal(resources.length, 1); assert.ok(resources[0].traceparent, 'Browser did not inject the configured trace header');
  let replay = { recording: false, snapshots: 0 };
  let captureIntervals = [];
  if (replayEnabled) {
    const snapshotDeadline = Date.now() + 20000;
    const canvasRecords = () => replayRecords.filter(record => record.type === 3 && record.data?.source === 9 && record.data?.commands?.length);
    while (!canvasRecords().length && Date.now() < snapshotDeadline) await new Promise(resolve => setTimeout(resolve, 250));
    replay = { recording: await page.evaluate(() => window.TRUEWATCH_RUM.isRecording()), snapshots: canvasRecords().length };
    assert.equal(replay.recording, true); assert.ok(replay.snapshots > 0, 'No canvas image reached the local collector');
    const times = [...new Set(canvasRecords().map(record => record.timestamp))].sort((a, b) => a - b);
    captureIntervals = times.slice(1).map((time, index) => time - times[index]);
    if (configuration.web.replay.captureFps > 1) {
      assert.ok(captureIntervals.some(interval => interval > 0 && interval < 850), 'WebGL cooldown still overrides the configured capture rate');
    }
    const images = [];
    const visit = value => {
      if (value?.rr_type === 'Blob' && value.type?.startsWith('image/')) {
        const buffer = value.data?.find(item => item.rr_type === 'ArrayBuffer');
        if (buffer?.base64) images.push(`data:${value.type};base64,${buffer.base64}`);
      } else if (typeof value === 'string' && value.startsWith('data:image/')) images.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    canvasRecords().forEach(visit);
    assert.ok(images.length > 0, 'Canvas records did not contain encoded images');
    const maxBytes = configuration.web.replay.maxFrameBytes || 40000;
    for (const image of images) assert.ok(Buffer.from(image.split(',')[1], 'base64').length <= maxBytes, 'Encoded image exceeded the configured byte limit');
    const dimensions = await page.evaluate(async image => {
      const img = new Image(); img.src = image; await img.decode(); return [img.width, img.height];
    }, images[0]);
    assert.ok(Math.max(...dimensions) <= (configuration.web.replay.maxImageDimension || 720));
    await page.evaluate(() => window.__cocosWebSample.sdk.replay.stop());
    assert.equal(await page.evaluate(() => window.TRUEWATCH_RUM.isRecording()), false);
    await page.evaluate(() => window.__cocosWebSample.sdk.replay.start());
    assert.equal(await page.evaluate(() => window.TRUEWATCH_RUM.isRecording()), true);
    await page.evaluate(() => {
      const sample = window.__cocosWebSample;
      sample.setPrivate(true);
    });
    const blocked = await page.evaluate(() => window.TRUEWATCH_RUM.getInitConfiguration().shouldRecordCanvas(document.querySelector('#GameCanvas')));
    assert.equal(blocked, false, 'Protected canvas was not blocked');
  }
  await page.evaluate(() => {
    const sample = window.__cocosWebSample; sample.setPrivate(false);
    sample.sdk.stop();
  });
  assert.equal(await page.evaluate(() => window.TRUEWATCH_RUM.isRecording()), false);
  const finalEvents = await page.evaluate(() => window.__webEvents);
  assert.ok(finalEvents.some(event => event.type === 'view' && event.view?.name === 'OutsideCocos'));
  // Flush page events through the real SDK transport into the local test collector.
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const deadline = Date.now() + 35000;
  while (packets.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(packets.some(packet => packet.bytes > 0), 'No batch reached the local collector');
  if (!replayEnabled) assert.equal(packets.filter(packet => packet.path.endsWith('/replay')).length, 0);
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ build: root, events: finalEvents.length, resourceCount: resources.length, replaySnapshots: replay.snapshots, captureIntervals, packets, browserErrors }));
} catch (error) {
  const diagnostics = page ? await page.evaluate(() => ({ recording: window.TRUEWATCH_RUM?.isRecording(), history: window.TRUEWATCH_RUM?.getAutoCanvasSnapshotDebugHistoryForDebug?.()?.slice(-3), mutation: window.TRUEWATCH_RUM?.getLastCanvasMutationForDebug?.(), renderType: window.cc?.game?.renderType, canvases: Array.from(document.querySelectorAll('canvas')).map(canvas => ({id: canvas.id, width: canvas.width, height: canvas.height})) })).catch(() => undefined) : undefined;
  console.error(JSON.stringify({ build: root, browserErrors, consoleErrors, packets, diagnostics }));
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
