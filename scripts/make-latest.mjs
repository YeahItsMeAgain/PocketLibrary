#!/usr/bin/env node
// Build the `latest.json` manifest attached to a PocketLibrary GitHub release.
//
// The APK is signed with the updater key (minisign), and this script records
// the APK's size, SHA-256 and the *contents of the `.sig` file* in the shape the
// Rust updater in `src-tauri/src/updates/` expects.
//
// Usage:
//   node scripts/make-latest.mjs --apk <path> [--notes-file docs/release-x.y.z.md]
//
// Signing happens automatically when POCKETLIBRARY_UPDATER_KEY is set (or the
// key sits at the documented default path). See docs/updates.md.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const REPOSITORY = 'YeahItsMeAgain/PocketLibrary';
const DEFAULT_KEY = path.join(homedir(), '.android-keys', 'pocketlibrary-updater.key');
const DEFAULT_KEY_PASS = path.join(
  homedir(),
  '.android-keys',
  'pocketlibrary-updater.pass'
);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const [name, inline] = arg.slice(2).split('=', 2);
    const value = inline ?? argv[index + 1];
    if (!inline) {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Missing value for --${name}`);
      }
      index += 1;
    }
    args[name] = value;
  }
  return args;
}

function fail(message) {
  console.error(`make-latest: ${message}`);
  process.exit(1);
}

function decodeBase64Text(value) {
  return Buffer.from(value, 'base64').toString('utf8');
}

function signedVersion(signatureText) {
  // Tauri writes tab-separated `key:value` fields in the trusted comment.
  const trusted = signatureText
    .split('\n')
    .find((line) => line.startsWith('trusted comment:'));
  if (!trusted) return null;
  const field = trusted.split('\t').find((part) => part.startsWith('version:'));
  return field ? field.slice('version:'.length).trim() : null;
}

async function readNotes(args, version) {
  if (args.notes !== undefined) return args.notes;
  if (args['notes-file']) {
    return readFile(args['notes-file'], 'utf8');
  }
  const conventional = path.join('docs', `release-${version}.md`);
  if (existsSync(conventional)) {
    return readFile(conventional, 'utf8');
  }
  console.warn(
    `make-latest: no notes supplied; publishing empty notes (expected ${conventional})`
  );
  return '';
}

async function ensureSignature(apk, version, args) {
  if (args.signature) {
    return readFile(args.signature, 'utf8');
  }

  const sigPath = `${apk}.sig`;
  const key = args.key ?? process.env.POCKETLIBRARY_UPDATER_KEY ?? DEFAULT_KEY;
  if (!existsSync(key)) {
    if (existsSync(sigPath)) {
      return readFile(sigPath, 'utf8');
    }
    fail(
      `no signature found and no updater key at ${key}. Sign first with:\n` +
        `  npx tauri signer sign -f <key> -p <password> --app-version ${version} ${apk}`
    );
  }

  const password =
    args['key-pass'] ??
    process.env.POCKETLIBRARY_UPDATER_KEY_PASS ??
    (existsSync(process.env.POCKETLIBRARY_UPDATER_KEY_PASS_FILE ?? DEFAULT_KEY_PASS)
      ? (await readFile(
          process.env.POCKETLIBRARY_UPDATER_KEY_PASS_FILE ?? DEFAULT_KEY_PASS,
          'utf8'
        )).trim()
      : '');
  if (!password) {
    fail(
      'the updater key has no password available. Set POCKETLIBRARY_UPDATER_KEY_PASS ' +
        'or POCKETLIBRARY_UPDATER_KEY_PASS_FILE.'
    );
  }

  const localCli = path.join('node_modules', '.bin',
    process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
  const signArgs = [
    'signer',
    'sign',
    '-f',
    key,
    '-p',
    password,
    '--app-version',
    version,
    apk,
  ];
  const result = existsSync(localCli)
    ? spawnSync(localCli, signArgs, { stdio: 'inherit' })
    : spawnSync(
        'npx',
        ['--yes', '@tauri-apps/cli@2', ...signArgs],
        { stdio: 'inherit' }
      );
  if (result.status !== 0) {
    fail('tauri signer sign failed');
  }
  if (!existsSync(sigPath)) {
    fail(`signing did not produce ${sigPath}`);
  }
  return readFile(sigPath, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apk = args.apk ?? process.env.APK;
  if (!apk) fail('usage: node scripts/make-latest.mjs --apk <path> [options]');

  const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
  const version = args.version ?? config.version;
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`version ${JSON.stringify(version)} is not semantic versioning`);
  }

  const apkStat = await stat(apk);
  if (!apkStat.isFile() || apkStat.size === 0) {
    fail(`${apk} is not a non-empty file`);
  }
  if (apkStat.size > 512 * 1024 * 1024) {
    fail(`${apk} is larger than the 512 MiB updater limit`);
  }

  const signatureText = (await ensureSignature(apk, version, args)).trim();
  if (!signatureText.startsWith('dW50cnVzdGVkIGNvbW1lbnQ6')) {
    fail(
      'the signature file does not look like a Tauri/minisign signature. ' +
        'Do not base64-encode it a second time: latest.json stores the .sig contents.'
    );
  }
  const boundVersion = signedVersion(decodeBase64Text(signatureText));
  if (!boundVersion) {
    fail(
      `the signature is not bound to a version. Re-sign with --app-version ${version} ` +
        '(docs/updates.md), then rerun.'
    );
  }
  if (boundVersion.replace(/^v/, '') !== version) {
    fail(
      `the signature is bound to ${boundVersion}, but the manifest version is ${version}`
    );
  }

  const sha256 = createHash('sha256')
    .update(await readFile(apk))
    .digest('hex');
  const assetName = `PocketLibrary-${version}.apk`;
  const url =
    args.url ??
    `https://github.com/${REPOSITORY}/releases/download/v${version}/${assetName}`;

  const manifest = {
    version,
    notes: await readNotes(args, version),
    pubDate: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    url,
    size: apkStat.size,
    sha256,
    signature: signatureText,
  };

  const out = args.out ?? 'latest.json';
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${out}`);
  console.log(`  version  ${manifest.version}`);
  console.log(`  asset    ${assetName}`);
  console.log(`  size     ${manifest.size} bytes`);
  console.log(`  sha256   ${manifest.sha256}`);
  console.log(`  url      ${manifest.url}`);
  console.log(
    `\nAttach ${out} and the APK (renamed to ${assetName}) to the GitHub release.`
  );
}

main().catch((error) => fail(error.stack ?? String(error)));
