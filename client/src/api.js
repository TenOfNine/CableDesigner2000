// Kleiner Fetch-Wrapper für die REST-API

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, url, body, { raw = false, contentType } = {}) {
  const headers = { 'X-Requested-With': 'HarnessDesigner' };
  let payload;
  if (body !== undefined) {
    if (raw) {
      headers['Content-Type'] = contentType || 'application/octet-stream';
      payload = body;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Server nicht erreichbar.', 0);
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(data?.error || `Fehler ${res.status}`, res.status, data);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, file) => request('PUT', url, file, { raw: true, contentType: file.type }),
};

export function partImageUrl(part) {
  if (!part || !part.id || !part.hasImage) return null;
  return `/api/parts/${part.id}/image?v=${encodeURIComponent(part.imageVersion || '')}`;
}

// Lädt ein Bild als Data-URL (für Exporte/Druck)
export async function fetchAsDataUrl(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) return null;
  const blob = await res.blob();
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => resolve(null);
    r.readAsDataURL(blob);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFilename(s) {
  return String(s || 'export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100) || 'export';
}
