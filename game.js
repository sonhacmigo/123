'use strict';
// Regras do jogo. Esta parte não sabe nada de rede: recebe ações e devolve o estado.

const MAX_POINTS = 12;
const MAX_DEVICES = 60;
const MIN_CAPTURE_GAP_MS = 800;
const DEFAULT_CONFIG = Object.freeze({ nameA: 'Vermelho', nameB: 'Azul', colorA: '#c42d2d', colorB: '#1d5fb5', duration: 15 });
const DEFAULT_RULES = Object.freeze({ sec: 30, cap: 1, hold: 3 });
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function clampInt(v, d, min, max) {
  const n = typeof v === 'string' ? parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, n));
}
function cleanStr(v, max) {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : null;
}
function validColor(v, d) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d;
}
const isTeam = (t) => t === 'a' || t === 'b';
const ok = () => ({ ok: true });
const err = (code) => ({ error: code });

function createGame(opts = {}) {
  const clock = opts.clock || Date.now;
  const emitCb = opts.emit || (() => {});
  const isOnline = opts.isOnline || (() => false);

  const cfg = { ...DEFAULT_CONFIG };
  let points = [];
  let nextPointId = 1;
  const devices = new Map(); // id -> { id, name, pointId, player }
  let nextDeviceNo = 1;
  const run = { status: 'idle', elapsedMs: 0, asOf: 0, warned: false, areas: {} };
  let seq = 0;
  const lastCapture = {};

  function emit(type, data) {
    seq += 1;
    emitCb({ seq, type, at: clock(), ...(data || {}) });
  }
  const teamName = (k) => (k === 'a' ? cfg.nameA : cfg.nameB) || (k === 'a' ? 'Equipe 1' : 'Equipe 2');
  const pointLabel = (p) => p.name || `Ponto ${points.indexOf(p) + 1}`;
  const findPoint = (id) => points.find((p) => p.id === id);
  function areaOf(id) {
    return run.areas[id] || (run.areas[id] = { owner: null, t: { a: 0, b: 0 }, caps: { a: 0, b: 0 } });
  }

  function addPoint(src) {
    if (points.length >= MAX_POINTS) return null;
    const base = src || points[points.length - 1] || DEFAULT_RULES;
    const p = {
      id: nextPointId++,
      name: cleanStr(src && src.name, 24) || '',
      sec: clampInt(base.sec, DEFAULT_RULES.sec, 1, 3600),
      cap: clampInt(base.cap, DEFAULT_RULES.cap, 0, 100),
      hold: clampInt(base.hold, DEFAULT_RULES.hold, 0, 30),
    };
    points.push(p);
    areaOf(p.id);
    return p;
  }
  for (let i = 0; i < 3; i++) addPoint(DEFAULT_RULES);

  /* Passa o tempo. Devolve true quando algo mudou além do relógio (aviso de 1 minuto, fim). */
  function advance() {
    if (run.status !== 'running') return false;
    const now = clock();
    let d = Math.max(0, now - run.asOf);
    run.asOf = now;
    const limit = cfg.duration * 60000;
    if (limit > 0 && run.elapsedMs + d >= limit) d = Math.max(0, limit - run.elapsedMs);
    run.elapsedMs += d;
    for (const p of points) {
      const a = areaOf(p.id);
      if (a.owner) a.t[a.owner] += d;
    }
    let changed = false;
    if (limit > 0) {
      const rem = limit - run.elapsedMs;
      if (rem <= 0) {
        run.status = 'ended';
        emit('end');
        return true;
      }
      if (!run.warned && limit > 60000 && rem <= 60000) {
        run.warned = true;
        emit('oneMinute');
        changed = true;
      }
    }
    return changed;
  }

  function areasView() {
    const out = {};
    for (const p of points) {
      const a = areaOf(p.id);
      out[p.id] = { owner: a.owner, t: { a: Math.round(a.t.a), b: Math.round(a.t.b) }, caps: { ...a.caps } };
    }
    return out;
  }
  function publicView() {
    advance();
    return {
      serverNow: clock(),
      seq,
      config: { ...cfg },
      points: points.map((p) => ({ ...p })),
      run: { status: run.status, elapsedMs: Math.round(run.elapsedMs), areas: areasView() },
    };
  }
  function adminView() {
    const v = publicView();
    v.devices = [...devices.values()].map((d) => ({ id: d.id, name: d.name, pointId: d.pointId, player: d.player, online: !!isOnline(d.id) }));
    return v;
  }
  function deviceView(id) {
    const v = publicView();
    const d = devices.get(id);
    v.me = d ? { id: d.id, name: d.name, pointId: d.pointId, player: d.player } : null;
    return v;
  }

  /* Aparelhos */
  function hello(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) return null;
    let d = devices.get(id);
    if (!d) {
      if (devices.size >= MAX_DEVICES) return null;
      d = { id, name: `Aparelho ${nextDeviceNo++}`, pointId: null, player: '' };
      devices.set(id, d);
    }
    return d;
  }
  function setPlayer(id, player) {
    const d = devices.get(id);
    if (!d) return err('unknown_device');
    d.player = cleanStr(player, 20) || '';
    return ok();
  }

  /* Captura feita pelo celular de um ponto */
  function capture(deviceId, team) {
    const d = devices.get(deviceId);
    if (!d) return err('unknown_device');
    if (!isTeam(team)) return err('bad_team');
    const p = d.pointId == null ? null : findPoint(d.pointId);
    if (!p) return err('no_point');
    advance();
    if (run.status !== 'running') return err('not_running');
    const a = areaOf(p.id);
    if (a.owner === team) return err('already_owner');
    const now = clock();
    if (lastCapture[p.id] && now - lastCapture[p.id] < MIN_CAPTURE_GAP_MS) return err('too_fast');
    lastCapture[p.id] = now;
    a.owner = team;
    a.caps[team] += 1;
    emit('capture', { pointId: p.id, pointName: pointLabel(p), team, teamName: teamName(team), player: d.player || '' });
    return ok();
  }

  /* Ações do administrador */
  function act(action, p) {
    p = p || {};
    switch (action) {
      case 'ping':
        return ok();
      case 'start': {
        if (run.status === 'ended') return err('ended');
        if (run.status === 'running') return ok();
        const first = run.status === 'idle';
        run.status = 'running';
        run.asOf = clock();
        emit(first ? 'start' : 'resume');
        return ok();
      }
      case 'pause':
        if (run.status !== 'running') return ok();
        advance();
        if (run.status === 'running') {
          run.status = 'paused';
          emit('pause');
        }
        return ok();
      case 'reset':
        run.status = 'idle';
        run.elapsedMs = 0;
        run.asOf = 0;
        run.warned = false;
        run.areas = {};
        for (const k of Object.keys(lastCapture)) delete lastCapture[k];
        for (const pt of points) areaOf(pt.id);
        emit('reset');
        return ok();
      case 'config': {
        advance();
        const na = cleanStr(p.nameA, 16), nb = cleanStr(p.nameB, 16);
        if (na !== null) cfg.nameA = na;
        if (nb !== null) cfg.nameB = nb;
        if (p.colorA !== undefined) cfg.colorA = validColor(p.colorA, cfg.colorA);
        if (p.colorB !== undefined) cfg.colorB = validColor(p.colorB, cfg.colorB);
        if (p.duration !== undefined) cfg.duration = clampInt(p.duration, cfg.duration, 0, 240);
        return ok();
      }
      case 'point_add': {
        const pt = addPoint(p);
        if (!pt) return err('too_many_points');
        if (p.deviceId && devices.has(p.deviceId)) devices.get(p.deviceId).pointId = pt.id;
        return { ok: true, pointId: pt.id };
      }
      case 'point_update': {
        advance();
        const pt = findPoint(p.id);
        if (!pt) return err('unknown_point');
        const nm = cleanStr(p.name, 24);
        if (nm !== null) pt.name = nm;
        if (p.sec !== undefined) pt.sec = clampInt(p.sec, pt.sec, 1, 3600);
        if (p.cap !== undefined) pt.cap = clampInt(p.cap, pt.cap, 0, 100);
        if (p.hold !== undefined) pt.hold = clampInt(p.hold, pt.hold, 0, 30);
        return ok();
      }
      case 'point_remove': {
        if (run.status !== 'idle') return err('game_started');
        if (points.length <= 1) return err('last_point');
        const i = points.findIndex((x) => x.id === p.id);
        if (i < 0) return err('unknown_point');
        points.splice(i, 1);
        delete run.areas[p.id];
        for (const d of devices.values()) if (d.pointId === p.id) d.pointId = null;
        return ok();
      }
      case 'device_assign': {
        const d = devices.get(p.deviceId);
        if (!d) return err('unknown_device');
        if (p.pointId === null || p.pointId === undefined) d.pointId = null;
        else if (findPoint(p.pointId)) d.pointId = p.pointId;
        else return err('unknown_point');
        return ok();
      }
      case 'device_rename': {
        const d = devices.get(p.deviceId);
        const nm = cleanStr(p.name, 24);
        if (!d) return err('unknown_device');
        if (nm) d.name = nm;
        return ok();
      }
      case 'device_remove':
        if (!devices.delete(p.deviceId)) return err('unknown_device');
        return ok();
      case 'devices_new_points': {
        let n = 0;
        for (const d of devices.values()) {
          if (d.pointId !== null && findPoint(d.pointId)) continue;
          const pt = addPoint(null);
          if (!pt) return n ? ok() : err('too_many_points');
          d.pointId = pt.id;
          n += 1;
        }
        return ok();
      }
      case 'owner': {
        advance();
        const pt = findPoint(p.pointId);
        if (!pt) return err('unknown_point');
        if (p.owner !== null && !isTeam(p.owner)) return err('bad_team');
        areaOf(pt.id).owner = p.owner;
        return ok();
      }
      default:
        return err('unknown_action');
    }
  }

  /* Salvar e carregar */
  function serialize() {
    return {
      v: 1,
      config: { ...cfg },
      points: points.map((p) => ({ ...p })),
      nextPointId,
      devices: [...devices.values()].map((d) => ({ ...d })),
      nextDeviceNo,
      run: { status: run.status, elapsedMs: Math.round(run.elapsedMs), warned: run.warned, areas: areasView() },
    };
  }
  function load(s) {
    if (!s || typeof s !== 'object') return;
    const c = s.config || {};
    cfg.nameA = cleanStr(c.nameA, 16) ?? cfg.nameA;
    cfg.nameB = cleanStr(c.nameB, 16) ?? cfg.nameB;
    cfg.colorA = validColor(c.colorA, cfg.colorA);
    cfg.colorB = validColor(c.colorB, cfg.colorB);
    cfg.duration = clampInt(c.duration, cfg.duration, 0, 240);
    if (Array.isArray(s.points) && s.points.length) {
      points = [];
      for (const raw of s.points.slice(0, MAX_POINTS)) {
        const id = clampInt(raw && raw.id, 0, 1, 1e9);
        if (!id || points.some((x) => x.id === id)) continue;
        points.push({
          id,
          name: cleanStr(raw.name, 24) || '',
          sec: clampInt(raw.sec, DEFAULT_RULES.sec, 1, 3600),
          cap: clampInt(raw.cap, DEFAULT_RULES.cap, 0, 100),
          hold: clampInt(raw.hold, DEFAULT_RULES.hold, 0, 30),
        });
      }
      if (!points.length) addPoint(DEFAULT_RULES);
      nextPointId = Math.max(clampInt(s.nextPointId, 1, 1, 1e9), ...points.map((x) => x.id + 1));
    }
    run.areas = {};
    const sa = (s.run && s.run.areas) || {};
    for (const p of points) {
      const a = areaOf(p.id), r = sa[p.id];
      if (r && typeof r === 'object') {
        a.owner = isTeam(r.owner) ? r.owner : null;
        a.t.a = clampInt(r.t && r.t.a, 0, 0, 1e10);
        a.t.b = clampInt(r.t && r.t.b, 0, 0, 1e10);
        a.caps.a = clampInt(r.caps && r.caps.a, 0, 0, 1e6);
        a.caps.b = clampInt(r.caps && r.caps.b, 0, 0, 1e6);
      }
    }
    const st = s.run && s.run.status;
    run.elapsedMs = clampInt(s.run && s.run.elapsedMs, 0, 0, 1e10);
    run.warned = !!(s.run && s.run.warned);
    // Se o servidor reiniciou durante o jogo, o tempo parado não conta: volta pausado.
    run.status = st === 'running' ? 'paused' : st === 'paused' || st === 'ended' ? st : 'idle';
    devices.clear();
    for (const raw of Array.isArray(s.devices) ? s.devices.slice(0, MAX_DEVICES) : []) {
      if (!raw || typeof raw.id !== 'string' || !ID_RE.test(raw.id)) continue;
      devices.set(raw.id, {
        id: raw.id,
        name: cleanStr(raw.name, 24) || `Aparelho ${devices.size + 1}`,
        pointId: raw.pointId != null && findPoint(raw.pointId) ? raw.pointId : null,
        player: cleanStr(raw.player, 20) || '',
      });
    }
    nextDeviceNo = Math.max(clampInt(s.nextDeviceNo, 1, 1, 1e9), devices.size + 1);
  }
  if (opts.saved) load(opts.saved);

  return { advance, publicView, adminView, deviceView, hello, setPlayer, capture, act, serialize, status: () => run.status };
}

module.exports = { createGame, ID_RE, MAX_POINTS, MAX_DEVICES };
