// Google sign-in (Google Identity Services) + leaderboard client.
// Talks to the backend in server/ via <base>/api. Everything degrades gracefully
// when the backend is unreachable or no OAuth client is configured.

export interface ScoreRow { rank: number; id: string; name: string; picture: string; score: number; depthKm: number; level: number; won: boolean; at: number; }
export interface Profile { name: string; picture: string; sub: string; exp: number; token: string; }
interface PendingScore { score: number; depthKm: number; level: number; won: boolean; }

declare global {
  interface Window { google?: any; }
}

const API = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}api`;
const STORAGE_KEY = 'digger.google';

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(Array.from(json, (c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return null; }
}

export class Online {
  available = false;      // backend reachable
  configured = false;     // backend has a Google client id
  clientId: string | null = null;
  profile: Profile | null = null;
  scores: ScoreRow[] = [];
  players = 0;
  lastResult: { rank: number; improved: boolean; best: number } | null = null;
  pending: PendingScore | null = null;
  private gisReady: Promise<void> | null = null;
  private listeners: Array<() => void> = [];
  private status = '';

  onChange(fn: () => void) { this.listeners.push(fn); }
  private emit() { for (const fn of this.listeners) fn(); }

  async init() {
    this.loadProfile();
    try {
      const res = await fetch(`${API}/config`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const cfg = await res.json();
      this.available = true;
      this.configured = !!cfg.configured;
      this.clientId = cfg.clientId || null;
      this.players = cfg.players || 0;
    } catch {
      this.available = false;
    }
    this.emit();
    if (this.available) void this.refreshScores();
    if (this.configured && this.clientId) void this.loadGis();
  }

  private loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const p = JSON.parse(raw) as Profile;
      if (p.exp * 1000 > Date.now() + 60_000) this.profile = p; else localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }

  private loadGis(): Promise<void> {
    if (this.gisReady) return this.gisReady;
    this.gisReady = new Promise<void>((resolve, reject) => {
      if (window.google?.accounts?.id) return resolve();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Google sign-in script failed to load'));
      document.head.appendChild(s);
    }).then(() => {
      window.google.accounts.id.initialize({
        client_id: this.clientId,
        callback: (resp: { credential: string }) => this.onCredential(resp.credential),
        auto_select: false,
        itp_support: true,
        use_fedcm_for_prompt: true,
      });
    });
    return this.gisReady;
  }

  private onCredential(token: string) {
    const payload = decodeJwt(token);
    if (!payload) return;
    this.profile = { name: String(payload.name || payload.given_name || 'Digger'), picture: String(payload.picture || ''), sub: String(payload.sub), exp: Number(payload.exp), token };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.profile)); } catch { /* ignore */ }
    this.status = '';
    this.emit();
    if (this.pending) void this.submit(this.pending);
  }

  signOut() {
    this.profile = null; this.lastResult = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
    this.emit();
  }

  get signedIn() { return !!this.profile && this.profile.exp * 1000 > Date.now() + 30_000; }

  async refreshScores() {
    try {
      const res = await fetch(`${API}/scores?limit=10`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      this.scores = data.scores || [];
      this.players = data.players || this.players;
      this.emit();
    } catch { /* offline */ }
  }

  /** Called at game over / win. Submits immediately when signed in, otherwise waits for sign-in. */
  async submit(s: PendingScore) {
    if (!this.available || !this.configured) return;
    if (!this.signedIn) { this.pending = s; this.status = ''; this.emit(); return; }
    this.pending = null;
    this.status = 'Saving score…';
    this.emit();
    try {
      const res = await fetch(`${API}/scores`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...s, idToken: this.profile!.token }) });
      const data = await res.json();
      if (res.status === 401) { this.status = 'Sign-in expired, please sign in again'; this.pending = s; this.signOut(); return; }
      if (!res.ok) { this.status = `Could not save (${data.error || res.status})`; this.emit(); return; }
      this.lastResult = { rank: data.rank, improved: data.improved, best: data.best };
      this.status = data.improved ? `New personal best! You are #${data.rank} of ${data.players}` : `Saved. Your best is ${data.best.toLocaleString('en-US')} (#${data.rank})`;
      void this.refreshScores();
    } catch {
      this.status = 'Could not reach the leaderboard';
    }
    this.emit();
  }

  /** Renders the sign-in control and top-10 list into `el`. */
  render(el: HTMLElement) {
    if (!this.available) { el.innerHTML = ''; return; }
    const rows = this.scores.map((r) => `
      <li class="${this.profile && r.name === this.profile.name ? 'me' : ''}">
        <span class="rank">${r.rank}</span>
        ${r.picture ? `<img class="avatar" src="${r.picture}" alt="" referrerpolicy="no-referrer">` : '<span class="avatar"></span>'}
        <span class="name">${escapeHtml(r.name)}${r.won ? ' 🇨🇳' : ''}</span>
        <span class="pts">${r.score.toLocaleString('en-US')}</span>
        <span class="km">${r.depthKm.toLocaleString('en-US')} km</span>
      </li>`).join('');
    const list = this.scores.length ? `<ol class="board">${rows}</ol>` : '<p class="muted">No scores yet. Be the first!</p>';
    let auth = '';
    if (!this.configured) auth = '<p class="muted">Sign-in is not configured on this server yet.</p>';
    else if (this.signedIn) auth = `<div class="who">${this.profile!.picture ? `<img class="avatar" src="${this.profile!.picture}" alt="" referrerpolicy="no-referrer">` : ''}<span>${escapeHtml(this.profile!.name)}</span><button type="button" class="link" data-act="signout">Sign out</button></div>`;
    else auth = `<div class="gsi-wrap"><div id="gsi-btn"></div></div>${this.pending ? '<p class="muted">Sign in to save this score to the leaderboard.</p>' : ''}`;
    el.innerHTML = `<div class="online"><div class="online-head"><span>🏆 Leaderboard</span><span class="muted">${this.players} player${this.players === 1 ? '' : 's'}</span></div>${list}${auth}${this.status ? `<p class="status">${escapeHtml(this.status)}</p>` : ''}</div>`;
    el.querySelector('[data-act="signout"]')?.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); this.signOut(); });
    const btn = el.querySelector<HTMLElement>('#gsi-btn');
    if (btn && this.configured) {
      void this.loadGis().then(() => {
        if (!btn.isConnected) return;
        window.google.accounts.id.renderButton(btn, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', width: 240 });
      }).catch(() => { btn.textContent = 'Google sign-in unavailable'; });
    }
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)); }
