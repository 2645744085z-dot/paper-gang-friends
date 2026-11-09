/* 纸牌帮·群友专属版 —— 客户端逻辑 */
(() => {
  'use strict';

  const PHASE_NAMES = { preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '结算' };
  const RANK_LABEL = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  const $ = (id) => document.getElementById(id);
  const els = {
    homeView: $('homeView'), lobbyView: $('lobbyView'), gameView: $('gameView'), resultView: $('resultView'),
    nameInput: $('nameInput'), roomInput: $('roomInput'), roomCodeField: $('roomCodeField'), enterButton: $('enterButton'),
    homeError: $('homeError'), connectionBadge: $('connectionBadge'),
    leaveButton: $('leaveButton'), lobbyCode: $('lobbyCode'), copyButton: $('copyButton'),
    lobbyMessage: $('lobbyMessage'), startButton: $('startButton'), startHint: $('startHint'),
    rosterList: $('rosterList'), rosterCount: $('rosterCount'),
    gameCode: $('gameCode'), heistMetric: $('heistMetric'), alarmMetric: $('alarmMetric'),
    phaseMetric: $('phaseMetric'), soundButton: $('soundButton'), gameLeaveButton: $('gameLeaveButton'),
    alertStrip: $('alertStrip'), phaseTitle: $('phaseTitle'), phaseHint: $('phaseHint'),
    communityCards: $('communityCards'), poolCount: $('poolCount'), chipPool: $('chipPool'),
    playerGrid: $('playerGrid'), controlMessage: $('controlMessage'),
    nextPhaseButton: $('nextPhaseButton'), nextHeistButton: $('nextHeistButton'),
    eventStatus: $('eventStatus'), eventLog: $('eventLog'), statsBody: $('statsBody'),
    resultHero: $('resultHero'), resultPlayers: $('resultPlayers'), resultStats: $('resultStats'),
    resultNextButton: $('resultNextButton'), toastRegion: $('toastRegion'),
  };

  const store = {
    get name() { return localStorage.getItem('pgz_name') || ''; },
    set name(v) { localStorage.setItem('pgz_name', v); },
    get session() {
      let s = localStorage.getItem('pgz_session');
      if (!s) { s = crypto.randomUUID(); localStorage.setItem('pgz_session', s); }
      return s;
    },
    get room() { return localStorage.getItem('pgz_room') || ''; },
    set room(v) { v ? localStorage.setItem('pgz_room', v) : localStorage.removeItem('pgz_room'); },
  };

  const socket = io({ transports: ['websocket', 'polling'] });
  let state = null;          // 最新房间状态（含自己的手牌）
  let joinMode = 'create';   // create | join
  let eventFilter = 'phase'; // phase | all
  let soundOn = localStorage.getItem('pgz_sound') !== 'off';
  let lastAlarms = 0;
  const replaceCount = new Map(); // playerId -> 换筹次数（由事件流累计）

  /* ---------- 基础工具 ---------- */
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });

  function show(view) {
    for (const key of ['homeView', 'lobbyView', 'gameView', 'resultView']) {
      els[key].classList.toggle('hidden', key !== view);
    }
    window.scrollTo(0, 0);
  }

  function toast(message, isAlert = false) {
    const node = document.createElement('div');
    node.className = `toast${isAlert ? ' alert' : ''}`;
    node.textContent = message;
    els.toastRegion.appendChild(node);
    setTimeout(() => node.remove(), 4200);
  }

  function setError(message) {
    els.homeError.textContent = message || '';
    if (message) toast(message, true);
  }

  let audioCtx = null;
  function beep(freq, duration = 0.12, when = 0) {
    if (!soundOn) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + when + duration);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + when);
      osc.stop(audioCtx.currentTime + when + duration + 0.05);
    } catch { /* 忽略音频异常 */ }
  }

  /* ---------- 连接状态 ---------- */
  function setBadge(status, text) {
    els.connectionBadge.className = `connection-badge ${status}`;
    els.connectionBadge.textContent = text;
    els.eventStatus.className = `live-dot${status === 'connected' ? '' : ' offline'}`;
  }
  setBadge('connecting', '正在连接');
  socket.on('connect', () => {
    setBadge('connected', '已连接');
    const room = store.room;
    if (room && !els.homeView.classList.contains('hidden')) {
      socket.emit('room:join', { name: store.name, code: room, sessionId: store.session });
    }
  });
  socket.on('disconnect', () => setBadge('offline', '连接断开'));
  socket.io.on('reconnect_attempt', () => setBadge('connecting', '正在重连'));

  socket.on('room:error', (payload) => {
    const message = payload?.message || '操作失败';
    if (!els.homeView.classList.contains('hidden')) setError(message);
    else toast(message, true);
    if (/房间不存在|被房主移出/.test(message)) { store.room = ''; show('homeView'); }
  });

  socket.on('room:kicked', (payload) => {
    store.room = '';
    toast(payload?.message || '你被移出了房间', true);
    show('homeView');
  });

  socket.on('room:left', () => { store.room = ''; show('homeView'); });

  socket.on('chip:event', (action) => {
    if (!state || state.code !== (els.gameCode.textContent)) return;
    recordReplace(action);
    announceAction(action);
    playActionSound(action);
    animateAction(action);
  });

  socket.on('room:state', (next) => {
    const prevAlarms = state ? state.alarms : 0;
    state = next;
    render();
    if (next.gameState === 'playing' && next.alarms > prevAlarms) {
      els.alertStrip.classList.remove('hidden');
      els.alertStrip.textContent = '⚠️ 警报被触发！筹码顺序与牌力不一致。';
      setTimeout(() => els.alertStrip.classList.add('hidden'), 5000);
    }
  });

  /* ---------- 首页 ---------- */
  document.querySelectorAll('.mode-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      joinMode = tab.dataset.mode;
      els.roomCodeField.classList.toggle('hidden', joinMode !== 'join');
      els.enterButton.innerHTML = joinMode === 'create' ? '创建房间 <span>→</span>' : '加入房间 <span>→</span>';
    });
  });

  els.nameInput.value = store.name;
  els.enterButton.addEventListener('click', () => {
    const name = els.nameInput.value.trim();
    if (!name) return setError('请先输入昵称');
    if (joinMode === 'join' && !els.roomInput.value.trim()) return setError('请输入六位房间码');
    store.name = name;
    setError('');
    if (joinMode === 'create') {
      socket.emit('room:create', { name, sessionId: store.session }, (res) => {
        if (res?.ok) store.room = res.code;
      });
    } else {
      const code = els.roomInput.value.trim().toUpperCase();
      socket.emit('room:join', { name, code, sessionId: store.session }, (res) => {
        if (res?.ok) store.room = res.code;
      });
    }
  });
  els.roomInput.addEventListener('input', () => { els.roomInput.value = els.roomInput.value.toUpperCase(); });

  /* ---------- 大厅 ---------- */
  els.leaveButton.addEventListener('click', () => socket.emit('room:leave'));
  els.copyButton.addEventListener('click', async () => {
    if (!state) return;
    const text = `【纸牌帮·群友专属版】邀请你加入行动！房间码：${state.code}，打开链接直接入场：${location.origin}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('邀请信息已复制，发给朋友吧');
    } catch {
      toast(`复制失败，请手动抄写房间码：${state.code}`, true);
    }
  });
  els.startButton.addEventListener('click', () => socket.emit('game:start'));

  /* ---------- 对局 ---------- */
  els.gameLeaveButton.addEventListener('click', () => socket.emit('room:leave'));
  els.nextPhaseButton.addEventListener('click', () => socket.emit('phase:next'));
  els.nextHeistButton.addEventListener('click', () => socket.emit('phase:next'));
  els.soundButton.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('pgz_sound', soundOn ? 'on' : 'off');
    els.soundButton.textContent = soundOn ? '◉ 声音' : '◈ 静音';
    if (soundOn) beep(660);
  });
  els.soundButton.textContent = soundOn ? '◉ 声音' : '◈ 静音';

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      eventFilter = tab.dataset.filter;
      renderEventLog();
    });
  });

  function recordReplace(action) {
    if (action.actionType === 'replace') {
      replaceCount.set(action.actorId, (replaceCount.get(action.actorId) || 0) + 1);
    }
  }

  function announceAction(action) {
    const value = `${action.chipValue}★`;
    let text;
    if (action.actionType === 'steal') {
      text = `${action.actorName} 从 ${action.sourcePlayerName} 手中抢走了 ${value} 筹码！${action.sourcePlayerName} 需要重新选择`;
    } else if (action.actionType === 'replace') {
      text = `${action.actorName} 归还旧筹码，换拿了 ${value} 筹码`;
    } else {
      text = `${action.actorName} 从公共池拿了 ${value} 筹码`;
    }
    toast(text, action.actionType === 'steal');
    if (action.affectedPlayerId === me()?.id) {
      els.alertStrip.classList.remove('hidden');
      els.alertStrip.textContent = `⚠️ 你的 ${value} 筹码被 ${action.actorName} 抢走了，请重新选择！`;
      beep(220, 0.2);
      setTimeout(() => els.alertStrip.classList.add('hidden'), 4000);
    }
  }

  function playActionSound(action) {
    if (action.actionType === 'steal') { beep(300, 0.1); beep(200, 0.14, 0.1); }
    else beep(560, 0.08);
  }

  function animateAction(action) {
    const actorCard = document.querySelector(`[data-player-id="${action.actorId}"]`);
    if (actorCard) flashClass(actorCard, 'actor-glow');
    if (action.affectedPlayerId) {
      const victimCard = document.querySelector(`[data-player-id="${action.affectedPlayerId}"]`);
      if (victimCard) flashClass(victimCard, 'stolen-glow');
    }
  }

  function flashClass(node, className) {
    node.classList.add(className);
    setTimeout(() => node.classList.remove(className), 900);
  }

  /* ---------- 渲染 ---------- */
  function me() { return state?.players.find((p) => p.id === state.viewerId) || null; }
  function isHost() { return !!state && state.viewerId === state.hostId; }

  function chipNode(value, extraClass = '') {
    const span = document.createElement('span');
    span.className = `chip chip-${value} ${extraClass}`.trim();
    span.textContent = `${value}★`;
    return span;
  }

  function cardNode(card, back = false) {
    const div = document.createElement('div');
    if (back) { div.className = 'playing-card card-back'; div.textContent = '?'; return div; }
    const isRed = card.suit === '♥' || card.suit === '♦';
    div.className = `playing-card${isRed ? ' red' : ''}`;
    const rank = document.createElement('div');
    rank.className = 'rank';
    rank.textContent = RANK_LABEL[card.rank] ?? card.rank;
    const suit = document.createElement('div');
    suit.className = 'suit';
    suit.textContent = card.suit;
    div.append(rank, suit);
    return div;
  }

  function render() {
    if (!state) return;
    if (state.gameState === 'lobby') return renderLobby();
    if (state.gameState === 'playing') return renderGame();
    if (state.gameState === 'result') return renderResult();
    if (state.gameState === 'ended') return renderEnded();
    renderLobby();
  }

  function renderLobby() {
    show('lobbyView');
    els.lobbyCode.textContent = state.code;
    els.rosterCount.textContent = `${state.players.length}/6`;
    const online = state.players.filter((p) => p.connected).length;
    if (state.players.length < 3) {
      els.lobbyMessage.textContent = `等待队友加入。至少需要 3 位玩家才能开始（当前 ${state.players.length} 位）。`;
    } else if (online < state.players.length) {
      els.lobbyMessage.textContent = '有队友掉线，等待重连后再开始。';
    } else {
      els.lobbyMessage.textContent = '人手齐了！房主可以随时开始行动。';
    }
    const canStart = isHost() && state.players.length >= 3 && state.players.length <= 6 && online === state.players.length;
    els.startButton.disabled = !canStart;
    els.startButton.classList.toggle('hidden', !isHost());
    els.startHint.textContent = isHost() ? '需要 3–6 位正式玩家' : '等待房主开始行动';
    els.rosterList.innerHTML = '';
    for (const p of state.players) {
      const item = document.createElement('div');
      item.className = 'roster-item';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = p.name.slice(0, 1);
      const info = document.createElement('div');
      info.className = 'roster-name';
      info.textContent = p.name + (p.id === state.hostId ? '（房主）' : '') + (p.id === state.viewerId ? '（你）' : '');
      const dot = document.createElement('span');
      dot.className = `online-dot${p.connected ? '' : ' offline'}`;
      dot.title = p.connected ? '在线' : '离线';
      item.append(avatar, info, dot);
      if (isHost() && p.id !== state.hostId) {
        const kick = document.createElement('button');
        kick.className = 'kick-button';
        kick.textContent = '移除';
        kick.addEventListener('click', () => socket.emit('player:kick', { playerId: p.id }));
        item.appendChild(kick);
      }
      els.rosterList.appendChild(item);
    }
  }

  function renderGame() {
    show('gameView');
    const mePlayer = me();
    els.gameCode.textContent = state.code;
    els.heistMetric.textContent = `${state.heistNumber}/3`;
    els.alarmMetric.textContent = `${state.alarms}/3`;
    els.phaseMetric.textContent = PHASE_NAMES[state.phase];
    els.phaseTitle.textContent = PHASE_NAMES[state.phase];
    const chosen = state.players.filter((p) => p.currentChip !== null).length;
    els.phaseHint.textContent = `本阶段已有 ${chosen}/${state.players.length} 人选定筹码（点击公共池或他人筹码即可行动）`;

    els.communityCards.innerHTML = '';
    if (state.communityCards.length === 0) {
      for (let i = 0; i < 5; i += 1) els.communityCards.appendChild(cardNode(null, true));
    } else {
      for (const card of state.communityCards) els.communityCards.appendChild(cardNode(card));
      for (let i = state.communityCards.length; i < 5; i += 1) els.communityCards.appendChild(cardNode(null, true));
    }

    // 公共筹码池：未被持有且未被我持有的筹码（我手里的那枚不重复出现在池里）
    els.poolCount.textContent = `${state.availableChips.length} 枚`;
    els.chipPool.innerHTML = '';
    for (const value of state.availableChips) {
      const chip = chipNode(value);
      if (mePlayer && mePlayer.currentChip !== null) {
        chip.title = '换拿这枚筹码会自动归还你当前的筹码';
      }
      chip.addEventListener('click', () => socket.emit('chip:choose', { value }));
      els.chipPool.appendChild(chip);
    }

    renderPlayerGrid();
    renderEventLog();
    renderStats();

    // 阶段控制
    const allChosen = chosen === state.players.length;
    const atRiver = state.phase === 'river';
    els.nextHeistButton.classList.add('hidden');
    els.nextPhaseButton.classList.remove('hidden');
    if (isHost()) {
      els.controlMessage.textContent = allChosen
        ? (atRiver ? '所有人都已选定筹码，可以公开牌型结算。' : '所有人都已选定筹码，可以推进到下一阶段。')
        : `等待 ${state.players.length - chosen} 位玩家选择筹码…`;
      els.nextPhaseButton.disabled = !allChosen;
      els.nextPhaseButton.innerHTML = atRiver && allChosen ? '公开牌型并结算 <span>→</span>' : '进入下一阶段 <span>→</span>';
    } else {
      els.controlMessage.textContent = allChosen ? '全员已就位，等待房主推进。' : '请选择你的筹码。';
      els.nextPhaseButton.disabled = true;
    }
  }

  function renderPlayerGrid() {
    const mePlayer = me();
    els.playerGrid.innerHTML = '';
    for (const p of state.players) {
      const card = document.createElement('div');
      card.className = 'player-card';
      card.dataset.playerId = p.id;
      const head = document.createElement('div');
      head.className = 'player-head';
      const avatar = document.createElement('div');
      avatar.className = 'avatar';
      avatar.textContent = p.name.slice(0, 1);
      const info = document.createElement('div');
      info.className = 'player-info';
      const name = document.createElement('div');
      name.className = 'player-name';
      name.textContent = p.name + (p.id === state.hostId ? ' ' : '');
      const status = document.createElement('div');
      status.className = `player-status${p.connected ? '' : ' offline'}`;
      status.textContent = p.connected ? (p.currentChip !== null ? '已选定筹码' : '选择中…') : '离线等待重连';
      info.append(name, status);
      head.append(avatar, info);
      if (p.id === state.hostId) {
        const mark = document.createElement('span');
        mark.className = 'host-mark';
        mark.textContent = '房主';
        head.appendChild(mark);
      }

      const held = document.createElement('div');
      held.className = 'held-area';
      if (p.currentChip !== null) {
        const holder = document.createElement('div');
        holder.className = 'chip-holder';
        const chip = chipNode(p.currentChip, p.id === mePlayer?.id ? 'held' : '');
        if (p.id === mePlayer?.id) {
          const note = document.createElement('span');
          note.className = 'chip-note';
          note.textContent = '你的筹码';
          holder.append(chip, note);
        } else {
          chip.title = `点击抢走 ${p.name} 的这枚筹码`;
          chip.addEventListener('click', () => socket.emit('chip:choose', { value: p.currentChip, sourcePlayerId: p.id }));
          holder.appendChild(chip);
        }
        held.appendChild(holder);
      } else {
        const empty = document.createElement('span');
        empty.className = 'empty-chip';
        empty.textContent = p.id === mePlayer?.id ? '你还没有选择筹码' : '尚未选择筹码';
        held.appendChild(empty);
      }

      const metrics = document.createElement('div');
      metrics.className = 'player-metrics';
      const items = [['抢筹', p.stealsMade], ['被抢', p.timesStolen], ['换筹', replaceCount.get(p.id) || 0]];
      for (const [label, value] of items) {
        const box = document.createElement('div');
        const b = document.createElement('b');
        b.textContent = String(value);
        const s = document.createElement('span');
        s.textContent = label;
        box.append(b, s);
        metrics.appendChild(box);
      }

      const trail = document.createElement('div');
      trail.className = 'phase-trail';
      for (const phase of ['preflop', 'flop', 'turn', 'river']) {
        const cell = document.createElement('span');
        cell.className = 'trail-cell';
        if (phase === state.phase) cell.classList.add('current');
        else if (p.chipHistory[phase] != null) cell.classList.add('filled');
        trail.appendChild(cell);
      }

      card.append(head, held, metrics, trail);

      if (mePlayer && p.id === mePlayer.id && mePlayer.hand?.length) {
        const handRow = document.createElement('div');
        handRow.className = 'chip-holder';
        handRow.style.marginTop = '10px';
        for (const cardData of mePlayer.hand) {
          const mini = cardNode(cardData);
          mini.style.height = '58px';
          mini.style.width = '42px';
          mini.querySelector('.rank').style.fontSize = '15px';
          mini.querySelector('.suit').style.fontSize = '13px';
          handRow.appendChild(mini);
        }
        card.appendChild(handRow);
      }
      els.playerGrid.appendChild(card);
    }
  }

  function eventText(action) {
    const value = `${action.chipValue}★`;
    if (action.actionType === 'steal') return `${esc(action.actorName)} 从 ${esc(action.sourcePlayerName)} 手中抢走了 ${value} 筹码`;
    if (action.actionType === 'replace') return `${esc(action.actorName)} 换拿了 ${value} 筹码（旧筹码已归还）`;
    return `${esc(action.actorName)} 从公共池拿了 ${value} 筹码`;
  }

  function renderEventLog() {
    const logs = (state?.eventLog || []).filter((a) => eventFilter === 'all' || a.phase === state.phase);
    els.eventLog.innerHTML = '';
    if (logs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'event-empty';
      empty.textContent = '本阶段还没有抢筹记录，等你发起第一笔行动。';
      els.eventLog.appendChild(empty);
      return;
    }
    for (const action of [...logs].reverse()) {
      const item = document.createElement('div');
      item.className = `event-item ${action.actionType === 'steal' ? 'steal' : action.actionType === 'replace' ? 'return' : ''}`;
      const phase = document.createElement('span');
      phase.className = 'event-phase';
      phase.textContent = PHASE_NAMES[action.phase];
      const body = document.createElement('span');
      body.innerHTML = eventText(action);
      const time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = fmtTime(action.timestamp);
      item.append(phase, body, time);
      els.eventLog.appendChild(item);
    }
  }

  function renderStats() {
    els.statsBody.innerHTML = '';
    for (const p of state.players) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = p.name;
      row.appendChild(nameCell);
      for (const phase of ['preflop', 'flop', 'turn', 'river']) {
        const cell = document.createElement('td');
        const value = p.chipHistory[phase];
        cell.textContent = value != null ? `${value}★` : '—';
        row.appendChild(cell);
      }
      const stealCell = document.createElement('td');
      stealCell.innerHTML = `<span class="trend-up">${p.stealsMade}</span>/<span class="trend-down">${p.timesStolen}</span>`;
      row.appendChild(stealCell);
      els.statsBody.appendChild(row);
    }
  }

  /* ---------- 结算 ---------- */
  function renderResult() {
    show('resultView');
    const result = state.result;
    if (!result) return;
    const hero = els.resultHero;
    hero.className = `panel result-hero ${result.success ? 'success' : 'failure'}`;
    hero.innerHTML = `
      <div class="result-symbol">${result.success ? '🔓' : '🚨'}</div>
      <h1>第 ${result.heistNumber} 次劫案：${result.success ? '保险箱打开' : '警报大作'}</h1>
      <p>${esc(result.reason)}｜已开保险箱 ${result.vaults}/3 · 警报 ${result.alarms}/3</p>`;

    els.resultPlayers.innerHTML = '';
    for (const p of result.players) {
      const row = document.createElement('div');
      row.className = 'result-player';
      const rank = document.createElement('div');
      rank.className = 'result-rank';
      rank.textContent = `#${p.order}`;
      const main = document.createElement('div');
      main.className = 'result-player-main';
      const name = document.createElement('div');
      name.className = 'result-player-name';
      name.textContent = p.name;
      const detail = document.createElement('div');
      detail.className = 'result-player-detail';
      detail.textContent = `${p.result.name}（关键牌 ${p.result.keyCards || '—'}）｜手牌 ${p.hand.map((c) => (RANK_LABEL[c.rank] ?? c.rank) + c.suit).join(' ')}`;
      main.append(name, detail);
      const chip = document.createElement('div');
      chip.className = 'result-chip';
      chip.appendChild(chipNode(p.finalChip ?? 0));
      chip.appendChild(document.createTextNode(p.finalChip != null ? `终局筹码 ${p.finalChip}★` : '未选筹码'));
      row.append(rank, main, chip);
      els.resultPlayers.appendChild(row);
    }

    els.resultStats.innerHTML = '<div class="result-stat-row header"><span>玩家</span><span>抢筹</span><span>被抢</span><span>换筹</span><span>操作</span></div>';
    for (const p of state.players) {
      const row = document.createElement('div');
      row.className = 'result-stat-row';
      for (const text of [esc(p.name), p.stealsMade, p.timesStolen, replaceCount.get(p.id) || 0, p.totalActionCount]) {
        const cell = document.createElement('span');
        cell.textContent = String(text);
        row.appendChild(cell);
      }
      els.resultStats.appendChild(row);
    }

    const ended = state.gameState === 'ended' || result.vaults >= 3 || result.alarms >= 3;
    if (ended) return renderEnded();
    els.resultNextButton.classList.remove('hidden');
    if (isHost()) {
      els.resultNextButton.disabled = false;
      els.resultNextButton.innerHTML = '开始下一劫案 <span>→</span>';
      els.resultNextButton.onclick = () => socket.emit('heist:next');
    } else {
      els.resultNextButton.disabled = true;
      els.resultNextButton.textContent = '等待房主开启下一劫案';
      els.resultNextButton.onclick = null;
    }
  }

  function renderEnded() {
    show('resultView');
    const win = state.vaults >= 3;
    const hero = els.resultHero;
    hero.className = `panel result-hero ${win ? 'success' : 'failure'}`;
    hero.innerHTML = `
      <div class="result-symbol">${win ? '🏆' : '🚓'}</div>
      <h1>${win ? '行动圆满成功！' : '行动失败告终'}</h1>
      <p>${win ? '三只保险箱全部打开，赃款到手，全员撤离。' : '警报累计三次，行动小组被迫撤退。'}｜共进行 ${state.heistNumber} 次劫案</p>`;
    els.resultPlayers.innerHTML = '';
    els.resultStats.innerHTML = '';
    els.resultNextButton.classList.remove('hidden');
    els.resultNextButton.disabled = false;
    els.resultNextButton.innerHTML = '返回首页 <span>→</span>';
    els.resultNextButton.onclick = () => { store.room = ''; location.reload(); };
  }

  /* ---------- 启动 ---------- */
  show('homeView');
})();
