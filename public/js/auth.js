/**
 * auth.js — Login & Register UI logic
 */

(function () {
  'use strict';

  /* ── SVG Logo snippet ──────────────────────────────────────── */
  const logoSVG = `
    <div class="auth-logo">
      <div class="auth-logo-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </div>
      <span class="auth-logo-text">JobFlow</span>
    </div>`;

  /* ── Validation helpers ────────────────────────────────────── */
  function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  function validatePassword(password) {
    return password.length >= 8;
  }

  function showFieldError(inputId, message) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.style.borderColor = 'var(--error)';
    let err = input.parentElement.querySelector('.form-error');
    if (!err) {
      err = document.createElement('div');
      err.className = 'form-error';
      input.parentElement.appendChild(err);
    }
    err.textContent = message;
  }

  function clearFieldError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.style.borderColor = '';
    const err = input.parentElement.querySelector('.form-error');
    if (err) err.remove();
  }

  function clearAllErrors(ids) {
    ids.forEach(id => clearFieldError(id));
    const global = document.getElementById('auth-global-error');
    if (global) global.style.display = 'none';
  }

  function showGlobalError(message) {
    let el = document.getElementById('auth-global-error');
    if (el) {
      el.textContent = message;
      el.style.display = 'block';
    }
  }

  function setLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset.orig = btn.innerHTML;
      btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span> Please wait…`;
    } else {
      if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    }
  }

  /* ── Login Page ─────────────────────────────────────────────── */
  function renderLoginPage() {
    const container = document.getElementById('auth-card-container');
    if (!container) return;

    container.innerHTML = `
      ${logoSVG}
      <h1 class="auth-title">Welcome back</h1>
      <p class="auth-subtitle">Sign in to your dashboard</p>

      <div id="auth-global-error" style="
        display:none;
        background:var(--error-bg);
        border:1px solid rgba(239,68,68,0.3);
        border-radius:var(--radius-md);
        padding:10px 14px;
        font-size:13px;
        color:#f87171;
        margin-bottom:16px;
      "></div>

      <form id="login-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="login-email">Email address</label>
          <input
            class="form-input"
            type="email"
            id="login-email"
            placeholder="you@example.com"
            autocomplete="email"
            required
          />
        </div>

        <div class="form-group">
          <label class="form-label" for="login-password">
            Password
            <span style="float:right; font-size:11px; color:var(--accent-primary); cursor:pointer;" id="forgot-link">Forgot?</span>
          </label>
          <input
            class="form-input"
            type="password"
            id="login-password"
            placeholder="••••••••"
            autocomplete="current-password"
            required
          />
        </div>

        <button type="submit" class="btn btn-primary" id="login-btn" style="width:100%; justify-content:center; margin-top:8px; padding:12px;">
          Sign in
        </button>
      </form>

      <div class="auth-switch">
        Don't have an account? <a href="#" id="go-register">Create one</a>
      </div>
    `;

    // Events
    document.getElementById('login-form').addEventListener('submit', handleLogin);
    document.getElementById('go-register').addEventListener('click', e => {
      e.preventDefault();
      renderRegisterPage();
    });
    document.getElementById('forgot-link').addEventListener('click', () => {
      App.showToast('Password reset is not available in this demo.', 'info');
    });

    // Focus first field
    setTimeout(() => {
      const el = document.getElementById('login-email');
      if (el) el.focus();
    }, 50);
  }

  /* ── Register Page ──────────────────────────────────────────── */
  function renderRegisterPage() {
    const container = document.getElementById('auth-card-container');
    if (!container) return;

    container.innerHTML = `
      ${logoSVG}
      <h1 class="auth-title">Create account</h1>
      <p class="auth-subtitle">Get started with JobFlow</p>

      <div id="auth-global-error" style="
        display:none;
        background:var(--error-bg);
        border:1px solid rgba(239,68,68,0.3);
        border-radius:var(--radius-md);
        padding:10px 14px;
        font-size:13px;
        color:#f87171;
        margin-bottom:16px;
      "></div>

      <form id="register-form" novalidate>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="reg-firstname">First name</label>
            <input class="form-input" type="text" id="reg-firstname" placeholder="Ada" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="reg-lastname">Last name</label>
            <input class="form-input" type="text" id="reg-lastname" placeholder="Lovelace" required />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="reg-email">Email address</label>
          <input class="form-input" type="email" id="reg-email" placeholder="you@example.com" autocomplete="email" required />
        </div>

        <div class="form-group">
          <label class="form-label" for="reg-password">Password</label>
          <input class="form-input" type="password" id="reg-password" placeholder="Min. 8 characters" autocomplete="new-password" required />
        </div>

        <div class="form-group">
          <label class="form-label" for="reg-confirm">Confirm password</label>
          <input class="form-input" type="password" id="reg-confirm" placeholder="Re-enter password" autocomplete="new-password" required />
        </div>

        <button type="submit" class="btn btn-primary" id="register-btn" style="width:100%; justify-content:center; margin-top:8px; padding:12px;">
          Create account
        </button>
      </form>

      <div class="auth-switch">
        Already have an account? <a href="#" id="go-login">Sign in</a>
      </div>
    `;

    document.getElementById('register-form').addEventListener('submit', handleRegister);
    document.getElementById('go-login').addEventListener('click', e => {
      e.preventDefault();
      renderLoginPage();
    });

    setTimeout(() => {
      const el = document.getElementById('reg-firstname');
      if (el) el.focus();
    }, 50);
  }

  /* ── Login handler ──────────────────────────────────────────── */
  async function handleLogin(e) {
    e.preventDefault();
    clearAllErrors(['login-email', 'login-password']);

    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    let valid = true;

    if (!email) {
      showFieldError('login-email', 'Email is required.');
      valid = false;
    } else if (!validateEmail(email)) {
      showFieldError('login-email', 'Enter a valid email address.');
      valid = false;
    }

    if (!password) {
      showFieldError('login-password', 'Password is required.');
      valid = false;
    } else if (!validatePassword(password)) {
      showFieldError('login-password', 'Password must be at least 8 characters.');
      valid = false;
    }

    if (!valid) return;

    setLoading('login-btn', true);

    try {
      const data = await API.post('/auth/login', { email, password });
      const token = data.token || data.access_token || data.accessToken;
      if (!token) throw new Error('No token received from server.');
      API.setToken(token);

      // Store user info if returned
      if (data.user) {
        localStorage.setItem('jf_user', JSON.stringify(data.user));
      }

      App.hideAuthOverlay();
      App.navigate('overview');
      App.showToast('Signed in successfully!', 'success');
    } catch (err) {
      setLoading('login-btn', false);
      showGlobalError(err.message || 'Login failed. Please try again.');
    }
  }

  /* ── Register handler ───────────────────────────────────────── */
  async function handleRegister(e) {
    e.preventDefault();
    clearAllErrors(['reg-firstname', 'reg-lastname', 'reg-email', 'reg-password', 'reg-confirm']);

    const firstname = document.getElementById('reg-firstname').value.trim();
    const lastname  = document.getElementById('reg-lastname').value.trim();
    const email     = document.getElementById('reg-email').value.trim();
    const password  = document.getElementById('reg-password').value;
    const confirm   = document.getElementById('reg-confirm').value;

    let valid = true;

    if (!firstname) { showFieldError('reg-firstname', 'First name is required.'); valid = false; }
    if (!lastname)  { showFieldError('reg-lastname', 'Last name is required.');  valid = false; }
    if (!email)     { showFieldError('reg-email', 'Email is required.'); valid = false; }
    else if (!validateEmail(email)) { showFieldError('reg-email', 'Enter a valid email.'); valid = false; }
    if (!password)  { showFieldError('reg-password', 'Password is required.'); valid = false; }
    else if (!validatePassword(password)) { showFieldError('reg-password', 'Password must be at least 8 characters.'); valid = false; }
    if (password && confirm !== password) { showFieldError('reg-confirm', 'Passwords do not match.'); valid = false; }

    if (!valid) return;

    setLoading('register-btn', true);

    try {
      await API.post('/auth/register', {
        first_name: firstname,
        last_name: lastname,
        email,
        password,
      });

      // Auto-login after register
      const loginData = await API.post('/auth/login', { email, password });
      const token = loginData.token || loginData.access_token || loginData.accessToken;
      if (!token) throw new Error('Registration succeeded but login failed. Please sign in manually.');
      API.setToken(token);

      if (loginData.user) {
        localStorage.setItem('jf_user', JSON.stringify(loginData.user));
      }

      App.hideAuthOverlay();
      App.navigate('overview');
      App.showToast('Account created successfully! Welcome to JobFlow.', 'success');
    } catch (err) {
      setLoading('register-btn', false);
      showGlobalError(err.message || 'Registration failed. Please try again.');
    }
  }

  /* ── Exports ─────────────────────────────────────────────────── */
  window.Auth = {
    renderLoginPage,
    renderRegisterPage,
  };
})();
