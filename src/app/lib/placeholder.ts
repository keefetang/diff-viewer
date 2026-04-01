export const PLACEHOLDER = {
  original: `import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Configuration
const DEFAULT_PORT = 3000;
const MAX_RETRIES = 3;
const TIMEOUT = 5000;

interface Config {
  port: number;
  host: string;
  debug: boolean;
}

function loadConfig(path: string): Config {
  const raw = process.env.CONFIG_PATH ?? path;
  return JSON.parse(readFileSync(raw, 'utf-8'));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return \`\${(bytes / 1024 ** i).toFixed(1)} \${units[i]}\`;
}

async function fetchData(url: string): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    throw new Error(\`Request failed: \${res.status}\`);
  }
  return res.json();
}

function createLogger(prefix: string) {
  return {
    info: (msg: string) => console.log(\`[\${prefix}] \${msg}\`),
    error: (msg: string) => console.error(\`[\${prefix}] \${msg}\`),
  };
}

export { loadConfig, formatBytes, fetchData, createLogger };`,

  modified: `import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Configuration
const DEFAULT_PORT = 3000;
const MAX_RETRIES = 5;
const TIMEOUT = 10_000;

interface Config {
  port: number;
  host: string;
  debug: boolean;
  logLevel: 'info' | 'warn' | 'error';
}

function loadConfig(filePath: string): Config {
  const raw = process.env.CONFIG_PATH ?? filePath;
  return JSON.parse(readFileSync(raw, 'utf-8'));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return \`\${(bytes / 1024 ** i).toFixed(2)} \${units[i]}\`;
}

function validateUrl(url: string): URL {
  return new URL(url);
}

async function fetchData(url: string): Promise<unknown> {
  const validated = validateUrl(url);
  const res = await fetch(validated.href, {
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) {
    throw new Error(\`Request failed: \${res.status} \${res.statusText}\`);
  }
  return res.json();
}

function createLogger(prefix: string) {
  return {
    info: (msg: string) => console.log(\`[\${prefix}] \${msg}\`),
    warn: (msg: string) => console.warn(\`[\${prefix}] \${msg}\`),
    error: (msg: string) => console.error(\`[\${prefix}] \${msg}\`),
  };
}

export { loadConfig, formatBytes, validateUrl, fetchData, createLogger };`,
};
