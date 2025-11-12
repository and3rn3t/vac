function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parsePositiveInt(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function parseDurationToMs(input, fallbackMs) {
  if (input === undefined || input === null || input === '') return fallbackMs;
  if (typeof input === 'number') return Number.isFinite(input) ? input : fallbackMs;
  const str = String(input).trim();
  if (!str) return fallbackMs;
  if (/^\d+$/.test(str)) return parseInt(str, 10);
  const m = str.match(/^([0-9]+)(ms|s|m|h|d|w)$/i);
  if (!m) return fallbackMs;
  const value = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const factors = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return value * (factors[unit] || 0) || fallbackMs;
}

function validateConnectBody(body) {
  const errors = [];
  const ip = body?.ip;
  const blid = body?.blid;
  const password = body?.password;
  if (!isNonEmptyString(ip)) errors.push('ip is required');
  if (!isNonEmptyString(blid)) errors.push('blid is required');
  if (!isNonEmptyString(password)) errors.push('password is required');
  return { ok: errors.length === 0, errors };
}

function validateCleanRoomsBody(body) {
  const errors = [];
  const regions = Array.isArray(body?.regions)
    ? body.regions
    : (typeof body?.regions === 'string' ? [body.regions] : null);
  if (!regions || regions.length === 0) errors.push('regions array is required');
  const ordered = body?.ordered;
  if (ordered !== undefined && typeof ordered !== 'boolean') errors.push('ordered must be boolean');
  if (body?.maxPoints !== undefined && !Number.isFinite(Number(body.maxPoints))) errors.push('maxPoints must be a number');
  return { ok: errors.length === 0, errors, regions };
}

function validateMapQuery(query) {
  const errors = [];
  const missionId = typeof query.missionId === 'string' ? query.missionId.trim() : null;
  const maxPoints = query.maxPoints ?? query.maxSamples;
  let parsedMaxPoints = undefined;
  if (maxPoints !== undefined) {
    parsedMaxPoints = parsePositiveInt(maxPoints, null);
    if (parsedMaxPoints === null) errors.push('maxPoints must be a positive integer');
  }
  return { ok: errors.length === 0, errors, missionId, maxPoints: parsedMaxPoints };
}

function validateAnalyticsQuery(query, defaults) {
  const errors = [];
  const rangeRaw = query.range ?? query.rangeMs;
  const bucketRaw = query.bucket ?? query.bucketMs;
  const rangeMs = parseDurationToMs(rangeRaw, defaults.defaultRangeMs);
  if (!Number.isFinite(rangeMs) || rangeMs <= 0) errors.push('Invalid range value');
  let bucketSizeMs = undefined;
  if (bucketRaw !== undefined) {
    bucketSizeMs = parseDurationToMs(bucketRaw, null);
    if (!Number.isFinite(bucketSizeMs) || bucketSizeMs <= 0) errors.push('Invalid bucket value');
  }
  return { ok: errors.length === 0, errors, rangeMs, bucketSizeMs };
}

function sendError(res, status, message, code, requestId) {
  const body = { error: message };
  if (code) body.code = code;
  if (requestId) body.requestId = requestId;
  res.status(status).json(body);
}

module.exports = {
  isNonEmptyString,
  parsePositiveInt,
  parseDurationToMs,
  validateConnectBody,
  validateCleanRoomsBody,
  validateMapQuery,
  validateAnalyticsQuery,
  sendError
};
