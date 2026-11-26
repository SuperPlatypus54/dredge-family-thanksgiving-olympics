export const PLAYERS = [
  'Charlie', 'Diane', 'Evan', 'Ian', 'Jamie', 'John', 'Kate',
  'Marilyn', 'Matt', 'Max', 'Mia', 'Rich', 'Steve',
];
export const CONFIRMED_TEAMS = [
  { id: 'A', players: ['Marilyn', 'Charlie'] },
  { id: 'B', players: ['Ian', 'Evan'] },
  { id: 'C', players: ['Steve', 'Matt'] },
  { id: 'D', players: ['Rich', 'Mia'] },
  { id: 'E', players: ['Max', 'John'] },
  { id: 'F', players: ['Diane', 'Kate'] },
];
export const TEAM_IDS = CONFIRMED_TEAMS.map(team => team.id);
export const TEAMS = TEAM_IDS.map(id => ({ id, players: [] }));

export const CORNHOLE_TARGET = 11;
export const CORNHOLE_MAX_FRAME = 12;

export const TOURNAMENT_START = 11 * 60 + 30;
export const DINNER_START = 15 * 60 + 30;
const ROUND_MINUTES = 45;
const DARTS_AND_BAGS_MINUTES = 8;
const POOL_MINUTES = 6;
const POOL_OFFSET = 3 * DARTS_AND_BAGS_MINUTES + 1;

