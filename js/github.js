// Lecture et écriture des fichiers du site directement dans le dépôt GitHub.
// Le jeton reste dans le navigateur de l'administrateur (localStorage), jamais dans le dépôt.

const API = 'https://api.github.com';

export class ConflictError extends Error {
  constructor(paths) {
    super('Fichiers modifiés ailleurs : ' + paths.join(', '));
    this.paths = paths;
  }
}

function b64ToUtf8(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GitHub {
  constructor({ owner, repo, branch, token, basePath }) {
    this.owner = (owner || '').trim();
    this.repo = (repo || '').trim();
    this.branch = (branch || 'main').trim();
    this.token = (token || '').trim();
    this.basePath = (basePath || '').trim().replace(/^\/+|\/+$/g, '');
  }

  get ready() { return !!(this.owner && this.repo && this.token); }
  get base() { return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`; }
  full(path) { return this.basePath ? `${this.basePath}/${path}` : path; }

  async api(method, url, body) {
    const r = await fetch(API + url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    });
    if (!r.ok) {
      let msg = `GitHub ${r.status}`;
      try { const j = await r.json(); if (j.message) msg += ` : ${j.message}`; } catch { /* rien */ }
      const e = new Error(msg);
      e.status = r.status;
      throw e;
    }
    return r.status === 204 ? null : r.json();
  }

  async test() {
    const repo = await this.api('GET', this.base);
    await this.api('GET', `${this.base}/branches/${encodeURIComponent(this.branch)}`);
    return {
      canWrite: !!(repo.permissions && (repo.permissions.push || repo.permissions.admin)),
      isPrivate: repo.private,
      pagesUrl: repo.has_pages ? `https://${this.owner.toLowerCase()}.github.io/${this.repo}/` : null
    };
  }

  // Renvoie { text, sha } ou null si le fichier n'existe pas.
  async readText(path) {
    const encoded = this.full(path).split('/').map(encodeURIComponent).join('/');
    let data;
    try {
      data = await this.api('GET', `${this.base}/contents/${encoded}?ref=${encodeURIComponent(this.branch)}`);
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
    let b64 = data.content;
    if (!b64 && data.sha) {
      const blob = await this.api('GET', `${this.base}/git/blobs/${data.sha}`);
      b64 = blob.content;
    }
    return { text: b64ToUtf8(b64 || ''), sha: data.sha };
  }

  async readJSON(path) {
    const f = await this.readText(path);
    return f ? { data: JSON.parse(f.text), sha: f.sha } : null;
  }

  /**
   * Publie plusieurs fichiers en un seul commit.
   * files: [{ path, text } | { path, base64 }]
   * deletes: [path]
   * expect: { path: shaAttendu|null } pour détecter une modification faite ailleurs.
   */
  async commit({ files = [], deletes = [], message, expect = {}, force = false }) {
    const ref = await this.api('GET', `${this.base}/git/ref/heads/${encodeURIComponent(this.branch)}`);
    const parentSha = ref.object.sha;
    const parent = await this.api('GET', `${this.base}/git/commits/${parentSha}`);
    const tree = await this.api('GET', `${this.base}/git/trees/${parent.tree.sha}?recursive=1`);
    const existing = new Map(tree.tree.filter((x) => x.type === 'blob').map((x) => [x.path, x.sha]));

    if (!force) {
      const conflicts = Object.entries(expect)
        .filter(([p, sha]) => (existing.get(this.full(p)) || null) !== (sha || null))
        .map(([p]) => p);
      if (conflicts.length) throw new ConflictError(conflicts);
    }

    const entries = [];
    const newShas = {};
    for (const f of files) {
      const isText = f.text != null;
      const blob = await this.api('POST', `${this.base}/git/blobs`, {
        content: isText ? f.text : f.base64,
        encoding: isText ? 'utf-8' : 'base64'
      });
      entries.push({ path: this.full(f.path), mode: '100644', type: 'blob', sha: blob.sha });
      newShas[f.path] = blob.sha;
    }
    for (const d of deletes) {
      if (existing.has(this.full(d))) {
        entries.push({ path: this.full(d), mode: '100644', type: 'blob', sha: null });
        newShas[d] = null;
      }
    }
    if (!entries.length) return { commit: null, newShas };

    const newTree = await this.api('POST', `${this.base}/git/trees`, { base_tree: parent.tree.sha, tree: entries });
    const commit = await this.api('POST', `${this.base}/git/commits`, { message, tree: newTree.sha, parents: [parentSha] });
    await this.api('PATCH', `${this.base}/git/refs/heads/${encodeURIComponent(this.branch)}`, { sha: commit.sha });
    return { commit: commit.sha, newShas };
  }
}
