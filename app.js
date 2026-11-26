import {
  CATCH_UP_START, DINNER_START, EVENTS, TARGETS, TEAMS, TOURNAMENT_START,
  formatScheduleTime, getLineup, getMatches, getMatchState, getStandings, getSubstitution,
} from './tournament.js';
import { createDrawEditor } from './draw-editor.js';
import { setupFullscreen, watchScoreboard } from './display.js';
import { createScoreEditor } from './score-editor.js';
import { apiUrl, pageUrl } from './site-config.js';

const $ = id => document.getElementById(id);
const scorekeeperPath = pageUrl('score').pathname;
const organizer = [scorekeeperPath, `${scorekeeperPath}/`, `${scorekeeperPath}/index.html`].includes(location.pathname);
document.body.dataset.view = organizer ? 'scorekeeper' : 'spectator';
const tokenKey = 'dredge-olympics-token';
const statusLabel = { upcoming: 'Scheduled', live: 'In play', final: 'Final' };
const dialog = $('match-dialog');
const content = $('dialog-content');
const roundFilters = new Map();
let state = { records: {}, revision: -1, draw: null };
let selectedEvent = EVENTS[0].id;
let token = organizer ? sessionStorage.getItem(tokenKey) ?? '' : '';
if (organizer) sessionStorage.removeItem('dredge-olympics-pin');
let openDetails = null;
let invoker = null;

const currentTeams = () => state.draw?.teams ?? TEAMS;
const currentMatches = () => getMatches(currentTeams().length);
const sportMatches = event => currentMatches().filter(match => match.event === event);
const scoreOf = match => getMatchState(match, state.records[match.id]);
const finals = matches => matches.filter(match => scoreOf(match).status === 'final').length;
const hasScores = () => Object.values(state.records).some(record => record.actions.length > 0);
const teamLabel = team => team.players.join(' &amp; ') || `Team ${team.id}`;
const sideLabel = (match, side) => teamLabel({ id: match[side], players: getLineup(match, side, state.draw) });
const substituteNote = match => {
  const substitution = getSubstitution(match, state.draw);
  return substitution ? `${substitution.player} fills in for ${substitution.forPlayer} on Team ${substitution.team}.` : '';
};
const chip = id => `<span class="team-chip team-${id}" aria-label="Team ${id}">${id}</span>`;
const badge = status => `<span class="match-status ${status}">${statusLabel[status]}</span>`;

function timeMarkup(minute) {
  const hour = String(Math.floor(minute / 60)).padStart(2, '0');
  const minutes = String(minute % 60).padStart(2, '0');
  return `<time datetime="${hour}:${minutes}">${formatScheduleTime(minute)}</time>`;
}

function renderOrganizer() {
  if (!organizer) return;
  $('organizer-banner').hidden = !organizer;
  const button = $('organizer-button');
  button.hidden = Boolean(token) && hasScores();
  button.textContent = !token ? 'Unlock scorekeeper' : state.draw ? 'Edit teams' : 'Enter drawn teams';
  $('organizer-message').textContent = !token
    ? 'Enter the organizer PIN.'
    : state.draw ? 'Select a match to add or correct its score.' : 'Enter the teams after drawing from the hat.';
}

function saveToken(value) {
  token = value;
  if (token) sessionStorage.setItem(tokenKey, token);
  else sessionStorage.removeItem(tokenKey);
  renderOrganizer();
}

function renderMatch(match) {
  const score = scoreOf(match);
  const note = substituteNote(match);
  const sides = ['home', 'away'].map(side => `<span class="fixture-team">
    ${chip(match[side])}<span><strong>${sideLabel(match, side)}</strong>
    ${score.winner === side ? '<small class="winner-text">Won</small>' : ''}</span>
  </span>`);
  const center = score.status !== 'upcoming' && match.event !== 'pool'
    ? `<b>${score.scores[0]}</b> : <b>${score.scores[1]}</b>`
    : 'vs';
  const time = Number.isInteger(match.startMinute) ? timeMarkup(match.startMinute) : '';
  return `<button type="button" class="fixture" data-match="${match.id}" title="${organizer && state.draw ? 'Score match' : 'Match details'}">
    ${sides[0]}<span class="fixture-score">${center}</span>${sides[1]}
    <span class="fixture-meta">${time}${badge(score.status)}</span>
    ${note ? `<span class="fixture-note">${note}</span>` : ''}
  </button>`;
}

