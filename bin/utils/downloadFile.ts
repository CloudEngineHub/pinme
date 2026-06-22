import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);

export interface DownloadFileWithRetriesOptions {
  attempts?: number;
  retryDelayMs?: number;
  minBytes?: number;
  timeoutMs?: number;
  request?: (
    url: string,
    options: { timeoutMs: number; headers: Record<string, string> },
  ) => Promise<{ data: NodeJS.ReadableStream }>;
  onAttempt?: (attempt: number, attempts: number) => void;
  onAttemptFailure?: (attempt: number, error: unknown) => void;
}

export interface DownloadFileResult {
  attempts: number;
  bytes: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getDownloadErrorMessage(error: any): string {
  const status = error?.response?.status;
  const statusText = error?.response?.statusText;

  if (status) {
    return `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
  }

  if (error?.code && error?.message) {
    return `${error.code}: ${error.message}`;
  }

  return error?.message || String(error);
}

async function requestDownload(
  url: string,
  options: { timeoutMs: number; headers: Record<string, string> },
): Promise<{ data: NodeJS.ReadableStream }> {
  return axios.get(url, {
    responseType: 'stream',
    timeout: options.timeoutMs,
    headers: options.headers,
  });
}

export async function downloadFileWithRetries(
  url: string,
  destinationPath: string,
  options: DownloadFileWithRetriesOptions = {},
): Promise<DownloadFileResult> {
  const attempts = options.attempts ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const minBytes = options.minBytes ?? 1;
  const timeoutMs = options.timeoutMs ?? 120000;
  const request = options.request ?? requestDownload;
  const headers = {
    'User-Agent': 'pinme-cli',
  };
  let lastError: unknown;

  fs.ensureDirSync(path.dirname(destinationPath));
  fs.removeSync(destinationPath);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const tempPath = `${destinationPath}.download-${process.pid}-${Date.now()}-${attempt}.tmp`;

    try {
      options.onAttempt?.(attempt, attempts);

      const response = await request(url, { timeoutMs, headers });

      await pipelineAsync(response.data, createWriteStream(tempPath));

      const bytes = fs.statSync(tempPath).size;
      if (bytes < minBytes) {
        throw new Error(`Downloaded file is too small (${bytes} bytes; expected at least ${minBytes} bytes).`);
      }

      fs.moveSync(tempPath, destinationPath, { overwrite: true });
      return { attempts: attempt, bytes };
    } catch (error) {
      lastError = error;
      fs.removeSync(tempPath);
      options.onAttemptFailure?.(attempt, error);

      if (attempt < attempts) {
        await sleep(retryDelayMs);
      }
    }
  }

  throw new Error(`Failed to download ${url} after ${attempts} attempts: ${getDownloadErrorMessage(lastError)}`);
}
