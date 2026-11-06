/* Placar: só mostra o andamento da partida. Não controla nada. */
(function () {
  'use strict';
  var D = window.Dominacao, $ = D.$;
  var live = new D.Live('/api/stream?role=view');
  var sig = '', refs = {};

  D.bindBanner($('banner'), live);
  D.keepAwake(live);
  D.Sound.mount($('soundBtn'));
  live.on('game', function (ev) { D.Sound.handle(ev, 'placar'); });

  function render() {
    var d = D.derive(live);
    if (!d) return;
    D.syncColors(d.cfg);
    var c = D.clock(d);
    D.setText($('clockLabel'), c.label);
    D.setText($('clockTime'), c.text);
    $('status').dataset.s = d.status === 'running' ? 'run' : d.status === 'ended' ? 'end' : 'idle';
    D.setText($('status'), D.statusText(d.status));
    var s = D.pointsSig(d.points);
    if (s !== sig) { sig = s; refs = D.buildList($('plist'), d.points, null); }
    D.renderBoard(d);
    D.renderList(refs, d);
    var res = $('result');
    res.hidden = d.status !== 'ended';
    if (d.status === 'ended') { var r = D.result(d); D.setText($('resultTitle'), r.title); D.setText($('resultText'), r.text); }
  }

  live.start();
  setInterval(render, 100);
})();