function renderFixtures(matches, activeRound, rounds) {
  const focusedMatch = document.activeElement?.dataset.match;
  const visible = activeRound === 'All' ? rounds : [activeRound];
  $('fixtures').innerHTML = visible.map(round => {
    const group = matches.filter(match => match.round === round);
    const participating = new Set(group.flatMap(match => [match.home, match.away]));
    const bye = currentTeams().find(team => !participating.has(team.id));
    const byeText = bye ? `<span>Bye: Team ${bye.id}${bye.players.length ? ` (${teamLabel(bye)})` : ''}</span>` : '';
    return `<div class="fixture-round">
      <div class="round-heading"><h3>Round ${round}</h3>${byeText}</div>
      <div class="fixture-list">${group.map(renderMatch).join('')}</div>
    </div>`;
  }).join('');
  if (focusedMatch) $('fixtures').querySelector(`[data-match="${focusedMatch}"]`)?.focus({ preventScroll: true });
}

function renderStandings(event, completed, matchCount) {
  const rows = getStandings(event.id, state.records, currentTeams());
  const done = completed === matchCount;
  $('standings-event').textContent = event.name;
  $('standings-rows').innerHTML = rows.map(({ team, wins, losses, rank }) => `<tr${done && rank === 1 ? ' class="is-champion"' : ''}>
    <td>${completed ? rank : '–'}</td><td>${chip(team.id)} ${teamLabel(team)}</td><td>${wins}</td><td>${losses}</td>
  </tr>`).join('');
  const winners = rows.filter(row => row.rank === 1).map(({ team }) => `Team ${team.id}`);
  $('standings-note').textContent = done
    ? `${winners.length === 1 ? 'Champion' : 'Joint champions'}: ${winners.join(', ')}`
    : 'Ranked by wins, then head-to-head results.';
}

function render() {
  renderOrganizer();
  for (const button of $('events').children) {
    const eventMatches = sportMatches(button.dataset.event);
    button.setAttribute('aria-pressed', String(button.dataset.event === selectedEvent));
    button.querySelector('.event-count').textContent = `${finals(eventMatches)}/${eventMatches.length}`;
  }

  const event = EVENTS.find(item => item.id === selectedEvent);
  const matches = sportMatches(event.id);
  const rounds = [...new Set(matches.map(match => match.round))];
  const filter = roundFilters.get(event.id);
  const activeRound = filter === 'All' || rounds.includes(filter)
    ? filter
    : matches.find(match => scoreOf(match).status !== 'final')?.round ?? rounds.at(-1);
  const focusedRound = document.activeElement?.dataset.round;
  $('rounds').innerHTML = ['All', ...rounds].map(round => {
    const complete = round !== 'All' && matches.filter(match => match.round === round).every(match => scoreOf(match).status === 'final');
    const label = round === 'All' ? 'All rounds' : `Round ${round}${complete ? ', complete' : ''}`;
    return `<button type="button" data-round="${round}" aria-label="${label}" aria-pressed="${round === activeRound}">${round}${complete ? '<span class="round-check" aria-hidden="true">✓</span>' : ''}</button>`;
  }).join('');
  if (focusedRound) $('rounds').querySelector(`[data-round="${focusedRound}"]`)?.focus({ preventScroll: true });

  const completed = finals(matches);
  const timed = matches.some(match => Number.isInteger(match.startMinute));
  $('schedule-hours').hidden = !timed;
  const flexible = timed && event.id === 'cornhole' ? ' · Flexible times' : '';
  $('event-rule').textContent = `2v2 round robin · ${event.rule}${flexible}`;
  $('event-progress').textContent = `${completed} / ${matches.length} played`;
  const allMatches = currentMatches();
  $('overall-progress').innerHTML = `<strong>${finals(allMatches)}</strong> / ${allMatches.length} matches`;
  renderFixtures(matches, activeRound, rounds);
  renderStandings(event, completed, matches.length);
  renderRoster();
  if (openDetails && dialog.open) renderDetails(openDetails);
}

