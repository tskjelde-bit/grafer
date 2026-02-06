/**
 * GitHub Save Module
 * Allows saving CSV files directly to a GitHub repo via the Contents API.
 * Used by admin pages to save data when running on GitHub Pages (no backend).
 */

(function () {
  'use strict';

  const GITHUB_TOKEN_KEY = 'github_pat';
  const isGitHubPages = window.location.hostname.endsWith('.github.io');
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // UTF-8 safe base64 encoding
  function utf8ToBase64(str) {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function getToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  }

  function setToken(token) {
    localStorage.setItem(GITHUB_TOKEN_KEY, token.trim());
  }

  function deleteToken() {
    localStorage.removeItem(GITHUB_TOKEN_KEY);
  }

  function maskToken(token) {
    if (!token || token.length < 8) return '';
    return token.slice(0, 4) + '****' + token.slice(-4);
  }

  async function verifyToken(token) {
    const resp = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `token ${token}` }
    });
    if (!resp.ok) throw new Error('Ugyldig token');
    const user = await resp.json();
    return user.login;
  }

  async function getFileSha(owner, repo, path, token) {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=main`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Kunne ikke hente fil: ${resp.status}`);
    const data = await resp.json();
    return data.sha;
  }

  async function saveToGitHub(owner, repo, path, content, message, token) {
    const sha = await getFileSha(owner, repo, path, token);
    const base64Content = utf8ToBase64(content);

    const body = {
      message: message,
      content: base64Content,
      branch: 'main'
    };
    if (sha) body.sha = sha;

    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      if (resp.status === 401) throw new Error('Ugyldig eller utløpt token. Oppdater token i innstillinger.');
      if (resp.status === 409) throw new Error('Konflikt - filen ble endret av andre. Prøv igjen.');
      if (resp.status === 422) throw new Error('Filen ble endret siden sist. Last inn siden på nytt og prøv igjen.');
      throw new Error(err.message || `GitHub API feil: ${resp.status}`);
    }

    const result = await resp.json();
    return {
      success: true,
      commitUrl: result.commit ? result.commit.html_url : '',
      message: 'Lagret til GitHub!'
    };
  }

  function createSettingsPanel() {
    const token = getToken();
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.id = 'githubSettingsPanel';
    panel.innerHTML = `
      <h2>GitHub-innstillinger</h2>
      <p style="font-size: 0.875rem; color: #a1a1aa; margin-bottom: 0.5rem;">
        For å lagre direkte til GitHub trenger du en
        <a href="https://github.com/settings/tokens" target="_blank" style="color: #60a5fa;">Personal Access Token</a>
        med <strong>repo</strong> scope.
      </p>
      <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
        <input type="password" id="githubTokenInput" placeholder="ghp_xxxxxxxxxxxx"
               value="${token}"
               style="flex: 1; min-width: 200px; background: #1f2937; color: #e4e4e7; border: 1px solid rgba(255,255,255,0.1); padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem;">
        <button class="btn" id="saveTokenBtn">Lagre token</button>
        <button class="btn" id="deleteTokenBtn" style="background: #ef4444;">Slett</button>
      </div>
      <div id="tokenStatus" style="margin-top: 0.5rem; font-size: 0.875rem;">
        ${token ? '<span style="color: #10b981;">Token lagret: ' + maskToken(token) + '</span>' : '<span style="color: #f59e0b;">Ingen token satt</span>'}
      </div>
    `;
    return panel;
  }

  function initGitHubSave(config) {
    const { owner, repo, filePath, getCSVContent, commitMessagePrefix, statusElement } = config;

    // Inject settings panel at the top of .container
    const container = document.querySelector('.container');
    if (!container) return;

    const settingsPanel = createSettingsPanel();
    const firstPanel = container.querySelector('.panel');
    if (firstPanel) {
      container.insertBefore(settingsPanel, firstPanel);
    } else {
      container.appendChild(settingsPanel);
    }

    // Token save/delete handlers
    const tokenInput = document.getElementById('githubTokenInput');
    const tokenStatus = document.getElementById('tokenStatus');
    const saveTokenBtn = document.getElementById('saveTokenBtn');
    const deleteTokenBtn = document.getElementById('deleteTokenBtn');

    saveTokenBtn.addEventListener('click', async () => {
      const token = tokenInput.value.trim();
      if (!token) {
        tokenStatus.innerHTML = '<span style="color: #ef4444;">Skriv inn en token</span>';
        return;
      }
      tokenStatus.innerHTML = '<span style="color: #60a5fa;">Verifiserer...</span>';
      try {
        const username = await verifyToken(token);
        setToken(token);
        tokenStatus.innerHTML = `<span style="color: #10b981;">Token lagret for bruker: ${username}</span>`;
      } catch (e) {
        tokenStatus.innerHTML = `<span style="color: #ef4444;">${e.message}</span>`;
      }
    });

    deleteTokenBtn.addEventListener('click', () => {
      deleteToken();
      tokenInput.value = '';
      tokenStatus.innerHTML = '<span style="color: #f59e0b;">Token slettet</span>';
    });

    // Find the button container (the div with download/save/push buttons)
    const previewPanel = document.getElementById('previewPanel');
    if (previewPanel) {
      const btnContainers = previewPanel.querySelectorAll('div[style*="margin-top"]');
      let btnContainer = null;
      for (const el of btnContainers) {
        if (el.querySelector('#downloadBtn') || el.querySelector('.btn-success')) {
          btnContainer = el;
          break;
        }
      }

      if (btnContainer) {
        // Create the GitHub save button
        const githubSaveBtn = document.createElement('button');
        githubSaveBtn.className = 'btn';
        githubSaveBtn.id = 'githubSaveBtn';
        githubSaveBtn.style.background = '#238636';
        githubSaveBtn.style.marginTop = '0.5rem';
        githubSaveBtn.textContent = 'Lagre til GitHub';
        btnContainer.appendChild(githubSaveBtn);

        // Click handler
        githubSaveBtn.addEventListener('click', async () => {
          const token = getToken();
          if (!token) {
            if (statusElement) {
              statusElement.textContent = 'Sett opp GitHub-token i innstillinger øverst på siden.';
              statusElement.className = 'status show error';
            }
            document.getElementById('githubSettingsPanel')?.scrollIntoView({ behavior: 'smooth' });
            return;
          }

          const csv = getCSVContent();
          if (!csv || csv.trim().split('\n').length < 2) {
            if (statusElement) {
              statusElement.textContent = 'Ingen data å lagre. Last opp og prosesser data først.';
              statusElement.className = 'status show error';
            }
            return;
          }

          if (statusElement) {
            statusElement.textContent = 'Lagrer til GitHub...';
            statusElement.className = 'status show info';
          }
          githubSaveBtn.disabled = true;

          try {
            const today = new Date().toISOString().split('T')[0];
            const message = `${commitMessagePrefix} ${today}`;
            const result = await saveToGitHub(owner, repo, filePath, csv, message, token);

            if (statusElement) {
              statusElement.innerHTML = `Lagret til GitHub! <a href="${result.commitUrl}" target="_blank" style="color: #60a5fa;">Se commit</a>`;
              statusElement.className = 'status show success';
            }
          } catch (e) {
            if (statusElement) {
              statusElement.textContent = `Feil: ${e.message}`;
              statusElement.className = 'status show error';
            }
          } finally {
            githubSaveBtn.disabled = false;
          }
        });
      }
    }

    // Hide server-only buttons when on GitHub Pages
    if (isGitHubPages) {
      const saveBtn = document.getElementById('saveBtn');
      const githubBtn = document.getElementById('githubBtn');
      if (saveBtn) saveBtn.style.display = 'none';
      if (githubBtn) githubBtn.style.display = 'none';
    }
  }

  // Export to global scope
  window.initGitHubSave = initGitHubSave;
})();
