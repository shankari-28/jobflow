/**
 * queues.js — Queue management page
 */

(function () {
  'use strict';

  let allQueues   = [];
  let allProjects = [];
  let expandedRow = null;

  /* ── Main render ─────────────────────────────────────────────── */
  async function renderQueuesPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading queues…</span></div>`;

    await fetchData();
    renderPage();
  }

  async function fetchData() {
    try {
      // Fetch all projects first, then their queues
      allProjects = await API.get('/projects') || [];
      if (!Array.isArray(allProjects)) allProjects = allProjects.data || allProjects.projects || [];
    } catch (err) {
      allProjects = [];
      console.warn('Projects fetch failed:', err.message);
    }

    allQueues = [];
    try {
      // Try global queues endpoint first
      const data = await API.get('/queues');
      allQueues = Array.isArray(data) ? data : (data.data || data.queues || []);
    } catch (_) {
      // Fallback: fetch per project
      for (const project of allProjects.slice(0, 10)) {
        try {
          const qData = await API.get(`/projects/${project.id}/queues`);
          const qs = Array.isArray(qData) ? qData : (qData.data || qData.queues || []);
          qs.forEach(q => { q._project = project; });
          allQueues.push(...qs);
        } catch (_) {}
      }
    }
  }

  function renderPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="section-header mb-16">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
          All Queues <span style="font-size:13px;font-weight:400;color:var(--text-muted);margin-left:8px;">(${allQueues.length})</span>
        </h2>
        <button class="btn btn-primary" onclick="Queues.openCreateModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Queue
        </button>
      </div>

      ${allQueues.length === 0
        ? `<div class="empty-state">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
             <div class="empty-state-title">No queues found</div>
             <div class="empty-state-desc">Create your first queue to get started</div>
             <button class="btn btn-primary mt-12" onclick="Queues.openCreateModal()">Create Queue</button>
           </div>`
        : `<div class="table-container">
             <table id="queues-table">
               <thead>
                 <tr>
                   <th style="width:40px;"></th>
                   <th>Name</th>
                   <th>Project</th>
                   <th>Priority</th>
                   <th>Concurrency</th>
                   <th>Status</th>
                   <th>Queued</th>
                   <th>Running</th>
                   <th>Failed</th>
                   <th style="text-align:right;">Actions</th>
                 </tr>
               </thead>
               <tbody id="queues-tbody">
                 ${allQueues.map(q => renderQueueRow(q)).join('')}
               </tbody>
             </table>
           </div>`
      }
    `;
  }

  function renderQueueRow(q) {
    const status   = q.is_paused || q.paused ? 'paused' : 'active';
    const project  = q._project || q.project || {};
    const projName = project.name || q.project_name || '—';

    return `
      <tr data-queue-id="${q.id}" onclick="Queues.toggleRow('${q.id}', event)">
        <td>
          <svg class="expand-chevron" style="width:14px;height:14px;color:var(--text-muted);transition:transform 0.2s;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </td>
        <td style="font-weight:600;">${escHtml(q.name || '—')}</td>
        <td class="td-muted">${escHtml(projName)}</td>
        <td>${q.priority ?? '—'}</td>
        <td>${q.concurrency_limit ?? q.max_concurrent ?? '—'}</td>
        <td>${Utils.badge(status)}</td>
        <td style="color:var(--status-queued);font-weight:600;">${q.queued_count ?? q.jobs_queued ?? '—'}</td>
        <td style="color:var(--success);font-weight:600;">${q.running_count ?? q.jobs_running ?? '—'}</td>
        <td style="color:var(--error);font-weight:600;">${q.failed_count ?? q.jobs_failed ?? '—'}</td>
        <td style="text-align:right;" onclick="event.stopPropagation()">
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-sm ${status === 'paused' ? 'btn-success' : 'btn-warning'}"
              onclick="Queues.togglePause('${q.id}', ${q.is_paused || q.paused ? 'true' : 'false'})">
              ${status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button class="btn btn-secondary btn-sm" onclick="Queues.openEditModal('${q.id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="Queues.deleteQueue('${q.id}', '${escHtml(q.name)}')">Delete</button>
          </div>
        </td>
      </tr>
      <tr class="row-detail hidden" id="detail-${q.id}">
        <td colspan="10" class="row-detail">
          <div class="row-detail-inner" id="detail-inner-${q.id}">
            <div class="spinner"></div>
          </div>
        </td>
      </tr>
    `;
  }

  /* ── Toggle inline stats row ─────────────────────────────────── */
  async function toggleRow(id, event) {
    if (event && event.target.closest('button')) return;

    const detailRow = document.getElementById(`detail-${id}`);
    const mainRow   = detailRow?.previousElementSibling;
    const chevron   = mainRow?.querySelector('.expand-chevron');

    if (!detailRow) return;

    if (expandedRow && expandedRow !== id) {
      // Collapse previous
      const prev = document.getElementById(`detail-${expandedRow}`);
      const prevMain = prev?.previousElementSibling;
      if (prev) prev.classList.add('hidden');
      if (prevMain) prevMain.querySelector('.expand-chevron').style.transform = '';
    }

    if (expandedRow === id) {
      detailRow.classList.add('hidden');
      if (chevron) chevron.style.transform = '';
      expandedRow = null;
      return;
    }

    expandedRow = id;
    detailRow.classList.remove('hidden');
    if (chevron) chevron.style.transform = 'rotate(90deg)';

    // Fetch stats
    const inner = document.getElementById(`detail-inner-${id}`);
    inner.innerHTML = '<div class="spinner"></div>';

    try {
      const stats = await API.get(`/queues/${id}/stats`);
      renderQueueStats(inner, stats);
    } catch (err) {
      inner.innerHTML = `<span style="color:var(--text-muted);font-size:13px;">Could not load stats: ${err.message}</span>`;
    }
  }

  function renderQueueStats(el, stats) {
    const s = stats || {};
    const items = [
      { label: 'Queued',    value: s.queued    ?? s.queued_count    ?? 0, color: 'var(--status-queued)'    },
      { label: 'Running',   value: s.running   ?? s.running_count   ?? 0, color: 'var(--success)'          },
      { label: 'Completed', value: s.completed ?? s.completed_count ?? 0, color: 'var(--status-completed)' },
      { label: 'Failed',    value: s.failed    ?? s.failed_count    ?? 0, color: 'var(--error)'            },
      { label: 'Dead',      value: s.dead      ?? s.dead_count      ?? 0, color: 'var(--status-dead)'      },
    ];
    const total = items.reduce((a, i) => a + Number(i.value), 0);
    const failed = Number(s.failed ?? s.failed_count ?? 0);
    const errRate = total ? (failed / total * 100).toFixed(1) : '0.0';

    el.innerHTML = `
      <div style="display:flex;gap:24px;flex-wrap:wrap;padding:4px 0;">
        ${items.map(i => `
          <div>
            <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);">${i.label}</div>
            <div style="font-size:22px;font-weight:800;color:${i.color};margin-top:2px;">${i.value}</div>
          </div>
        `).join('')}
        <div>
          <div style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);">Error Rate</div>
          <div style="font-size:22px;font-weight:800;color:${Number(errRate)>10?'var(--error)':'var(--text-primary)'};margin-top:2px;">${errRate}%</div>
        </div>
      </div>
    `;
  }

  /* ── Pause / Resume ──────────────────────────────────────────── */
  async function togglePause(id, isPaused) {
    const action = isPaused ? 'resume' : 'pause';
    try {
      await API.post(`/queues/${id}/${action}`);
      App.showToast(`Queue ${action}d successfully.`, 'success');
      await fetchData();
      renderPage();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  /* ── Delete ──────────────────────────────────────────────────── */
  function deleteQueue(id, name) {
    App.showModal(
      'Delete Queue',
      `<p style="color:var(--text-secondary);font-size:14px;">Are you sure you want to delete queue <strong style="color:var(--text-primary);">"${escHtml(name)}"</strong>? This action cannot be undone.</p>`,
      [
        {
          label: 'Delete Queue',
          class: 'btn-danger',
          onclick: async () => {
            try {
              await API.delete(`/queues/${id}`);
              App.closeModal();
              App.showToast('Queue deleted.', 'success');
              await fetchData();
              renderPage();
            } catch (err) {
              App.showToast(err.message, 'error');
            }
          },
        },
      ]
    );
  }

  /* ── Create / Edit Modal ─────────────────────────────────────── */
  function openCreateModal() {
    openQueueModal(null);
  }

  function openEditModal(id) {
    const queue = allQueues.find(q => String(q.id) === String(id));
    openQueueModal(queue);
  }

  function openQueueModal(queue) {
    const isEdit = !!queue;
    const q = queue || {};

    const projectOptions = allProjects.map(p =>
      `<option value="${p.id}" ${q._project?.id === p.id || q.project_id === p.id ? 'selected' : ''}>${escHtml(p.name)}</option>`
    ).join('');

    const bodyHTML = `
      <div class="form-group">
        <label class="form-label">Project</label>
        <select class="form-select" id="q-project" ${isEdit ? 'disabled' : ''}>
          <option value="">Select project…</option>
          ${projectOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Queue Name</label>
        <input class="form-input" id="q-name" type="text" placeholder="e.g. email-delivery" value="${escHtml(q.name || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input class="form-input" id="q-desc" type="text" placeholder="Optional description" value="${escHtml(q.description || '')}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Priority (0–100)</label>
          <input class="form-input" id="q-priority" type="number" min="0" max="100" value="${q.priority ?? 50}" />
        </div>
        <div class="form-group">
          <label class="form-label">Concurrency Limit (1–50)</label>
          <input class="form-input" id="q-concurrency" type="number" min="1" max="50" value="${q.concurrency_limit ?? q.max_concurrent ?? 10}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Retry Strategy</label>
        <select class="form-select" id="q-retry-strategy">
          ${['fixed','linear','exponential','exponential_jitter'].map(s =>
            `<option value="${s}" ${(q.retry_strategy || 'exponential') === s ? 'selected' : ''}>${s}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Max Retries</label>
          <input class="form-input" id="q-max-retries" type="number" min="0" max="100" value="${q.max_retries ?? 3}" />
        </div>
        <div class="form-group">
          <label class="form-label">Base Delay (ms)</label>
          <input class="form-input" id="q-base-delay" type="number" min="0" value="${q.base_delay_ms ?? q.retry_delay_ms ?? 1000}" />
        </div>
        <div class="form-group">
          <label class="form-label">Max Delay (ms)</label>
          <input class="form-input" id="q-max-delay" type="number" min="0" value="${q.max_delay_ms ?? 60000}" />
        </div>
      </div>
    `;

    App.showModal(
      isEdit ? `Edit Queue: ${q.name}` : 'Create Queue',
      bodyHTML,
      [
        {
          label: isEdit ? 'Save Changes' : 'Create Queue',
          class: 'btn-primary',
          onclick: () => submitQueueForm(isEdit, q.id),
        },
      ]
    );
  }

  async function submitQueueForm(isEdit, queueId) {
    const projectId = document.getElementById('q-project')?.value;
    const name      = document.getElementById('q-name')?.value.trim();
    const desc      = document.getElementById('q-desc')?.value.trim();
    const priority  = parseInt(document.getElementById('q-priority')?.value);
    const concurrency = parseInt(document.getElementById('q-concurrency')?.value);
    const retryStrategy = document.getElementById('q-retry-strategy')?.value;
    const maxRetries  = parseInt(document.getElementById('q-max-retries')?.value);
    const baseDelay   = parseInt(document.getElementById('q-base-delay')?.value);
    const maxDelay    = parseInt(document.getElementById('q-max-delay')?.value);

    if (!name) { App.showToast('Queue name is required.', 'error'); return; }
    if (!isEdit && !projectId) { App.showToast('Please select a project.', 'error'); return; }

    const payload = {
      name,
      description: desc,
      priority,
      concurrency_limit: concurrency,
      retry_strategy: retryStrategy,
      max_retries: maxRetries,
      base_delay_ms: baseDelay,
      max_delay_ms: maxDelay,
    };

    try {
      if (isEdit) {
        await API.put(`/queues/${queueId}`, payload);
      } else {
        await API.post(`/projects/${projectId}/queues`, payload);
      }
      App.closeModal();
      App.showToast(`Queue ${isEdit ? 'updated' : 'created'} successfully.`, 'success');
      await fetchData();
      renderPage();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.Queues = {
    renderQueuesPage,
    toggleRow,
    togglePause,
    deleteQueue,
    openCreateModal,
    openEditModal,
  };
})();