async function api(path, options) {
  const response = await fetch(apiUrl(path), { cache: 'no-store', signal: AbortSignal.timeout(8000), ...options });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function connection(online) {
  const indicator = organizer ? $('connection') : $('spectator-connection');
  indicator.classList.toggle('is-online', online);
  const label = indicator.querySelector('[data-connection-label]');
  const message = online ? 'Live scoreboard' : 'Reconnecting';
  if (label.textContent !== message) label.textContent = message;
}

function accept(next) {
  if (next.revision > state.revision) {
    state = next;
    render();
  }
}

const poll = watchScoreboard({ onState: accept, onConnection: connection });

function showDialog(title, context = '') {
  openDetails = null;
  $('dialog-title').textContent = title;
  $('dialog-context').textContent = context;
  content.replaceChildren();
  if (!dialog.open) {
    invoker = document.activeElement;
    dialog.showModal();
  }
}

function unlock(onUnlock) {
  showDialog('Unlock scorekeeper');
  content.innerHTML = `<form class="pin-form">
    <p>Enter the organizer PIN.</p>
    <label for="score-pin">Organizer PIN</label>
    <input type="password" id="score-pin" name="pin" inputmode="numeric" pattern="[0-9]{4,32}" autocomplete="off" required>
    <p class="form-error" role="alert" hidden></p>
    <button type="submit" class="button-primary">Unlock scorekeeper</button>
  </form>`;
  const form = content.querySelector('form');
  const input = form.elements.pin;
  const submit = form.querySelector('button');
  const feedback = form.querySelector('.form-error');
  input.focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    feedback.hidden = true;
    try {
      const session = await api('/api/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: input.value }),
      });
      if (typeof session.token !== 'string' || !session.token) {
        throw new Error('The scorekeeper session could not be started.');
      }
      input.value = '';
      saveToken(session.token);
      if (dialog.open && form.isConnected) {
        if (onUnlock) onUnlock();
        else dialog.close();
      }
    } catch (error) {
      feedback.textContent = error.status === 401 ? error.message : 'Could not unlock the scorekeeper. Check your connection and try again.';
      feedback.hidden = false;
      submit.disabled = false;
      input.select();
    }
  });
}

