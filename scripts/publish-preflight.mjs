import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import releasePolicy from './release-policy.cjs';
import { verifyRelease } from './verify-release.mjs';

const packageName = '@truewatchtech/cocos-sdk';

export async function planPublish(version, gitSha, fetchImpl = fetch) {
  if (!/^[0-9a-f]{40}$/.test(gitSha || '')) throw new Error('A release commit SHA is required');
  const response = await fetchImpl(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}?release_check=${Date.now()}`,
    { signal: AbortSignal.timeout(30000) },
  );
  let versions = {};
  if (response.status !== 404) {
    if (!response.ok) throw new Error(`Registry preflight failed: ${response.status}`);
    const document = await response.json();
    if (document?.name !== packageName || !document.versions
      || typeof document.versions !== 'object' || Array.isArray(document.versions)) {
      throw new Error('Invalid npm package document');
    }
    versions = document.versions;
  }
  const npmDistTag = releasePolicy.selectDistTag(version, Object.keys(versions));
  const published = versions[version];
  if (published && (published.name !== packageName || published.version !== version || published.gitHead !== gitSha)) {
    throw new Error('Existing npm version has a different release identity');
  }
  return { npmDistTag, alreadyPublished: Boolean(published) };
}

async function main() {
  if (!process.env.RELEASE_GIT_TAG) throw new Error('A release tag is required');
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  verifyRelease(process.env.RELEASE_GIT_TAG);
  const { version } = JSON.parse(readFileSync('packages/cocos/package.json', 'utf8'));
  const plan = await planPublish(version, process.env.GITHUB_SHA);
  appendFileSync(process.env.GITHUB_OUTPUT,
    `npm_dist_tag=${plan.npmDistTag}\nalready_published=${plan.alreadyPublished}\n`);
  console.log(plan.alreadyPublished
    ? `${packageName}@${version} is already published from this commit`
    : `Publish ${packageName}@${version} under ${plan.npmDistTag}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
