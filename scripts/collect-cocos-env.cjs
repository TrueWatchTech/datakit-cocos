#!/usr/bin/env node
'use strict';

// Standalone support tool: only Node built-ins; project code is never executed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');

const VERSION = '2.3.1';
const PACKAGES = ['cocos-sdk', 'cocos-session-replay', 'browser-rum', 'browser-logs', 'browser-rum-webgl'];
// Unknown types are counted without exporting their names, including custom cc.* registrations.
const COMPONENT_TYPES = new Set(('Button Label LabelOutline LabelShadow RichText EditBox ScrollView ScrollBar Scrollbar Toggle ToggleGroup ToggleContainer Slider '
  + 'ProgressBar PageView PageViewIndicator Layout Widget Mask Sprite Graphics UITransform UIOpacity '
  + 'Canvas Camera WebView VideoPlayer Animation SkeletalAnimation AudioSource MeshRenderer '
  + 'SkinnedMeshRenderer ParticleSystem ParticleSystem2D UIMeshRenderer UIModelComponent '
  + 'DirectionalLight SpotLight SphereLight PointLight RangedDirectionalLight Light LightProbeGroup ReflectionProbe '
  + 'BlockInputEvents SafeArea UIStaticBatch Billboard TiledMap TiledLayer TiledTile MotionStreak '
  + 'RenderRoot2D UICoordinateTracker UISkew Sorting Sorting2D SpriteRenderer SkinnedMeshBatchRenderer '
  + 'ParticleSystem3D SkeletonAnimation Terrain LODGroup Line '
  + 'RigidBody RigidBody2D RigidBody3D ConstantForce BoxCollider BoxCollider2D BoxCollider3D '
  + 'SphereCollider SphereCollider3D CapsuleCollider CapsuleCollider3D CylinderCollider ConeCollider '
  + 'MeshCollider TerrainCollider CircleCollider PolygonCollider PhysicsBoxCollider PhysicsCircleCollider '
  + 'PhysicsPolygonCollider PhysicsChainCollider CircleCollider2D PolygonCollider2D')
  .split(' ').map(name => 'cc.' + name).concat(['sp.Skeleton', 'dragonBones.ArmatureDisplay',
    'cc.animation.AnimationController', 'cc.FXAA', 'cc.postProcess.PostProcess', 'cc.postProcess.BlitScreen', 'cc.postProcess.Bloom',
    'cc.postProcess.ColorGrading', 'cc.postProcess.DOF', 'cc.postProcess.DepthOfField', 'cc.postProcess.FXAA',
    'cc.postProcess.FSR', 'cc.postProcess.HBAO', 'cc.postProcess.TAA', 'cc.postProcess.ToneMapping']));
const SKIP = new Set(['node_modules', '.git', '.svn', 'library', 'temp', 'Pods', '.gradle', '.cxx',
  'CMakeFiles', 'DerivedData', 'data', 'res', 'Resources']);
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const NUM_VERSION = /^\d+(?:\.\d+){0,3}$/;
const fact = (value, source, status = value === null ? 'unknown' : 'found') => ({ value, source, status });
const version = value => typeof value === 'string' && SEMVER.test(value) ? value : null;
const numericVersion = value => typeof value === 'string' && NUM_VERSION.test(value) ? value : null;

function packageType(name) {
  const parts = name.split('/');
  if (parts.length === 2 && /^@[a-z0-9][a-z0-9._-]*$/i.test(parts[0])) return PACKAGES.includes(parts[1]) ? parts[1] : null;
  return parts.length === 1 && PACKAGES.includes(name) ? name : null;
}

// A bounded lexer keeps comments, UI strings, shaders and regular expressions out of code matching.
// It does not evaluate code, follow imports, or retain source text in the report.
function scriptTokens(source) {
  const tokens = [];
  let offset = 0, limited = false;
  const add = (value, kind = 'punctuation') => tokens.push({ value, kind });
  function scan(interpolation = false, depth = 0) {
    if (depth > 32) { limited = true; return; }
    let braces = 0;
    while (offset < source.length && !limited) {
      if (tokens.length >= 100000) { limited = true; break; }
      const c = source[offset], next = source[offset + 1];
      if (/\s/.test(c)) { offset++; continue; }
      if (c === '/' && next === '/') {
        const end = source.indexOf('\n', offset + 2);
        offset = end < 0 ? source.length : end + 1; continue;
      }
      if (c === '/' && next === '*') {
        const end = source.indexOf('*/', offset + 2);
        offset = end < 0 ? source.length : end + 2; continue;
      }
      if (c === '"' || c === "'") {
        const start = ++offset;
        let escaped = false;
        while (offset < source.length && source[offset] !== c) {
          if (source[offset] === '\\') { escaped = true; offset++; }
          offset++;
        }
        add(!escaped && offset - start <= 160 ? source.slice(start, offset) : '', 'string');
        offset++; continue;
      }
      if (c === '`') {
        add('', 'literal'); offset++;
        while (offset < source.length && !limited) {
          if (source[offset] === '\\') { offset += 2; continue; }
          if (source[offset] === '`') { offset++; break; }
          if (source[offset] === '$' && source[offset + 1] === '{') {
            offset += 2; scan(true, depth + 1); continue;
          }
          offset++;
        }
        add('', 'literal'); continue;
      }
      const previous = tokens[tokens.length - 1];
      const expressionEnd = previous && (previous.kind === 'string' || previous.kind === 'literal'
        || [')', ']', '}'].includes(previous.value)
        || (previous.kind === 'identifier' && !['return', 'throw', 'case', 'typeof', 'void', 'delete', 'yield', 'await'].includes(previous.value)));
      if (c === '/' && !expressionEnd) {
        offset++;
        let characterClass = false;
        while (offset < source.length && !/[\r\n]/.test(source[offset])) {
          const value = source[offset++];
          if (value === '\\') { offset++; continue; }
          if (value === '[') characterClass = true;
          if (value === ']') characterClass = false;
          if (value === '/' && !characterClass) break;
        }
        while (/[a-z]/i.test(source[offset] || '')) offset++;
        add('', 'literal'); continue;
      }
      if (/[a-z_$]/i.test(c)) {
        const start = offset++;
        while (/[\w$]/.test(source[offset] || '')) offset++;
        add(source.slice(start, offset), 'identifier'); continue;
      }
      if (/[0-9]/.test(c)) {
        while (/[\w.]/.test(source[offset] || '')) offset++;
        add('', 'literal'); continue;
      }
      if (c === '{') braces++;
      if (c === '}') {
        if (interpolation && braces === 0) { offset++; return; }
        braces--;
      }
      add(c); offset++;
    }
  }
  scan();
  return { tokens, limited };
}

