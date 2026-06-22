import os from 'os';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { version } from '../../package.json';
import { getUid } from './getDeviceId';

export interface TrackData {
  [key: string]: string | number | boolean | null | undefined;
}

const REQUEST_TIMEOUT_MS = 1500;
const TRACK_VALUE_LIMIT = 200;
const TRACK_REASON_LIMIT = 255;
const DEFAULT_GATEWAY = 'https://pinme.dev';
const DEFAULT_PRODUCT = 'pinme-cli';

const ACTION_OVERRIDES: Record<string, string> = {
  cli_login_success: 'success',
  cli_login_failed: 'fail',
  appkey_set_success: 'success',
  appkey_set_failed: 'fail',
  appkey_shown_success: 'view',
  appkey_shown_failed: 'fail',
  my_domains_success: 'view',
  my_domains_failed: 'fail',
  wallet_balance_success: 'view',
  wallet_balance_failed: 'fail',
  upload_history_viewed: 'view',
  upload_history_cleared: 'click',
  upload_history_failed: 'fail',
};

const EV_OVERRIDES: Record<string, string> = {
  upload_success: 'upload',
  upload_failed: 'upload',
  project_save_success: 'project_save',
  project_save_failed: 'project_save',
};

const TRACK_CHILD_SCRIPT = `
const rawUrl = process.argv[1];
if (!rawUrl) process.exit(0);
try {
  const transport = rawUrl.startsWith('https:') ? require('https') : require('http');
  const req = transport.get(rawUrl, {
    headers: {
      'User-Agent': 'Pinme-CLI-Tracker'
    }
  }, (res) => {
    res.resume();
    res.on('end', () => process.exit(0));
  });
  req.setTimeout(${REQUEST_TIMEOUT_MS}, () => req.destroy());
  req.on('error', () => process.exit(0));
  req.on('close', () => process.exit(0));
} catch (_) {
  process.exit(0);
}
`;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function shouldDisableTracking(): boolean {
  return (
    process.env.PINME_TRACKING_DISABLED === '1' ||
    process.env.DO_NOT_TRACK === '1'
  );
}

function sanitizeTrackValue(
  value: unknown,
  maxLength = TRACK_VALUE_LIMIT,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value).trim().slice(0, maxLength);
}

export function getTrackErrorReason(error: unknown): string {
  return sanitizeTrackValue(resolveErrorReason(error), TRACK_REASON_LIMIT) || 'unknown_error';
}

function responseDataMessage(data: any): string | undefined {
  if (typeof data === 'string') {
    return data;
  }

  return data?.msg
    || data?.message
    || data?.error
    || data?.data?.msg
    || data?.data?.message
    || data?.data?.error
    || data?.errors?.[0]?.message;
}

function normalizeReason(candidate: unknown, status?: number): string | undefined {
  const value = sanitizeTrackValue(candidate, TRACK_REASON_LIMIT);
  if (!value) {
    return undefined;
  }

  const lower = value.toLowerCase();

  if (/^\s*<!doctype\s+html/i.test(value) || /^\s*<html[\s>]/i.test(value)) {
    return 'api_returned_html';
  }

  const statusMatch = lower.match(/request failed with status code (\d{3})/);
  const statusCode = status || (statusMatch ? Number(statusMatch[1]) : undefined);
  if (statusCode === 520) {
    return 'gateway_520';
  }

  if (
    lower.includes('token authentication failed') ||
    lower.includes('invalid token') ||
    lower.includes('token expired') ||
    lower.includes('authentication failed') ||
    lower.includes('auth failed') ||
    lower.includes('unauthorized')
  ) {
    return 'token_auth_failed';
  }

  if (lower.includes('auth not set') || lower.includes('please login first')) {
    return 'auth_not_set';
  }

  if (lower.includes('login timeout')) {
    return 'login_timeout';
  }

  return value;
}

function resolveErrorReason(error: unknown, seen = new Set<unknown>()): string {
  if (error === undefined || error === null || seen.has(error)) {
    return 'unknown_error';
  }
  seen.add(error);

  const maybeError = error as any;
  const responseData = maybeError?.response?.data;
  const responseStatus = maybeError?.response?.status;

  const responseReason = normalizeReason(
    responseDataMessage(responseData),
    responseStatus,
  );
  if (responseReason) {
    return responseReason;
  }

  if (maybeError?.cause) {
    const causeReason = resolveErrorReason(maybeError.cause, seen);
    if (causeReason && causeReason !== 'unknown_error') {
      return causeReason;
    }
  }

  const messageReason = normalizeReason(maybeError?.message, responseStatus);
  if (messageReason) {
    return messageReason;
  }

  const stringReason = normalizeReason(maybeError?.toString?.(), responseStatus);
  return stringReason || 'unknown_error';
}

