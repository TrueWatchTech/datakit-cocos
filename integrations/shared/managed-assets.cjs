'use strict';
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const legacyHashes = new Set(require('./legacy-asset-hashes.json'));
// Older combined installations predate the ownership manifest. Never leave a
// locally modified obsolete Replay bridge compiling beside the new bridge.
const legacyReplayNames = new Set(['FTCocosReplayImageJobs.java', 'FTCocosReplayImageJobs.h', 'FTCocosReplayImageJobs.m', 'FTReplayFileBridge.h', 'FTReplayFileWorker.h']);
const manifestName = '.cocos-sdk-managed.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function files(root) {
  const result = [];
  if (!fs.existsSync(root)) return result;
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === manifestName || entry.name === '.DS_Store') continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`[cocos-sdk] Refusing to copy symbolic link: ${file}`);
      if (entry.isDirectory()) visit(file);
      else result.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  visit(root);
  return result;
}

/** Reconciles only files written by the SDK, preserving unrelated project assets. */
function syncManagedDirectory(destination, sources, overrides = {}) {
  const desired = new Map();
  for (const { root, prefix = '' } of sources) {
    if (!fs.existsSync(root)) throw new Error(`[cocos-sdk] Missing package assets: ${root}`);
    for (const file of files(root)) desired.set(prefix + file, fs.readFileSync(path.join(root, file)));
  }
  for (const [file, content] of Object.entries(overrides)) desired.set(file, Buffer.from(content));
  const manifest = path.join(destination, manifestName);
  const previous = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : {};
  const existing = files(destination);
  const remove = [];
  // Check every conflict before writing or deleting any managed file.
  for (const file of existing) {
    const digest = hash(fs.readFileSync(path.join(destination, file)));
    const old = previous[file];
    const next = desired.get(file);
    const legacy = legacyHashes.has(digest);
    if (!next && !old && !legacy && legacyReplayNames.has(path.basename(file))) {
      throw new Error(`[cocos-sdk] Preserve or reconcile modified legacy Replay asset before reinstalling: ${path.join(destination, file)}`);
    }
    if ((old || next) && digest !== old && !legacy && (!next || digest !== hash(next))) {
      throw new Error(`[cocos-sdk] Preserve or reconcile modified SDK asset before reinstalling: ${path.join(destination, file)}`);
    }
    if (!next && (old || legacy) && !file.endsWith('.meta')) remove.push(file);
  }
  fs.mkdirSync(destination, { recursive: true });
  for (const file of remove) fs.unlinkSync(path.join(destination, file));
  const nextManifest = {};
  for (const [file, content] of desired) {
    const target = path.resolve(destination, file);
    if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error('Invalid SDK asset path');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || hash(fs.readFileSync(target)) !== hash(content)) fs.writeFileSync(target, content);
    nextManifest[file] = hash(content);
  }
  fs.writeFileSync(manifest, `${JSON.stringify(nextManifest, null, 2)}\n`);
}

module.exports = { syncManagedDirectory };