function scriptComponentUsage(source) {
  const lexed = scriptTokens(source);
  if (lexed.limited) return { limited: true };
  const tokens = lexed.tokens;
  const value = index => tokens[index]?.value;
  const bindings = new Map([['cc', 'cc'], ['sp', 'sp'], ['dragonBones', 'dragonBones']]);
  const normalize = name => name.replace(/^cc\.(sp|dragonBones)\./, '$1.');
  const imported = name => ['sp', 'dragonBones'].includes(name) ? name : 'cc.' + name;
  const references = new Set();
  const calls = {};
  let unresolved = 0;
  function resolve(index) {
    let name = tokens[index]?.kind === 'identifier' ? bindings.get(value(index)) : null;
    let component = COMPONENT_TYPES.has(name) ? name : null;
    let end = index + 1;
    if (!name) return { name: null, component: null, end };
    while (end < tokens.length) {
      if (value(end) === '.' && tokens[end + 1]?.kind === 'identifier') {
        name = normalize(name + '.' + value(end + 1)); end += 2;
      } else if (value(end) === '[' && tokens[end + 1]?.kind === 'string' && value(end + 2) === ']') {
        name = normalize(name + '.' + value(end + 1)); end += 3;
      } else break;
      if (COMPONENT_TYPES.has(name)) component = name;
    }
    return { name, component, end };
  }
  const importRanges = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (value(i) !== 'import' || ['(', '.'].includes(value(i + 1)) || tokens[i + 1]?.kind === 'string') continue;
    let end = i + 1;
    while (end < tokens.length && !['from', ';'].includes(value(end))) end++;
    if (value(end) !== 'from' || tokens[end + 1]?.kind !== 'string') continue;
    const engine = value(end + 1) === 'cc' && value(i + 1) !== 'type';
    for (let j = i; j <= end + 1; j++) importRanges.add(j);
    for (let j = i + 1; j < end; j++) {
      if (value(j) === '*' && value(j + 1) === 'as') {
        bindings.set(value(j + 2), engine ? 'cc' : null); j += 2;
      } else if (value(j) === '{') {
        for (j++; j < end && value(j) !== '}'; j++) {
          if (tokens[j]?.kind !== 'identifier') continue;
          const typeOnly = value(j) === 'type';
          if (typeOnly) j++;
          const name = value(j);
          const alias = value(j + 1) === 'as' ? value(j + 2) : name;
          bindings.set(alias, engine && !typeOnly ? imported(name) : null);
          if (value(j + 1) === 'as') j += 2;
        }
      } else if (tokens[j]?.kind === 'identifier' && value(j) !== 'type') {
        bindings.set(value(j), engine ? 'cc' : null);
      }
    }
    i = end + 1;
  }
  // Handle Creator 2 destructuring and aliases such as const E = cc / require('cc').
  for (let i = 0; i < tokens.length; i++) {
    if (!['const', 'let', 'var'].includes(value(i))) continue;
    let end = i + 1;
    const destructured = value(end) === '{';
    if (destructured) while (end < tokens.length && !['}', ';'].includes(value(end))) end++;
    let assignment = end + 1;
    if (value(assignment) === ':') {
      while (assignment < tokens.length && assignment < end + 200 && value(assignment) !== ';'
        && !(value(assignment) === '=' && value(assignment + 1) !== '>')) assignment++;
    }
    if (value(assignment) !== '=') continue;
    const start = assignment + 1;
    const expression = resolve(start);
    let root = expression.name;
    if (value(start) === 'require' && value(start + 1) === '(' && value(start + 2) === 'cc'
      && tokens[start + 2]?.kind === 'string' && value(start + 3) === ')') root = 'cc';
    if (expression.name === 'cc.js.getClassByName' && value(expression.end) === '('
      && tokens[expression.end + 1]?.kind === 'string' && value(expression.end + 2) === ')') {
      root = COMPONENT_TYPES.has(value(expression.end + 1)) ? value(expression.end + 1) : null;
    }
    if (destructured) {
      for (let j = i + 2; j < end; j++) {
        if (tokens[j]?.kind !== 'identifier') continue;
        const alias = value(j + 1) === ':' ? value(j + 2) : value(j);
        bindings.set(alias, root ? normalize(root + '.' + value(j)) : null);
        if (value(j + 1) === ':') j += 2;
      }
    } else if (tokens[end]?.kind === 'identifier') bindings.set(value(end), root);
  }
  for (let i = 0; i < tokens.length; i++) {
    if (importRanges.has(i)) continue;
    if (tokens[i].kind === 'identifier' && value(i - 1) !== '.') {
      const reference = resolve(i).component;
      if (reference) references.add(reference);
    }
    if (value(i) !== 'addComponent' || value(i - 1) !== '.' || value(i + 1) !== '(') continue;
    const argument = i + 2;
    const resolved = resolve(argument);
    const name = tokens[argument]?.kind === 'string' && value(argument + 1) === ')'
      ? value(argument) : value(resolved.end) === ')' ? resolved.name : null;
    if (COMPONENT_TYPES.has(name)) { calls[name] = (calls[name] || 0) + 1; references.add(name); }
    else unresolved++;
  }
  return { limited: false, references: [...references], calls, unresolved };
}

