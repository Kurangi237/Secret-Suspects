const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const SESSION_KEY = 'secret-suspects-session-v1';
const TUTORIAL_KEY = 'secret-suspects-tutorial-seen-v1';
let session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
let state = null;
let pollHandle = null;
let busy = false;
let toastHandle = null;
let lastChatSignature = '';
let lastViewSignature = '';
let tutorialStep = 0;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeLeft() { return Math.max(0, Math.ceil(((state?.deadline ?? Date.now()) - Date.now()) / 1000)); }
function saveSession() { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); session = null; state = null; stopPolling(); }
function stopPolling() { if (pollHandle) clearInterval(pollHandle); pollHandle = null; }
function toast(message, kind = '') {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.append(el); }
  el.className = `toast show ${kind}`; el.textContent = message;
  clearTimeout(toastHandle); toastHandle = setTimeout(() => el.classList.remove('show'), 3200);
}
async function api(action, extra = {}) {
  const payload = { action, ...(session || {}), ...extra };
  const response = await fetch('/.netlify/functions/game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}
async function createRoom(nickname) {
  const data = await api('create', { nickname });
  session = { code: data.code, token: data.token, nickname };
  saveSession(); state = data.state; lastChatSignature = ''; enterRoom(); beginPolling();
}
async function joinRoom(code, nickname) {
  const priorToken = session?.code === code ? session.token : null;
  const data = await api('join', { code, nickname, token: priorToken });
  session = { code, token: data.token, nickname };
  saveSession(); state = data.state; lastChatSignature = ''; enterRoom(); beginPolling();
}
function beginPolling() {
  stopPolling();
  pollHandle = setInterval(refreshState, 2200);
  refreshState();
}
async function refreshState() {
  if (!session || busy) return;
  try {
    const next = await api('state');
    const previousSignature = lastViewSignature;
    state = next;
    if (viewSignature(state) !== previousSignature || !$('#room-screen')) render();
    else updateLiveBits();
  } catch (error) {
    if (/reconnection window expired|not part of that room|room not found/i.test(error.message)) {
      stopPolling(); toast(error.message, 'error');
      setTimeout(() => { clearSession(); render(); }, 1600);
    } else if (!navigator.onLine) showConnectionBanner(true);
  }
}
function showConnectionBanner(show) {
  const el = $('#connection-banner'); if (el) el.classList.toggle('visible', show);
}
function enterRoom() { render(); if (!localStorage.getItem(TUTORIAL_KEY)) openTutorial(); }
function viewSignature(value) {
  if (!value) return '';
  return JSON.stringify({ phase: value.phase, hostId: value.hostId, you: value.you, players: value.players, clue: value.clue, clueNumber: value.clueNumber, deadline: value.deadline, lastResult: value.lastResult, lastVoteSummary: value.lastVoteSummary, tiedCandidates: value.tiedCandidates, matchResults: value.matchResults, caseWord: value.caseWord, canStart: value.canStart });
}
function render() {
  lastViewSignature = viewSignature(state);
  if (!state || !session) { renderHome(); return; }
  if (state.phase === 'lobby') renderLobby();
  else if (state.phase === 'finished') renderResults();
  else renderMatch();
}
function brandMark() { return `<span class="brand-mark"><span></span><span></span><span></span></span>`; }
function header() {
  return `<header class="topbar"><button class="brand" data-action="home">${brandMark()}<span>SECRET <b>SUSPECTS</b></span></button><div class="topbar-right"><span class="live-pill"><i></i> LIVE CASE</span>${state ? `<button class="room-code-mini" data-action="copy-code">ROOM ${escapeHtml(state.code)} <span>↗</span></button>` : ''}</div></header>`;
}
function renderHome() {
  stopPolling();
  app.innerHTML = `${header()}<main class="home-shell"><div class="home-grid"><section class="hero-copy"><div class="eyebrow"><span class="eyebrow-line"></span> A SOCIAL DEDUCTION MYSTERY</div><h1>TRUST<br/><em>NO ONE.</em></h1><p class="hero-tagline">One of you is lying. Everyone has something to hide.</p><p class="hero-description">A secret case. A hidden impostor. Every clue brings you closer to the truth — or deeper into the lie.</p><div class="hero-actions"><button class="button button-primary button-large" data-action="open-create"><span class="button-icon">＋</span> CREATE ROOM <span class="button-arrow">↗</span></button><button class="button button-secondary button-large" data-action="open-join"><span class="button-icon">⌕</span> JOIN ROOM</button></div><button class="text-button how-button" data-action="tutorial">HOW TO PLAY <span>→</span></button><div class="hero-meta"><span><b>03—08</b> PLAYERS</span><span class="meta-dot"></span><span>NO LOGIN REQUIRED</span></div></section><section class="case-art" aria-label="Noir detective evidence board"><div class="art-grain"></div><div class="art-stamp">CASE FILE<br/><b>NO. 001</b></div><div class="red-thread thread-one"></div><div class="red-thread thread-two"></div><div class="evidence-card card-a"><div class="evidence-photo silhouette-one"></div><span>SUBJECT 01</span><b>THE WITNESS</b><small>STATEMENT INCONSISTENT</small></div><div class="evidence-card card-b"><div class="evidence-photo silhouette-two"></div><span>SUBJECT 02</span><b>THE STRANGER</b><small>LOCATION UNKNOWN</small></div><div class="evidence-card card-c"><div class="evidence-photo silhouette-three"></div><span>SUBJECT 03</span><b>THE INSIDER</b><small>MOTIVE UNCLEAR</small></div><div class="case-note"><span>CONFIDENTIAL / EYES ONLY</span><p>“The truth is in the details.<br/>So is the lie.”</p><small>DETECTIVE'S NOTE — 11:47 PM</small></div><div class="art-crosshair">+</div><div class="art-caption"><span>FIG. 01</span> EVIDENCE BOARD / UNRESOLVED</div></section></div><section class="feature-strip"><div><span class="feature-number">01</span><b>PRIVATE ROLES</b><small>One impostor. A secret case.</small></div><div><span class="feature-number">02</span><b>SHARED CLUES</b><small>Compare stories. Find the gaps.</small></div><div><span class="feature-number">03</span><b>ANONYMOUS VOTES</b><small>Choose who you trust least.</small></div></section></main><div class="modal-layer" id="modal-layer"></div>`;
}
function renderLobby() {
  app.innerHTML = `${header()}<main id="room-screen" class="page-shell"><div class="page-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span> CASE ROOM / WAITING AREA</div><h1>GATHER YOUR <em>TEAM.</em></h1><p>Share the code. Trust will be tested soon.</p></div><div class="room-code-card"><span>YOUR ROOM CODE</span><button data-action="copy-code" class="room-code-big">${escapeHtml(state.code)} <i>⧉</i></button><small>Click to copy and invite friends</small></div></div><div class="lobby-layout"><section class="panel players-panel"><div class="panel-heading"><div><span class="panel-kicker">THE SUSPECTS</span><h2>Players <span class="count-badge">${state.playerCount}/8</span></h2></div><span class="waiting-indicator"><i></i> WAITING</span></div><div class="player-list">${state.players.map((p, i) => `<div class="player-row"><div class="avatar avatar-${i % 6}">${escapeHtml(initials(p.nickname))}</div><div class="player-info"><b>${escapeHtml(p.nickname)} ${p.id === state.you.id ? '<small>(YOU)</small>' : ''}</b><span>${p.isHost ? 'CASE LEAD' : p.connected ? 'READY FOR BRIEFING' : 'DISCONNECTED'}</span></div>${p.isHost ? '<span class="host-tag">HOST</span>' : ''}${state.isHost && p.id !== state.you.id ? `<button class="icon-button remove-player" data-action="remove" data-id="${escapeHtml(p.id)}" aria-label="Remove ${escapeHtml(p.nickname)}">×</button>` : ''}<span class="connection-dot ${p.connected ? 'online' : ''}"></span></div>`).join('')}${Array.from({ length: Math.max(0, 3 - state.playerCount) }, (_, i) => `<div class="player-row empty-row"><div class="avatar empty-avatar">＋</div><div class="player-info"><b>Awaiting player…</b><span>SHARE YOUR ROOM CODE</span></div></div>`).join('')}</div><div class="panel-footnote"><span class="tiny-lock">▣</span> Your room is private. New players can't join once a match begins.</div></section><aside class="panel briefing-panel"><div class="file-tab">CLASSIFIED</div><span class="panel-kicker">MISSION BRIEFING</span><h2>The case<br/>isn't closed.</h2><p>One player will secretly become the impostor. Investigators share a case word. Work together to catch the liar before it's too late.</p><div class="briefing-stats"><div><span>MINIMUM</span><b>03 PLAYERS</b></div><div><span>MAXIMUM</span><b>08 PLAYERS</b></div></div>${state.isHost ? `<button class="button button-primary button-full ${state.canStart ? '' : 'is-disabled'}" data-action="start" ${state.canStart ? '' : 'disabled'}>START INVESTIGATION <span>↗</span></button><small class="button-hint">${state.playerCount < 3 ? `Need ${3 - state.playerCount} more player${state.playerCount === 2 ? '' : 's'} to begin.` : 'Everyone ready? Open the case.'}</small>` : `<div class="host-wait"><span class="spinner"></span><span>Waiting for <b>${escapeHtml(state.players.find(p => p.isHost)?.nickname ?? 'the host')}</b> to start…</span></div>`}<button class="text-button tutorial-inline" data-action="tutorial">REVIEW HOW TO PLAY <span>→</span></button></aside></div><div class="room-bottom"><button class="text-button" data-action="leave">← LEAVE ROOM</button><span>ALL TIMES ARE SERVER-SYNCHRONIZED <i>•</i> NO LOGIN REQUIRED</span></div><div id="connection-banner" class="connection-banner">Connection interrupted — trying to reconnect…</div></main><div class="modal-layer" id="modal-layer"></div>`;
}
function initials(name) { return String(name).split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase(); }
function renderMatch() {
  const voting = ['voting', 'revote'].includes(state.phase);
  const roleClass = state.you.role === 'impostor' ? 'impostor' : 'investigator';
  app.innerHTML = `${header()}<main id="room-screen" class="page-shell match-shell"><div class="match-topline"><div class="case-label"><span class="red-pulse"></span> LIVE INVESTIGATION <span class="slash">/</span> CASE #${String(state.code).slice(0,3)}</div><div class="round-pill">ROUND ${String(state.clueNumber || 1).padStart(2, '0')}</div></div><div class="match-grid"><section class="panel investigation-panel"><div class="panel-heading"><div><span class="panel-kicker">CURRENT EVIDENCE</span><h2>${voting ? (state.phase === 'revote' ? 'A TIE IN THE ROOM.' : 'MAKE YOUR CALL.') : 'THE CLUE BOARD.'}</h2></div><div class="timer-box ${timeLeft() <= 10 ? 'urgent' : ''}"><span>${voting ? 'VOTING ENDS IN' : 'DISCUSSION ENDS IN'}</span><b id="timer-value">${formatTime(timeLeft())}</b></div></div><div class="clue-card"><div class="clue-index">CLUE ${String(state.clueNumber || 1).padStart(2, '0')} <span>•</span> EVIDENCE LOG</div><div class="clue-mark">“</div><p>${escapeHtml(state.clue || 'Evidence is being reviewed…')}</p><div class="clue-foot"><span>RECOVERED FROM CASE FILE</span><span>↗</span></div></div>${state.you.role === 'investigator' ? `<div class="secret-card"><div class="secret-icon">▣</div><div><span>YOUR SECRET CASE WORD</span><b>${escapeHtml(state.caseWord || 'CLASSIFIED')}</b><small>Keep it private. The impostor cannot see this.</small></div><span class="secret-seal">EYES<br/>ONLY</span></div>` : `<div class="secret-card impostor-secret"><div class="secret-icon">◉</div><div><span>YOUR COVER STORY</span><b>BLEND IN.</b><small>You do not know the case word. Listen, bluff, and survive.</small></div><span class="secret-seal">TOP<br/>SECRET</span></div>`}<div class="phase-instruction">${voting ? `<span class="instruction-icon">◎</span><div><b>${state.phase === 'revote' ? 'REVOTE — TIED SUSPECTS ONLY' : 'CAST YOUR VOTE'}</b><small>${state.you.active ? 'Select the suspect you believe is the impostor. Votes stay secret until reveal.' : 'You have been eliminated and cannot vote.'}</small></div>` : `<span class="instruction-icon">⌁</span><div><b>DISCUSS THE EVIDENCE</b><small>Share theories in chat. Each round reveals another clue.</small></div>`}</div>${!voting && state.lastResult?.votes ? `<div class="vote-reveal"><div><b>${escapeHtml(state.lastResult.message || (state.lastResult.type === 'elimination' ? `${state.lastResult.eliminatedNickname} was eliminated.` : 'Votes revealed.'))}</b><small>VOTES REVEALED</small></div><div class="revealed-votes">${state.lastVoteSummary.map(v => `<span>${escapeHtml(v.nickname)} <b>${v.count}</b></span>`).join('')}</div></div>` : ''}${voting ? `<div class="vote-grid">${state.players.filter(p => p.active && p.id !== state.you.id && (state.phase !== 'revote' || state.tiedCandidates.some(t => t.id === p.id))).map((p, i) => `<button class="suspect-card ${state.you.active ? '' : 'is-disabled'}" data-action="vote" data-id="${escapeHtml(p.id)}" ${!state.you.active ? 'disabled' : ''}><span class="suspect-number">SUSPECT ${String(i+1).padStart(2,'0')}</span><div class="suspect-avatar avatar-${i%6}">${escapeHtml(initials(p.nickname))}</div><b>${escapeHtml(p.nickname)}</b><small>${p.hasVoted ? 'VOTE SUBMITTED' : 'SELECT SUSPECT'}</small><span class="suspect-select">↗</span></button>`).join('')}</div>` : `<div class="evidence-players">${state.players.map((p, i) => `<div class="mini-player ${!p.active ? 'eliminated' : ''}"><div class="mini-avatar avatar-${i%6}">${escapeHtml(initials(p.nickname))}</div><span>${escapeHtml(p.nickname)}</span><small>${!p.active ? 'ELIMINATED' : p.connected ? 'ACTIVE' : 'OFFLINE'}</small></div>`).join('')}</div>`}</section><aside class="panel chat-panel"><div class="panel-heading chat-heading"><div><span class="panel-kicker">SECURE CHANNEL</span><h2>Discussion</h2></div><span class="chat-status"><i></i> LIVE</span></div><div class="chat-notice">⌁ <span>${voting ? 'Chat is locked during voting.' : 'Share clues. Keep your role secret.'}</span></div><div class="chat-messages" id="chat-messages">${renderChat()}</div><form id="chat-form" class="chat-form ${voting ? 'chat-disabled' : ''}"><input name="message" maxlength="240" placeholder="${voting ? 'Chat disabled during voting' : 'Share your theory…'}" autocomplete="off" ${voting || !state.you.active ? 'disabled' : ''}/><button type="submit" aria-label="Send message" ${voting || !state.you.active ? 'disabled' : ''}>↑</button></form><div class="chat-footnote">BE RESPECTFUL. BLUFFING IS PART OF THE GAME.</div></aside></div><div class="match-bottom"><span><span class="red-pulse"></span> ALL PLAYERS SYNCHRONIZED</span><button class="text-button" data-action="leave">LEAVE MATCH</button></div><div id="connection-banner" class="connection-banner">Connection interrupted — trying to reconnect…</div></main><div class="modal-layer" id="modal-layer"></div>`;
}
function renderChat() {
  const items = state.chat || [];
  const signature = items.map(x => x.id).join('|'); lastChatSignature = signature;
  if (!items.length) return '<div class="chat-empty">No messages yet. Break the silence.</div>';
  return items.map(item => item.system ? `<div class="system-message"><span>—</span> ${escapeHtml(item.text)}</div>` : `<div class="chat-message ${item.playerId === state.you.id ? 'own-message' : ''}"><div class="message-avatar avatar-${Math.abs((item.nickname || '').length)%6}">${escapeHtml(initials(item.nickname || '?'))}</div><div class="message-body"><div class="message-meta"><b>${escapeHtml(item.nickname)}</b><time>${new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div><p>${escapeHtml(item.text)}</p></div></div>`).join('');
}
function renderResults() {
  const result = state.lastResult || {};
  const investigatorsWon = result.winner === 'investigators';
  app.innerHTML = `${header()}<main id="room-screen" class="page-shell results-shell"><div class="results-hero"><div class="result-stamp">CASE CLOSED <span>✦</span></div><div class="eyebrow"><span class="eyebrow-line"></span> FINAL REPORT / MATCH ${state.match || ''}</div><h1>${investigatorsWon ? 'THE TRUTH<br/><em>PREVAILED.</em>' : 'THE IMPOSTOR<br/><em>ESCAPED.</em>'}</h1><p>${escapeHtml(result.reason || 'The investigation has ended.')}</p><div class="reveal-case"><span>THE SECRET CASE WORD WAS</span><b>${escapeHtml(result.caseWord || 'UNKNOWN')}</b><small>THE IMPOSTOR WAS <strong>${escapeHtml(state.players.find(p => p.id === result.impostorId)?.nickname || 'UNKNOWN')}</strong></small></div></div><section class="panel leaderboard-panel"><div class="panel-heading"><div><span class="panel-kicker">OFFICIAL MATCH RECORD</span><h2>Case leaderboard</h2></div><span class="host-tag">FINAL</span></div><div class="leaderboard-table"><div class="leaderboard-head"><span>RANK / PLAYER</span><span>ROLE</span><span>RESULT</span><span>POINTS</span></div>${(state.matchResults || []).map((p, i, arr) => { const rank = i > 0 && p.matchPoints === arr[i-1].matchPoints ? i : i+1; return `<div class="leaderboard-row"><div class="rank-player"><span class="rank">${String(rank).padStart(2,'0')}</span><div class="avatar avatar-${i%6}">${escapeHtml(initials(p.nickname))}</div><b>${escapeHtml(p.nickname)} ${p.id === state.you.id ? '<small>(YOU)</small>' : ''}</b></div><span class="role-tag ${p.role}">${p.role === 'impostor' ? 'IMPOSTOR' : 'INVESTIGATOR'}</span><span class="result-tag ${p.teamWon ? 'won' : 'lost'}">${p.teamWon ? 'TEAM WON' : 'TEAM LOST'}</span><strong class="points">+${p.matchPoints}</strong></div>`; }).join('')}</div><div class="leaderboard-foot">Tied scores share the same rank. Scores shown are for this match only.</div></section><div class="results-actions">${state.isHost ? `<button class="button button-primary button-large" data-action="restart">PLAY AGAIN <span>↗</span></button>` : `<div class="host-wait"><span class="spinner"></span><span>Waiting for the host to start a rematch…</span></div>`}<button class="button button-secondary" data-action="copy-code">COPY ROOM CODE</button><button class="text-button" data-action="leave">LEAVE ROOM</button></div><div id="connection-banner" class="connection-banner">Connection interrupted — trying to reconnect…</div></main><div class="modal-layer" id="modal-layer"></div>`;
}
function formatTime(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function updateLiveBits() {
  const timer = $('#timer-value'); if (timer) { timer.textContent = formatTime(timeLeft()); timer.parentElement.classList.toggle('urgent', timeLeft() <= 10); }
  const banner = $('#connection-banner'); if (banner) banner.classList.toggle('visible', !navigator.onLine);
  const messages = $('#chat-messages');
  if (messages) {
    const signature = (state.chat || []).map(x => x.id).join('|');
    if (signature !== lastChatSignature) { const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100; messages.innerHTML = renderChat(); if (nearBottom) messages.scrollTop = messages.scrollHeight; }
  }
}
function openModal(content) { const layer = $('#modal-layer'); if (!layer) return; layer.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true">${content}</section></div>`; const first = $('input', layer); if (first) first.focus(); }
function openCreate() {
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow"><span class="eyebrow-line"></span> OPEN A NEW CASE</div><h2>Lead the <em>investigation.</em></h2><p>Create a private room and invite your friends to join.</p><form id="create-form" class="modal-form"><label for="create-name">YOUR NICKNAME</label><input id="create-name" name="nickname" maxlength="18" required placeholder="e.g. NightOwl" autocomplete="nickname"/><button class="button button-primary button-full" type="submit">CREATE PRIVATE ROOM <span>↗</span></button></form><div class="modal-note">NO LOGIN · 3–8 PLAYERS · FREE TO PLAY</div>`);
}
function openJoin() {
  openModal(`<button class="modal-close" data-action="close-modal" aria-label="Close">×</button><div class="eyebrow"><span class="eyebrow-line"></span> ENTER A CASE ROOM</div><h2>Join the <em>investigation.</em></h2><p>Enter the six-character code shared by your host.</p><form id="join-form" class="modal-form"><label for="join-code">ROOM CODE</label><input id="join-code" name="code" maxlength="6" required placeholder="ABC234" class="code-input" autocapitalize="characters"/><label for="join-name">YOUR NICKNAME</label><input id="join-name" name="nickname" maxlength="18" required placeholder="e.g. NightOwl" autocomplete="nickname"/><button class="button button-primary button-full" type="submit">JOIN ROOM <span>↗</span></button></form><div class="modal-note">ROOMS LOCK WHEN A MATCH BEGINS</div>`);
}
function openTutorial() {
  const slides = [
    { n:'01 / YOUR ROLE', title:'KNOW WHAT YOU KNOW.', text:'Investigators share the same secret case word. The impostor sees no word at all — only the public clues.', icon:'▣', label:'ONE SECRET. DIFFERENT STORIES.' },
    { n:'02 / THE CLUES', title:'READ BETWEEN THE LINES.', text:'Each round reveals a new clue. Discuss your theories for 60 seconds and watch for answers that do not quite fit.', icon:'⌁', label:'EVERY DETAIL COUNTS.' },
    { n:'03 / THE VOTE', title:'DECIDE WHO TO TRUST.', text:'Vote anonymously for the suspected impostor. Investigators win by catching them; the impostor wins by surviving until two players remain.', icon:'◎', label:'TRUST NO ONE.' }
  ];
  const s = slides[tutorialStep];
  openModal(`<button class="modal-close" data-action="close-tutorial" aria-label="Close">×</button><div class="tutorial-art"><span class="tutorial-orbit"></span><span class="tutorial-icon">${s.icon}</span><span class="tutorial-redline"></span><small>${s.label}</small></div><div class="tutorial-progress">${slides.map((_, i) => `<span class="${i === tutorialStep ? 'active' : ''}"></span>`).join('')}</div><div class="eyebrow">${s.n}</div><h2>${s.title}</h2><p>${s.text}</p><div class="tutorial-actions"><button class="text-button" data-action="skip-tutorial">SKIP GUIDE</button><button class="button button-primary" data-action="next-tutorial">${tutorialStep === slides.length - 1 ? 'GOT IT' : 'CONTINUE'} <span>→</span></button></div>`);
}
function closeTutorial() { localStorage.setItem(TUTORIAL_KEY, '1'); $('#modal-layer').innerHTML = ''; }
async function doAction(action, id) {
  if (busy) return;
  busy = true;
  try {
    if (action === 'start') { const data = await api('start'); state = data.state; render(); toast('Investigation started. Keep your role secret.'); }
    else if (action === 'vote') { const data = await api('vote', { targetId: id }); state = data.state; render(); toast('Your vote is locked in.'); }
    else if (action === 'remove') { const data = await api('remove', { targetId: id }); state = data.state; render(); toast('Player removed from the lobby.'); }
    else if (action === 'restart') { const data = await api('restart'); state = data.state; render(); toast('Fresh case lobby opened.'); }
    else if (action === 'leave') { try { await api('leave'); } catch {} clearSession(); render(); toast('You left the room.'); }
    else if (action === 'copy-code') { await navigator.clipboard.writeText(state?.code || session?.code || ''); toast('Room code copied. Share it with your friends.'); }
    else if (action === 'home') { if (state && state.phase !== 'finished') { toast('Leave the current room before returning home.'); } else { clearSession(); render(); } }
    else if (action === 'open-create') openCreate();
    else if (action === 'open-join') openJoin();
    else if (action === 'close-modal') { const layer = $('#modal-layer'); if (layer) layer.innerHTML = ''; }
    else if (action === 'tutorial') { tutorialStep = 0; openTutorial(); }
    else if (action === 'skip-tutorial') closeTutorial();
    else if (action === 'close-tutorial') closeTutorial();
    else if (action === 'next-tutorial') { if (tutorialStep < 2) { tutorialStep++; openTutorial(); } else closeTutorial(); }
  } catch (error) { toast(error.message, 'error'); }
  finally { busy = false; }
}
app.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  if (button.classList.contains('is-disabled') || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'close-modal' && event.target.closest('.modal-card')) return;
  await doAction(action, button.dataset.id);
});
app.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (event.target.id === 'create-form') {
    const nickname = cleanInput(new FormData(event.target).get('nickname'));
    try { busy = true; await createRoom(nickname); toast('Room created. Share your code to invite friends.'); }
    catch (error) { toast(error.message, 'error'); }
    finally { busy = false; }
  } else if (event.target.id === 'join-form') {
    const form = new FormData(event.target); const nickname = cleanInput(form.get('nickname')); const code = String(form.get('code') || '').toUpperCase().replace(/\s/g, '');
    try { busy = true; await joinRoom(code, nickname); toast('You joined the room.'); }
    catch (error) { toast(error.message, 'error'); }
    finally { busy = false; }
  } else if (event.target.id === 'chat-form') {
    const input = $('input[name="message"]', event.target); const text = input.value.trim(); if (!text) return;
    input.value = '';
    try { const data = await api('chat', { text }); state = data.state; updateLiveBits(); }
    catch (error) { toast(error.message, 'error'); }
  }
});
function cleanInput(value) { return String(value || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18); }
window.addEventListener('online', () => { showConnectionBanner(false); refreshState(); });
window.addEventListener('offline', () => showConnectionBanner(true));

if (session?.code && session?.token) {
  api('state').then(data => { state = data; render(); beginPolling(); }).catch(() => { clearSession(); renderHome(); });
} else renderHome();
