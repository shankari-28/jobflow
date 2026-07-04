/**
 * jobs.js — Job explorer page
 */

(function () {
  'use strict';

  /* ── State ─────────────────────────────────────────────────── */
  let allJobs      = [];
  let allQueues    = [];
  let filteredJobs = [];
  let currentPage  = 1;
  const PAGE_SIZE  = 20;

  let filters = {
    status:   '',
    job_type: '',
    queue_id: '',
    search:   '',
  };

  /* ── Render ─────────────────────────────────────────────────── */
  async function renderJobsPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading jobs…</span></div>`;

    await loadQueues();
    await loadJobs();
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

  async function loadJobs() {
    allJobs = [];

    // Strategy: try a global jobs endpoint, fallback to per-queue
    try {
      const params = { limit: 200, page: 1 };
      if (filters.status)   params.status   = filters.status;
      if (filters.job_type) params.job_type = filters.job_type;

      const data = await API.get('/jobs', params);
      allJobs = Array.isArray(data) ? data : (data.data || data.jobs || []);
    } catch (_) {
      // Per-queue fallback
      for (const q of allQueues.slice(0, 15)) {
        try {
          const data = await API.get(`/queues/${q.id}/jobs`, { limit: 50 });
          const jobs = Array.isArray(data) ? data : (data.data || data.jobs || []);
          jobs.forEach(j => { j._queue = q; });
          allJobs.push(...jobs);
        } catch (_) {}
      }
    }

    applyFilters();
  }

  function applyFilters() {
    filteredJobs = allJobs.filter(j => {
      if (filters.status   && (j.status || '').toLowerCase() !== filters.status.toLowerCase()) return false;
      if (filters.job_type && (j.job_type || j.type || '').toLowerCase() !== filters.job_type.toLowerCase()) return false;
      if (filters.queue_id && String(j.queue_id || j._queue?.id) !== String(filters.queue_id)) return false;
      if (filters.search) {
        const term = filters.search.toLowerCase();
        if (!((j.name || '').toLowerCase().includes(term) || (j.id || '').toLowerCase().includes(term))) return false;
      }
      return true;
    });
    currentPage = 1;
  }

  function renderPage() {
    const content = document.getElementById('page-content');

    const queueOptions = allQueues.map(q => `<option value="${q.id}">${escHtml(q.name)}</option>`).join('');

    content.innerHTML = `
      <div class="section-header mb-16">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><path d="M12 12v4M10 14h4"/></svg>
          Jobs
        </h2>
        <button class="btn btn-primary" onclick="Jobs.openCreateJobModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Job
        </button>
      </div>

      <div class="filters-bar">
        <div class="search-input-wrapper" style="max-width:280px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input class="search-input" type="text" id="job-search" placeholder="Search by name or ID…" value="${escHtml(filters.search)}" />
        </div>
        <select class="filter-select" id="job-status-filter">
          <option value="">All Statuses</option>
          ${['queued','running','completed','failed','dead','scheduled','claimed','cancelled'].map(s =>
            `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${capitalize(s)}</option>`
          ).join('')}
        </select>
        <select class="filter-select" id="job-type-filter">
          <option value="">All Types</option>
          ${['immediate','delayed','scheduled','recurring','batch'].map(t =>
            `<option value="${t}" ${filters.job_type === t ? 'selected' : ''}>${capitalize(t)}</option>`
          ).join('')}
        </select>
        <select class="filter-select" id="job-queue-filter">
          <option value="">All Queues</option>
          ${queueOptions}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="Jobs.resetFilters()">Reset</button>
        <button class="btn btn-secondary btn-sm" onclick="Jobs.refresh()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
          Refresh
        </button>
      </div>

      <div id="jobs-table-container"></div>
      <div id="jobs-pagination"></div>
    `;

    // Wire filters
    document.getElementById('job-search').addEventListener('input', debounce(e => {
      filters.search = e.target.value;
      applyFilters();
      renderJobsTable();
    }, 300));

    document.getElementById('job-status-filter').addEventListener('change', e => {
      filters.status = e.target.value;
      applyFilters();
      renderJobsTable();
    });

    document.getElementById('job-type-filter').addEventListener('change', e => {
      filters.job_type = e.target.value;
      applyFilters();
      renderJobsTable();
    });

    document.getElementById('job-queue-filter').addEventListener('change', e => {
      filters.queue_id = e.target.value;
      applyFilters();
      renderJobsTable();
    });

    renderJobsTable();
  }

  function renderJobsTable() {
    const container  = document.getElementById('jobs-table-container');
    const pagEl      = document.getElementById('jobs-pagination');
    if (!container) return;

    const total    = filteredJobs.length;
    const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start    = (currentPage - 1) * PAGE_SIZE;
    const pageJobs = filteredJobs.slice(start, start + PAGE_SIZE);

    if (total === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>
          <div class="empty-state-title">No jobs found</div>
          <div class="empty-state-desc">Try adjusting your filters or create a new job</div>
        </div>`;
      pagEl.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Queue</th>
              <th>Type</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Retries</th>
              <th>Created</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            ${pageJobs.map(j => {
              const queue = j._queue || {};
              const queueName = queue.name || j.queue_name || '—';
              const jobType   = j.job_type || j.type || '—';
              return `
                <tr onclick="Jobs.showJobDetail('${j.id}')">
                  <td style="font-weight:600;max-width:200px;" class="truncate" title="${escHtml(j.name || j.id)}">${escHtml(j.name || j.id)}</td>
                  <td class="td-muted">${escHtml(queueName)}</td>
                  <td><span class="badge badge-info" style="text-transform:capitalize;">${jobType}</span></td>
                  <td>${Utils.badge(j.status)}</td>
                  <td>${j.priority ?? '—'}</td>
                  <td class="td-muted">${j.retry_count ?? 0} / ${j.max_retries ?? j.retry_limit ?? '?'}</td>
                  <td class="td-muted">${Utils.timeAgo(j.created_at)}</td>
                  <td class="td-muted">${j.started_at ? Utils.timeAgo(j.started_at) : '—'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    // Pagination
    if (pages <= 1) { pagEl.innerHTML = ''; return; }

    const range = buildPageRange(currentPage, pages);
    pagEl.innerHTML = `
      <div class="pagination">
        <button class="page-btn" onclick="Jobs.goPage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        ${range.map(p => p === '…'
          ? `<span class="page-info">…</span>`
          : `<button class="page-btn ${p === currentPage ? 'active' : ''}" onclick="Jobs.goPage(${p})">${p}</button>`
        ).join('')}
        <button class="page-btn" onclick="Jobs.goPage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <span class="page-info">${total} total</span>
      </div>`;
  }

  function buildPageRange(cur, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
    if (cur <= 4) return [1, 2, 3, 4, 5, '…', total];
    if (cur >= total - 3) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
    return [1, '…', cur - 1, cur, cur + 1, '…', total];
  }

  function goPage(page) {
    const pages = Math.ceil(filteredJobs.length / PAGE_SIZE);
    if (page < 1 || page > pages) return;
    currentPage = page;
    renderJobsTable();
    document.getElementById('jobs-table-container')?.scrollIntoView({ behavior: 'smooth' });
  }

  /* ── Job detail drawer ───────────────────────────────────────── */
  async function showJobDetail(id) {
    const job = allJobs.find(j => String(j.id) === String(id));
    if (!job) return;

    const bodyHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:22px;font-weight:800;color:var(--text-primary);margin-bottom:8px;">${escHtml(job.name || job.id)}</div>
        <div>${Utils.badge(job.status)}</div>
      </div>

      <div class="divider"></div>

      <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value td-mono">${job.id}</span></div>
      <div class="detail-row"><span class="detail-label">Queue</span><span class="detail-value">${escHtml(job._queue?.name || job.queue_name || '—')}</span></div>
      <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${job.job_type || job.type || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value">${job.priority ?? '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Retries</span><span class="detail-value">${job.retry_count ?? 0} / ${job.max_retries ?? job.retry_limit ?? '?'}</span></div>
      <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${Utils.formatDate(job.created_at)}</span></div>
      <div class="detail-row"><span class="detail-label">Scheduled</span><span class="detail-value">${Utils.formatDate(job.scheduled_at)}</span></div>
      <div class="detail-row"><span class="detail-label">Started</span><span class="detail-value">${Utils.formatDate(job.started_at)}</span></div>
      <div class="detail-row"><span class="detail-label">Completed</span><span class="detail-value">${Utils.formatDate(job.completed_at)}</span></div>
      <div class="detail-row"><span class="detail-label">Idempotency Key</span><span class="detail-value td-mono">${job.idempotency_key || '—'}</span></div>
      ${job.cron_expression ? `<div class="detail-row"><span class="detail-label">Cron</span><span class="detail-value td-mono">${job.cron_expression}</span></div>` : ''}

      <div class="divider"></div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:8px;">Payload</div>
      <pre class="pre-block">${escHtml(Utils.prettyJSON(job.payload || job.args || {}))}</pre>

      <div class="divider"></div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:8px;">Execution History</div>
      <div id="job-executions-list"><div class="spinner"></div></div>
    `;

    const isCancellable = ['queued','scheduled','claimed'].includes((job.status || '').toLowerCase());
    const isRetryable   = ['failed','dead'].includes((job.status || '').toLowerCase());

    const footerHTML = `
      ${isCancellable ? `<button class="btn btn-danger btn-sm" onclick="Jobs.cancelJob('${job.id}')">Cancel</button>` : ''}
      ${isRetryable   ? `<button class="btn btn-warning btn-sm" onclick="Jobs.retryJob('${job.id}')">Retry</button>` : ''}
      <button class="btn btn-secondary btn-sm" style="margin-left:auto;" onclick="App.closeDrawer()">Close</button>
    `;

    App.showDrawer(job.name || job.id, bodyHTML, footerHTML);

    // Load executions async
    loadJobExecutions(id);
  }

  async function loadJobExecutions(jobId) {
    const el = document.getElementById('job-executions-list');
    if (!el) return;

    try {
      const data = await API.get(`/jobs/${jobId}/executions`);
      const execs = Array.isArray(data) ? data : (data.data || data.executions || []);

      if (execs.length === 0) {
        el.innerHTML = '<div class="empty-state" style="padding:24px 0;"><div class="empty-state-title">No executions yet</div></div>';
        return;
      }

      el.innerHTML = execs.map((ex, i) => `
        <div class="accordion-item" id="exec-${ex.id}">
          <div class="accordion-header" onclick="Jobs.toggleExecution('${ex.id}')">
            <span style="font-size:12px;font-weight:600;color:var(--text-muted);">#${i + 1}</span>
            ${Utils.badge(ex.status)}
            <span style="font-size:12px;color:var(--text-muted);margin-left:4px;">${Utils.duration(ex.duration_seconds || ex.duration)}</span>
            <span style="font-size:11px;color:var(--text-muted);">${escHtml(ex.worker_id || ex.worker || '')}</span>
            <svg class="accordion-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </div>
          <div class="accordion-body">
            <div style="padding:10px 14px;">
              <div class="detail-row"><span class="detail-label">Started</span><span class="detail-value">${Utils.formatDate(ex.started_at)}</span></div>
              <div class="detail-row"><span class="detail-label">Completed</span><span class="detail-value">${Utils.formatDate(ex.completed_at || ex.finished_at)}</span></div>
              ${ex.error || ex.error_message ? `<div class="detail-row"><span class="detail-label">Error</span><span class="detail-value" style="color:var(--error);">${escHtml(ex.error || ex.error_message)}</span></div>` : ''}
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      el.innerHTML = `<span style="font-size:12px;color:var(--text-muted);">Could not load executions: ${err.message}</span>`;
    }
  }

  function toggleExecution(id) {
    const item = document.getElementById(`exec-${id}`);
    if (item) item.classList.toggle('open');
  }

  /* ── Cancel / Retry ──────────────────────────────────────────── */
  async function cancelJob(id) {
    try {
      await API.post(`/jobs/${id}/cancel`);
      App.showToast('Job cancelled.', 'success');
      App.closeDrawer();
      await loadJobs();
      renderJobsTable();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  async function retryJob(id) {
    try {
      await API.post(`/jobs/${id}/retry`);
      App.showToast('Job re-queued for retry.', 'success');
      App.closeDrawer();
      await loadJobs();
      renderJobsTable();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  /* ── Create Job Modal ────────────────────────────────────────── */
  function openCreateJobModal() {
    const queueOptions = allQueues.map(q => `<option value="${q.id}">${escHtml(q.name)}</option>`).join('');

    const bodyHTML = `
      <div class="form-group">
        <label class="form-label">Job Name</label>
        <input class="form-input" id="j-name" type="text" placeholder="e.g. send-welcome-email" />
      </div>
      <div class="form-group">
        <label class="form-label">Queue</label>
        <select class="form-select" id="j-queue">
          <option value="">Select queue…</option>
          ${queueOptions}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Job Type</label>
          <select class="form-select" id="j-type" onchange="Jobs.onJobTypeChange()">
            <option value="immediate">Immediate</option>
            <option value="delayed">Delayed</option>
            <option value="scheduled">Scheduled</option>
            <option value="recurring">Recurring</option>
            <option value="batch">Batch</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Priority (0–100)</label>
          <input class="form-input" id="j-priority" type="number" min="0" max="100" value="50" />
        </div>
      </div>

      <div id="j-type-fields"></div>

      <div class="form-group">
        <label class="form-label">Payload (JSON)</label>
        <textarea class="form-textarea" id="j-payload" rows="5" placeholder='{"key": "value"}'>{}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Idempotency Key <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
        <input class="form-input" id="j-idempotency" type="text" placeholder="Unique key to prevent duplicate jobs" />
      </div>
    `;

    App.showModal('Create Job', bodyHTML, [
      {
        label: 'Create Job',
        class: 'btn-primary',
        onclick: submitCreateJob,
      },
    ]);

    // Trigger type fields render
    setTimeout(onJobTypeChange, 20);
  }

  function onJobTypeChange() {
    const type = document.getElementById('j-type')?.value;
    const el   = document.getElementById('j-type-fields');
    if (!el) return;

    let html = '';
    if (type === 'delayed') {
      html = `
        <div class="form-group">
          <label class="form-label">Delay (seconds)</label>
          <input class="form-input" id="j-delay" type="number" min="1" placeholder="e.g. 300" />
        </div>`;
    } else if (type === 'scheduled') {
      html = `
        <div class="form-group">
          <label class="form-label">Scheduled At</label>
          <input class="form-input" id="j-scheduled-at" type="datetime-local" />
        </div>`;
    } else if (type === 'recurring') {
      html = `
        <div class="form-group">
          <label class="form-label">Cron Expression</label>
          <input class="form-input" id="j-cron" type="text" placeholder="e.g. */5 * * * *" />
          <div class="form-hint">Standard 5-field cron format</div>
        </div>`;
    }
    el.innerHTML = html;
  }

  async function submitCreateJob() {
    const name        = document.getElementById('j-name')?.value.trim();
    const queueId     = document.getElementById('j-queue')?.value;
    const jobType     = document.getElementById('j-type')?.value;
    const priority    = parseInt(document.getElementById('j-priority')?.value || '50');
    const payloadStr  = document.getElementById('j-payload')?.value || '{}';
    const idempKey    = document.getElementById('j-idempotency')?.value.trim();

    if (!name)    { App.showToast('Job name is required.', 'error'); return; }
    if (!queueId) { App.showToast('Please select a queue.', 'error'); return; }

    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      App.showToast('Payload is not valid JSON.', 'error'); return;
    }

    const body = {
      name,
      job_type: jobType,
      priority,
      payload,
    };

    if (idempKey) body.idempotency_key = idempKey;

    const delayEl     = document.getElementById('j-delay');
    const scheduledEl = document.getElementById('j-scheduled-at');
    const cronEl      = document.getElementById('j-cron');

    if (jobType === 'delayed' && delayEl?.value) {
      body.delay_seconds = parseInt(delayEl.value);
    } else if (jobType === 'scheduled' && scheduledEl?.value) {
      body.scheduled_at = new Date(scheduledEl.value).toISOString();
    } else if (jobType === 'recurring' && cronEl?.value) {
      body.cron_expression = cronEl.value;
    }

    try {
      await API.post(`/queues/${queueId}/jobs`, body);
      App.closeModal();
      App.showToast('Job created successfully.', 'success');
      await loadJobs();
      renderJobsTable();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function resetFilters() {
    filters = { status: '', job_type: '', queue_id: '', search: '' };
    renderJobsPage();
  }

  async function refresh() {
    await loadJobs();
    renderJobsTable();
    App.showToast('Jobs refreshed.', 'info');
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.Jobs = {
    renderJobsPage,
    showJobDetail,
    toggleExecution,
    cancelJob,
    retryJob,
    openCreateJobModal,
    onJobTypeChange,
    resetFilters,
    refresh,
    goPage,
  };
})();