export function formatScheduleTime(minute) {
  const hour = Math.floor(minute / 60);
  return `${hour % 12 || 12}:${String(minute % 60).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

export const EVENTS = [
  { id: 'cornhole', name: 'Cornhole', rule: `First to ${CORNHOLE_TARGET}+` },
  { id: 'darts', name: 'Darts', rule: 'Cricket' },
  { id: 'pool', name: 'Pool', rule: 'Win or loss' },
];

export const TARGETS = ['20', '19', '18', '17', '16', '15', 'Bull'];
const TARGET_VALUES = [20, 19, 18, 17, 16, 15, 25];
const SIDES = ['home', 'away'];

const SIX_TEAM_ROUNDS = [
  ['AF', 'BE', 'CD'],
  ['AE', 'FD', 'BC'],
  ['AD', 'EC', 'FB'],
  ['AC', 'DB', 'EF'],
  ['AB', 'CF', 'DE'],
];

// Use a different set of opponents in the same numbered round of each event.
const SIX_TEAM_ROUND_ORDER = {
  darts: [2, 3, 4, 0, 1],
  pool: [4, 0, 1, 2, 3],
};

// Preserve fixture IDs for any previously saved seven-team event.
const SEVEN_TEAM_ROUNDS = [
  ['BG', 'CF', 'DE'],
  ['GA', 'BE', 'CD'],
  ['BC', 'GE', 'AF'],
  ['GC', 'EA', 'FD'],
  ['EC', 'AD', 'FB'],
  ['CA', 'DB', 'FG'],
  ['AB', 'DG', 'EF'],
];

function makeSchedule(rounds, roundOrder = {}) {
  const defaultOrder = rounds.map((_, index) => index);
  return EVENTS.flatMap(({ id: event }) =>
    (roundOrder[event] ?? defaultOrder).flatMap((originalRound, roundIndex) =>
      rounds[originalRound].map(([home, away], slot) => ({
        // Keep scores attached to the same matchup after a round moves.
        id: `${event}-${originalRound + 1}-${slot + 1}`,
        event,
        round: roundIndex + 1,
        home,
        away,
      }))
    )
  );
}

export const CATCH_UP_START = TOURNAMENT_START + (SIX_TEAM_ROUNDS.length - 1) * ROUND_MINUTES
  + POOL_OFFSET + 3 * POOL_MINUTES;

function planSixTeamSchedule() {
  const fixtures = makeSchedule(SIX_TEAM_ROUNDS, SIX_TEAM_ROUND_ORDER);
  const timed = [];
  for (let round = 1; round <= SIX_TEAM_ROUNDS.length; round++) {
    const start = TOURNAMENT_START + (round - 1) * ROUND_MINUTES;
    const eventFixtures = event => fixtures.filter(match => match.round === round && match.event === event);
    const bags = eventFixtures('cornhole');

    eventFixtures('darts').forEach((darts, slot) => {
      const startMinute = start + slot * DARTS_AND_BAGS_MINUTES;
      const dartsTeams = [darts.home, darts.away];
      const bagIndex = bags.findIndex(match => !dartsTeams.includes(match.home) && !dartsTeams.includes(match.away));
      if (bagIndex < 0) throw new Error(`Round ${round} has no bags match available alongside ${darts.id}.`);
      const [bag] = bags.splice(bagIndex, 1);
      timed.push({ ...darts, startMinute }, { ...bag, startMinute });
    });

    eventFixtures('pool').forEach((pool, slot) => {
      timed.push({ ...pool, startMinute: start + POOL_OFFSET + slot * POOL_MINUTES });
    });
  }
  return EVENTS.flatMap(({ id }) => timed.filter(match => match.event === id));
}

export const MATCHES = planSixTeamSchedule();
const SEVEN_TEAM_MATCHES = makeSchedule(SEVEN_TEAM_ROUNDS);

export function getMatches(teamCount) {
  return teamCount === 7 ? SEVEN_TEAM_MATCHES : MATCHES;
}

export function inspectTeams(teams) {
  if (!Array.isArray(teams) || ![6, 7].includes(teams.length)) {
    throw new Error('Enter two players for each team.');
  }

  const teamIds = teams.length === 7 ? [...TEAM_IDS, 'G'] : TEAM_IDS;
  const normalized = teamIds.map(id => {
    const entries = teams.filter(team => team?.id === id);
    const players = entries[0]?.players;
    if (entries.length !== 1 || !Array.isArray(players) || players.length !== 2
      || !players.every(player => PLAYERS.includes(player))) {
      throw new Error(`Choose two players for Team ${id}.`);
    }
    if (players[0] === players[1]) {
      throw new Error(`Choose two different players for Team ${id}.`);
    }
    return { id, players: [...players] };
  });

  const seats = normalized.flatMap(team => team.players);
  if (normalized.length === 6) {
    if (new Set(seats).size !== seats.length) {
      throw new Error('Enter 12 different players across the six teams.');
    }
    return { teams: normalized, sharedPlayer: null, sharedTeams: [], headToHeadRound: null, byeTeam: null };
  }

  if (new Set(seats).size !== PLAYERS.length) {
    throw new Error('Include all 13 players. One player appears on two teams.');
  }

  const sharedPlayer = seats.find((player, index) => seats.indexOf(player) !== index);
  const sharedTeams = normalized.filter(team => team.players.includes(sharedPlayer)).map(team => team.id);
  const headToHeadRound = SEVEN_TEAM_ROUNDS.findIndex(pairs => pairs.some(pair =>
    sharedTeams.every(team => pair.includes(team))
  )) + 1;
  const activeTeams = SEVEN_TEAM_ROUNDS[headToHeadRound - 1].join('');
  const byeTeam = normalized.find(team => !activeTeams.includes(team.id));
  return { teams: normalized, sharedPlayer, sharedTeams, headToHeadRound, byeTeam };
}

export function getSubstitution(match, draw) {
  if (!draw || !draw.sharedTeams.includes(match.home) || !draw.sharedTeams.includes(match.away)) return null;
  return { player: draw.substitute, forPlayer: draw.sharedPlayer, team: draw.sharedTeams[1] };
}

export function getLineup(match, side, draw) {
  const team = draw?.teams.find(item => item.id === match[side]);
  if (!team) return [];

  const substitute = getSubstitution(match, draw);
  return team.players.map(player =>
    substitute?.team === team.id && player === substitute.forPlayer ? substitute.player : player
  );
}

function validateScores(action, maximum) {
  const scores = [action.home, action.away];
  if (scores.some(score => !Number.isSafeInteger(score) || score < 0)) {
    throw new Error('Enter a whole number of zero or more for each team.');
  }
  if (maximum !== undefined && scores.some(score => score > maximum)) {
    throw new Error(`Enter scores of ${maximum} or less.`);
  }
  return scores;
}

function applyCornhole(state, action, target) {
  if (action.type === 'frame') {
    const [home, away] = validateScores(action, CORNHOLE_MAX_FRAME);
    state.scores[0] += Math.max(0, home - away);
    state.scores[1] += Math.max(0, away - home);
  } else if (action.type === 'result') {
    const [home, away] = validateScores(action, target + CORNHOLE_MAX_FRAME - 1);
    if ((home >= target) === (away >= target)) {
      throw new Error(`One team must finish at ${target} or higher and the other below ${target}.`);
    }
    state.scores = [home, away];
  } else {
    throw new Error('Enter a cornhole frame or final score.');
  }

  state.winner = SIDES[state.scores.findIndex(score => score >= target)] ?? null;
}

function applyCricket(state, action) {
  if (action.type === 'result') {
    const winner = SIDES.indexOf(action.winner);
    const scores = validateScores(action);
    if (winner < 0 || scores[winner] < scores[1 - winner]) {
      throw new Error('Choose a winner with at least as many points as the other team.');
    }
    state.scores = scores;
    state.winner = action.winner;
    return;
  }

  const side = SIDES.indexOf(action.side);
  const { target, multiplier } = action;
  const maxMultiplier = target === TARGETS.length - 1 ? 2 : 3;
  if (action.type !== 'hit' || side < 0 || !Number.isInteger(target) || target < 0 || target >= TARGETS.length
    || !Number.isInteger(multiplier) || multiplier < 1 || multiplier > maxMultiplier) {
    throw new Error('Choose a team, a cricket target, and a valid hit.');
  }

  const opponent = 1 - side;
  const marks = state.marks[side][target] + multiplier;
  state.marks[side][target] = Math.min(3, marks);
  if (marks > 3 && state.marks[opponent][target] < 3) {
    state.scores[side] += (marks - 3) * TARGET_VALUES[target];
    if (!Number.isSafeInteger(state.scores[side])) throw new Error('Score exceeds the supported range.');
  }
  if (state.marks[side].every(count => count === 3) && state.scores[side] >= state.scores[opponent]) {
    state.winner = SIDES[side];
  }
}

function applyPool(state, action) {
  const winner = SIDES.indexOf(action.winner);
  if (action.type !== 'result' || winner < 0) throw new Error('Choose the winning pool team.');
  state.scores[winner] = 1;
  state.winner = action.winner;
}

const applyAction = new Map([
  ['cornhole', applyCornhole],
  ['darts', applyCricket],
  ['pool', applyPool],
]);

export function getMatchState(match, record) {
  const scoreAction = applyAction.get(match?.event);
  if (!scoreAction) throw new Error('Unknown event.');
  const actions = record == null ? [] : record.actions;
  const cornholeTarget = record?.cornholeTarget ?? CORNHOLE_TARGET;
  if (!Array.isArray(actions)) throw new Error('Match actions must be an array.');

  const state = {
    status: 'upcoming',
    scores: [0, 0],
    marks: SIDES.map(() => TARGETS.map(() => 0)),
    winner: null,
  };

  for (const action of actions) {
    if (state.winner) throw new Error('Undo the final action before adding a score to a finished match.');
    if (action == null || typeof action !== 'object' || Array.isArray(action)) {
      throw new Error('Invalid scoring action.');
    }
    scoreAction(state, action, cornholeTarget);
    state.status = state.winner ? 'final' : 'live';
  }
  return state;
}

function rankGroup(group, defeated, firstRank) {
  if (group.length === 1) return [{ ...group[0], rank: firstRank }];

  const headToHead = group.map(row => {
    const opponents = group.filter(opponent => opponent.team.id !== row.team.id);
    const wins = opponents.filter(opponent => defeated.get(row.team.id).has(opponent.team.id)).length;
    const losses = opponents.filter(opponent => defeated.get(opponent.team.id).has(row.team.id)).length;
    return { row, wins, complete: wins + losses === opponents.length };
  });
  if (headToHead.some(score => !score.complete)) {
    return group.map(row => ({ ...row, rank: firstRank }));
  }

  headToHead.sort((first, second) => second.wins - first.wins);
  let rank = firstRank;
  return headToHead.map(({ row, wins }, index) => {
    if (index > 0 && wins !== headToHead[index - 1].wins) rank = firstRank + index;
    return { ...row, rank };
  });
}

export function getStandings(event, records = {}, teams = TEAMS) {
  const rows = teams.map(team => ({ team, wins: 0, losses: 0 }));
  const rowsByTeam = new Map(rows.map(row => [row.team.id, row]));
  const defeated = new Map(teams.map(team => [team.id, new Set()]));

  for (const match of getMatches(teams.length)) {
    if (match.event !== event) continue;
    const { winner } = getMatchState(match, records[match.id]);
    if (!winner) continue;

    const winningTeam = match[winner];
    const losingTeam = winner === 'home' ? match.away : match.home;
    rowsByTeam.get(winningTeam).wins++;
    rowsByTeam.get(losingTeam).losses++;
    defeated.get(winningTeam).add(losingTeam);
  }

  const groups = new Map();
  for (const row of rows.sort((first, second) => second.wins - first.wins)) {
    if (!groups.has(row.wins)) groups.set(row.wins, []);
    groups.get(row.wins).push(row);
  }

  const standings = [];
  for (const group of groups.values()) {
    standings.push(...rankGroup(group, defeated, standings.length + 1));
  }
  return standings;
}