function renderDetails(match) {
  const score = scoreOf(match);
  const note = substituteNote(match);
  const sides = ['home', 'away'];
  const lines = sides.map((side, index) => {
    const won = score.winner === side;
    const points = score.status === 'upcoming' ? '' : match.event === 'pool' ? (won ? 'Win' : 'Loss') : score.scores[index];
    return `<div class="details-side">${chip(match[side])}
      <strong>${sideLabel(match, side)}</strong>
      <span class="${won ? 'winner-text' : ''}">${points}${won && match.event !== 'pool' ? ' · Won' : ''}</span>
    </div>`;
  }).join('');
  const hits = match.event === 'darts' && state.records[match.id]?.actions.some(action => action.type === 'hit');
  const marks = hits ? `<table class="details-marks">
    <thead><tr><th scope="col">Team</th>${TARGETS.map(target => `<th scope="col">${target}</th>`).join('')}</tr></thead>
    <tbody>${sides.map((side, index) => `<tr><th scope="row">${match[side]}</th>${score.marks[index].map(count => `<td>${count}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>` : '';
  content.innerHTML = `<p class="details-lede">${badge(score.status)}</p><div class="details-sides">${lines}</div>${marks}
    ${note ? `<p class="details-note">${note}</p>` : ''}`;
}

async function save(match, actions, version, drawVersion) {
  try {
    const result = await api(`/api/match/${match.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ actions, version, drawVersion }),
    });
    accept(result);
    return result.records[match.id];
  } catch (error) {
    if (error.status === 401) {
      saveToken('');
      if (dialog.open) unlock(() => openMatch(match));
    }
    if (error.status === 409) {
      await poll();
      throw new Error('This match changed. Close it and reopen it to load the latest score.');
    }
    throw error;
  }
}

function openMatch(match) {
  if (organizer && !token) return unlock(() => openMatch(match));
  if (organizer && !state.draw) return openDraw();
  const event = EVENTS.find(item => item.id === match.event);
  const planned = Number.isInteger(match.startMinute) ? ` · Planned ${formatScheduleTime(match.startMinute)}` : '';
  showDialog(organizer ? 'Score match' : 'Match details', `${event.name} · Round ${match.round}${planned}`);
  if (organizer) {
    const draw = state.draw;
    content.append(createScoreEditor({
      match,
      draw,
      record: state.records[match.id],
      onSave: (actions, version) => save(match, actions, version, draw.version),
    }));
  } else {
    openDetails = match;
    renderDetails(match);
  }
}

function openDraw() {
  if (!token) return unlock(openDraw);
  if (hasScores()) return;
  const { revision, draw } = state;
  showDialog(draw ? 'Edit drawn teams' : 'Enter drawn teams');
  const editor = createDrawEditor({
    draw,
    onSave: async (teams, substitute) => {
      try {
        const result = await api('/api/draw', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ teams, substitute, revision }),
        });
        accept(result);
        if (editor.isConnected && dialog.open) dialog.close();
      } catch (error) {
        if (error.status === 401) {
          saveToken('');
          if (editor.isConnected && dialog.open) unlock(openDraw);
        }
        if (error.status === 409) await poll();
        throw error;
      }
    },
  });
  content.append(editor);
  editor.querySelector('select')?.focus();
}

function renderRoster() {
  const teams = currentTeams();
  const playerCount = state.draw ? new Set(teams.flatMap(team => team.players)).size : teams.length * 2;
  $('player-count').textContent = `${playerCount} players`;
  $('teams-description').textContent = state.draw
    ? 'All three events use the same draw.'
    : 'Team names will appear after the hat draw.';
  $('team-list').innerHTML = teams.map(team => `<div class="roster-team">
    ${chip(team.id)} <strong>${teamLabel(team)}</strong>
  </div>`).join('');
  const note = $('roster-note');
  note.hidden = !state.draw?.sharedPlayer;
  if (state.draw?.sharedPlayer) {
    const { sharedPlayer, sharedTeams, headToHeadRound, substitute } = state.draw;
    note.textContent = `${sharedPlayer} plays for Teams ${sharedTeams.join(' and ')}. ${substitute} fills in on Team ${sharedTeams[1]} when they meet in Round ${headToHeadRound}. Play ${sharedPlayer}’s matches one at a time.`;
  }
}

$('events').innerHTML = EVENTS.map(event => `<button type="button" class="event-button" data-event="${event.id}">
  <span class="event-icon ${event.id}" aria-hidden="true"></span>
  <span class="event-label"><strong>${event.name}</strong><small>${event.rule}</small></span>
  <span class="event-count" aria-hidden="true"></span>
</button>`).join('');
$('schedule-hours').innerHTML = [
  ['Start', TOURNAMENT_START], ['Catch-up', CATCH_UP_START], ['Dinner', DINNER_START],
].map(([label, minute]) => `<span>${label} ${timeMarkup(minute)}</span>`).join('');
if (organizer) {
  $('view-link').href = pageUrl('');
  $('view-link').innerHTML = 'Spectator view <span aria-hidden="true">↗</span>';
  renderOrganizer();
} else {
  setupFullscreen($('spectator-fullscreen'));
}

$('events').addEventListener('click', event => {
  const button = event.target.closest('[data-event]');
  if (!button) return;
  selectedEvent = button.dataset.event;
  render();
});
$('rounds').addEventListener('click', event => {
  const button = event.target.closest('[data-round]');
  if (!button) return;
  const round = button.dataset.round;
  roundFilters.set(selectedEvent, round === 'All' ? round : Number(round));
  render();
});
$('fixtures').addEventListener('click', event => {
  const button = event.target.closest('[data-match]');
  if (button) openMatch(currentMatches().find(match => match.id === button.dataset.match));
});
$('organizer-button').addEventListener('click', openDraw);
$('dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => {
  openDetails = null;
  if (invoker?.isConnected && !invoker.hidden) invoker.focus({ preventScroll: true });
  else if (invoker?.dataset.match) $('fixtures').querySelector(`[data-match="${invoker.dataset.match}"]`)?.focus({ preventScroll: true });
});
render();
poll();
