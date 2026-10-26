import { getStore } from '@netlify/blobs';
import { randomInt, randomUUID } from 'node:crypto';
import { CASES } from '../../src/cases.js';

const store = getStore('secret-suspects-rooms');
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 3;
const DISCUSSION_MS = 60_000;
const VOTE_MS = 20_000;
const REVOTE_MS = 15_000;
const RECONNECT_GRACE_MS = 60_000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const now = () => Date.now();
const uid = () => randomUUID();
const cleanName = (value) => String(value ?? '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 18);
const cleanChat = (value) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 240);
const roomKey = (code) => `room:${code}`;
const roomCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
const pick = (array) => array[randomInt(array.length)];

function newRoom(code, hostToken, nickname) {
  const timestamp = now();
  return {
    code, createdAt: timestamp, updatedAt: timestamp, phase: 'lobby', hostId: hostToken,
    players: [{ id: hostToken, nickname, role: null, joinedAt: timestamp, lastSeen: timestamp, connected: true, active: true, points: 0, vote: null }],
    chat: [], match: 0, round: 0, case: null, impostorId: null, clueIndex: 0, deadline: null,
    votes: {}, tiedCandidates: [], lastResult: null, matchResults: null
  };
}
function playerByToken(room, token) { return room.players.find(p => p.id === token); }
function requirePlayer(room, token) {
  const p = playerByToken(room, token);
  if (!p) throw new GameError('This session is not part of that room. Rejoin from the lobby. ', 403);
  return p;
}
function requireHost(room, player) {
  if (room.hostId !== player.id) throw new GameError('Only the host can do that.', 403);
}
function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function activePlayers(room) { return room.players.filter(p => p.active && p.connected); }
function finish(room, winner, reason) {
  room.phase = 'finished'; room.deadline = null;
  const winningTeam = winner;
  for (const p of room.players) {
    const won = p.role === winningTeam;
    p.points += won ? 100 : 0;
  }
  room.lastResult = { winner, reason, impostorId: room.impostorId, caseWord: room.case?.word ?? null, finishedAt: now() };
  room.matchResults = room.players.map(p => ({ id: p.id, nickname: p.nickname, role: p.role, points: p.points, matchPoints: p.role === winningTeam ? 100 : 0, teamWon: p.role === winningTeam }))
    .sort((a, b) => b.matchPoints - a.matchPoints || a.nickname.localeCompare(b.nickname));
}
function checkWin(room) {
  if (room.phase === 'finished' || !room.impostorId) return;
  const active = activePlayers(room);
  const impostorAlive = active.some(p => p.id === room.impostorId);
  if (!impostorAlive) { finish(room, 'investigators', 'The impostor was identified.'); return; }
  if (active.length <= 2) finish(room, 'impostor', 'The impostor survived until only two active players remained.');
}
function enterVoting(room, duration = VOTE_MS, phase = 'voting') {
  room.phase = phase; room.deadline = now() + duration; room.votes = {};
  for (const p of room.players) p.vote = null;
}
function resolveVotes(room) {
  const eligible = room.phase === 'revote' ? new Set(room.tiedCandidates) : null;
  const eligibleVoters = activePlayers(room);
  const counts = {};
  for (const [voterId, targetId] of Object.entries(room.votes)) {
    if (!eligibleVoters.some(p => p.id === voterId)) continue;
    if (eligible && !eligible.has(targetId)) continue;
    if (!activePlayers(room).some(p => p.id === targetId)) continue;
    counts[targetId] = (counts[targetId] ?? 0) + 1;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = Object.keys(counts).filter(id => counts[id] === max && max > 0);
  room.lastVoteSummary = Object.entries(counts).map(([id, count]) => ({ id, count, nickname: room.players.find(p => p.id === id)?.nickname ?? 'Unknown' }));
  if (leaders.length === 1) {
    const eliminated = room.players.find(p => p.id === leaders[0]);
    if (eliminated) { eliminated.active = false; eliminated.eliminatedAt = now(); }
    room.lastResult = { type: 'elimination', eliminatedId: leaders[0], eliminatedNickname: eliminated?.nickname ?? 'Unknown', votes: room.lastVoteSummary };
    room.tiedCandidates = [];
    checkWin(room);
    if (room.phase !== 'finished') startNextRound(room);
    return;
  }
  if (room.phase === 'revote') {
    room.lastResult = { type: 'tie', message: 'The revote is tied. Nobody is eliminated.', votes: room.lastVoteSummary };
    room.tiedCandidates = [];
    startNextRound(room);
    return;
  }
  room.tiedCandidates = leaders;
  if (!leaders.length) {
    room.lastResult = { type: 'tie', message: 'No votes were counted. Nobody is eliminated.', votes: room.lastVoteSummary };
    startNextRound(room);
  } else {
    room.lastResult = { type: 'tie', message: 'The vote is tied. Vote again between the tied suspects.', votes: room.lastVoteSummary };
    enterVoting(room, REVOTE_MS, 'revote');
  }
}
function startNextRound(room) {
  if (room.phase === 'finished') return;
  room.round += 1;
  room.clueIndex = Math.min(room.round - 1, room.case.clues.length - 1);
  room.phase = 'discussion';
  room.deadline = now() + DISCUSSION_MS;
  room.votes = {};
  for (const p of room.players) p.vote = null;
  room.chat.push({ id: uid(), system: true, text: `Investigation round ${room.round} begins. A new clue has been revealed.`, at: now() });
  room.chat = room.chat.slice(-80);
}
function tick(room) {
  const t = now();
  for (const p of room.players) {
    if (p.connected && t - p.lastSeen > RECONNECT_GRACE_MS) {
      p.connected = false;
      if (room.phase !== 'lobby' && room.phase !== 'finished') p.active = false;
    }
  }
  if (room.hostId && !playerByToken(room, room.hostId)?.connected) {
    const candidate = room.players.filter(p => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (candidate) { room.hostId = candidate.id; room.chat.push({ id: uid(), system: true, text: `${candidate.nickname} is now the host.`, at: t }); }
  }
  if (room.phase === 'discussion' && room.deadline <= t) enterVoting(room);
  else if ((room.phase === 'voting' || room.phase === 'revote') && room.deadline <= t) resolveVotes(room);
  if (room.phase !== 'lobby' && room.phase !== 'finished') checkWin(room);
}
function publicState(room, token) {
  const me = requirePlayer(room, token);
  const isInvestigator = me.role === 'investigator';
  const caseWord = room.phase === 'finished' ? room.case?.word ?? null : (isInvestigator ? room.case?.word ?? null : null);
  const canSeeClue = room.phase !== 'lobby' && room.clueIndex >= 0;
  return {
    code: room.code, phase: room.phase, hostId: room.hostId, you: { id: me.id, nickname: me.nickname, role: me.role, active: me.active, points: me.points },
    players: room.players.map(p => ({ id: p.id, nickname: p.nickname, connected: p.connected, active: p.active, eliminated: !p.active && room.phase !== 'lobby', isHost: p.id === room.hostId, role: room.phase === 'finished' ? p.role : null, points: p.points, hasVoted: Boolean(room.votes[p.id]) })),
    caseWord, clue: canSeeClue ? room.case?.clues[room.clueIndex] ?? null : null, clueNumber: room.round, deadline: room.deadline,
    chat: room.chat.slice(-50), lastResult: room.lastResult, lastVoteSummary: (room.phase === 'finished' || (room.phase === 'discussion' && room.lastResult?.votes)) ? room.lastVoteSummary ?? [] : [],
    tiedCandidates: room.phase === 'revote' ? room.tiedCandidates.map(id => ({ id, nickname: room.players.find(p => p.id === id)?.nickname })) : [],
    matchResults: room.phase === 'finished' ? room.matchResults : null,
    isHost: room.hostId === me.id, canStart: room.phase === 'lobby' && room.players.length >= MIN_PLAYERS && room.players.length <= MAX_PLAYERS,
    playerCount: room.players.length, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS
  };
}
async function readRoom(code) {
  const entry = await store.getWithMetadata(roomKey(code), { type: 'json', consistency: 'strong' });
  return entry ? { room: entry.data, etag: entry.etag } : null;
}
async function writeRoom(room, etag) {
  const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
  return store.setJSON(roomKey(room.code), room, opts);
}
async function mutate(code, callback) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = await readRoom(code);
    if (!entry) throw new GameError('Room not found. Check the code and try again.', 404);
    const room = entry.room;
    tick(room);
    const result = await callback(room);
    room.updatedAt = now();
    const saved = await writeRoom(room, entry.etag);
    if (saved.modified) return { room, result };
  }
  throw new GameError('The room changed at the same time as another action. Please retry.', 409);
}
async function getState(code, token) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const entry = await readRoom(code);
    if (!entry) throw new GameError('Room not found. Check the code and try again.', 404);
    const room = entry.room;
    const before = JSON.stringify(room);
    tick(room);
    const me = requirePlayer(room, token);
    const expired = !me.connected && room.phase !== 'lobby' && room.phase !== 'finished';
    if (!expired && now() - me.lastSeen >= 10_000) { me.lastSeen = now(); me.connected = true; }
    const changed = JSON.stringify(room) !== before;
    if (changed) {
      room.updatedAt = now();
      const saved = await writeRoom(room, entry.etag);
      if (!saved.modified) continue;
    }
    if (expired) throw new GameError('Your 60-second reconnection window expired. You can rejoin after this match.', 409);
    return publicState(room, token);
  }
  throw new GameError('The room changed at the same time as another action. Please retry.', 409);
}
async function createRoom(nickname) {
  if (!nickname) throw new GameError('Enter a nickname first.');
  for (let i = 0; i < 8; i++) {
    const code = roomCode(); const token = uid(); const room = newRoom(code, token, nickname);
    const saved = await writeRoom(room, null);
    if (saved.modified) return { code, token, state: publicState(room, token) };
  }
  throw new GameError('Could not create a room. Please try again.', 503);
}
async function joinRoom(code, nickname, token) {
  if (!nickname) throw new GameError('Enter a nickname first.');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) throw new GameError('Enter a valid six-character room code.');
  return mutate(code, room => {
    if (token) {
      const existing = playerByToken(room, token);
      if (existing && existing.nickname.toLowerCase() === nickname.toLowerCase()) {
        if (room.phase !== 'lobby' && room.phase !== 'finished' && now() - existing.lastSeen > RECONNECT_GRACE_MS) {
          existing.connected = false; existing.active = false;
          throw new GameError('Your 60-second reconnection window expired. You can rejoin after this match.', 409);
        }
        existing.connected = true; existing.active = true; existing.lastSeen = now();
        if (room.phase === 'finished') { existing.role = null; }
        return { token, state: publicState(room, token) };
      }
    }
    if (room.phase !== 'lobby') throw new GameError('This room is locked during a match. New players can join in the next lobby.', 409);
    if (room.players.length >= MAX_PLAYERS) throw new GameError('This room is full (8 players maximum).', 409);
    if (room.players.some(p => p.nickname.toLowerCase() === nickname.toLowerCase())) throw new GameError('That nickname is already in this room. Choose another.', 409);
    const newToken = uid(); const t = now();
    room.players.push({ id: newToken, nickname, role: null, joinedAt: t, lastSeen: t, connected: true, active: true, points: 0, vote: null });
    room.chat.push({ id: uid(), system: true, text: `${nickname} joined the room.`, at: t });
    return { token: newToken, state: publicState(room, newToken) };
  });
}
async function action(body) {
  const act = String(body.action ?? '');
  if (act === 'create') return createRoom(cleanName(body.nickname));
  if (act === 'join') {
    const code = String(body.code ?? '').toUpperCase().replace(/\s/g, '');
    const joined = await joinRoom(code, cleanName(body.nickname), body.token);
    return joined.result;
  }
  const code = String(body.code ?? '').toUpperCase().replace(/\s/g, '');
  const token = String(body.token ?? '');
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code) || !token) throw new GameError('Room code and session are required.');
  if (act === 'state') return getState(code, token);
  const output = await mutate(code, room => {
    const me = requirePlayer(room, token);
    if (!me.connected && room.phase !== 'lobby' && room.phase !== 'finished') {
      throw new GameError('Your 60-second reconnection window expired. You can rejoin after this match.', 409);
    }
    me.lastSeen = now(); me.connected = true;
    switch (act) {
      case 'state':
        return publicState(room, token);
      case 'start': {
        requireHost(room, me);
        if (room.phase !== 'lobby' && room.phase !== 'finished') throw new GameError('The match is already in progress.');
        const connected = room.players.filter(p => p.connected);
        if (connected.length < MIN_PLAYERS || connected.length > MAX_PLAYERS) throw new GameError('You need 3–8 connected players to start.');
        const selectedCase = pick(CASES);
        const chosenImpostor = pick(connected);
        room.match += 1; room.round = 1; room.case = structuredClone(selectedCase); room.impostorId = chosenImpostor.id;
        room.players.forEach(p => { p.role = p.id === chosenImpostor.id ? 'impostor' : 'investigator'; p.active = p.connected; p.vote = null; });
        room.chat = [{ id: uid(), system: true, text: `Case #${room.match} opened. Investigation round 1 begins.`, at: now() }];
        room.lastResult = null; room.lastVoteSummary = []; room.tiedCandidates = []; room.votes = {}; room.matchResults = null;
        room.clueIndex = 0; room.phase = 'discussion'; room.deadline = now() + DISCUSSION_MS;
        return { started: true };
      }
      case 'chat': {
        if (room.phase !== 'discussion') throw new GameError('Chat is available during discussion only.');
        if (!me.active || !me.connected) throw new GameError('Eliminated or disconnected players cannot chat.');
        const text = cleanChat(body.text); if (!text) throw new GameError('Write a message first.');
        room.chat.push({ id: uid(), playerId: me.id, nickname: me.nickname, text, at: now() }); room.chat = room.chat.slice(-80);
        return { sent: true };
      }
      case 'vote': {
        if (!['voting', 'revote'].includes(room.phase)) throw new GameError('Voting is not open.');
        if (!me.active || !me.connected) throw new GameError('You are not eligible to vote.');
        if (room.votes[me.id]) throw new GameError('Your vote has already been submitted.');
        const target = room.players.find(p => p.id === body.targetId);
        if (!target || !target.active || target.id === me.id) throw new GameError('Choose another active suspect.');
        if (room.phase === 'revote' && !room.tiedCandidates.includes(target.id)) throw new GameError('Only tied suspects can receive a revote.');
        room.votes[me.id] = target.id; me.vote = target.id;
        const voters = activePlayers(room);
        if (voters.every(p => room.votes[p.id])) resolveVotes(room);
        return { submitted: true };
      }
      case 'remove': {
        requireHost(room, me);
        if (room.phase !== 'lobby') throw new GameError('Players can only be removed before a match starts.');
        const target = room.players.find(p => p.id === body.targetId);
        if (!target || target.id === me.id) throw new GameError('Choose a different player.');
        room.players = room.players.filter(p => p.id !== target.id);
        room.chat.push({ id: uid(), system: true, text: `${target.nickname} was removed by the host.`, at: now() });
        return { removed: true };
      }
      case 'leave': {
        me.connected = false; me.active = false;
        if (room.hostId === me.id) {
          const candidate = room.players.filter(p => p.id !== me.id && p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
          if (candidate) room.hostId = candidate.id;
        }
        return { left: true };
      }
      case 'restart': {
        requireHost(room, me);
        if (room.phase !== 'finished') throw new GameError('Finish the current match before restarting.');
        room.players = room.players.filter(p => p.connected).map(p => ({ ...p, role: null, active: true, vote: null, eliminatedAt: null }));
        if (room.players.length < MIN_PLAYERS) { room.phase = 'lobby'; room.case = null; room.impostorId = null; room.round = 0; room.deadline = null; room.chat = []; return { restarted: true, needsPlayers: true }; }
        room.case = null; room.impostorId = null; room.round = 0; room.clueIndex = -1; room.deadline = null; room.phase = 'lobby'; room.votes = {}; room.tiedCandidates = []; room.lastResult = null; room.matchResults = null;
        room.chat = [{ id: uid(), system: true, text: 'New case lobby. The host can start when 3–8 players are ready.', at: now() }];
        return { restarted: true };
      }
      default: throw new GameError('Unknown action.');
    }
  });
  const result = output.result;
  if (act === 'state') return result;
  return { ...result, state: publicState(output.room, token) };
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  if (request.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405, headers: { 'Cache-Control': 'no-store' } });
  try {
    const body = await request.json();
    const result = await action(body);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const status = error instanceof GameError ? error.status : 500;
    if (status === 500) console.error('Secret Suspects API error:', error);
    return Response.json({ error: status === 500 ? 'A server error occurred. Please retry.' : error.message }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
};
