/* Celular de ponto fixo: mostra só o ponto que o administrador atribuiu a este aparelho. */
(function () {
  'use strict';
  var D = window.Dominacao, $ = D.$;

  function newId() {
    var a = new Uint8Array(16);
    window.crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function deviceId() {
    try {
      var v = localStorage.getItem('dominacao-device');
      if (v && /^[A-Za-z0-9_-]{8,64}$/.test(v)) return v;
    } catch (e) {}
    var id = newId();
    try { localStorage.setItem('dominacao-device', id); } catch (e) {}
    return id;
  }
  var ID = deviceId();
  var live = new D.Live('/api/stream?role=device&device=' + encodeURIComponent(ID));
  var holds = { a: 0, b: 0 }, sending = false, msgTimer = null;

  D.bindBanner($('banner'), live);
  D.keepAwake(live);
  D.Sound.mount($('soundBtn'));
  live.on('game', function (ev) { D.Sound.handle(ev, 'terminal'); });

  function flash(text, good) {
    var m = $('msg');
    m.textContent = text;
    m.className = 'msg' + (good ? ' good' : '');
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(function () { m.textContent = ''; }, 4000);
  }

  var btns = { a: $('btnA'), b: $('btnB') };
  function ui(k) { var b = btns[k]; return { fill: b.querySelector('.fill'), nm: b.querySelector('.nm'), sub: b.querySelector('.sub') }; }
  var parts = { a: ui('a'), b: ui('b') };

  function currentPoint() {
    var s = live.snap;
    if (!s || !s.me || s.me.pointId == null) return null;
    for (var i = 0; i < s.points.length; i++) if (s.points[i].id === s.me.pointId) return { p: s.points[i], i: i };
    return null;
  }

  function send(k) {
    if (sending) return;
    sending = true; holds[k] = 0;
    D.api('/api/capture', { deviceId: ID, team: k })
      .then(function (r) {
        live.apply(r.snapshot);
        try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch (e) {}
        flash('');
      })
      .catch(function (e) { flash(D.errorText(e)); })
      .then(function () { sending = false; });
  }
  function startHold(k) {
    var cp = currentPoint(), d = D.derive(live);
    if (!cp || !d || d.status !== 'running' || d.areas[cp.p.id].owner === k || sending || holds[k]) return;
    if (cp.p.hold <= 0) { send(k); return; }
    holds[k] = performance.now();
  }
  function stopHold(k) { holds[k] = 0; }
  ['a', 'b'].forEach(function (k) {
    var b = btns[k];
    b.addEventListener('pointerdown', function () { startHold(k); });
    b.addEventListener('pointerup', function () { stopHold(k); });
    b.addEventListener('pointercancel', function () { stopHold(k); });
    b.addEventListener('pointerleave', function () { stopHold(k); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    b.addEventListener('keydown', function (e) { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(k); } });
    b.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter') stopHold(k); });
    b.addEventListener('blur', function () { stopHold(k); });
  });

  /* Nome do jogador */
  var playerTimer = null;
  function savePlayer() {
    clearTimeout(playerTimer);
    D.api('/api/device/player', { deviceId: ID, player: $('player').value })
      .then(function (r) { live.apply(r.snapshot); })
      .catch(function (e) { flash(D.errorText(e)); });
  }
  $('player').addEventListener('input', function () { clearTimeout(playerTimer); playerTimer = setTimeout(savePlayer, 700); });
  $('player').addEventListener('change', savePlayer);

  function render() {
    var d = D.derive(live);
    if (!d) return;
    D.syncColors(d.cfg);
    var c = D.clock(d);
    D.setText($('clockLabel'), c.label);
    D.setText($('clockTime'), c.text);
    $('status').dataset.s = d.status === 'running' ? 'run' : d.status === 'ended' ? 'end' : 'idle';
    D.setText($('status'), D.statusText(d.status));
    var res = $('result');
    res.hidden = d.status !== 'ended';
    if (d.status === 'ended') { var r = D.result(d); D.setText($('resultTitle'), r.title); D.setText($('resultText'), r.text); }

    var me = live.snap.me;
    if (me) D.setText($('waitName'), me.name);
    if (me && !D.focused($('player')) && $('player').value !== me.player) $('player').value = me.player;

    var cp = currentPoint();
    $('wait').hidden = !!cp;
    $('pointPanel').hidden = !cp;
    if (!cp) return;
    var p = cp.p, a = d.areas[p.id], now = performance.now();
    D.setText($('pname'), D.pointLabel(p, cp.i));
    var st = $('pstate');
    st.dataset.o = a.owner || '';
    D.setText(st, a.owner ? 'Dominado: ' + D.teamName(d.cfg, a.owner) : 'Livre');

    ['a', 'b'].forEach(function (k) {
      var K = k.toUpperCase(), own = a.owner === k, ui = parts[k];
      btns[k].classList.toggle('own', own);
      D.setText(ui.nm, D.teamName(d.cfg, k));
      var sub;
      if (own) sub = 'Dominando';
      else if (d.status === 'ended') sub = 'Encerrado';
      else if (d.status === 'idle') sub = 'Aguardando o início';
      else if (d.status === 'paused') sub = 'Pausado';
      else sub = p.hold > 0 ? 'Segure ' + p.hold + ' s' : 'Toque';
      D.setText(ui.sub, sub);
      var prog = 0;
      if (holds[k] && p.hold > 0) {
        prog = Math.min(1, (now - holds[k]) / (p.hold * 1000));
        if (prog >= 1) send(k);
      }
      ui.fill.style.width = (prog * 100) + '%';
      D.setText($('who' + K), D.teamName(d.cfg, k));
      D.setText($('pts' + K), D.pointScore(p, a, k) + ' pts');
      D.setText($('info' + K), D.fmt(a.t[k]) + ' de posse · ' + a.caps[k] + (a.caps[k] === 1 ? ' captura' : ' capturas'));
    });
  }

  live.start();
  setInterval(render, 100);
})();
