import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(repositoryRoot, 'src', 'shared', 'api');
const snapshotPath = join(outputDirectory, 'openapi.json');
const lockPath = join(outputDirectory, 'contract-lock.json');
const usage = `Usage:
  node scripts/sync-api-contract.mjs --source <JSON file or HTTP(S) URL> --version <exact info.version>
  node scripts/sync-api-contract.mjs --check

Requires Node.js 18 or later. Outputs are relative to this script's repository.`;

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!['--source', '--version', '--check', '--help'].includes(flag)) {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const key = flag.slice(2);
    if (key in options) throw new Error(`Duplicate argument: ${flag}`);
    if (key === 'check' || key === 'help') options[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      options[key] = value;
    }
  }
  if (options.help && Object.keys(options).length !== 1) {
    throw new Error('--help must be used alone.');
  }
  if (options.check && Object.keys(options).length !== 1) {
    throw new Error('--check must be used alone; it reads the existing local files only.');
  }
  if (!options.help && !options.check && (!options.source || !options.version)) {
    throw new Error('--source and --version are both required.');
  }
  return options;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateContract(document) {
  if (!isObject(document) || typeof document.openapi !== 'string'
    || !/^3\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(document.openapi)) {
    throw new Error('The contract must be an OpenAPI 3.x JSON object.');
  }
  if (!isObject(document.info) || typeof document.info.version !== 'string'
    || document.info.version.trim().length === 0) {
    throw new Error('The contract must contain a nonempty info.version string.');
  }
  if (!isObject(document.paths)) throw new Error('The contract must contain a paths object.');
  return document;
}

function checksum(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Contract download failed: HTTP ${response.status}`);
    return response.text();
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) {
    throw new Error('Only local files and HTTP(S) URLs are supported.');
  }
  return readFile(resolve(source), 'utf8');
}

async function readOptional(path) {
  try { return await readFile(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function replacePair(snapshot, lock) {
  await mkdir(outputDirectory, { recursive: true });
  const id = randomUUID();
  const stagedSnapshot = join(outputDirectory, `.openapi-${id}.tmp`);
  const stagedLock = join(outputDirectory, `.contract-lock-${id}.tmp`);
  const rollbackSnapshot = join(outputDirectory, `.openapi-${id}.rollback`);
  const previousSnapshot = await readOptional(snapshotPath);
  let snapshotReplaced = false;
  try {
    await writeFile(stagedSnapshot, snapshot, { flag: 'wx' });
    await writeFile(stagedLock, lock, { flag: 'wx' });
    await rename(stagedSnapshot, snapshotPath);
    snapshotReplaced = true;
    await rename(stagedLock, lockPath);
  } catch (error) {
    if (snapshotReplaced) {
      if (previousSnapshot === null) await rm(snapshotPath, { force: true });
      else {
        await writeFile(rollbackSnapshot, previousSnapshot, { flag: 'wx' });
        await rename(rollbackSnapshot, snapshotPath);
      }
    }
    throw error;
  } finally {
    await Promise.all([stagedSnapshot, stagedLock, rollbackSnapshot]
      .map((path) => rm(path, { force: true })));
  }
}

async function checkSnapshot() {
  const bytes = await readFile(snapshotPath);
  const document = validateContract(JSON.parse(bytes.toString('utf8')));
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  if (!isObject(lock) || lock.version !== document.info.version
    || typeof lock.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(lock.sha256)
    || lock.sha256 !== checksum(bytes)) {
    throw new Error('Snapshot and contract-lock.json do not match. Sync the approved contract again.');
  }
  console.log(`API contract verified: ${lock.version} (${lock.sha256})`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) return console.log(usage);
  if (options.check) return checkSnapshot();
  const document = validateContract(JSON.parse(await readSource(options.source)));
  if (document.info.version !== options.version) {
    throw new Error(`Version mismatch: requested ${options.version}, received ${document.info.version}`);
  }
  const snapshot = `${JSON.stringify(document, null, 2)}\n`;
  const lock = `${JSON.stringify({ version: options.version, sha256: checksum(snapshot) }, null, 2)}\n`;
  await replacePair(snapshot, lock);
  console.log(`API contract synchronized: ${options.version}`);
  console.log(`Snapshot: ${snapshotPath}`);
  console.log(`Lock: ${lockPath}`);
}

main().catch((error) => {
  console.error(`API contract error: ${error.message}`);
  process.exitCode = 1;
});
