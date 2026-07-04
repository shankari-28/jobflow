/**
 * workers.js — Worker monitor page with live cards and heartbeat chart
 */

(function () {
  'use strict';

  let workerList = [];

  /* ── Main render ─────────────────────────────────────────────── */
  async function renderWorkersPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading workers…</span></div>`;

    await loadWorkers();
    renderPage();

    // Live polling every 5s
    App.setPollingInterval(async () => {
      await loadWorkers();
      refreshCards();
    }, 5000);
  }

  async function loadWorkers() {
    try {
      const data = await API.get('/workers');
      workerList = Array.isArray(data) ? data : (data.data || data.workers || []);
    } catch (err) {
      console.warn('Workers fetch failed:', err.message);
      workerList = [];
    }
  }

  /* ── Full page layout ────────────────────────────────────────── */
  function renderPage() {
    const content = document.getElementById('page-content');

    const totalWorkers = workerList.length;
    const idle    = workerList.filter(w => getStatus(w) === 'idle').length;
    const busy    = workerList.filter(w => getStatus(w) === 'busy').length;
    const offline = workerList.filter(w => getStatus(w) === 'offline').length;

    content.innerHTML = `
      <!-- Summary bar -->
      <div class="grid grid-4 mb-24" style="grid-template-columns:repeat(4,1fr);">
        <div class="card accent-purple" style="padding:16px;">
          <div class="card-title">Total Workers</div>
          <div class="card-value" style="font-size:28px;">${totalWorkers}</div>
        </div>
        <div class="card accent-green" style="padding:16px;">
          <div class="card-title">Idle</div>
          <div class="card-value" style="font-size:28px;color:var(--success);">${idle}</div>
        </div>
        <div class="card accent-amber" style="padding:16px;">
          <div class="card-title">Busy</div>
          <div class="card-value" style="font-size:28px;color:var(--warning);">${busy}</div>
        </div>
        <div class="card accent-gray" style="padding:16px;">
          <div class="card-title">Offline</div>
          <div class="card-value" style="font-size:28px;color:var(--status-dead);">${offline}</div>
        </div>
      </div>

      <!-- Worker grid -->
      <div class="section-header mb-16">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Connected Workers
        </h2>
        <div class="live-indicator">
          <div class="live-dot"></div>
          <span>Polling every 5s</span>
        </div>
      </div>

      <div class="grid grid-auto" id="workers-grid">
        ${workerList.length === 0
          ? `<div class="empty-state" style="grid-column:1/-1;">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
               <div class="empty-state-title">No workers connected</div>
               <div class="empty-state-desc">Workers appear here when they register with the scheduler</div>
             </div>`
          : workerList.map(w => workerCardHTML(w)).join('')
        }
      </div>
    `;
  }

  /* ── Card HTML ───────────────────────────────────────────────── */
  function workerCardHTML(w) {
    const status  = getStatus(w);
    const hbAgo   = getHeartbeatAge(w);
    const dotCls  = hbAgo < 10 ? 'fresh' : hbAgo < 60 ? 'stale' : 'expired';
    const running  = w.jobs_running   ?? w.current_jobs   ?? 0;
    const capacity = w.concurrency    ?? w.max_concurrent ?? '?';
    const completed= w.jobs_completed ?? w.total_completed ?? 0;

    return `
      <div class="worker-card" id="wcard-${w.id}" onclick="Workers.showWorkerDetail('${w.id}')">
        <div class="worker-header">
          <div class="worker-info">
            <div class="worker-name" title="${escHtml(w.name || w.id)}">${escHtml(w.name || w.id)}</div>
            <div class="worker-host">${escHtml(w.hostname || w.host || '—')}${w.pid ? ` · PID ${w.pid}` : ''}</div>
          </div>
          ${Utils.badge(status)}
        </div>

        <div style="margin-bottom:14px;">
          <div class="heartbeat-indicator">
            <div class="hb-dot ${dotCls}"></div>
            <span>Heartbeat ${hbAgo < 3 ? 'just now' : hbAgo + 's ago'}</span>
          </div>
        </div>

        <div class="worker-stats">
          <div class="worker-stat">
            <div class="worker-stat-label">Running</div>
            <div class="worker-stat-value" style="color:${running > 0 ? 'var(--success)' : 'var(--text-primary)'};">${running}<span style="font-size:12px;font-weight:400;color:var(--text-muted);"> / ${capacity}</span></div>
          </div>
          <div class="worker-stat">
            <div class="worker-stat-label">Completed</div>
            <div class="worker-stat-value">${fmtNum(completed)}</div>
          </div>
        </div>

        ${running > 0 ? `
          <div style="margin-top:12px;">
            <div class="progress-bar">
              <div class="progress-bar-fill accent" style="width:${capacity !== '?' ? Math.min(100, (running/capacity)*100) : 50}%;"></div>
            </div>
          </div>` : ''}
      </div>`;
  }

  /* ── Refresh without full re-render ──────────────────────────── */
  function refreshCards() {
    const grid = document.getElementById('workers-grid');
    if (!grid) { renderPage(); return; }

    // Update summary numbers
    const idle    = workerList.filter(w => getStatus(w) === 'idle').length;
    const busy    = workerList.filter(w => getStatus(w) === 'busy').length;
    const offline = workerList.filter(w => getStatus(w) === 'offline').length;

    // Re-render grid
    grid.innerHTML = workerList.length === 0
      ? `<div class="empty-state" style="grid-column:1/-1;"><div class="empty-state-title">No workers connected</div></div>`
      : workerList.map(w => workerCardHTML(w)).join('');
  }

  /* ── Worker detail modal ─────────────────────────────────────── */
  async function showWorkerDetail(id) {
    const worker = workerList.find(w => String(w.id) === String(id));
    if (!worker) return;

    const status  = getStatus(worker);
    const hbAgo   = getHeartbeatAge(worker);
    const dotCls  = hbAgo < 10 ? 'fresh' : hbAgo < 60 ? 'stale' : 'expired';

    const bodyHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <div style="flex:1;">
          <div style="font-size:18px;font-weight:700;">${escHtml(worker.name || worker.id)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${escHtml(worker.hostname || '—')}${worker.pid ? ` · PID ${worker.pid}` : ''}</div>
        </div>
        ${Utils.badge(status)}
      </div>

      <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value td-mono">${worker.id}</span></div>
      <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${Utils.badge(status)}</span></div>
      <div class="detail-row"><span class="detail-label">Heartbeat</span><span class="detail-value"><span class="hb-dot ${dotCls}" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;"></span>${hbAgo}s ago</span></div>
      <div class="detail-row"><span class="detail-label">Running</span><span class="detail-value">${worker.jobs_running ?? worker.current_jobs ?? 0} / ${worker.concurrency ?? worker.max_concurrent ?? '?'}</span></div>
      <div class="detail-row"><span class="detail-label">Completed</span><span class="detail-value">${fmtNum(worker.jobs_completed ?? worker.total_completed ?? 0)}</span></div>
      <div class="detail-row"><span class="detail-label">Last seen</span><span class="detail-value">${Utils.formatDate(worker.last_heartbeat_at || worker.last_seen)}</span></div>
      <div class="detail-row"><span class="detail-label">Registered</span><span class="detail-value">${Utils.formatDate(worker.created_at || worker.registered_at)}</span></div>
      ${worker.version ? `<div class="detail-row"><span class="detail-label">Version</span><span class="detail-value">${escHtml(worker.version)}</span></div>` : ''}

      <div class="divider"></div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:10px;">Jobs Running (Heartbeat History)</div>
      <div class="chart-container" style="height:160px;">
        <canvas id="worker-hb-chart" style="width:100%;height:160px;"></canvas>
      </div>

      <div id="worker-heartbeats-list" style="margin-top:12px;"></div>
    `;

    App.showModal(`Worker: ${worker.name || worker.id}`, bodyHTML, [], { size: 'lg' });

    // Load and draw heartbeat history
    setTimeout(() => loadWorkerHeartbeats(id), 80);
  }

  async function loadWorkerHeartbeats(id) {
    let heartbeats = [];
    try {
      const data = await API.get(`/workers/${id}`);
      // The worker detail might include heartbeat_history array
      heartbeats = data.heartbeat_history || data.heartbeats || [];

      // If just got worker data, try separate endpoint
      if (heartbeats.length === 0) {
        const hbData = await API.get(`/workers/${id}/heartbeats`);
        heartbeats = Array.isArray(hbData) ? hbData : (hbData.data || hbData.heartbeats || []);
      }
    } catch (_) {}

    const canvas = document.getElementById('worker-hb-chart');
    if (!canvas) return;

    if (heartbeats.length === 0) {
      // Show single data point
      const w = workerList.find(w => String(w.id) === String(id));
      heartbeats = [{ jobs_running: w?.jobs_running ?? 0 }];
    }

    const last20 = heartbeats.slice(-20);
    const values = last20.map(h => h.jobs_running ?? h.running_jobs ?? 0);
    const labels = last20.map((h, i) => {
      if (h.timestamp || h.created_at) {
        return Utils.timeAgo(h.timestamp || h.created_at);
      }
      return `-${(last20.length - i - 1) * 5}s`;
    });

    requestAnimationFrame(() => {
      Utils.drawLineChart(canvas, [
        {
          data: values,
          color: '#6366f1',
          fillColor: 'rgba(99,102,241,0.12)',
        },
      ], labels, { min: 0, padL: 30, padB: 28 });
    });
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function getStatus(w) {
    if (w.status) return w.status.toLowerCase();
    const hbAgo = getHeartbeatAge(w);
    if (hbAgo > 60) return 'offline';
    if ((w.jobs_running ?? w.current_jobs ?? 0) > 0) return 'busy';
    return 'idle';
  }

  function getHeartbeatAge(w) {
    const ts = w.last_heartbeat_at || w.last_seen || w.last_heartbeat;
    if (!ts) return 9999;
    return Math.floor((Date.now() - new Date(ts)) / 1000);
  }

  function fmtNum(n) {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.Workers = {
    renderWorkersPage,
    showWorkerDetail,
  };
})();
