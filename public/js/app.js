/**
 * app.js — SPA router & global utilities
 * Must be loaded after api.js and auth.js.
 */

(function () {
  'use strict';

  /* ── Route registry ─────────────────────────────────────────── */
  const routes = {
    overview: {
      title:    'Overview',
      subtitle: 'Platform health at a glance',
      render:   () => Dashboard.renderDashboardPage(),
    },
    queues: {
      title:    'Queues',
      subtitle: 'Manage job queues and configurations',
      render:   () => Queues.renderQueuesPage(),
    },
    jobs: {
      title:    'Jobs',
      subtitle: 'Browse and manage all jobs',
      render:   () => Jobs.renderJobsPage(),
    },
    workers: {
      title:    'Workers',
      subtitle: 'Monitor connected worker processes',
      render:   () => Workers.renderWorkersPage(),
    },
    logs: {
      title:    'Execution Logs',
      subtitle: 'Inspect job execution history and logs',
      render:   () => Executions.renderExecutionsPage(),
    },
    dlq: {
      title:    'Dead Letter Queue',
      subtitle: 'Jobs that exhausted all retry attempts',
      render:   () => DLQ.renderDLQPage(),
    },
  };

  /* ── State ───────────────────────────────────────────────────── */
  let currentPage     = null;
  let pollingInterval = null;
  let sidebarCollapsed = false;
  let mobileSidebarOpen = false;

  /* ── Clock ───────────────────────────────────────────────────── */
  function startClock() {
    function tick() {
      const el = document.getElementById('current-time');
      if (el) {
        const now = new Date();
        el.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ── Navigate ────────────────────────────────────────────────── */
  function navigate(page) {
    if (!routes[page]) {
      console.warn('Unknown page:', page);
      page = 'overview';
    }

    // Guard: require auth
    if (!API.isAuthenticated()) {
      showLogin();
      return;
    }

    // Clear existing polling
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }

    // Close drawer
    closeDrawer();

    // Update active nav
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === page);
    });

    // Update header
    const route = routes[page];
    document.getElementById('header-title').textContent    = route.title;
    document.getElementById('header-subtitle').textContent = route.subtitle;

    currentPage = page;

    // Render
    const content = document.getElementById('page-content');
    content.innerHTML = '<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading…</span></div>';

    // Small defer to allow spinner to paint
    setTimeout(() => {
      try {
        route.render();
      } catch (err) {
        console.error('Render error:', err);
        content.innerHTML = `
          <div class="loading-state" style="color:var(--error);">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <span>Failed to load page: ${err.message}</span>
          </div>`;
      }
    }, 20);

    // Close mobile sidebar after navigation
    if (mobileSidebarOpen) toggleMobileSidebar();
  }

  /* ── Auth overlay ────────────────────────────────────────────── */
  function showLogin() {
    const overlay = document.getElementById('auth-overlay');
    overlay.classList.remove('hidden');
    Auth.renderLoginPage();
  }

  function hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    overlay.classList.add('hidden');
    updateUserDisplay();
  }

  function updateUserDisplay() {
    try {
      const raw = localStorage.getItem('jf_user');
      if (raw) {
        const user = JSON.parse(raw);
        const el = document.getElementById('nav-username');
        if (el) el.textContent = user.first_name || user.email || 'User';
      }
    } catch (_) {}
  }

  /* ── Toast system ────────────────────────────────────────────── */
  const TOAST_ICONS = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info:    `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };

  const TOAST_TITLES = {
    success: 'Success',
    error:   'Error',
    warning: 'Warning',
    info:    'Info',
  };

  function showToast(message, type = 'info', duration = 4500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      ${TOAST_ICONS[type] || TOAST_ICONS.info}
      <div class="toast-body">
        <div class="toast-title">${TOAST_TITLES[type] || 'Notice'}</div>
        <div class="toast-message">${message}</div>
      </div>
      <button class="toast-close" aria-label="Dismiss">×</button>
    `;

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));

    container.appendChild(toast);

    const timer = setTimeout(() => removeToast(toast), duration);
    toast._timer = timer;
  }

  function removeToast(toast) {
    if (toast._timer) clearTimeout(toast._timer);
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 320);
  }

  /* ── Modal system ─────────────────────────────────────────────── */
  function showModal(title, bodyHTML, actions = [], opts = {}) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML    = bodyHTML;

    const footer = document.getElementById('modal-footer');
    footer.innerHTML = '';

    // Add cancel button by default
    const hasCancel = actions.some(a => a.label === 'Cancel' || a.cancel);
    if (!hasCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn btn-secondary';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.onclick = closeModal;
      footer.appendChild(cancelBtn);
    }

    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.className = `btn ${action.class || 'btn-primary'}`;
      btn.textContent = action.label;
      btn.disabled = !!action.disabled;
      btn.onclick = action.onclick;
      footer.appendChild(btn);
    });

    // Optional modal size
    const mc = document.getElementById('modal-container');
    mc.className = `modal${opts.size ? ' modal-' + opts.size : ''}`;

    const backdrop = document.getElementById('modal-backdrop');
    backdrop.classList.add('active');

    // Trap focus
    setTimeout(() => {
      const first = document.querySelector('#modal-container .form-input, #modal-container select, #modal-container button');
      if (first) first.focus();
    }, 50);
  }

  function closeModal() {
    const backdrop = document.getElementById('modal-backdrop');
    backdrop.classList.remove('active');
  }

  /* ── Drawer system ─────────────────────────────────────────────── */
  function showDrawer(title, bodyHTML, footerHTML = '') {
    document.getElementById('drawer-title').textContent = title;
    document.getElementById('drawer-body').innerHTML    = bodyHTML;
    document.getElementById('drawer-footer').innerHTML  = footerHTML;
    document.getElementById('side-drawer').classList.add('open');
  }

  function closeDrawer() {
    document.getElementById('side-drawer').classList.remove('open');
  }

  /* ── Sidebar toggle ─────────────────────────────────────────── */
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
  }

  function toggleMobileSidebar() {
    mobileSidebarOpen = !mobileSidebarOpen;
    document.getElementById('sidebar').classList.toggle('mobile-open', mobileSidebarOpen);
  }

  /* ── Backdrop click closes modal ────────────────────────────── */
  document.getElementById('modal-backdrop').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  /* ── Sidebar nav click handlers ──────────────────────────────── */
  document.getElementById('sidebar-nav').addEventListener('click', function (e) {
    const item = e.target.closest('.nav-item[data-page]');
    if (item) navigate(item.dataset.page);
  });

  /* ── Logout ──────────────────────────────────────────────────── */
  document.getElementById('logout-nav').addEventListener('click', function () {
    API.clearToken();
    localStorage.removeItem('jf_user');
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    showLogin();
    showToast('Signed out successfully.', 'info');
  });

  /* ── Sidebar toggle button ───────────────────────────────────── */
  document.getElementById('sidebar-toggle').addEventListener('click', toggleSidebar);

  /* ── Responsive: show hamburger on mobile ────────────────────── */
  function checkMobile() {
    const mobileBtn = document.getElementById('mobile-menu-btn');
    if (window.innerWidth <= 900) {
      mobileBtn.style.display = 'block';
    } else {
      mobileBtn.style.display = 'none';
      // Close mobile sidebar if open
      if (mobileSidebarOpen) {
        mobileSidebarOpen = false;
        document.getElementById('sidebar').classList.remove('mobile-open');
      }
    }
  }

  window.addEventListener('resize', checkMobile);

  /* ── Keyboard shortcuts ──────────────────────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeModal();
      closeDrawer();
    }
  });

  /* ── DLQ badge updater ───────────────────────────────────────── */
  async function updateDLQBadge() {
    if (!API.isAuthenticated()) return;
    try {
      const data = await API.get('/dlq', { limit: 1 });
      const total = (data && (data.total || data.count || (Array.isArray(data) ? data.length : 0))) || 0;
      const badge = document.getElementById('dlq-badge');
      if (badge) {
        if (total > 0) {
          badge.textContent = total > 99 ? '99+' : total;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      }
    } catch (_) {}
  }

  /* ── Polling registry ────────────────────────────────────────── */
  function setPollingInterval(fn, ms) {
    if (pollingInterval) clearInterval(pollingInterval);
    fn(); // immediate call
    pollingInterval = setInterval(fn, ms);
  }

  /* ── Init ────────────────────────────────────────────────────── */
  function init() {
    checkMobile();
    startClock();

    if (!API.isAuthenticated()) {
      showLogin();
      return;
    }

    updateUserDisplay();
    navigate('overview');

    // Refresh DLQ badge every 30s
    updateDLQBadge();
    setInterval(updateDLQBadge, 30000);
  }

  /* ── Expose App globally ─────────────────────────────────────── */
  window.App = {
    navigate,
    showLogin,
    hideAuthOverlay,
    showToast,
    showModal,
    closeModal,
    showDrawer,
    closeDrawer,
    setPollingInterval,
    toggleMobileSidebar,
    init,
  };

  /* ── Utility functions used across modules ─────────────────── */
  window.Utils = {
    /** Format ISO date to "2m ago" */
    timeAgo(isoStr) {
      if (!isoStr) return '—';
      const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
      if (diff < 5)    return 'just now';
      if (diff < 60)   return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    },

    /** Format seconds to "1m 23s" */
    duration(seconds) {
      if (!seconds && seconds !== 0) return '—';
      if (seconds < 60) return `${seconds.toFixed(1)}s`;
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}m ${s}s`;
    },

    /** Format ISO date to locale string */
    formatDate(isoStr) {
      if (!isoStr) return '—';
      return new Date(isoStr).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    },

    /** Return status badge HTML */
    badge(status) {
      const s = (status || 'unknown').toLowerCase();
      return `<span class="badge badge-${s}">${s}</span>`;
    },

    /** Safely truncate string */
    truncate(str, len = 40) {
      if (!str) return '—';
      return str.length > len ? str.slice(0, len) + '…' : str;
    },

    /** Pretty-print JSON */
    prettyJSON(obj) {
      try {
        return JSON.stringify(typeof obj === 'string' ? JSON.parse(obj) : obj, null, 2);
      } catch (_) {
        return String(obj);
      }
    },

    /** Error rate as % string */
    errorRate(failed, total) {
      if (!total) return '0%';
      return ((failed / total) * 100).toFixed(1) + '%';
    },

    /** Draw a simple sparkline on a canvas element */
    drawSparkline(canvas, data, opts = {}) {
      if (!canvas || !data || data.length === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const w   = canvas.offsetWidth  || canvas.width;
      const h   = canvas.offsetHeight || canvas.height;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const padding = opts.padding || 8;
      const color   = opts.color   || '#6366f1';
      const fillColor = opts.fillColor || 'rgba(99,102,241,0.15)';

      const min = Math.min(...data);
      const max = Math.max(...data);
      const range = max - min || 1;

      const pw = w - padding * 2;
      const ph = h - padding * 2;
      const step = pw / (data.length - 1 || 1);

      const points = data.map((v, i) => ({
        x: padding + i * step,
        y: padding + ph - ((v - min) / range) * ph,
      }));

      ctx.clearRect(0, 0, w, h);

      // Fill area
      ctx.beginPath();
      ctx.moveTo(points[0].x, h - padding);
      points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(points[points.length - 1].x, h - padding);
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      points.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();

      // Last point dot
      const last = points[points.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },

    /** Draw a multi-line canvas chart */
    drawLineChart(canvas, datasets, labels, opts = {}) {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w   = canvas.offsetWidth  || canvas.width;
      const h   = canvas.offsetHeight || canvas.height;
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const padL = opts.padL || 40;
      const padR = opts.padR || 16;
      const padT = opts.padT || 16;
      const padB = opts.padB || 32;

      const pw = w - padL - padR;
      const ph = h - padT - padB;

      // Grid
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      const gridLines = 4;
      for (let i = 0; i <= gridLines; i++) {
        const y = padT + (ph / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + pw, y);
        ctx.stroke();
      }

      if (!datasets || datasets.length === 0) return;

      const allValues = datasets.flatMap(d => d.data);
      const min = opts.min !== undefined ? opts.min : Math.min(...allValues);
      const max = opts.max !== undefined ? opts.max : Math.max(...allValues) || 1;
      const range = max - min || 1;
      const dataLen = datasets[0].data.length;
      const step = pw / (dataLen - 1 || 1);

      // Y-axis labels
      ctx.fillStyle = 'rgba(148,163,184,0.6)';
      ctx.font = `${10 * dpr / dpr}px Inter, sans-serif`;
      ctx.textAlign = 'right';
      for (let i = 0; i <= gridLines; i++) {
        const val = max - (range / gridLines) * i;
        const y   = padT + (ph / gridLines) * i;
        ctx.fillText(Math.round(val), padL - 6, y + 4);
      }

      // X-axis labels
      if (labels && labels.length > 0) {
        ctx.textAlign = 'center';
        const skip = Math.ceil(labels.length / 6);
        labels.forEach((lbl, i) => {
          if (i % skip !== 0 && i !== labels.length - 1) return;
          const x = padL + i * step;
          ctx.fillText(lbl, x, h - padB + 16);
        });
      }

      // Datasets
      datasets.forEach(ds => {
        const pts = ds.data.map((v, i) => ({
          x: padL + i * step,
          y: padT + ph - ((v - min) / range) * ph,
        }));

        // Fill
        if (ds.fill !== false) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, padT + ph);
          pts.forEach(p => ctx.lineTo(p.x, p.y));
          ctx.lineTo(pts[pts.length - 1].x, padT + ph);
          ctx.closePath();
          ctx.fillStyle = ds.fillColor || 'rgba(99,102,241,0.08)';
          ctx.fill();
        }

        // Line
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        ctx.strokeStyle = ds.color || '#6366f1';
        ctx.lineWidth   = 2;
        ctx.lineJoin    = 'round';
        ctx.stroke();
      });
    },
  };

  /* ── Boot ────────────────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => App.init());
})();
