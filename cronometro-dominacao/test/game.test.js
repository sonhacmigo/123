'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame } = require('../game');

function setup(saved) {
  let now = 1_000_000;
  const events = [];
  const game = createGame({ clock: () => now, emit: (e) => events.push(e), saved });
  return { game, events, tick: (ms) => { now += ms; game.advance(); }, setNow: (n) => { now = n; } };
}
const DEV = 'aparelho-0001';

test('começa com três pontos livres e relógio parado', () => {
  const { game } = setup();
  const v = game.publicView();
  assert.equal(v.points.length, 3);
  assert.equal(v.run.status, 'idle');
  assert.ok(Object.values(v.run.areas).every((a) => a.owner === null));
});

test('captura só vale com a partida rodando e para quem está no ponto', () => {
  const { game, events, tick } = setup();
  game.hello(DEV);
  assert.equal(game.capture(DEV, 'a').error, 'no_point');
  game.act('device_assign', { deviceId: DEV, pointId: 1 });
  assert.equal(game.capture(DEV, 'a').error, 'not_running');
  game.act('start');
  tick(2000);
  assert.deepEqual(game.capture(DEV, 'a'), { ok: true });
  assert.equal(game.capture(DEV, 'a').error, 'already_owner');
  const cap = events.find((e) => e.type === 'capture');
  assert.equal(cap.pointId, 1);
  assert.equal(cap.team, 'a');
  assert.equal(cap.teamName, 'Vermelho');
});

test('conta só o tempo de quem domina e para quando pausa', () => {
  const { game, tick } = setup();
  game.hello(DEV);
  game.act('device_assign', { deviceId: DEV, pointId: 1 });
  game.act('start');
  tick(1000);
  game.capture(DEV, 'a');
  tick(5000);
  game.act('pause');
  tick(9000); // pausado, não conta
  const a = game.publicView().run.areas[1];
  assert.equal(a.t.a, 5000);
  assert.equal(a.t.b, 0);
  assert.equal(game.publicView().run.elapsedMs, 6000);
});

test('a partida termina na duração e avisa um minuto antes', () => {
  const { game, events, tick } = setup();
  game.act('config', { duration: 2 });
  game.act('start');
  tick(61000);
  assert.ok(events.some((e) => e.type === 'oneMinute'));
  tick(70000);
  assert.equal(game.publicView().run.status, 'ended');
  assert.equal(game.publicView().run.elapsedMs, 120000);
  assert.ok(events.some((e) => e.type === 'end'));
  assert.equal(game.act('start').error, 'ended');
});

test('o tempo de posse não passa do fim da partida', () => {
  const { game, tick } = setup();
  game.hello(DEV);
  game.act('device_assign', { deviceId: DEV, pointId: 2 });
  game.act('config', { duration: 1 });
  game.act('start');
  tick(100);
  game.capture(DEV, 'b');
  tick(500000);
  const a = game.publicView().run.areas[2];
  assert.equal(a.t.b, 59900);
});

test('o admin ajusta nomes, cores e regras com limites', () => {
  const { game } = setup();
  game.act('config', { nameA: '  Time Verde  ', colorA: '#2E7D32', colorB: 'azul', duration: 9999 });
  game.act('point_update', { id: 1, name: 'Casa Azul', sec: 0, cap: 5, hold: 999 });
  const v = game.publicView();
  assert.equal(v.config.nameA, 'Time Verde');
  assert.equal(v.config.colorA, '#2e7d32');
  assert.equal(v.config.colorB, '#1d5fb5');
  assert.equal(v.config.duration, 240);
  assert.deepEqual(
    { name: v.points[0].name, sec: v.points[0].sec, cap: v.points[0].cap, hold: v.points[0].hold },
    { name: 'Casa Azul', sec: 1, cap: 5, hold: 30 }
  );
});

