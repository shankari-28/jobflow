/**
 * executions.js — Execution log viewer (split layout)
 */

(function () {
  'use strict';

  let allQueues   = [];
  let queueJobs   = [];
  let selectedJob = null;

  /* ── Main render ─────────────────────────────────────────────── */
  async function renderExecutionsPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading…</span></div>`;

    await loadQueues();
    renderPage();
  }

  async function loadQueues() {
    try {
      const data = await API.get('/queues');
      allQueues = Array.isArray(data) ? data : (data.data || data.queues || []);
    } catch (_) {
      allQueues = [];
    }
  }

  /* ── Page layout ─────────────────────────────────────────────── */
  function renderPage() {
    const content = document.getElementById('page-content');

    const queueOptions = allQueues.map(q =>
      `<option value="${q.id}">${escHtml(q.name)}</option>`
    ).join('');

    content.innerHTML = `
      <div class="split-layout">
        <!-- LEFT PANEL -->
        <div class="split-left" style="height:calc(100vh - 112px);overflow:hidden;display:flex;flex-direction:column;gap:12px;">
          <div class="card" style="padding:16px;flex-shrink:0;">
            <div class="card-title" style="margin-bottom:12px;">Select Queue & Job</div>
            <div class="form-group" style="margin-bottom:10px;">
              <label class="form-label">Queue</label>
              <select class="form-select" id="ex-queue-select" onchange="Executions.onQueueChange()">
                <option value="">Choose a queue…</option>
                ${queueOptions}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:0;">
              <label class="form-label">Search Job</label>
              <div class="search-input-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input class="search-input" id="ex-job-search" type="text" placeholder="Filter jobs…" oninput="Executions.filterJobs()" />
              </div>
            </div>
          </div>

          <div id="ex-jobs-list" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
            <div class="empty-state" style="padding:30px 0;">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              <div class="empty-state-title">Select a queue</div>
              <div class="empty-state-desc">Then pick a job to see its executions</div>
            </div>
          </div>
        </div>

        <!-- RIGHT PANEL -->
        <div class="split-right" style="height:calc(100vh - 112px);overflow-y:auto;" id="ex-right-panel">
          <div class="card" style="height:100%;display:flex;align-items:center;justify-content:center;">
            <div class="empty-state">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              <div class="empty-state-title">No job selected</div>
              <div class="empty-state-desc">Select a job from the left panel to view its execution history</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Queue change ────────────────────────────────────────────── */
  async function onQueueChange() {
    const queueId = document.getElementById('ex-queue-select')?.value;
    const listEl  = document.getElementById('ex-jobs-list');
    if (!queueId) { queueJobs = []; renderJobsList(); return; }

    listEl.innerHTML = '<div class="loading-state" style="padding:20px 0;"><div class="spinner"></div></div>';

    try {
      const data = await API.get(`/queues/${queueId}/jobs`, { limit: 100 });
      queueJobs = Array.isArray(data) ? data : (data.data || data.jobs || []);
    } catch (err) {
      queueJobs = [];
      App.showToast('Could not load jobs: ' + err.message, 'error');
    }

    renderJobsList();
  }

  /* ── Jobs list ───────────────────────────────────────────────── */
  function renderJobsList() {
    const listEl = document.getElementById('ex-jobs-list');
    if (!listEl) return;

    const search = (document.getElementById('ex-job-search')?.value || '').toLowerCase();
    const jobs   = queueJobs.filter(j =>
      !search || (j.name || j.id || '').toLowerCase().includes(search)
    );

    if (jobs.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state" style="padding:30px 0;">
          <div class="empty-state-title">${queueJobs.length === 0 ? 'No jobs in this queue' : 'No matches'}</div>
        </div>`;
      return;
    }

    listEl.innerHTML = jobs.map(j => `
      <div class="card" style="padding:12px 14px;cursor:pointer;border-radius:var(--radius-md);${selectedJob?.id === j.id ? 'border-color:var(--border-accent);background:rgba(99,102,241,0.08);' : ''}"
        onclick="Executions.selectJob('${j.id}')" id="ex-job-item-${j.id}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div style="min-width:0;flex:1;">
            <div style="font-size:13px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
              title="${escHtml(j.name || j.id)}">${escHtml(j.name || j.id)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${Utils.timeAgo(j.created_at)}</div>
          </div>
          ${Utils.badge(j.status)}
        </div>
      </div>
    `).join('');
  }

  function filterJobs() {
    renderJobsList();
  }

  /* ── Select job → show executions ───────────────────────────── */
  async function selectJob(id) {
    selectedJob = queueJobs.find(j => String(j.id) === String(id));
    if (!selectedJob) return;

    // Highlight selected
    document.querySelectorAll('[id^="ex-job-item-"]').forEach(el => {
      el.style.borderColor = '';
      el.style.background  = '';
    });
    const selEl = document.getElementById(`ex-job-item-${id}`);
    if (selEl) {
      selEl.style.borderColor = 'var(--border-accent)';
      selEl.style.background  = 'rgba(99,102,241,0.08)';
    }

    const rightPanel = document.getElementById('ex-right-panel');
    rightPanel.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading executions…</span></div>`;

    try {
      const [exData, logData] = await Promise.all([
        API.get(`/jobs/${id}/executions`).catch(() => []),
        API.get(`/jobs/${id}/logs`).catch(() => []),
      ]);

      const executions = Array.isArray(exData) ? exData : (exData.data || exData.executions || []);
      const logs       = Array.isArray(logData) ? logData : (logData.data || logData.logs || []);

      renderRightPanel(selectedJob, executions, logs);
    } catch (err) {
      rightPanel.innerHTML = `<div class="loading-state" style="color:var(--error);"><span>Error: ${err.message}</span></div>`;
    }
  }

  /* ── Right panel ─────────────────────────────────────────────── */
  function renderRightPanel(job, executions, logs) {
    const rightPanel = document.getElementById('ex-right-panel');

    rightPanel.innerHTML = `
      <div class="card" style="margin-bottom:16px;padding:20px;">
        <div style="display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:18px;font-weight:700;color:var(--text-primary);">${escHtml(job.name || job.id)}</div>
            <div style="font-size:12px;color:var(--text-muted);font-family:monospace;margin-top:4px;">${job.id}</div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            ${Utils.badge(job.status)}
            <span style="font-size:11px;color:var(--text-muted);">${executions.length} attempt${executions.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      ${executions.length === 0
        ? `<div class="card"><div class="empty-state"><div class="empty-state-title">No executions recorded</div><div class="empty-state-desc">This job has not been executed yet</div></div></div>`
        : executions.map((ex, i) => renderExecutionAccordion(ex, i, logs)).join('')
      }
    `;
  }

  function renderExecutionAccordion(ex, index, allLogs) {
    const exId = ex.id || `exec-${index}`;
    const duration = ex.duration_seconds || ex.duration;
    const jobLogs  = allLogs.filter(l =>
      l.execution_id === ex.id || l.attempt === (index + 1)
    );

    return `
      <div class="accordion-item" id="exec-acc-${exId}" style="margin-bottom:8px;">
        <div class="accordion-header" onclick="Executions.toggleAccordion('${exId}')">
          <span style="font-size:12px;font-weight:700;color:var(--text-muted);min-width:28px;">
            #${index + 1}
          </span>
          ${Utils.badge(ex.status)}
          <span style="font-size:12px;color:var(--text-muted);">${duration ? Utils.duration(duration) : '—'}</span>
          <span style="font-size:12px;color:var(--text-muted);">${escHtml(ex.worker_id || ex.worker || '')}</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:auto;margin-right:8px;">${Utils.timeAgo(ex.started_at || ex.created_at)}</span>
          <svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="accordion-body">
          <div style="padding:14px 16px;border-bottom:1px solid var(--border-color);">
            <div class="form-row">
              <div>
                <div class="detail-row"><span class="detail-label">Started</span><span class="detail-value">${Utils.formatDate(ex.started_at)}</span></div>
                <div class="detail-row"><span class="detail-label">Completed</span><span class="detail-value">${Utils.formatDate(ex.completed_at || ex.finished_at)}</span></div>
                <div class="detail-row"><span class="detail-label">Worker</span><span class="detail-value td-mono">${escHtml(ex.worker_id || ex.worker || '—')}</span></div>
              </div>
              <div>
                <div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${duration ? Utils.duration(duration) : '—'}</span></div>
                <div class="detail-row"><span class="detail-label">Exit Code</span><span class="detail-value">${ex.exit_code ?? '—'}</span></div>
                <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${Utils.badge(ex.status)}</span></div>
              </div>
            </div>
            ${ex.error || ex.error_message ? `
              <div style="margin-top:10px;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;color:var(--error);margin-bottom:6px;">Error</div>
                <pre class="pre-block" style="color:var(--error);max-height:120px;">${escHtml(ex.error || ex.error_message)}</pre>
              </div>` : ''}
          </div>

          <!-- Log Lines -->
          <div style="padding:12px 16px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:8px;">
              Log Output <span style="color:var(--text-muted);font-weight:400;">(${jobLogs.length} lines)</span>
            </div>
            ${jobLogs.length === 0
              ? `<div style="font-size:12px;color:var(--text-muted);padding:8px 0;">No log lines captured for this execution.</div>`
              : `<div class="log-viewer">
                  ${jobLogs.map(line => renderLogLine(line)).join('')}
                 </div>`
            }
          </div>
        </div>
      </div>
    `;
  }

  /* ── Log line renderer ───────────────────────────────────────── */
  function renderLogLine(line) {
    const level   = (line.level || 'info').toLowerCase();
    const message = line.message || line.msg || '';
    const time    = line.timestamp || line.created_at || '';
    const meta    = line.metadata || line.context || null;

    const levelColors = {
      info:  'badge-info',
      warn:  'badge-warn',
      error: 'badge-error',
      debug: 'badge-debug',
    };

    const metaStr = meta ? JSON.stringify(meta) : null;

    return `
      <div class="log-line">
        <span class="log-time">${time ? new Date(time).toLocaleTimeString('en-US', { hour12: false }) : ''}</span>
        <span class="log-level"><span class="badge ${levelColors[level] || 'badge-info'}" style="padding:1px 6px;font-size:9px;">${level.toUpperCase()}</span></span>
        <span class="log-message">${escHtml(message)}</span>
        ${metaStr ? `<span class="log-meta" title="${escHtml(metaStr)}" onclick="Executions.showMeta(this, ${escHtml(JSON.stringify(metaStr))})">{…}</span>` : ''}
      </div>`;
  }

  function toggleAccordion(id) {
    const item = document.getElementById(`exec-acc-${id}`);
    if (item) item.classList.toggle('open');
  }

  function showMeta(el, metaStr) {
    try {
      const obj = JSON.parse(metaStr);
      App.showModal('Log Metadata', `<pre class="pre-block">${escHtml(Utils.prettyJSON(obj))}</pre>`, []);
    } catch (_) {
      App.showModal('Log Metadata', `<pre class="pre-block">${escHtml(metaStr)}</pre>`, []);
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.Executions = {
    renderExecutionsPage,
    onQueueChange,
    filterJobs,
    selectJob,
    toggleAccordion,
    showMeta,
  };
})();
