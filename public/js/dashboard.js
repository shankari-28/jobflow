/**
 * dashboard.js — Overview / metrics page
 */

(function () {
  'use strict';

  /* ── Sparkline data buffer ───────────────────────────────────── */
  let throughputData = new Array(30).fill(0);
  let lastCompletedCount = null;

  /* ── Main render ─────────────────────────────────────────────── */
  async function renderDashboardPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = getSkeletonHTML();

    // Fetch all data concurrently
    await Promise.all([
      loadMetrics(),
      loadQueueHealth(),
      loadActivity(),
    ]);

    // Start live polling every 5s
    App.setPollingInterval(refreshDashboard, 5000);
  }

  /* ── Skeleton while loading ──────────────────────────────────── */
  function getSkeletonHTML() {
    return `
      <div class="grid grid-5 mb-24" id="stat-cards">
        ${Array(5).fill('<div class="card" style="height:110px;"><div class="skeleton" style="height:14px;width:60%;margin-bottom:12px;"></div><div class="skeleton" style="height:36px;width:40%;"></div></div>').join('')}
      </div>
      <div class="grid grid-2 mb-24" id="dashboard-mid" style="grid-template-columns:1fr 1.5fr;">
        <div class="card" style="min-height:240px;"></div>
        <div class="card" style="min-height:240px;"></div>
      </div>
      <div class="grid grid-2" id="dashboard-bottom" style="grid-template-columns:1.5fr 1fr;">
        <div class="card" style="min-height:280px;"></div>
        <div class="card" style="min-height:280px;"></div>
      </div>
    `;
  }

  /* ── Refresh (called by polling) ─────────────────────────────── */
  async function refreshDashboard() {
    await Promise.all([
      loadMetrics(),
      loadQueueHealth(),
      loadActivity(),
    ]);
  }

  /* ── Load metrics ────────────────────────────────────────────── */
  async function loadMetrics() {
    let metrics = {};
    try {
      metrics = await API.get('/dashboard/metrics') || {};
    } catch (err) {
      console.warn('Metrics error:', err.message);
    }

    const jobs    = metrics.jobs    || {};
    const workers = metrics.workers || {};

    // Throughput sparkline logic
    const currentCompleted = jobs.completed || 0;
    if (lastCompletedCount !== null) {
      const delta = Math.max(0, currentCompleted - lastCompletedCount);
      throughputData.push(delta);
      if (throughputData.length > 30) throughputData.shift();
    }
    lastCompletedCount = currentCompleted;

    renderStatCards(jobs, workers);
    renderWorkerHealth(workers);
    renderThroughputChart();
  }

  /* ── Stat Cards ─────────────────────────────────────────────── */
  function renderStatCards(jobs, workers) {
    const total = (jobs.total || 0);
    const cards = [
      { label: 'Total Jobs', value: fmt(total),              icon: 'briefcase', cls: 'accent-purple', iconCls: 'purple' },
      { label: 'Queued',     value: fmt(jobs.queued || 0),   icon: 'queue',     cls: 'accent-blue',   iconCls: 'blue'   },
      { label: 'Running',    value: fmt(jobs.running || 0),  icon: 'running',   cls: 'accent-green',  iconCls: 'green'  },
      { label: 'Completed',  value: fmt(jobs.completed || 0),icon: 'check',     cls: 'accent-green',  iconCls: 'green'  },
      { label: 'Failed',     value: fmt(jobs.failed || 0),   icon: 'failed',    cls: 'accent-red',    iconCls: 'red'    },
    ];

    const el = document.getElementById('stat-cards');
    if (!el) {
      // Full page render
      renderFullDashboard(jobs, workers);
      return;
    }

    el.innerHTML = cards.map(c => `
      <div class="card ${c.cls}">
        <div class="card-header">
          <div class="card-title">${c.label}</div>
          <div class="card-icon ${c.iconCls}">${getIcon(c.icon)}</div>
        </div>
        <div class="card-value">${c.value}</div>
        ${c.label === 'Running' && (jobs.running || 0) > 0
          ? '<div class="card-delta up" style="font-size:11px;color:var(--success);">● Active</div>'
          : '<div class="card-delta" style="font-size:11px;color:var(--text-muted);">This session</div>'}
      </div>
    `).join('');
  }

  /* ── Full page initial render ────────────────────────────────── */
  function renderFullDashboard(jobs, workers) {
    const content = document.getElementById('page-content');
    const total = (jobs.total || 0);
    const cards = [
      { label: 'Total Jobs', value: fmt(total),              cls: 'accent-purple', iconCls: 'purple', icon: 'briefcase' },
      { label: 'Queued',     value: fmt(jobs.queued || 0),   cls: 'accent-blue',   iconCls: 'blue',   icon: 'queue'     },
      { label: 'Running',    value: fmt(jobs.running || 0),  cls: 'accent-green',  iconCls: 'green',  icon: 'running'   },
      { label: 'Completed',  value: fmt(jobs.completed || 0),cls: 'accent-green',  iconCls: 'green',  icon: 'check'     },
      { label: 'Failed',     value: fmt(jobs.failed || 0),   cls: 'accent-red',    iconCls: 'red',    icon: 'failed'    },
    ];

    content.innerHTML = `
      <div class="grid grid-5 mb-24" id="stat-cards">
        ${cards.map(c => `
          <div class="card ${c.cls}">
            <div class="card-header">
              <div class="card-title">${c.label}</div>
              <div class="card-icon ${c.iconCls}">${getIcon(c.icon)}</div>
            </div>
            <div class="card-value">${c.value}</div>
          </div>
        `).join('')}
      </div>

      <div class="grid mb-24" style="grid-template-columns:280px 1fr; gap:16px;" id="dashboard-mid">
        <div class="card" id="worker-health-card">
          <div class="card-header">
            <div class="card-title">Worker Health</div>
            <div style="font-size:11px;color:var(--text-muted);" id="worker-total-label"></div>
          </div>
          <div id="worker-health-content"></div>
        </div>
        <div class="card" id="throughput-card">
          <div class="card-header">
            <div class="card-title">Throughput (jobs completed / poll)</div>
            <div style="font-size:11px;color:var(--text-muted);">Last 30 intervals</div>
          </div>
          <div class="chart-container" style="height:180px;">
            <canvas id="throughput-canvas" class="chart-canvas" style="height:180px;"></canvas>
          </div>
        </div>
      </div>

      <div class="grid mb-24" style="grid-template-columns:1.6fr 1fr; gap:16px;" id="dashboard-bottom">
        <div class="card" id="queue-health-card">
          <div class="card-header">
            <div class="card-title">Queue Health</div>
            <button class="btn btn-secondary btn-sm" onclick="App.navigate('queues')">View all</button>
          </div>
          <div id="queue-health-content"><div class="loading-state"><div class="spinner"></div></div></div>
        </div>
        <div class="card" id="activity-card">
          <div class="card-header">
            <div class="card-title">Recent Activity</div>
            <div style="font-size:11px;color:var(--text-muted);" id="activity-label">Last 20 events</div>
          </div>
          <div id="activity-content" style="max-height:320px;overflow-y:auto;">
            <div class="loading-state"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    `;

    // Now call sub-renderers
    renderWorkerHealth(workers);
    renderThroughputChart();
  }

  /* ── Worker health panel ─────────────────────────────────────── */
  function renderWorkerHealth(workers) {
    const el = document.getElementById('worker-health-content');
    const labelEl = document.getElementById('worker-total-label');
    if (!el) return;

    const idle    = workers.idle    || 0;
    const busy    = workers.busy    || 0;
    const offline = workers.offline || 0;
    const total   = idle + busy + offline;

    if (labelEl) labelEl.textContent = `${total} workers`;

    const segments = [
      { label: 'Idle',    count: idle,    color: 'var(--success)',          pct: total ? (idle/total*100) : 0 },
      { label: 'Busy',    count: busy,    color: 'var(--warning)',          pct: total ? (busy/total*100) : 0 },
      { label: 'Offline', count: offline, color: 'var(--status-dead)',      pct: total ? (offline/total*100) : 0 },
    ];

    el.innerHTML = `
      <div style="margin-bottom:16px;">
        <div style="display:flex; height:10px; border-radius:5px; overflow:hidden; gap:2px;">
          ${segments.map(s => s.count > 0
            ? `<div style="flex:${s.pct};background:${s.color};min-width:4px;" title="${s.label}: ${s.count}"></div>`
            : '').join('')}
        </div>
      </div>
      ${segments.map(s => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-color);">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0;"></div>
            <span style="font-size:13px;color:var(--text-secondary);">${s.label}</span>
          </div>
          <span style="font-size:16px;font-weight:700;color:var(--text-primary);">${s.count}</span>
        </div>
      `).join('')}
    `;
  }

  /* ── Throughput sparkline ────────────────────────────────────── */
  function renderThroughputChart() {
    const canvas = document.getElementById('throughput-canvas');
    if (!canvas) return;

    // Ensure canvas has rendered dimensions
    requestAnimationFrame(() => {
      Utils.drawSparkline(canvas, throughputData, {
        color: '#6366f1',
        fillColor: 'rgba(99,102,241,0.12)',
        padding: 10,
      });
    });
  }

  /* ── Queue health table ──────────────────────────────────────── */
  async function loadQueueHealth() {
    const el = document.getElementById('queue-health-content');
    if (!el) return;

    let rows = [];
    try {
      rows = await API.get('/dashboard/queue-health') || [];
      if (!Array.isArray(rows)) rows = rows.queues || rows.data || [];
    } catch (err) {
      console.warn('Queue health error:', err.message);
    }

    if (rows.length === 0) {
      el.innerHTML = '<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg><div class="empty-state-title">No queue data</div></div>';
      return;
    }

    const top10 = rows.slice(0, 10);
    el.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px 10px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border-color);">Queue</th>
              <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border-color);">Queued</th>
              <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border-color);">Running</th>
              <th style="text-align:right;padding:8px 10px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border-color);">Failed</th>
              <th style="padding:8px 10px;color:var(--text-muted);font-weight:600;font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border-color);">Error Rate</th>
            </tr>
          </thead>
          <tbody>
            ${top10.map(q => {
              const total   = (q.queued || 0) + (q.running || 0) + (q.completed || 0) + (q.failed || 0);
              const errRate = total ? ((q.failed || 0) / total * 100) : 0;
              const errCls  = errRate > 20 ? 'error' : errRate > 5 ? 'warning' : 'success';
              return `
                <tr style="border-bottom:1px solid var(--border-color);">
                  <td style="padding:8px 10px;font-weight:500;color:var(--text-primary);">${Utils.truncate(q.name || q.queue_name, 22)}</td>
                  <td style="padding:8px 10px;text-align:right;color:var(--status-queued);font-weight:600;">${q.queued || 0}</td>
                  <td style="padding:8px 10px;text-align:right;color:var(--success);font-weight:600;">${q.running || 0}</td>
                  <td style="padding:8px 10px;text-align:right;color:var(--error);font-weight:600;">${q.failed || 0}</td>
                  <td style="padding:8px 10px;min-width:100px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                      <div class="progress-bar" style="flex:1;height:5px;">
                        <div class="progress-bar-fill ${errCls}" style="width:${Math.min(errRate, 100).toFixed(1)}%;"></div>
                      </div>
                      <span style="font-size:11px;color:var(--text-muted);width:36px;text-align:right;">${errRate.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  /* ── Activity feed ───────────────────────────────────────────── */
  async function loadActivity() {
    const el = document.getElementById('activity-content');
    if (!el) return;

    let events = [];
    try {
      events = await API.get('/dashboard/activity') || [];
      if (!Array.isArray(events)) events = events.events || events.data || [];
    } catch (err) {
      console.warn('Activity error:', err.message);
    }

    if (events.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-title">No recent activity</div></div>';
      return;
    }

    const statusColors = {
      queued: 'var(--status-queued)',
      running: 'var(--success)',
      completed: 'var(--status-completed)',
      failed: 'var(--error)',
      dead: 'var(--status-dead)',
      scheduled: 'var(--warning)',
      claimed: 'var(--accent-secondary)',
      cancelled: 'var(--text-muted)',
    };

    el.innerHTML = `
      <div class="activity-list">
        ${events.slice(0, 20).map(ev => {
          const status = (ev.status || ev.to_status || 'unknown').toLowerCase();
          const color  = statusColors[status] || 'var(--text-muted)';
          const name   = ev.job_name || ev.name || 'Job';
          const queue  = ev.queue_name || ev.queue || '';
          return `
            <div class="activity-item">
              <div class="activity-dot" style="background:${color};"></div>
              <div class="activity-content">
                <div class="activity-name" title="${name}">${Utils.truncate(name, 28)}</div>
                <div class="activity-meta">${queue ? `${queue} · ` : ''}${Utils.badge(status)}</div>
              </div>
              <div class="activity-time">${Utils.timeAgo(ev.created_at || ev.timestamp || ev.occurred_at)}</div>
            </div>`;
        }).join('')}
      </div>
    `;
  }

  /* ── Icon helpers ────────────────────────────────────────────── */
  function getIcon(name) {
    const icons = {
      briefcase: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>`,
      queue:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>`,
      running:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
      check:     `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`,
      failed:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    };
    return icons[name] || icons.briefcase;
  }

  function fmt(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n / 1000).toFixed(1) + 'K';
    return String(n || 0);
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.Dashboard = { renderDashboardPage };
})();