function parseArgs(args) {
  const options = { project: '.', output: 'cocos-env.json', buildConfigs: [], components: false, tools: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--components') options.components = true;
    else if (arg === '--tools') options.tools = true;
    else if (arg === '--no-tools') options.tools = false;
    else if (arg === '--force') options.force = true;
    else if (['--project', '--output', '--build-config'].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('A path is required after ' + arg);
      if (arg === '--build-config') options.buildConfigs.push(value);
      else options[arg.slice(2)] = value;
    } else throw new Error('Unknown option. Run with --help.');
  }
  if (options.buildConfigs.length > 20) throw new Error('At most 20 explicit build configurations are allowed.');
  return options;
}

function collect(options) {
  if (options.scriptHints || options.includePaths) {
    throw new Error('Script source and path export are not supported. Use --components for anonymized component evidence.');
  }
  const root = fs.realpathSync(path.resolve(options.project || '.'));
  if (!fs.statSync(root).isDirectory() || !fs.existsSync(path.join(root, 'assets'))) {
    throw new Error('Select a Cocos project directory containing assets.');
  }
  const warnings = [];
  const warningKeys = new Set();
  const coverage = { visitedEntries: 0, filesRead: 0, bytesRead: 0, skippedSymlinks: 0, limited: false };
  function warn(code, source = null) {
    const key = code + ':' + source;
    if (!warningKeys.has(key) && warnings.length < 100) {
      warnings.push({ code, source }); warningKeys.add(key);
    }
  }
  const sourceIds = new Map();
  function label(file) {
    if (!sourceIds.has(file)) {
      const extension = path.extname(file);
      const suffix = ['.json', '.gradle', '.kts', '.properties', '.swift', '.resolved', '.podspec',
        '.pbxproj', '.lock', '.scene', '.fire', '.prefab'].includes(extension) ? extension : '';
      sourceIds.set(file, 'source-' + String(sourceIds.size + 1).padStart(3, '0') + suffix);
    }
    return sourceIds.get(file);
  }
  function read(file, source = label(file), allowExternal = false) {
    try {
      const real = fs.realpathSync(file);
      const rel = path.relative(root, real);
      if (!allowExternal && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
        warn('outside-project-skipped', source); return null;
      }
      const size = fs.statSync(real).size;
      if (size > 8 * 1024 * 1024 || coverage.bytesRead + size > 64 * 1024 * 1024) {
        coverage.limited = true; warn('read-limit', source); return null;
      }
      const data = fs.readFileSync(real, 'utf8');
      coverage.filesRead++; coverage.bytesRead += Buffer.byteLength(data);
      return data;
    } catch (error) {
      if (error.code !== 'ENOENT') warn('unreadable-file', source);
      return null;
    }
  }
  function json(file, source = label(file), allowExternal = false) {
    const content = read(file, source, allowExternal);
    if (content === null) return null;
    try { return JSON.parse(content.replace(/^\uFEFF/, '')); }
    catch { warn('invalid-json', source); return null; }
  }
  function walk(directory, accept, depth = 0, assetScan = false) {
    if (depth > 18) { coverage.limited = true; warn('directory-depth-limit'); return []; }
    let entries;
    try {
      if (fs.lstatSync(directory).isSymbolicLink()) { coverage.skippedSymlinks++; return []; }
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') warn('unreadable-directory', label(directory));
      return [];
    }
    const files = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++coverage.visitedEntries > 20000) { coverage.limited = true; warn('entry-limit'); break; }
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { coverage.skippedSymlinks++; continue; }
      const skip = assetScan ? ['node_modules', '.git', '.svn', 'library', 'temp'].includes(entry.name)
        : SKIP.has(entry.name) || entry.name === 'assets';
      if (entry.isDirectory() && !skip) {
        files.push(...walk(file, accept, depth + 1, assetScan));
      } else if (entry.isFile() && accept(file)) files.push(file);
    }
    return files;
  }

  const pkg = json(path.join(root, 'package.json')) || {};
  const legacy = json(path.join(root, 'project.json')) || {};
  const creatorCandidates = [
    fact(version(pkg.creator?.version), 'package.json#creator.version'),
    fact(version(pkg.creatorVersion), 'package.json#creatorVersion'),
    fact(version(legacy.version), 'project.json#version'),
  ].filter(item => item.value);
  const distinct = new Set(creatorCandidates.map(item => item.value));
  const creator = {
    version: distinct.size === 1 ? creatorCandidates[0] : fact(null, null, distinct.size > 1 ? 'conflict' : 'unknown'),
    candidates: creatorCandidates,
  };
  if (distinct.size > 1) warn('conflicting-creator-versions');
  const lock = json(path.join(root, 'package-lock.json')) || {};
  // Match exact SDK package names under any scope. Read manifests, never load package code.
  const packageNames = new Set();
  const addPackage = name => { if (packageType(name)) packageNames.add(name); };
  for (const entries of [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, lock.dependencies]) {
    for (const name of Object.keys(entries || {})) addPackage(name);
  }
  for (const key of Object.keys(lock.packages || {})) {
    if (key.startsWith('node_modules/')) addPackage(key.slice('node_modules/'.length));
  }
  function packageEntries(directory) {
    try { return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)); }
    catch (error) {
      if (error.code !== 'ENOENT') warn('unreadable-directory', label(directory));
      return [];
    }
  }
  function discoverPackages(directory, scope = '') {
    for (const entry of packageEntries(directory)) {
      if (++coverage.visitedEntries > 20000) { coverage.limited = true; warn('entry-limit'); break; }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      if (!scope && /^@[a-z0-9][a-z0-9._-]*$/i.test(entry.name)) discoverPackages(path.join(directory, entry.name), entry.name + '/');
      else addPackage(scope + entry.name);
    }
  }
  discoverPackages(path.join(root, 'node_modules'));
  const names = PACKAGES.flatMap(type => {
    const matches = [...packageNames].filter(name => packageType(name) === type).sort();
    return matches.length ? matches : [type];
  });
  const dependencies = names.map(name => {
    const declared = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name] ?? pkg.optionalDependencies?.[name];
    let locked = lock.packages?.['node_modules/' + name] || lock.dependencies?.[name];
    if (locked?.link) locked = lock.packages?.[locked.resolved];
    // Installed package manifests can be workspace symlinks. Read only this exact manifest, never require it.
    const installed = json(path.join(root, 'node_modules', name, 'package.json'), 'node_modules/' + name + '/package.json', true);
    return {
      name,
      declared: fact(safeDependency(declared), 'package.json'),
      locked: fact(version(locked?.version), 'package-lock.json'),
      installed: fact(version(installed?.version), 'node_modules/' + name + '/package.json'),
    };
  });
  for (const file of ['yarn.lock', 'pnpm-lock.yaml']) {
    if (fs.existsSync(path.join(root, file))) warn('lockfile-not-parsed', file);
  }

  const integrations = [];
  const integrationPackages = new Map();
  // Discover staged SDK extensions without assuming a brand or npm scope.
  for (const container of ['packages', 'extensions']) {
    const directory = path.join(root, container);
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) {
      coverage.skippedSymlinks++; continue;
    }
    for (const entry of packageEntries(directory)) {
      if (++coverage.visitedEntries > 20000) { coverage.limited = true; warn('entry-limit'); break; }
      if (!/(?:^|-)cocos-sdk$/.test(entry.name)) continue;
      if (entry.isSymbolicLink()) { coverage.skippedSymlinks++; continue; }
      if (!entry.isDirectory()) continue;
      const extension = entry.name;
      const source = container + '/' + extension + '/sdk-integration.json';
      const info = json(path.join(root, source));
      if (info) integrations.push({ source, version: version(info.version) });
    }
  }
  // The installed SDK supplies its Creator extension names. Read metadata only.
  for (const dep of dependencies.filter(dep => packageType(dep.name) === 'cocos-sdk')) {
    if (!integrations.length || !dep.installed.value) continue;
    for (const flavor of ['creator2', 'creator3']) {
      const manifest = json(path.join(root, 'node_modules', dep.name, 'extensions', flavor, 'package.json'), undefined, true);
      for (const integration of integrations) {
        if (manifest?.name !== integration.source.split('/')[1]) continue;
        const candidates = integrationPackages.get(integration.source) || new Set();
        candidates.add(dep.name);
        integrationPackages.set(integration.source, candidates);
      }
    }
  }

  const builds = [];
  const native = [];
  const configFiles = new Set();
  const nativeName = file => /(?:\.gradle(?:\.kts)?|\.podspec|\.pbxproj)$/.test(file)
    || ['Podfile', 'Podfile.lock', 'Package.swift', 'Package.resolved', 'gradle-wrapper.properties', 'gradle.properties'].includes(path.basename(file));
  for (const file of walk(path.join(root, 'build-config'), f => f.endsWith('.json'))) configFiles.add(file);
  // Do not parse unrelated service/account configuration under settings or profiles.
  for (const relative of ['settings/builder.json', 'settings/builder.panel.json', 'settings/v2/packages/builder.json',
    'profiles/v2/packages/builder.json', 'profiles/packages/builder.json']) {
    const file = path.join(root, relative);
    if (fs.existsSync(file)) configFiles.add(file);
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && /^(?:buildConfig|build-config)[\w.-]*\.json$/.test(entry.name)) configFiles.add(path.join(root, entry.name));
  }
  let count = 0;
  for (const file of configFiles) {
    if (++count > 300) { coverage.limited = true; warn('configuration-file-limit'); break; }
    const config = json(file);
    const projected = projectBuild(config, label(file));
    if (projected) builds.push(projected);
  }
  for (const [index, file] of (options.buildConfigs || []).entries()) {
    const source = 'explicit-build-config-' + (index + 1) + '.json';
    const config = json(path.resolve(file), source, true);
    const projected = projectBuild(config, source);
    if (projected) builds.push(projected);
    else warn('unrecognized-build-configuration', source);
  }
  const nativeFiles = new Set();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && nativeName(entry.name)) nativeFiles.add(path.join(root, entry.name));
  }
  for (const dir of ['native', 'native-host', 'build']) {
    for (const file of walk(path.join(root, dir), nativeName)) nativeFiles.add(file);
  }
  count = 0;
  for (const file of nativeFiles) {
    if (++count > 300) { coverage.limited = true; warn('native-file-limit'); break; }
    const content = read(file);
    if (content !== null) native.push({ source: label(file), ...parseNative(content, path.basename(file)) });
  }
  const report = {
    schemaVersion: 2, collectorVersion: VERSION,
    scope: options.components ? 'development-environment-with-component-summary' : 'development-environment',
    collectedAt: new Date().toISOString(),
    host: { platform: process.platform, architecture: process.arch,
      osRelease: os.release().match(/^\d+(?:\.\d+){0,3}/)?.[0] || null, node: process.versions.node },
    creator, dependencies, integrations, buildConfigurations: builds, nativeConfigurations: native,
    tools: options.tools === true ? collectTools() : { status: 'skipped' },
    coverage: { filesRead: coverage.filesRead, skippedSymlinks: coverage.skippedSymlinks, limited: coverage.limited }, warnings,
    privacy: { sourcePaths: 'anonymous-source-ids', businessScriptsRead: options.components === true, assetsRead: options.components === true,
      sdkRuntimeConfigurationRead: false, externalVersionCommands: options.tools === true,
      collectorUploads: false, versionAnnotations: 'build metadata removed; custom prerelease labels redacted',
      localReading: 'Selected configuration files and opt-in scene/Prefab and JS/TS files are read locally; only allowlisted fields and aggregate component evidence enter the report.',
      excluded: ['credentials', 'URLs', 'application IDs', 'project and scene names', 'UI text', 'source code',
        'SDK collection settings', 'business build options',
        'custom component names', 'device identifiers', 'environment variable dumps', 'logs'] },
    checks: [],
    manualChecks: ['Confirm actual release targets and minimum OS versions against the final native project.',
      'Confirm official/custom engine and the exact editor release used for this project.',
      'Confirm effective toolchain: configured, locked and installed versions may differ.'],
    limitations: ['Static evidence only; no build, project code, Gradle wrapper or package install is executed.',
      'No automatic upload. File sources are anonymous; file paths cannot be opted into the report.',
      'Gradle/Ruby/Swift expressions and variable overrides are not evaluated; declarations are not effective build results.',
      'Only npm package-lock.json is parsed for npm lock versions; other lock formats are reported as unparsed.',
      'Missing fields are unknown, not disabled or unsupported. Custom layouts may require --build-config.',
      'Files outside scan roots, directory symlinks, remote assets and runtime state are not covered.',
      'Target package manifests may resolve through workspace symlinks; explicit --build-config files may be outside the project.',
      'Scene/Prefab and JS/TS component scanning requires --components. Only allowlisted component types and aggregate counts are exported.',
      'Project scripts are never executed. Logs and cocos-sdk.config.json are not scanned.',
      'External tool version commands require --tools. The output path is printed locally but is not stored in the report.',
      'Custom version annotations are redacted after comparison; redacted version labels may look equal despite a reported mismatch.'],
  };
  if (options.components) {
    const assetFiles = walk(path.join(root, 'assets'), file => /\.(?:fire|scene|prefab|[cm]?js|[cm]?ts)$/.test(file)
      && !/\.d\.[cm]?ts$/.test(file), 0, true);
    const files = assetFiles.filter(file => /\.(?:fire|scene|prefab)$/.test(file));
    const scripts = assetFiles.filter(file => !/\.(?:fire|scene|prefab)$/.test(file));
    const counts = {};
    const unknownTypes = new Set();
    const components = { filesFound: files.length, filesScanned: 0, filesParsed: 0,
      serializedComponentRecords: counts, customOrUnrecognizedRecords: 0, customOrUnrecognizedTypes: 0,
      unresolvedReferences: 0,
      limitations: ['Counts are serialized records, not runtime instances or build reachability.',
        'Script evidence lists referenced built-in types and addComponent code locations, not runtime instance counts.',
        'Computed constructors, complex aliases and binding shadowing require manual review; imports are not followed.',
        'External/remote assets, directory symlinks and runtime-only loaded code are not covered.',
        'Unknown types, node names, UI text, source code and asset paths are not exported.'] };
    for (const [index, file] of files.entries()) {
      if (index >= 2000) { coverage.limited = true; warn('component-file-limit'); break; }
      components.filesScanned++;
      const data = json(file);
      if (!Array.isArray(data)) {
        if (data !== null) warn('unsupported-serialized-format', label(file));
        continue;
      }
      components.filesParsed++;
      const ids = new Set();
      for (const object of data) {
        if (!Array.isArray(object?._components)) continue;
        for (const ref of object._components) {
          if (Number.isInteger(ref?.__id__) && ref.__id__ >= 0 && ref.__id__ < data.length) ids.add(ref.__id__);
          else components.unresolvedReferences++;
        }
      }
      for (const id of ids) {
        const type = data[id]?.__type__;
        if (typeof type !== 'string') { components.unresolvedReferences++; continue; }
        if (COMPONENT_TYPES.has(type)) counts[type] = (counts[type] || 0) + 1;
        else { components.customOrUnrecognizedRecords++; unknownTypes.add(type); }
      }
    }
    components.serializedComponentRecords = Object.fromEntries(Object.entries(counts).sort());
    components.customOrUnrecognizedTypes = unknownTypes.size;
    const usage = { filesFound: scripts.length, filesScanned: 0, filesParsed: 0,
      componentReferenceFiles: {}, addComponentCallSites: {}, customOrUnresolvedAddComponentCalls: 0 };
    for (const [index, file] of scripts.entries()) {
      if (index >= 2000) { coverage.limited = true; warn('component-script-file-limit'); break; }
      usage.filesScanned++;
      const source = read(file);
      if (source === null) continue;
      const result = scriptComponentUsage(source);
      if (result.limited) { coverage.limited = true; warn('component-script-token-limit', label(file)); continue; }
      usage.filesParsed++;
      for (const type of result.references) usage.componentReferenceFiles[type] = (usage.componentReferenceFiles[type] || 0) + 1;
      for (const [type, total] of Object.entries(result.calls)) usage.addComponentCallSites[type] = (usage.addComponentCallSites[type] || 0) + total;
      usage.customOrUnresolvedAddComponentCalls += result.unresolved;
    }
    usage.componentReferenceFiles = Object.fromEntries(Object.entries(usage.componentReferenceFiles).sort());
    usage.addComponentCallSites = Object.fromEntries(Object.entries(usage.addComponentCallSites).sort());
    components.scriptUsage = usage;
    components.detectedTypes = [...new Set([...Object.keys(counts), ...Object.keys(usage.componentReferenceFiles)])].sort();
    report.components = components;
    report.coverage = { filesRead: coverage.filesRead, skippedSymlinks: coverage.skippedSymlinks, limited: coverage.limited };
  }
  const bases = dependencies.filter(dep => packageType(dep.name) === 'cocos-sdk');
  for (const dep of dependencies) {
    if (dep.locked.value && dep.installed.value && dep.locked.value !== dep.installed.value) {
      report.checks.push({ status: 'review', code: 'installed-lock-mismatch', package: dep.name });
    }
  }
  for (const base of bases) {
    const replayName = base.name.replace(/cocos-sdk$/, 'cocos-session-replay');
    const replay = dependencies.find(dep => dep.name === replayName);
    if (base.installed.value && replay?.installed.value) report.checks.push({
      status: base.installed.value === replay.installed.value ? 'pass' : 'review', code: 'base-replay-installed-version-match',
      packages: [base.name, replay.name],
    });
  }
  for (const integration of integrations) {
    const candidates = integrationPackages.get(integration.source);
    const base = (candidates?.size === 1 ? bases.find(dep => candidates.has(dep.name)) : null)
      || (bases.length === 1 ? bases[0] : bases.find(dep => dep.name === 'cocos-sdk'));
    if (base?.installed.value && integration.version && base.installed.value !== integration.version) {
      report.checks.push({ status: 'review', code: 'staged-runtime-version-mismatch', source: integration.source });
    }
  }
  const nativeSdkVersions = new Set(native.flatMap(item =>
    (item.fields.iosSDKDeclared || []).concat(item.fields.iosSDKLocked || [])));
  if (nativeSdkVersions.size > 1) report.checks.push({ status: 'review', code: 'multiple-ios-sdk-versions-in-scanned-files',
    versions: [...nativeSdkVersions].sort() });
  report.checks.push({ status: 'manual', code: 'sdk-compatibility-requires-version-specific-review' });
  return redactVersionAnnotations(report);
}