function resolveTrackAction(event: string, data: TrackData = {}): string {
  const explicitAction = data.a;
  if (typeof explicitAction === 'string' && explicitAction.trim()) {
    return explicitAction.trim();
  }

  if (ACTION_OVERRIDES[event]) {
    return ACTION_OVERRIDES[event];
  }

  if (event.endsWith('_success')) {
    return 'success';
  }

  if (event.endsWith('_failed') || event.endsWith('_fail')) {
    return 'fail';
  }

  if (event.includes('click') || event.includes('copied')) {
    return 'click';
  }

  if (event.includes('exposure')) {
    return 'exposure';
  }

  if (event.includes('view')) {
    return 'view';
  }

  if (event.endsWith('_started') || event.endsWith('_submit')) {
    return 'submit';
  }

  return 'view';
}

function resolveTrackEvent(event: string): string {
  return EV_OVERRIDES[event] || event;
}

function resolveTrackReason(
  data: TrackData,
): string | undefined {
  return sanitizeTrackValue(data.re || data.reason, TRACK_REASON_LIMIT);
}

interface ProjectContext {
  projectName?: string;
  projectDir?: string;
}

let cachedProjectContext: ProjectContext | null = null;
let cachedProjectContextCwd: string | null = null;

function resolveProjectContext(): ProjectContext {
  const cwd = process.cwd();
  if (cachedProjectContext && cachedProjectContextCwd === cwd) {
    return cachedProjectContext;
  }

  const context: ProjectContext = {};
  const configPath = path.join(cwd, 'pinme.toml');

  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const projectNameMatch = configContent.match(
        /project_name\s*=\s*"([^"]+)"/,
      );

      context.projectName =
        sanitizeTrackValue(projectNameMatch?.[1]) ||
        sanitizeTrackValue(process.env.PINME_PROJECT_NAME);
      context.projectDir = sanitizeTrackValue(path.basename(cwd));
    } catch (_) {
      context.projectName = sanitizeTrackValue(process.env.PINME_PROJECT_NAME);
    }
  } else {
    context.projectName = sanitizeTrackValue(process.env.PINME_PROJECT_NAME);
  }

  cachedProjectContext = context;
  cachedProjectContextCwd = cwd;
  return context;
}

export function getPathKind(pathValue: string): string {
  try {
    const stat = fs.statSync(pathValue);
    if (stat.isDirectory()) {
      return 'directory';
    }
    if (stat.isFile()) {
      return 'file';
    }
  } catch (_) {
    return 'unknown';
  }

  return 'unknown';
}

class Tracker {
  private static instance: Tracker;
  private readonly gateway: string;
  private readonly product: string;
  private readonly source: string | undefined;
  private readonly disabled: boolean;

  private constructor(gateway?: string, product?: string) {
    this.gateway = trimTrailingSlash(
      gateway || process.env.PINME_TRACKER_GATEWAY || DEFAULT_GATEWAY,
    );
    this.product = product || DEFAULT_PRODUCT;
    this.source = sanitizeTrackValue(process.env.PINME_TRACK_SOURCE);
    this.disabled = shouldDisableTracking();
  }

  public static getInstance(gateway?: string, product?: string): Tracker {
    if (!Tracker.instance) {
      Tracker.instance = new Tracker(gateway, product);
    }
    return Tracker.instance;
  }

  public trackEvent(
    event: string,
    page: string,
    data: TrackData = {},
  ): Promise<void> {
    if (this.disabled || !this.gateway) {
      return Promise.resolve();
    }

    try {
      const payload = this.buildPayload(event, page, data);
      const params = new URLSearchParams(payload).toString();
      const url = `${this.gateway}/track.gif?${params}`;
      this.dispatch(url);
    } catch (_) {
      // Tracking is best-effort and must never interrupt CLI flows.
    }

    return Promise.resolve();
  }

  private buildPayload(
    event: string,
    page: string,
    data: TrackData,
  ): Record<string, string> {
    const projectContext = resolveProjectContext();
    const action = resolveTrackAction(event, data);
    const ev = resolveTrackEvent(event);
    const payload: TrackData = {
      ...data,
      u: getUid(),
      s: this.source,
      pd: this.product,
      p: page,
      a: action,
      ev,
      event,
      re: resolveTrackReason(data),
      project_name: projectContext.projectName || data.project_name,
      project_dir: projectContext.projectDir,
      cli_version: version,
      node_version: process.version,
      os: os.platform(),
      arch: os.arch(),
    };

    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(payload)) {
      const normalized = sanitizeTrackValue(
        value,
        key === 're' ? TRACK_REASON_LIMIT : TRACK_VALUE_LIMIT,
      );
      if (normalized) {
        filtered[key] = normalized;
      }
    }

    return filtered;
  }

  private dispatch(url: string): void {
    const child = spawn(process.execPath, ['-e', TRACK_CHILD_SCRIPT, url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  }
}

const tracker = Tracker.getInstance();

export default tracker;