test('cria pontos para os aparelhos que ainda não têm ponto', () => {
  const { game } = setup();
  game.hello('aparelho-0001');
  game.hello('aparelho-0002');
  game.act('device_assign', { deviceId: 'aparelho-0001', pointId: 1 });
  game.act('devices_new_points');
  const v = game.adminView();
  assert.equal(v.points.length, 4);
  const d2 = v.devices.find((d) => d.id === 'aparelho-0002');
  assert.equal(d2.pointId, v.points[3].id);
  assert.equal(v.devices.find((d) => d.id === 'aparelho-0001').pointId, 1);
});

test('só remove ponto antes da partida começar e solta os aparelhos dele', () => {
  const { game } = setup();
  game.hello(DEV);
  game.act('device_assign', { deviceId: DEV, pointId: 3 });
  assert.deepEqual(game.act('point_remove', { id: 3 }), { ok: true });
  assert.equal(game.adminView().devices[0].pointId, null);
  game.act('start');
  assert.equal(game.act('point_remove', { id: 2 }).error, 'game_started');
});

test('a correção do árbitro troca o dono sem contar captura', () => {
  const { game } = setup();
  game.act('owner', { pointId: 1, owner: 'b' });
  const a = game.publicView().run.areas[1];
  assert.equal(a.owner, 'b');
  assert.equal(a.caps.b, 0);
  assert.equal(game.act('owner', { pointId: 1, owner: 'x' }).error, 'bad_team');
});

test('aparelho com id inválido não entra e nome do jogador é limpo', () => {
  const { game } = setup();
  assert.equal(game.hello('curto'), null);
  assert.equal(game.hello('<script>alert(1)</script>'), null);
  game.hello(DEV);
  game.setPlayer(DEV, '  Rafael\u0007 o Grande da Silva Santos  ');
  assert.equal(game.deviceView(DEV).me.player, 'Rafael o Grande da S');
});

test('zerar limpa o placar mas mantém pontos e aparelhos', () => {
  const { game, tick } = setup();
  game.hello(DEV);
  game.act('device_assign', { deviceId: DEV, pointId: 1 });
  game.act('start');
  tick(1500);
  game.capture(DEV, 'a');
  tick(3000);
  game.act('reset');
  const v = game.adminView();
  assert.equal(v.run.status, 'idle');
  assert.equal(v.run.elapsedMs, 0);
  assert.equal(v.run.areas[1].owner, null);
  assert.equal(v.run.areas[1].caps.a, 0);
  assert.equal(v.devices.length, 1);
  assert.equal(v.points.length, 3);
});

test('salvar e carregar: partida que estava rodando volta pausada', () => {
  const a = setup();
  a.game.hello(DEV);
  a.game.act('device_assign', { deviceId: DEV, pointId: 1 });
  a.game.act('config', { nameB: 'Time Azul' });
  a.game.act('start');
  a.tick(1000);
  a.game.capture(DEV, 'b');
  a.tick(4000);
  const snapshot = JSON.parse(JSON.stringify(a.game.serialize()));
  const b = setup(snapshot);
  const v = b.game.adminView();
  assert.equal(v.run.status, 'paused');
  assert.equal(v.config.nameB, 'Time Azul');
  assert.equal(v.run.areas[1].owner, 'b');
  assert.equal(v.run.areas[1].t.b, 4000);
  assert.equal(v.devices[0].pointId, 1);
});

test('arquivo salvo com lixo não derruba o servidor', () => {
  const { game } = setup({ config: { duration: 'x', colorA: 5 }, points: [{ id: 'a' }, null, { id: 7, sec: -4 }], devices: [{ id: 3 }], run: { areas: { 7: { owner: 'z' } } } });
  const v = game.adminView();
  assert.equal(v.points.length, 1);
  assert.equal(v.points[0].id, 7);
  assert.equal(v.points[0].sec, 1);
  assert.equal(v.run.areas[7].owner, null);
  assert.equal(v.devices.length, 0);
});
