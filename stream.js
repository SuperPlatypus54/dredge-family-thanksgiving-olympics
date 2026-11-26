import { setupFullscreen, watchScoreboard } from './display.js';
import { EVENTS, TEAMS, getLineup, getMatches, getMatchState, getStandings } from './tournament.js';

const order = ['darts', 'pool', 'cornhole'].map(id => EVENTS.find(event => event.id === id));
const rotationMs = 15_000;
const start = performance.now();
const find = id => document.getElementById(id);
const board = find('stream-board');
const connection = find('stream-connection');
const nextGame = find('stream-next');
const progress = find('stream-time');
const sides = ['home', 'away'];
const statusLabels = { upcoming: 'Scheduled', live: 'In play', final: 'Final' };
let index = 0;
let state = { draw: null, records: {}, revision: -1 };

function teamChip(id) {
  return `<span class="team-chip team-${id}" aria-hidden="true">${id}</span>`;
}

function matchCard(match, result) {
  const rows = sides.map((side, sideIndex) => {
    const players = getLineup(match, side, state.draw);
    const name = players.join(' &amp; ') || `Team ${match[side]}`;
    const won = result.winner === side;
    let points = '–';
    if (result.status !== 'upcoming') {
      points = match.event === 'pool' ? (won ? 'W' : 'L') : result.scores[sideIndex];
    }
    return `<div class="stream-side${won ? ' is-winner' : ''}">
      ${teamChip(match[side])}<span class="stream-name">${name}</span>
      <strong class="stream-points">${won ? '<span class="stream-check" aria-label="Winner">✓</span>' : ''}${points}</strong>
    </div>`;
  });
  return `<div class="stream-match is-${result.status}" title="${statusLabels[result.status]}" data-match="${match.id}">
    ${rows.join('')}
  </div>`;
}

function renderSchedule(matches, teams) {
  const rounds = new Map();
  for (const match of matches) {
    if (!rounds.has(match.round)) rounds.set(match.round, []);
    rounds.get(match.round).push(match);
  }

  board.dataset.roundCount = rounds.size;
  find('stream-rounds').innerHTML = Array.from(rounds, ([number, group]) => {
    const bye = teams.find(team => !group.some(match => sides.some(side => match[side] === team.id)));
    return `<section class="stream-round">
      <div class="stream-round-label">
        <h3>Round <strong>${number}</strong></h3>
        ${bye ? `<p>Bye ${bye.id}</p>` : ''}
      </div>
      <div class="stream-round-matches">
        ${group.map(match => matchCard(match, getMatchState(match, state.records[match.id]))).join('')}
      </div>
    </section>`;
  }).join('');
}

function renderStandings(event, teams, completed, matchCount) {
  const rows = getStandings(event.id, state.records, teams);
  const finished = completed === matchCount;
  find('stream-standings').innerHTML = rows.map(({ team, wins, losses, rank }) =>
    `<tr${finished && rank === 1 ? ' class="is-champion"' : ''}>
      <td>${completed ? rank : '–'}</td>
      <th scope="row"><span class="stream-standing-team">${teamChip(team.id)}
        <span>${team.players.join(' &amp; ') || `Team ${team.id}`}</span>
      </span></th>
      <td>${wins}</td>
      <td>${losses}</td>
    </tr>`
  ).join('');

  const champions = rows.filter(row => row.rank === 1).map(({ team }) => team.players.join(' & ') || `Team ${team.id}`);
  find('stream-standing-note').textContent = finished
    ? `${champions.length === 1 ? 'Champion' : 'Joint champions'} · ${champions.join(', ')}`
    : 'Ranked by wins, then head-to-head results.';
}

function render() {
  const event = order[index];
  const teams = state.draw?.teams ?? TEAMS;
  const matches = getMatches(teams.length).filter(match => match.event === event.id);
  const completed = matches.filter(match => getMatchState(match, state.records[match.id]).status === 'final').length;

  document.body.dataset.event = event.id;
  find('stream-event').textContent = event.name;
  find('stream-rule').textContent = `${event.rule} · 2v2 round robin`;
  find('stream-played').textContent = `${completed} / ${matches.length} played`;
  renderStandings(event, teams, completed, matches.length);
  renderSchedule(matches, teams);
}

function tick() {
  const elapsed = performance.now() - start;
  const active = Math.floor(elapsed / rotationMs) % order.length;
  if (active !== index) {
    index = active;
    render();
  }

  const remaining = rotationMs - elapsed % rotationMs;
  const next = order[(index + 1) % order.length].name;
  const label = `${next} next in ${Math.ceil(remaining / 1000)}s`;
  if (nextGame.textContent !== label) nextGame.textContent = label;
  progress.style.transform = `scaleX(${remaining / rotationMs})`;
}

setupFullscreen(null);
render();
tick();
setInterval(tick, 200);

const refresh = watchScoreboard({
  onState(next) {
    if (next.revision === state.revision) return;
    state = next;
    render();
  },
  onConnection(online) {
    connection.classList.toggle('is-online', online);
    const label = online ? 'Live scores' : 'Reconnecting';
    if (connection.textContent !== label) connection.textContent = label;
  },
});
void refresh();
