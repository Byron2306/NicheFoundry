#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { executeTransform } = require('../lib/media_transform');

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--workspace') args.workspace = argv[++index];
    else if (value === '--request') args.request = argv[++index];
    else if (value === '--help' || value === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/media_transform.js --workspace <dir> --request <request.json> [--dry-run]',
    '',
    'Request kinds:',
    '  image  format conversion, resize, fit/crop, rotate, flip, quality, metadata stripping',
    '  video  trim, concatenate, resize, transcode, fps, audio mute/replace/volume, subtitles, image overlay',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!args.workspace || !args.request) throw new Error('--workspace and --request are required.');
  const workspaceDir = path.resolve(args.workspace);
  const requestPath = path.resolve(args.request);
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  const result = executeTransform({ workspaceDir, request, dryRun: args.dryRun });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
