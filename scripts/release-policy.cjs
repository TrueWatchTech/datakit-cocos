'use strict';

const PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta)\.(0|[1-9]\d*))?$/;

function parse(version) {
  const match = PATTERN.exec(version);
  if (!match) throw new Error(`Unsupported release version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]),
    { alpha: 0, beta: 1, stable: 2 }[match[4] || 'stable'], Number(match[5] || 0)];
}

function compare(left, right) {
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function selectDistTag(version, publishedVersions) {
  parse(version);
  const published = publishedVersions.filter(value => PATTERN.test(value));
  const stable = published.filter(value => !value.includes('-'));
  const prerelease = version.includes('-');
  const channel = prerelease ? version.split('-')[1].split('.')[0] : 'latest';
  if (!prerelease) {
    if (stable.some(value => compare(value, version) > 0)) {
      throw new Error('Refusing to move latest to an older stable release');
    }
    return 'latest';
  }
  if (stable.length === 0 && published.every(value => compare(version, value) >= 0)) {
    return 'latest';
  }
  return channel;
}

module.exports = { selectDistTag };
