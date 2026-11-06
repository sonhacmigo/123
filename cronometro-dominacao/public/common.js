/* Código compartilhado pelas três telas (admin, celular de ponto e placar). */
(function () {
  'use strict';
  var D = (window.Dominacao = {});

  /* ---------- Formatação e cores ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  D.fmt = function (ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(ss) : pad(m) + ':' + pad(ss);
  };
  function lum(hex) {
    var v = [1, 3, 5].map(function (i) {
      var x = parseInt(hex.substr(i, 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  D.onColor = function (hex) { return lum(hex) > 0.179 ? '#111111' : '#ffffff'; };
  D.applyColors = function (cfg) {
    var r = document.documentElement.style;
    r.setProperty('--ca', cfg.colorA); r.setProperty('--on-a', D.onColor(cfg.colorA));
    r.setProperty('--cb', cfg.colorB); r.setProperty('--on-b', D.onColor(cfg.colorB));
  };
  D.teamName = function (cfg, k) { return (k === 'a' ? cfg.nameA : cfg.nameB) || (k === 'a' ? 'Equipe 1' : 'Equipe 2'); };
  D.pointLabel = function (p, i) { return p.name || 'Ponto ' + (i + 1); };
  var STATUS = { idle: 'Aguardando', running: 'Em jogo', paused: 'Pausado', ended: 'Encerrado' };
  D.statusText = function (s) { return STATUS[s] || ''; };

  /* ---------- Chamadas ao servidor ---------- */
  var ERRORS = {
    wrong_password: 'Senha incorreta.',
    too_many_attempts: 'Muitas tentativas. Espere um minuto.',
    unauthorized: 'Sessão expirada. Entre de novo.',
    not_running: 'A partida não está em andamento.',
    already_owner: 'Sua equipe já domina este ponto.',
    no_point: 'Este aparelho ainda não tem um ponto.',
    too_fast: 'Aguarde um instante e tente de novo.',
    ended: 'A partida já terminou. Zere para começar outra.',
    game_started: 'Zere a partida para fazer essa mudança.',
    too_many_points: 'Limite de pontos atingido.',
    last_point: 'É preciso manter pelo menos um ponto.',
    busy: 'Servidor cheio. Tente de novo em instantes.',
  };
  D.errorText = function (e) {
    if (e && e.code && ERRORS[e.code]) return ERRORS[e.code];
    if (e && e.status) return 'Não foi possível concluir (' + (e.code || e.status) + ').';
    return 'Sem conexão com o servidor. Tente de novo.';
  };
  D.api = function (path, body, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'http_' + r.status); e.code = j.error; e.status = r.status; throw e; }
        return j;
      });
    });
  };

  /* ---------- Conexão em tempo real ---------- */
  function Live(url) {
    this.url = url;
    this.snap = null;
    this.recv = 0;
    this.connected = false;
    this.floor = 0;
    this.fresh = true;
    this.h = { snapshot: [], game: [], status: [], fatal: [] };
  }
  Live.prototype.on = function (name, fn) { this.h[name].push(fn); return this; };
  Live.prototype.emit = function (name, arg) { this.h[name].forEach(function (fn) { fn(arg); }); };
  Live.prototype.apply = function (snap) {
    if (!snap) return;
    this.snap = snap;
    this.recv = performance.now();
    this.emit('snapshot', snap);
  };
  Live.prototype.stop = function () {
    this.stopped = true;
    if (this.es) this.es.close();
  };
  Live.prototype.start = function () {
    var self = this, es;
    function open() {
      if (self.stopped) return;
      es = self.es = new EventSource(self.url);
      es.addEventListener('open', function () { self.connected = true; self.fresh = true; self.emit('status', true); });
      es.addEventListener('error', function () {
        self.connected = false; self.emit('status', false);
        if (es.readyState === 2) { // o servidor recusou a conexão: o navegador não tenta sozinho
          es.close();
          self.emit('fatal');
          if (!self.stopped) setTimeout(open, 3000);
        }
      });
      es.addEventListener('snapshot', function (e) {
        var s = JSON.parse(e.data);
        if (self.fresh) { self.floor = Math.max(self.floor, s.seq); self.fresh = false; }
        self.apply(s);
      });
      es.addEventListener('game', function (e) {
        var ev = JSON.parse(e.data);
        if (ev.seq <= self.floor) return;
        self.floor = ev.seq;
        self.emit('game', ev);
      });
    }
    open();
    // Um toque leve a cada 4 minutos evita que hospedagens gratuitas durmam durante a partida.
    setInterval(function () { try { fetch('/healthz', { cache: 'no-store' }).catch(function () {}); } catch (e) {} }, 240000);
    return this;
  };

  D.Live = Live;

  /* Estado "ao vivo": soma o tempo que passou desde o último envio do servidor. */
  D.derive = function (live) {
    var s = live.snap;
    if (!s) return null;
    var dt = s.run.status === 'running' ? performance.now() - live.recv : 0;
    var limit = s.config.duration * 60000;
    if (dt > 0 && limit > 0 && s.run.elapsedMs + dt > limit) dt = Math.max(0, limit - s.run.elapsedMs);
    var areas = {};
    s.points.forEach(function (p) {
      var a = s.run.areas[p.id] || { owner: null, t: { a: 0, b: 0 }, caps: { a: 0, b: 0 } };
      areas[p.id] = {
        owner: a.owner, caps: a.caps,
        t: { a: a.t.a + (a.owner === 'a' ? dt : 0), b: a.t.b + (a.owner === 'b' ? dt : 0) },
      };
    });
    return { cfg: s.config, points: s.points, status: s.run.status, elapsed: s.run.elapsedMs + dt, areas: areas };
  };
  D.pointScore = function (p, area, k) {
    return area.caps[k] * p.cap + Math.floor(Math.floor(area.t[k] / 1000) / Math.max(1, p.sec));
  };
  D.totals = function (d) {
    var t = { pts: { a: 0, b: 0 }, time: { a: 0, b: 0 }, owned: { a: 0, b: 0 }, caps: { a: 0, b: 0 } };
    d.points.forEach(function (p) {
      var a = d.areas[p.id];
      ['a', 'b'].forEach(function (k) {
        t.pts[k] += D.pointScore(p, a, k); t.time[k] += a.t[k]; t.caps[k] += a.caps[k];
        if (a.owner === k) t.owned[k] += 1;
      });
    });
    return t;
  };
  D.clock = function (d) {
    var limited = d.cfg.duration > 0;
    return { label: limited ? 'Restante' : 'Decorrido', text: D.fmt(limited ? Math.max(0, d.cfg.duration * 60000 - d.elapsed) : d.elapsed) };
  };
  D.result = function (d) {
    var t = D.totals(d), w = null;
    if (t.pts.a !== t.pts.b) w = t.pts.a > t.pts.b ? 'a' : 'b';
    else if (t.time.a !== t.time.b) w = t.time.a > t.time.b ? 'a' : 'b';
    var A = D.teamName(d.cfg, 'a'), B = D.teamName(d.cfg, 'b');
    return {
      title: w ? 'Vitória: ' + D.teamName(d.cfg, w) : 'Empate',
      text: A + ' ' + t.pts.a + ' pontos (' + D.fmt(t.time.a) + ')  ·  ' + B + ' ' + t.pts.b + ' pontos (' + D.fmt(t.time.b) + ')' +
        (t.pts.a === t.pts.b && w ? '. Desempate pelo maior tempo de posse.' : ''),
    };
  };

  /* ---------- Placar e lista de pontos (usados por admin e placar) ---------- */
  D.renderBoard = function (d) {
    var t = D.totals(d);
    ['a', 'b'].forEach(function (k) {
      var K = k.toUpperCase();
      D.setText(D.$('name' + K), D.teamName(d.cfg, k));
      D.setText(D.$('pts' + K), String(t.pts[k]));
      D.setText(D.$('time' + K), D.fmt(t.time[k]));
      D.setText(D.$('areas' + K), t.owned[k] + ' de ' + d.points.length);
      D.setText(D.$('cap' + K), String(t.caps[k]));
    });
  };
  D.pointsSig = function (points) { return points.map(function (p) { return p.id; }).join(','); };
  D.buildList = function (box, points, onClick) {
    box.innerHTML = '';
    var refs = {};
    points.forEach(function (p) {
      var row = document.createElement(onClick ? 'button' : 'div');
      row.className = 'prow' + (onClick ? '' : ' readonly-row');
      if (onClick) { row.type = 'button'; row.addEventListener('click', function () { onClick(p); }); }
      row.innerHTML = '<span class="pr-name"></span><span class="pr-state" data-o=""></span>' +
        '<span class="pr-times"><span><i class="dot" data-team="a"></i><b class="ra"></b></span><span><i class="dot" data-team="b"></i><b class="rb"></b></span></span>';
      box.appendChild(row);
      refs[p.id] = { name: row.querySelector('.pr-name'), state: row.querySelector('.pr-state'), ra: row.querySelector('.ra'), rb: row.querySelector('.rb') };
    });
    return refs;
  };
  D.renderList = function (refs, d) {
    d.points.forEach(function (p, i) {
      var r = refs[p.id], a = d.areas[p.id];
      if (!r) return;
      D.setText(r.name, D.pointLabel(p, i));
      r.state.dataset.o = a.owner || '';
      D.setText(r.state, a.owner ? 'Dominado: ' + D.teamName(d.cfg, a.owner) : 'Livre');
      D.setText(r.ra, D.fmt(a.t.a));
      D.setText(r.rb, D.fmt(a.t.b));
    });
  };
  var colorsKey = '';
  D.syncColors = function (cfg) {
    var k = cfg.colorA + cfg.colorB;
    if (k !== colorsKey) { colorsKey = k; D.applyColors(cfg); }
  };

  /* ---------- Tela ligada durante a partida ---------- */
  D.keepAwake = function (live) {
    var lock = null;
    function want() { return live.snap && live.snap.run.status === 'running'; }
    function sync() {
      try {
        if (want() && !lock && navigator.wakeLock && document.visibilityState === 'visible') {
          navigator.wakeLock.request('screen').then(function (l) {
            lock = l;
            l.addEventListener('release', function () { lock = null; });
          }).catch(function () {});
        } else if (!want() && lock) { lock.release(); lock = null; }
      } catch (e) {}
    }
    live.on('snapshot', sync);
    document.addEventListener('visibilitychange', sync);
  };

  /* ---------- Banner de conexão ---------- */
  D.bindBanner = function (el, live) {
    function show(ok) { el.hidden = ok; }
    el.textContent = 'Sem conexão com o servidor. Tentando reconectar…';
    el.hidden = true;
    live.on('status', show);
  };

  /* ---------- Sons ---------- */
  D.Sound = (function () {
    var conf = window.SOUNDS_CONFIG || {};
    var ctx = null, unlocked = false, enabled = true, listeners = [];
    try { enabled = localStorage.getItem('dominacao-som') !== '0'; } catch (e) {}

    function changed() { listeners.forEach(function (fn) { fn(); }); }
    function unlock() {
      if (unlocked) return;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {}
      try {
        if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(' '); u.volume = 0; window.speechSynthesis.speak(u); }
      } catch (e) {}
      unlocked = true;
      changed();
    }
    function vol() { return Math.min(1, Math.max(0, conf.volume == null ? 0.8 : conf.volume)); }
    function tones(list, wave) {
      if (!ctx || !list) return;
      list.forEach(function (n) {
        try {
          var t0 = ctx.currentTime + (n[2] || 0), o = ctx.createOscillator(), g = ctx.createGain();
          o.type = wave || 'square'; o.frequency.value = n[0];
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.3 * vol() + 0.0001, t0 + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + n[1]);
          o.connect(g); g.connect(ctx.destination);
          o.start(t0); o.stop(t0 + n[1] + 0.02);
        } catch (e) {}
      });
    }
    function file(url) {
      try { var a = new Audio(url); a.volume = vol(); var p = a.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    function speak(text) {
      var sp = conf.speech || {};
      if (!sp.enabled || !window.speechSynthesis || !text) return;
      try {
        window.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = sp.lang || 'pt-BR'; u.rate = sp.rate || 1; u.pitch = sp.pitch || 1; u.volume = vol();
        var voices = window.speechSynthesis.getVoices() || [];
        var lang = (sp.lang || 'pt-BR').toLowerCase();
        for (var i = 0; i < voices.length; i++) { if (voices[i].lang && voices[i].lang.toLowerCase().indexOf(lang.slice(0, 2)) === 0) { u.voice = voices[i]; break; } }
        window.speechSynthesis.speak(u);
      } catch (e) {}
    }
    function fill(tpl, vars) { return String(tpl).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : ''; }); }

    function play(name, vars) {
      if (!enabled || !unlocked) return;
      var e = (conf.events || {})[name];
      if (!e) return;
      vars = vars || {};
      if (e.tones) tones(e.tones, e.wave);
      if (e.file) file(e.file);
      var say = vars.jogador && e.sayWithPlayer ? e.sayWithPlayer : e.say;
      if (say) setTimeout(function () { speak(fill(say, vars)); }, e.sayDelayMs != null ? e.sayDelayMs : 400);
    }

    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });

    return {
      /* Chame com cada evento recebido do servidor. page = 'admin' | 'terminal' | 'placar' */
      handle: function (ev, page) {
        if (conf.playOn && conf.playOn[page] === false) return;
        var vars = { ponto: ev.pointName, equipe: ev.teamName, jogador: ev.player };
        var map = { capture: 'capture', start: 'start', resume: 'resume', pause: 'pause', end: 'end', oneMinute: 'oneMinute', reset: 'reset' };
        if (map[ev.type]) play(map[ev.type], vars);
      },
      /* Liga um botão "Som ligado / desligado". */
      mount: function (btn) {
        function paint() {
          var label = !unlocked && enabled ? 'Ativar som' : enabled ? 'Som ligado' : 'Som desligado';
          btn.textContent = label;
          btn.setAttribute('aria-pressed', enabled && unlocked ? 'true' : 'false');
        }
        btn.addEventListener('click', function () {
          if (!unlocked) { enabled = true; unlock(); } else { enabled = !enabled; }
          try { localStorage.setItem('dominacao-som', enabled ? '1' : '0'); } catch (e) {}
          paint(); changed();
          if (enabled) play('resume', {});
        });
        listeners.push(paint);
        paint();
      },
    };
  })();

  /* ---------- Utilidades de tela ---------- */
  D.$ = function (id) { return document.getElementById(id); };
  D.setText = function (el, text) { if (el.textContent !== text) el.textContent = text; };
  D.focused = function (el) { return document.activeElement === el; };
})();
