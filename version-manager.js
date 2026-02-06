/**
 * Version Manager Module
 * Manages chart versions stored in versions.json files on GitHub.
 * Each generer.html page includes this and calls VersionManager.init() with chart-specific config.
 */

(function () {
  'use strict';

  const GITHUB_TOKEN_KEY = 'github_pat';
  const GITHUB_PAGES_BASE = 'https://tskjelde-bit.github.io/grafer';
  const OWNER = 'tskjelde-bit';
  const REPO = 'grafer';

  function getToken() {
    return localStorage.getItem(GITHUB_TOKEN_KEY) || '';
  }

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

  // UTF-8 safe base64 decoding
  function base64ToUtf8(base64) {
    const binary = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  function slugify(name) {
    return name
      .toLowerCase()
      .replace(/æ/g, 'ae')
      .replace(/ø/g, 'o')
      .replace(/å/g, 'a')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function uniqueSlug(slug, existingIds) {
    if (!existingIds.includes(slug)) return slug;
    let i = 2;
    while (existingIds.includes(`${slug}-${i}`)) i++;
    return `${slug}-${i}`;
  }

  async function getFileFromGitHub(path, token) {
    const resp = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=main`, {
      headers: { 'Authorization': `token ${token}` }
    });
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Kunne ikke hente fil: ${resp.status}`);
    const data = await resp.json();
    return {
      sha: data.sha,
      content: base64ToUtf8(data.content)
    };
  }

  async function saveFileToGitHub(path, content, message, token, sha) {
    const body = {
      message: message,
      content: utf8ToBase64(content),
      branch: 'main'
    };
    if (sha) body.sha = sha;

    const resp = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
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
      if (resp.status === 409) throw new Error('Konflikt – filen ble endret av andre. Prøv igjen.');
      if (resp.status === 422) throw new Error('Filen ble endret siden sist. Last inn siden på nytt og prøv igjen.');
      throw new Error(err.message || `GitHub API feil: ${resp.status}`);
    }

    return await resp.json();
  }

  // ---- Version Manager ----

  let _config = null;
  let _versions = {};  // { id: { name, id, createdAt, updatedAt, config } }
  let _sha = null;     // Current SHA of versions.json on GitHub
  let _loaded = false;
  let _panelEl = null;

  const VersionManager = {

    async init(config) {
      // config: { chartType, versionsPath, publicUrl, getCurrentConfig, applyConfig, containerSelector }
      _config = config;
      await this.loadVersions();
      this.renderVersionsPanel();
    },

    async loadVersions() {
      // Try fetching versions.json locally (works on both localhost and GitHub Pages)
      try {
        const resp = await fetch('versions.json?t=' + Date.now());
        if (resp.ok) {
          const data = await resp.json();
          _versions = data.versions || {};
          _loaded = true;
        }
      } catch (e) {
        // File doesn't exist yet, start empty
      }

      // Also cache in localStorage
      const cacheKey = `versions-cache-${_config.chartType}`;
      if (_loaded) {
        localStorage.setItem(cacheKey, JSON.stringify(_versions));
      } else {
        // Try loading from cache
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            _versions = JSON.parse(cached);
            _loaded = true;
          } catch (e) { /* ignore */ }
        }
      }
    },

    async _getLatestFromGitHub(token) {
      const file = await getFileFromGitHub(_config.versionsPath, token);
      if (file) {
        const data = JSON.parse(file.content);
        _versions = data.versions || {};
        _sha = file.sha;
      } else {
        _versions = {};
        _sha = null;
      }
    },

    async _pushToGitHub(message) {
      const token = getToken();
      if (!token) throw new Error('Ingen GitHub-token satt. Gå til admin-siden og sett opp token.');

      // Get latest SHA first to avoid conflicts
      await this._getLatestFromGitHub(token);

      // This is called AFTER _versions has been modified by the caller
      // But we need to re-merge. Let's use a different approach:
      // The caller passes the modification function
      return { token };
    },

    async saveVersion(name) {
      const token = getToken();
      if (!token) throw new Error('Ingen GitHub-token satt. Gå til admin-siden og sett opp token.');

      // Get latest from GitHub
      await this._getLatestFromGitHub(token);

      const slug = uniqueSlug(slugify(name), Object.keys(_versions));
      const now = new Date().toISOString();

      _versions[slug] = {
        name: name,
        id: slug,
        createdAt: now,
        updatedAt: now,
        config: _config.getCurrentConfig()
      };

      const fileContent = JSON.stringify({ versions: _versions }, null, 2);
      await saveFileToGitHub(
        _config.versionsPath,
        fileContent,
        `Ny versjon: ${name} (${_config.chartType})`,
        token,
        _sha
      );

      // Update cache
      localStorage.setItem(`versions-cache-${_config.chartType}`, JSON.stringify(_versions));

      this._renderList();
      return slug;
    },

    async updateVersion(id) {
      const token = getToken();
      if (!token) throw new Error('Ingen GitHub-token satt.');

      await this._getLatestFromGitHub(token);

      if (!_versions[id]) throw new Error('Versjon ikke funnet: ' + id);

      _versions[id].config = _config.getCurrentConfig();
      _versions[id].updatedAt = new Date().toISOString();

      const fileContent = JSON.stringify({ versions: _versions }, null, 2);
      await saveFileToGitHub(
        _config.versionsPath,
        fileContent,
        `Oppdater versjon: ${_versions[id].name} (${_config.chartType})`,
        token,
        _sha
      );

      localStorage.setItem(`versions-cache-${_config.chartType}`, JSON.stringify(_versions));
      this._renderList();
    },

    async deleteVersion(id) {
      const token = getToken();
      if (!token) throw new Error('Ingen GitHub-token satt.');

      await this._getLatestFromGitHub(token);

      const name = _versions[id]?.name || id;
      delete _versions[id];

      const fileContent = JSON.stringify({ versions: _versions }, null, 2);
      await saveFileToGitHub(
        _config.versionsPath,
        fileContent,
        `Slett versjon: ${name} (${_config.chartType})`,
        token,
        _sha
      );

      localStorage.setItem(`versions-cache-${_config.chartType}`, JSON.stringify(_versions));
      this._renderList();
    },

    getPublicUrl(id) {
      return `${GITHUB_PAGES_BASE}/${_config.publicUrl}?v=${id}`;
    },

    getEmbedCode(id) {
      const url = this.getPublicUrl(id);
      return `<div class="grafer-embed" data-src="${url}"><script src="${GITHUB_PAGES_BASE}/embed.js"><\/script></div>`;
    },

    renderVersionsPanel() {
      // Find the modal containers and replace them
      const embedModal = document.getElementById('embedModal');
      const versionsModal = document.getElementById('versionsModal');
      if (embedModal) embedModal.remove();
      if (versionsModal) versionsModal.remove();

      // Change the embed button to a versions button
      const embedBtn = document.getElementById('embedBtn');
      if (embedBtn) {
        embedBtn.textContent = 'Versjoner';
        embedBtn.id = 'versionsToggleBtn';
      }

      // Create the versions panel
      _panelEl = document.createElement('div');
      _panelEl.className = 'versions-panel-container';
      _panelEl.id = 'versionsPanelContainer';
      _panelEl.innerHTML = `
        <div class="versions-panel-inner">
          <div class="versions-save-row">
            <input type="text" id="versionNameInput" placeholder="Versjonsnavn (f.eks. 'Mørk 16:9')" class="version-name-input">
            <button class="btn btn-primary" id="saveNewVersionBtn">Lagre versjon</button>
          </div>
          <div id="versionStatus" class="version-status"></div>
          <div id="versionsListContainer" class="versions-list-container"></div>
        </div>
      `;

      // Insert after toolbar, before chart container
      const chartContainer = document.querySelector('.chart-container');
      if (chartContainer) {
        chartContainer.parentNode.insertBefore(_panelEl, chartContainer);
      } else {
        document.body.appendChild(_panelEl);
      }

      // Wire up save button
      const saveBtn = document.getElementById('saveNewVersionBtn');
      const nameInput = document.getElementById('versionNameInput');

      saveBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
          this._showStatus('Skriv inn et versjonsnavn', 'error');
          return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Lagrer...';
        try {
          const slug = await this.saveVersion(name);
          nameInput.value = '';
          this._showStatus(`Versjon "${name}" lagret! (${slug})`, 'success');
        } catch (e) {
          this._showStatus('Feil: ' + e.message, 'error');
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Lagre versjon';
        }
      });

      // Wire up toggle button
      const toggleBtn = document.getElementById('versionsToggleBtn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
          _panelEl.classList.toggle('show');
          if (_panelEl.classList.contains('show')) {
            this._renderList();
          }
        });
      }

      // Render initial list
      this._renderList();
    },

    _showStatus(msg, type) {
      const statusEl = document.getElementById('versionStatus');
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.className = 'version-status ' + type;
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'version-status';
      }, 5000);
    },

    _renderList() {
      const container = document.getElementById('versionsListContainer');
      if (!container) return;

      const ids = Object.keys(_versions);
      if (ids.length === 0) {
        container.innerHTML = '<div class="no-versions">Ingen lagrede versjoner ennå</div>';
        return;
      }

      // Sort by updatedAt descending
      const sorted = ids
        .map(id => _versions[id])
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      container.innerHTML = sorted.map(v => {
        const date = new Date(v.updatedAt || v.createdAt).toLocaleDateString('nb-NO', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const publicUrl = this.getPublicUrl(v.id);

        return `
          <div class="version-item" data-id="${v.id}">
            <div class="version-header-row">
              <span class="version-name">${v.name}</span>
              <span class="version-date">${date}</span>
            </div>
            <div class="version-url">${publicUrl}</div>
            <div class="version-actions">
              <button class="btn btn-sm btn-outline load-version-btn" title="Last inn innstillinger">Last inn</button>
              <button class="btn btn-sm btn-primary update-version-btn" title="Oppdater med nåværende innstillinger">Oppdater</button>
              <button class="btn btn-sm btn-outline copy-link-btn" title="Kopier lenke">Kopier lenke</button>
              <button class="btn btn-sm btn-outline copy-embed-btn" title="Kopier embed-kode">Embed</button>
              <button class="btn btn-sm btn-danger delete-version-btn" title="Slett versjon">Slett</button>
            </div>
          </div>
        `;
      }).join('');

      // Event listeners
      container.querySelectorAll('.load-version-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.closest('.version-item').dataset.id;
          const version = _versions[id];
          if (version && _config.applyConfig) {
            _config.applyConfig(version.config);
            this._showStatus(`Versjon "${version.name}" lastet inn`, 'success');
          }
        });
      });

      container.querySelectorAll('.update-version-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.closest('.version-item').dataset.id;
          const version = _versions[id];
          if (!version) return;
          if (!confirm(`Oppdater versjon "${version.name}" med nåværende innstillinger?`)) return;

          btn.disabled = true;
          btn.textContent = 'Lagrer...';
          try {
            await this.updateVersion(id);
            this._showStatus(`Versjon "${version.name}" oppdatert!`, 'success');
          } catch (e) {
            this._showStatus('Feil: ' + e.message, 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Oppdater';
          }
        });
      });

      container.querySelectorAll('.copy-link-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.closest('.version-item').dataset.id;
          const url = this.getPublicUrl(id);
          navigator.clipboard.writeText(url).then(() => {
            btn.textContent = 'Kopiert!';
            setTimeout(() => { btn.textContent = 'Kopier lenke'; }, 2000);
          });
        });
      });

      container.querySelectorAll('.copy-embed-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = e.target.closest('.version-item').dataset.id;
          const embed = this.getEmbedCode(id);
          navigator.clipboard.writeText(embed).then(() => {
            btn.textContent = 'Kopiert!';
            setTimeout(() => { btn.textContent = 'Embed'; }, 2000);
          });
        });
      });

      container.querySelectorAll('.delete-version-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const id = e.target.closest('.version-item').dataset.id;
          const version = _versions[id];
          if (!version) return;
          if (!confirm(`Er du sikker på at du vil slette "${version.name}"?`)) return;

          btn.disabled = true;
          btn.textContent = 'Sletter...';
          try {
            await this.deleteVersion(id);
            this._showStatus(`Versjon "${version.name}" slettet`, 'success');
          } catch (e) {
            this._showStatus('Feil: ' + e.message, 'error');
          }
        });
      });
    }
  };

  window.VersionManager = VersionManager;
})();
