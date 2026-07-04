/**
 * api.js — Fetch wrapper with JWT auth
 * Global object: window.API
 */

(function () {
  'use strict';

  // For production hosting (e.g. Vercel frontend calling Railway backend).
  // If your frontend and backend are hosted on separate domains, set this to your backend URL:
  // e.g., 'https://jobflow-production.up.railway.app'
  const PRODUCTION_BACKEND_URL = 'jobflow-production-b020.up.railway.app';

  const BASE_URL = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? 'http://localhost:8000/api'
    : (PRODUCTION_BACKEND_URL ? PRODUCTION_BACKEND_URL + '/api' : window.location.origin + '/api');
  const TOKEN_KEY = 'jf_token';

  /* ── Helpers ─────────────────────────────────────────────────── */
  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function buildHeaders(extra = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...extra,
    };
    const token = getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  function buildURL(path, params) {
    const url = new URL(`${BASE_URL}${path}`);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          url.searchParams.set(k, v);
        }
      });
    }
    return url.toString();
  }

  async function handleResponse(res) {
    // 401 → clear token & redirect to login
    if (res.status === 401) {
      API.clearToken();
      // Trigger login screen
      if (window.App && typeof window.App.showLogin === 'function') {
        window.App.showLogin();
      } else {
        window.location.reload();
      }
      const body = await res.json().catch(() => ({}));
      throw new APIError(401, 'Unauthorized', body);
    }

    // Try to parse JSON
    let data;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    if (!res.ok) {
      // Parse standard error format: {success: false, error: {code, message}}
      const errObj = (data && data.error) ? data.error : {};
      const code = errObj.code || res.status;
      const message = errObj.message || data?.message || `HTTP ${res.status}`;
      throw new APIError(res.status, message, errObj);
    }

    // If the server wraps in {success, data}, unwrap it
    if (data && typeof data === 'object' && 'data' in data && 'success' in data) {
      return data.data;
    }

    return data;
  }

  /* ── APIError class ──────────────────────────────────────────── */
  class APIError extends Error {
    constructor(status, message, details = {}) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.details = details;
    }
  }

  /* ── Core request ────────────────────────────────────────────── */
  async function request(method, path, { params, body, headers: extraHeaders } = {}) {
    const url = buildURL(path, params);
    const opts = {
      method,
      headers: buildHeaders(extraHeaders),
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      // Network error
      throw new APIError(0, 'Network error — is the server running?', { original: err.message });
    }

    return handleResponse(res);
  }

  /* ── Public API object ───────────────────────────────────────── */
  window.API = {
    /** GET request with optional query params */
    get(path, params) {
      return request('GET', path, { params });
    },

    /** POST request with JSON body */
    post(path, body) {
      return request('POST', path, { body });
    },

    /** PUT request with JSON body */
    put(path, body) {
      return request('PUT', path, { body });
    },

    /** PATCH request with JSON body */
    patch(path, body) {
      return request('PATCH', path, { body });
    },

    /** DELETE request */
    delete(path) {
      return request('DELETE', path);
    },

    /** Save token to localStorage */
    setToken(token) {
      localStorage.setItem(TOKEN_KEY, token);
    },

    /** Remove token from localStorage */
    clearToken() {
      localStorage.removeItem(TOKEN_KEY);
    },

    /** Check if a token is present */
    isAuthenticated() {
      const t = getToken();
      return !!t && t.length > 0;
    },

    /** Expose error class */
    APIError,

    /** Base URL (read-only) */
    BASE_URL,
  };
})();
