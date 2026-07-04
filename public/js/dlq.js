/**
 * dlq.js — Dead Letter Queue page
 */

(function () {
  'use strict';

  let dlqItems  = [];
  let allQueues = [];
  let filterQueueId = '';

  /* ── Main render ─────────────────────────────────────────────── */
  async function renderDLQPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `<div class="loading-state"><div class="spinner spinner-lg"></div><span>Loading dead letter queue…</span></div>`;

    await Promise.all([loadQueues(), loadDLQ()]);
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

  async function loadDLQ() {
    try {
      const params = { limit: 100 };
      if (filterQueueId) params.queue_id = filterQueueId;
      const data = await API.get('/dlq', params);
      dlqItems = Array.isArray(data) ? data : (data.data || data.items || data.jobs || []);
    } catch (err) {
      dlqItems = [];
      console.warn('DLQ fetch failed:', err.message);
    }
  }

  /* ── Render ─────────────────────────────────────────────────── */
  function renderPage() {
    const content = document.getElementById('page-content');

    const queueOptions = allQueues.map(q =>
      `<option value="${q.id}" ${filterQueueId === String(q.id) ? 'selected' : ''}>${escHtml(q.name)}</option>`
    ).join('');

    const filtered = filterQueueId
      ? dlqItems.filter(i => String(i.queue_id || i._queue?.id) === String(filterQueueId))
      : dlqItems;

    content.innerHTML = `
      <!-- Header -->
      <div class="section-header mb-16">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Dead Letter Queue
          <span style="font-size:13px;font-weight:400;color:var(--text-muted);margin-left:8px;">(${filtered.length} items)</span>
        </h2>
        <button class="btn btn-secondary btn-sm" onclick="DLQ.refresh()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
          Refresh
        </button>
      </div>

      <!-- Filters -->
      <div class="filters-bar mb-16">
        <select class="filter-select" id="dlq-queue-filter" onchange="DLQ.onQueueFilter()">
          <option value="">All Queues</option>
          ${queueOptions}
        </select>
        <span style="font-size:13px;color:var(--text-muted);">${filtered.length} dead job${filtered.length !== 1 ? 's' : ''}</span>
      </div>

      <!-- Table or empty -->
      ${filtered.length === 0
        ? `<div class="empty-state">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
             <div class="empty-state-title">No dead jobs 🎉</div>
             <div class="empty-state-desc">All jobs are healthy. No items in the dead letter queue.</div>
           </div>`
        : `<div class="table-container">
             <table>
               <thead>
                 <tr>
                   <th>Job Name</th>
                   <th>Queue</th>
                   <th>Failure Reason</th>
                   <th>Retries</th>
                   <th>Moved At</th>
                   <th style="text-align:right;">Actions</th>
                 </tr>
               </thead>
               <tbody>
                 ${filtered.map(item => renderDLQRow(item)).join('')}
               </tbody>
             </table>
           </div>`
      }
    `;
  }

  /* ── Table row ───────────────────────────────────────────────── */
  function renderDLQRow(item) {
    const name       = item.job_name || item.name || item.job?.name || '—';
    const queue      = item.queue_name || item.queue || item._queue?.name || '—';
    const reason     = item.failure_reason || item.error || item.last_error || '—';
    const retries    = item.retry_count ?? item.retries ?? '—';
    const movedAt    = item.moved_at || item.dead_at || item.created_at;

    return `
      <tr onclick="DLQ.showDetail('${item.id}')" style="cursor:pointer;">
        <td style="font-weight:600;">${escHtml(name)}</td>
        <td class="td-muted">${escHtml(queue)}</td>
        <td style="max-width:300px;">
          <span title="${escHtml(reason)}" style="color:var(--error);font-size:12px;">${escHtml(Utils.truncate(reason, 60))}</span>
        </td>
        <td style="text-align:center;color:var(--warning);font-weight:600;">${retries}</td>
        <td class="td-muted">${Utils.timeAgo(movedAt)}</td>
        <td style="text-align:right;" onclick="event.stopPropagation()">
          <div style="display:flex;gap:6px;justify-content:flex-end;">
            <button class="btn btn-success btn-sm" onclick="DLQ.requeue('${item.id}', '${escHtml(name)}')">
              Re-enqueue
            </button>
            <button class="btn btn-danger btn-sm" onclick="DLQ.discard('${item.id}', '${escHtml(name)}')">
              Discard
            </button>
          </div>
        </td>
      </tr>`;
  }

  /* ── Detail modal ────────────────────────────────────────────── */
  function showDetail(id) {
    const item = dlqItems.find(i => String(i.id) === String(id));
    if (!item) return;

    const name   = item.job_name || item.name || item.job?.name || id;
    const queue  = item.queue_name || item.queue || '—';
    const reason = item.failure_reason || item.error || item.last_error || '—';
    const trace  = item.failure_traceback || item.stack_trace || item.traceback || '';
    const payload = item.payload || item.job?.payload || {};

    const bodyHTML = `
      <div style="margin-bottom:16px;">
        <div style="font-size:18px;font-weight:700;margin-bottom:6px;">${escHtml(name)}</div>
        ${Utils.badge('dead')}
      </div>

      <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value td-mono">${item.id}</span></div>
      <div class="detail-row"><span class="detail-label">Queue</span><span class="detail-value">${escHtml(queue)}</span></div>
      <div class="detail-row"><span class="detail-label">Retry Count</span><span class="detail-value">${item.retry_count ?? item.retries ?? '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Moved At</span><span class="detail-value">${Utils.formatDate(item.moved_at || item.dead_at || item.created_at)}</span></div>
      <div class="detail-row"><span class="detail-label">Original Created</span><span class="detail-value">${Utils.formatDate(item.original_created_at || item.job?.created_at)}</span></div>

      <div class="divider"></div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--error);margin-bottom:8px;">Failure Reason</div>
      <div style="background:var(--error-bg);border:1px solid rgba(239,68,68,0.2);border-radius:var(--radius-md);padding:12px;font-size:13px;color:#f87171;margin-bottom:16px;">${escHtml(reason)}</div>

      ${trace ? `
        <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:8px;">Stack Trace</div>
        <pre class="pre-block" style="max-height:260px;">${escHtml(trace)}</pre>
      ` : ''}

      <div class="divider"></div>
      <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;color:var(--text-muted);margin-bottom:8px;">Payload</div>
      <pre class="pre-block">${escHtml(Utils.prettyJSON(payload))}</pre>
    `;

    App.showModal(
      `Dead Job: ${name}`,
      bodyHTML,
      [
        {
          label: 'Re-enqueue',
          class: 'btn-success',
          onclick: () => { App.closeModal(); requeue(item.id, name); },
        },
        {
          label: 'Discard',
          class: 'btn-danger',
          onclick: () => { App.closeModal(); discard(item.id, name); },
        },
      ],
      { size: 'lg' }
    );
  }

  /* ── Re-enqueue ──────────────────────────────────────────────── */
  async function requeue(id, name) {
    try {
      await API.post(`/dlq/${id}/requeue`);
      App.showToast(`Job "${name}" re-enqueued successfully.`, 'success');
      await loadDLQ();
      renderPage();
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  }

  /* ── Discard ─────────────────────────────────────────────────── */
  function discard(id, name) {
    App.showModal(
      'Discard Dead Job',
      `<p style="color:var(--text-secondary);font-size:14px;line-height:1.7;">
         Are you sure you want to permanently discard
         <strong style="color:var(--text-primary);">"${escHtml(name)}"</strong>?
         <br/>This action cannot be undone.
       </p>`,
      [
        {
          label: 'Discard Permanently',
          class: 'btn-danger',
          onclick: async () => {
            try {
              await API.delete(`/dlq/${id}`);
              App.closeModal();
              App.showToast(`Job "${name}" discarded.`, 'success');
              await loadDLQ();
              renderPage();
            } catch (err) {
              App.showToast(err.message, 'error');
            }
          },
        },
      ]
    );
  }

  /* ── Filter by queue ─────────────────────────────────────────── */
  function onQueueFilter() {
    filterQueueId = document.getElementById('dlq-queue-filter')?.value || '';
    renderPage();
  }

  async function refresh() {
    await loadDLQ();
    renderPage();
    App.showToast('DLQ refreshed.', 'info');
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.DLQ = {
    renderDLQPage,
    showDetail,
    requeue,
    discard,
    onQueueFilter,
    refresh,
  };
})();
