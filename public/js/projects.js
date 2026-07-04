/**
 * projects.js — Projects & Organizations Management View
 */

(function () {
  'use strict';

  let organizations = [];
  let projects = [];

  /* ── Main Render ─────────────────────────────────────────────── */
  async function renderProjectsPage() {
    const content = document.getElementById('page-content');
    content.innerHTML = `
      <div class="loading-state">
        <div class="spinner spinner-lg"></div>
        <span>Loading workspace data…</span>
      </div>
    `;

    await refreshData();
    renderView();
  }

  /* ── Fetch Data ──────────────────────────────────────────────── */
  async function refreshData() {
    try {
      organizations = await API.get('/orgs') || [];
      if (!Array.isArray(organizations)) {
        organizations = organizations.data || organizations.orgs || [];
      }
    } catch (err) {
      organizations = [];
      console.error('Failed to fetch organizations:', err);
    }

    try {
      projects = await API.get('/projects') || [];
      if (!Array.isArray(projects)) {
        projects = projects.data || projects.projects || [];
      }
    } catch (err) {
      projects = [];
      console.error('Failed to fetch projects:', err);
    }
  }

  /* ── Render Page Layout ──────────────────────────────────────── */
  function renderView() {
    const content = document.getElementById('page-content');

    const orgsListHTML = organizations.map(org => {
      // Find projects belonging to this org
      const orgProjects = projects.filter(p => p.org_id === org.id);

      return `
        <div class="card org-card mb-24" style="border-left: 4px solid var(--accent-primary);">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div>
              <h3 style="font-size: 18px; font-weight: 700; color: var(--text-primary);">${esc(org.name)}</h3>
              <p style="font-size: 12px; color: var(--text-muted); margin-top: 2px;">Slug: <code style="background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: var(--radius-sm);">${esc(org.slug)}</code></p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" onclick="Projects.openNewProjectModal('${org.id}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Project
              </button>
            </div>
          </div>

          <div style="border-top: 1px solid rgba(255,255,255,0.06); padding-top: 16px;">
            <div style="font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; margin-bottom: 12px;">
              Projects (${orgProjects.length})
            </div>
            
            ${orgProjects.length === 0 
              ? `<div style="text-align: center; padding: 20px; border: 1px dashed rgba(255,255,255,0.08); border-radius: var(--radius-md); font-size: 13px; color: var(--text-muted);">
                   No projects in this organization. Click "New Project" to create one.
                 </div>`
              : `<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
                   ${orgProjects.map(p => `
                     <div class="project-item-card" style="
                       background: rgba(255,255,255,0.02);
                       border: 1px solid rgba(255,255,255,0.06);
                       border-radius: var(--radius-md);
                       padding: 14px 18px;
                       position: relative;
                       transition: all 0.2s ease;
                     ">
                       <div style="font-weight: 600; font-size: 14px; color: var(--text-primary);">${esc(p.name)}</div>
                       <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px; min-height: 18px;">
                         ${esc(p.description || 'No description.')}
                       </div>
                       <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
                         <span style="font-size: 10px; color: var(--text-muted); background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: var(--radius-sm);">
                           ID: ${p.id.slice(0, 8)}
                         </span>
                         <button class="btn btn-danger btn-sm" style="padding: 2px 8px; font-size: 11px;" onclick="Projects.deleteProject('${p.id}', '${esc(p.name)}')">Delete</button>
                       </div>
                     </div>
                   `).join('')}
                 </div>`
            }
          </div>
        </div>
      `;
    }).join('');

    content.innerHTML = `
      <div class="section-header mb-20">
        <h2 class="section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/>
          </svg>
          Organizations & Projects
        </h2>
        <button class="btn btn-primary" onclick="Projects.openNewOrgModal()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Organization
        </button>
      </div>

      ${organizations.length === 0
        ? `<div class="empty-state">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
               <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
               <circle cx="9" cy="7" r="4"/>
             </svg>
             <div class="empty-state-title">No Organizations found</div>
             <div class="empty-state-desc">Create an organization to set up your project workspace</div>
             <button class="btn btn-primary mt-12" onclick="Projects.openNewOrgModal()">Create Organization</button>
           </div>`
        : orgsListHTML
      }
    `;
  }

  /* ── Open New Org Modal ─────────────────────────────────────── */
  function openNewOrgModal() {
    const bodyHTML = `
      <div class="form-group">
        <label class="form-label" for="org-name">Organization Name</label>
        <input class="form-input" id="org-name" type="text" placeholder="e.g. Acme Corporation" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="org-slug">Slug (Optional)</label>
        <input class="form-input" id="org-slug" type="text" placeholder="e.g. acme-corp" />
        <small style="color: var(--text-muted); font-size: 11px; margin-top: 4px; display: block;">Leave blank to auto-generate based on name.</small>
      </div>
    `;

    App.showModal('Create Organization', bodyHTML, [
      {
        label: 'Create Organization',
        class: 'btn-primary',
        onclick: submitNewOrg,
      }
    ]);
  }

  async function submitNewOrg() {
    const name = document.getElementById('org-name')?.value.trim();
    const slug = document.getElementById('org-slug')?.value.trim();

    if (!name) {
      App.showToast('Organization name is required.', 'error');
      return;
    }

    try {
      await API.post('/orgs', { name, slug: slug || undefined });
      App.closeModal();
      App.showToast('Organization created successfully!', 'success');
      await refreshData();
      renderView();
    } catch (err) {
      App.showToast(err.message || 'Failed to create organization.', 'error');
    }
  }

  /* ── Open New Project Modal ─────────────────────────────────── */
  function openNewProjectModal(orgId) {
    const bodyHTML = `
      <div class="form-group">
        <label class="form-label" for="proj-name">Project Name</label>
        <input class="form-input" id="proj-name" type="text" placeholder="e.g. User Notifications" required />
      </div>
      <div class="form-group">
        <label class="form-label" for="proj-desc">Description</label>
        <input class="form-input" id="proj-desc" type="text" placeholder="e.g. Notification email and SMS queues" />
      </div>
    `;

    App.showModal('Create Project', bodyHTML, [
      {
        label: 'Create Project',
        class: 'btn-primary',
        onclick: () => submitNewProject(orgId),
      }
    ]);
  }

  async function submitNewProject(orgId) {
    const name = document.getElementById('proj-name')?.value.trim();
    const desc = document.getElementById('proj-desc')?.value.trim();

    if (!name) {
      App.showToast('Project name is required.', 'error');
      return;
    }

    try {
      await API.post(`/orgs/${orgId}/projects`, { name, description: desc });
      App.closeModal();
      App.showToast('Project created successfully!', 'success');
      await refreshData();
      renderView();
    } catch (err) {
      App.showToast(err.message || 'Failed to create project.', 'error');
    }
  }

  /* ── Delete Project ─────────────────────────────────────────── */
  function deleteProject(id, name) {
    App.showModal(
      'Delete Project',
      `<p style="color:var(--text-secondary);font-size:14px;">Are you sure you want to delete project <strong style="color:var(--text-primary);">"${esc(name)}"</strong>? This will permanently delete all associated queues and job data.</p>`,
      [
        {
          label: 'Delete Project',
          class: 'btn-danger',
          onclick: async () => {
            try {
              await API.delete(`/projects/${id}`);
              App.closeModal();
              App.showToast('Project deleted successfully.', 'success');
              await refreshData();
              renderView();
            } catch (err) {
              App.showToast(err.message, 'error');
            }
          },
        },
      ]
    );
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ── Exports ─────────────────────────────────────────────────── */
  window.Projects = {
    renderProjectsPage,
    openNewOrgModal,
    openNewProjectModal,
    deleteProject,
  };
})();