// Customer-specific prerelease labels and build metadata can contain internal names.
// Compare raw versions above, then redact annotations only in the outgoing report.
function redactVersionAnnotations(value) {
  if (typeof value === 'string') return value.replace(/\b(\d+\.\d+\.\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?/g,
    (_, base, prerelease) => base + (prerelease ? /^(?:alpha|beta|rc|dev|preview)(?:[.-]?\d+)*$/i.test(prerelease)
      ? '-' + prerelease : '-custom' : ''));
  if (Array.isArray(value)) return value.map(redactVersionAnnotations);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, key === 'source' ? item : redactVersionAnnotations(item)]));
  return value;
}

function safeDependency(value) {
  if (typeof value !== 'string') return null;
  if (/^(file:|link:|workspace:)/.test(value)) return '<local-or-workspace>';
  const tokens = value.trim().split(/\s*\|\|\s*|\s+/).filter(Boolean);
  if (value.length < 100 && tokens.length && tokens.every(token => {
    if (/^(?:[~^<>=]{1,2}|-)$/.test(token)) return true;
    const bare = token.replace(/^[~^<>=]{1,2}/, '');
    return SEMVER.test(bare) || /^(?:\d+|[xX*])(?:\.(?:\d+|[xX*])){0,2}$/.test(bare);
  })) return value;
  return '<non-semver-spec-redacted>';
}
function get(object, key) { return key.split('.').reduce((value, part) => value?.[part], object); }
function projectBuild(config, source) {
  if (!config || typeof config !== 'object') return null;
  const platforms = ['android', 'ios', 'web-mobile', 'web-desktop', 'wechatgame', 'bytedance-mini-game',
    'windows', 'mac', 'linux', 'ohos', 'openharmony', 'harmonyos-next'];
  const platform = platforms.includes(config.platform) ? config.platform : null;
  const fields = {};
  const rules = {
    'packages.android.apiLevel': 'number',
    'packages.ios.targetVersion': 'version', 'packages.ios.osTarget.iphoneos': 'boolean',
    'packages.ios.osTarget.simulator': 'boolean',
  };
  for (const [key, type] of Object.entries(rules)) {
    const v = get(config, key);
    if ((type === 'boolean' && typeof v === 'boolean') || (type === 'number' && Number.isInteger(v) && v > 0 && v < 1000)
      || (type === 'version' && numericVersion(v))) fields[key] = v;
  }
  for (const key of ['packages.android.appABIs', 'appABIs']) {
    const v = get(config, key);
    if (Array.isArray(v)) fields[key] = v.filter(item => ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'].includes(item));
  }
  if (!platform && !Object.keys(fields).length) return null;
  return { source, platform, fields };
}

// Preserve strings for literal extraction while removing comments. No source is included in reports.
function stripComments(text, hashComments = false) {
  let result = '', quote = '', comment = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (comment) {
      if (comment === 'line' && (c === '\n' || c === '\r')) comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { result += '  '; i++; comment = ''; continue; }
      result += c === '\n' || c === '\r' ? c : ' '; continue;
    }
    if (quote) {
      result += c;
      if (c === '\\') { result += next || ''; i++; }
      else if (c === quote) quote = '';
    } else if ('\'"`'.includes(c)) { quote = c; result += c; }
    else if (c === '/' && (next === '/' || next === '*')) { comment = next === '/' ? 'line' : 'block'; result += '  '; i++; }
    else if (hashComments && c === '#') { comment = 'line'; result += ' '; }
    else result += c;
  }
  return result;
}
function parseNative(content, basename) {
  const text = basename.endsWith('.properties') ? content.replace(/^\s*[#!].*$/gm, '')
    : stripComments(content, /^Podfile|\.podspec$/.test(basename));
  const fields = {};
  const add = (key, values) => { if (values.length) fields[key] = [...new Set(values)].sort(); };
  const matches = regex => Array.from(text.matchAll(regex), m => m[1]);
  if (/\.gradle(?:\.kts)?$/.test(basename)) {
    for (const key of ['minSdk', 'targetSdk', 'compileSdk']) {
      add(key, matches(new RegExp('(?:^|[;{}])\\s*' + key + '(?:Version)?\\s*(?:=\\s*|\\(\\s*)?["\']?(\\d+)["\']?\\s*(?=[;\\r\\n)}]|$)', 'gm')).map(Number));
    }
    add('ndkVersion', matches(/\bndkVersion\s*(?:=\s*)?['"]([\d.]+)['"]/g));
    add('androidGradlePlugin', matches(/com\.android\.tools\.build:gradle:([\d.]+(?:-[\w.-]+)?)/g)
      .concat(matches(/id\s*\(?\s*['"]com\.android\.(?:application|library)['"]\s*\)?\s*version\s*['"]([\d.]+(?:-[\w.-]+)?)/g)));
    for (const name of ['ft-sdk', 'ft-session-replay']) {
      add(name, matches(new RegExp('["\'][\\w.-]+:' + name + ':([\\d.]+(?:-[\\w.-]+)?)["\']', 'g')));
    }
    add('abi', matches(/['"](arm64-v8a|armeabi-v7a|x86_64|x86)['"]/g));
  }
  if (basename === 'gradle-wrapper.properties') add('gradleWrapper', matches(/gradle-(\d+(?:\.\d+)+(?:-[\w.]+)?)-(?:bin|all)\.zip/g));
  if (basename === 'gradle.properties') {
    for (const key of ['PROP_MIN_SDK_VERSION', 'PROP_TARGET_SDK_VERSION', 'PROP_COMPILE_SDK_VERSION',
      'PROP_BUILD_TOOLS_VERSION', 'PROP_NDK_VERSION', 'PROP_CMAKE_VERSION']) {
      add(key, matches(new RegExp('^\\s*' + key + '\\s*=\\s*(\\d+(?:\\.\\d+){0,3})\\s*$', 'gm')));
    }
    const abi = matches(/^\s*PROP_APP_ABI\s*=\s*([^\r\n]+)/gm).flatMap(value => value.trim().split(':'));
    add('PROP_APP_ABI', abi.filter(value => ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'].includes(value)));
  }
  if (basename.endsWith('.pbxproj')) add('iosDeploymentTarget', matches(/\bIPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?([\d.]+)"?\s*;/g));
  if (basename === 'Podfile' || basename.endsWith('.podspec')) {
    add('iosDeploymentTarget', matches(/(?:platform\s*(?:=\s*)?:ios\s*,|\.ios\.deployment_target\s*=)\s*['"]([\d.]+)['"]/g));
    add('iosSDKDeclared', matches(/(?:pod|\.dependency)\s+['"][A-Za-z][A-Za-z0-9]*SDK(?:\/[\w]+)?['"]\s*,\s*['"]([\d.]+(?:-[\w.-]+)?)['"]/g));
  }
  if (basename === 'Podfile.lock') add('iosSDKLocked', matches(/^\s*- [A-Za-z][A-Za-z0-9]*SDK(?:\/[\w]+)? \(([\d.]+(?:-[\w.-]+)?)\)/gm));
  if (basename === 'Package.swift') {
    const tools = content.match(/^\s*\/\/\s*swift-tools-version:\s*([\d.]+)/m);
    if (tools) fields.swiftToolsVersion = [tools[1]];
    add('iosDeploymentTarget', matches(/\.iOS\(\s*(?:\.v(\d+(?:_\d+)*)|"([\d.]+)")\s*\)/g)
      .filter(Boolean).map(v => v.replace(/_/g, '.')));
    add('iosDeploymentTarget', (fields.iosDeploymentTarget || []).concat(matches(/\.iOS\(\s*"([\d.]+)"\s*\)/g)));
    add('iosSDKDeclared', matches(/\.package\(\s*url:\s*"[^"\r\n]*\/datakit-ios(?:\.git)?"\s*,\s*(?:\.exact\(\s*|exact:\s*)"(\d+\.\d+\.\d+(?:-[\w.-]+)?)"/g));
  }
  if (basename === 'Package.resolved') {
    try {
      const data = JSON.parse(content);
      const pins = data.pins || data.object?.pins || [];
      if (!Array.isArray(pins)) return { status: 'invalid-json', fields };
      add('iosSDKLocked', pins.filter(pin => /^(?:[a-z][a-z0-9]*sdk|datakit-ios|ft-sdk-ios)$/i.test(pin.identity || pin.package || ''))
        .map(pin => version(pin.state?.version)).filter(Boolean));
    } catch { return { status: 'invalid-json', fields }; }
  }
  return { status: Object.keys(fields).length ? 'literal-values-found' : 'no-supported-literals', fields };
}

function collectTools() {
  const environment = {};
  // Version tools need launch/runtime settings, not cloud tokens, signing passwords or preload hooks.
  for (const name of ['PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC',
    'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR', 'JAVA_HOME', 'JDK_HOME', 'DEVELOPER_DIR',
    'LANG', 'LC_ALL', 'GEM_HOME', 'GEM_PATH']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  const specs = [
    ['npm', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], /^\s*(\d+\.\d+\.\d+(?:-[\w.-]+)?)\s*$/m],
    ['java', 'java', ['-version'], /(?:openjdk|java) version "([\d._+\w-]+)"/],
    ['cmake', 'cmake', ['--version'], /cmake version ([\d.]+(?:-[\w.-]+)?)/],
  ];
  if (process.platform === 'darwin') specs.push(
    ['xcode', 'xcodebuild', ['-version'], /^Xcode ([\d.]+)/m],
    ['cocoapods', 'pod', ['--version'], /^\s*(\d+\.\d+\.\d+(?:\.[\w.-]+)?)\s*$/m]);
  const result = {};
  for (const [name, command, args, pattern] of specs) {
    // Fixed commands only; never interpolate user input or execute a project wrapper.
    const windowsNpm = command === 'npm.cmd';
    // The system directory need not be on PATH (e.g. a terminal with an isolated toolchain).
    const commandProcessor = environment.COMSPEC || (environment.SystemRoot
      ? path.join(environment.SystemRoot, 'System32', 'cmd.exe') : 'cmd.exe');
    const run = spawnSync(windowsNpm ? commandProcessor : command, windowsNpm ? ['/d', '/s', '/c', 'npm.cmd --version'] : args,
      { cwd: os.tmpdir(), encoding: 'utf8', timeout: 3000, maxBuffer: 64 * 1024, windowsHide: true,
        env: { ...environment, COCOAPODS_DISABLE_STATS: 'true', NO_COLOR: '1' } });
    const match = run.status === 0 && !run.error ? (run.stdout + '\n' + run.stderr).match(pattern) : null;
    result[name] = fact(match ? match[1] : null, command + ' ' + args.join(' '), match ? 'found'
      : run.error?.code === 'ETIMEDOUT' ? 'timeout' : 'unavailable');
  }
  return result;
}

function summary(report) {
  const lines = [`Cocos development environment report — collector ${VERSION}`, `Creator: ${report.creator.version.value || report.creator.version.status}`,
    `Host: ${report.host.platform}/${report.host.architecture}, Node ${report.host.node}`];
  lines.push(`Scope: ${report.scope}; ${report.privacy.sourcePaths}; tool commands=${report.privacy.externalVersionCommands}`);
  for (const dep of report.dependencies.filter(dep => dep.declared.value || dep.locked.value || dep.installed.value)) {
    lines.push(`${dep.name}: declared=${dep.declared.value || 'unknown'}, locked=${dep.locked.value || 'unknown'}, installed=${dep.installed.value || 'unknown'}`);
  }
  lines.push(`Build configurations: ${report.buildConfigurations.length}; native configuration files: ${report.nativeConfigurations.length}`);
  for (const [name, info] of Object.entries(report.tools)) if (info && typeof info === 'object') lines.push(`${name}: ${info.value || info.status}`);
  if (report.components) {
    const c = report.components;
    lines.push(`Components: ${c.filesParsed}/${c.filesFound} scene/Prefab files parsed`,
      `Detected component types (${c.detectedTypes.length}): ${c.detectedTypes.join(', ') || 'none'}`,
      `Serialized component records: ${JSON.stringify(c.serializedComponentRecords)}`,
      `Custom/unrecognized records: ${c.customOrUnrecognizedRecords}; unresolved references: ${c.unresolvedReferences}`,
      `Scripts: ${c.scriptUsage.filesParsed}/${c.scriptUsage.filesFound} files parsed`,
      `Script component reference files: ${JSON.stringify(c.scriptUsage.componentReferenceFiles)}`,
      `Script addComponent call sites: ${JSON.stringify(c.scriptUsage.addComponentCallSites)}`,
      `Custom/dynamic/unresolved addComponent call sites: ${c.scriptUsage.customOrUnresolvedAddComponentCalls}`,
      'Scene records, script reference files and creation call sites are separate evidence; runtime instance counts require running the project.');
  }
  lines.push(`Warnings: ${report.warnings.length}; scan limited: ${report.coverage.limited}`,
    'Static collection only. SDK compatibility and runtime behavior require review.');
  for (const check of report.checks.filter(item => item.status === 'review')) lines.push('REVIEW: ' + check.code);
  return lines.join('\n');
}

function confirmOverwrite(destination) {
  if (!process.stdin.isTTY) {
    throw new Error('Report already exists. Run in an interactive terminal to confirm, or use --force to overwrite.');
  }
  return new Promise(resolve => {
    const reader = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    let settled = false;
    const finish = answer => {
      if (settled) return;
      settled = true;
      reader.close();
      resolve(answer);
    };
    reader.once('close', () => finish(false));
    reader.question('Report already exists: ' + destination + '\nOverwrite? [y/N] ', answer => finish(/^(?:y|yes)$/i.test(answer.trim())));
  });
}

async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`Cocos development environment collector ${VERSION} (Node.js 16+; no external dependencies)\n\n`
      + 'node collect-cocos-env.cjs [--project DIR] [--output FILE]\n'
      + '  --components         Read scene/Prefab and JS/TS files locally for built-in component types and static counts.\n'
      + '  --tools              Run fixed external version commands (npm, Java, CMake, Xcode, CocoaPods).\n'
      + '  --build-config FILE  Include an exported build JSON (repeatable; relative to current directory).\n'
      + '  --no-tools           Skip external version commands (the default).\n'
      + '  --force              Overwrite an existing collector report without asking.\n'
      + 'Default output: cocos-env.json in the current directory. No upload or project execution.\n'
      + 'Existing reports prompt for confirmation in a terminal; non-interactive runs require --force.\n'
      + 'Scope: host, engine, toolchain, SDK dependency versions, build target, API levels and ABI.\n'
      + 'Optional component summary covers scene records, script reference files and addComponent call sites; no runtime instance counts.\n'
      + 'No source code, custom component names, SDK collection settings, runtime state or logs enter the report.\n'
      + 'Default: selected development config files only; anonymous file sources; no external commands.\n'
      + 'Selected files are read in full locally; only allowlisted values are exported. No logs or raw files are attached.\n'
      + 'Local SDK workspace symlink manifests and explicitly selected build configs may be outside the project.\n');
    return;
  }
  const destination = path.resolve(options.output);
  // Do not overwrite project configuration or follow an output symlink.
  if (!/\.json$/i.test(destination) || /^(?:package(?:-lock)?|project|cocos-sdk\.config|builder)\.json$/i.test(path.basename(destination))) {
    throw new Error('Choose a dedicated .json report filename.');
  }
  let existing;
  try { existing = fs.lstatSync(destination); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (!existing.isFile() || existing.size > 8 * 1024 * 1024) {
      throw new Error('The output is not a regular collector report. Choose another output.');
    }
    let old;
    try { old = JSON.parse(fs.readFileSync(destination, 'utf8')); } catch { /* Refuse non-report files. */ }
    if (![1, 2].includes(old?.schemaVersion) || typeof old.collectorVersion !== 'string' || typeof old.collectedAt !== 'string') {
      throw new Error('Only an existing collector report can be overwritten. Choose another output.');
    }
    if (!options.force && !await confirmOverwrite(destination)) {
      process.stdout.write('Cancelled. Existing report kept: ' + destination + '\n');
      return;
    }
  }
  const report = collect(options);
  const flags = fs.constants.O_WRONLY | (existing ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL)
    | (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(destination, flags, 0o600);
  try {
    if (existing) {
      const current = fs.fstatSync(fd);
      if (!current.isFile() || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => current[key] !== existing[key])) {
        throw new Error('The report changed while collecting or waiting for confirmation. Run again to review the current file.');
      }
      fs.ftruncateSync(fd, 0);
    }
    fs.writeFileSync(fd, JSON.stringify(report, null, 2) + '\n');
  } finally { fs.closeSync(fd); }
  process.stdout.write(summary(report) + '\nReport saved: ' + destination + '\n');
}

module.exports = { collect, parseArgs, parseNative, projectBuild, summary, main };
// Node's stdin entry point has no require.main; imports from stdin still have a parent.
if (require.main === module || (process.argv[1] === '-' && !module.parent)) {
  main().catch(error => {
    // Filesystem/process error messages can contain private absolute paths.
    process.stderr.write('Collection failed: ' + (error.code ? 'filesystem access failed (' + error.code + ')' : error.message) + '\n');
    process.exitCode = 1;
  });
}
