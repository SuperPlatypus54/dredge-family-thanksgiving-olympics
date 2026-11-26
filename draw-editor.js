import { inspectTeams, PLAYERS, TEAM_IDS } from './tournament.js';

function addOption(select, value, label = value) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

export function createDrawEditor({ draw, onSave }) {
  const teamIds = draw?.teams.map(team => team.id) ?? TEAM_IDS;
  const form = document.createElement('form');
  form.className = 'draw-editor';
  form.noValidate = true;
  form.innerHTML = `
    <fieldset class="draw-controls">
      <legend class="draw-sr-only">Team draw</legend>
      <p class="draw-instructions"></p>
      <div class="draw-teams"></div>
      <div class="draw-summary" hidden>
        <p class="draw-matchup"></p>
        <label for="draw-substitute">Substitute</label>
        <select id="draw-substitute" name="substitute" required disabled></select>
      </div>
      <p class="draw-error" role="alert" tabindex="-1" hidden></p>
      <button type="submit" class="button-primary draw-save">Save draw</button>
    </fieldset>`;

  const controls = form.querySelector('fieldset');
  const rows = form.querySelector('.draw-teams');
  const summary = form.querySelector('.draw-summary');
  const matchup = form.querySelector('.draw-matchup');
  const substitute = form.elements.substitute;
  const error = form.querySelector('.draw-error');
  const submit = form.querySelector('.draw-save');
  const players = [...PLAYERS].sort((a, b) => a.localeCompare(b));
  const savedTeams = new Map(draw?.teams.map(team => [team.id, team.players]));
  form.querySelector('.draw-instructions').textContent = teamIds.length === 7
    ? 'Enter the 13 players from the hat draw. One player goes on two different teams.'
    : 'Choose two players for each team. Each player can appear on one team.';
  let substituteValue = draw?.substitute ?? '';

  const fields = teamIds.map(id => {
    const row = document.createElement('div');
    row.className = 'draw-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `Team ${id}`);
    const label = document.createElement('span');
    label.className = 'draw-team';
    label.textContent = `Team ${id}`;
    row.append(label);
    const selects = [0, 1].map(index => {
      const select = document.createElement('select');
      select.name = `team-${id}-player-${index + 1}`;
      select.setAttribute('aria-label', `Team ${id}, player ${index + 1}`);
      select.required = true;
      addOption(select, '', `Player ${index + 1}`);
      for (const player of players) addOption(select, player);
      select.value = savedTeams.get(id)?.[index] ?? '';
      row.append(select);
      return select;
    });
    rows.append(row);
    return { id, selects };
  });

  function showError(message = '') {
    error.textContent = message;
    error.hidden = !message;
  }

  function review(showIncomplete = false) {
    showError();
    summary.hidden = true;
    substitute.disabled = true;
    const firstBlank = fields.flatMap(({ selects }) => selects).find(select => !select.value);
    if (firstBlank) {
      if (showIncomplete) {
        showError('Choose two players for every team.');
        firstBlank.focus();
      }
      return;
    }

    const teams = fields.map(({ id, selects }) => ({ id, players: selects.map(select => select.value) }));
    let details;
    try {
      details = inspectTeams(teams);
    } catch (failure) {
      showError(failure.message);
      if (showIncomplete) error.focus();
      return;
    }

    const { sharedPlayer, sharedTeams, headToHeadRound, byeTeam } = details;
    if (!sharedPlayer) return details;

    const [primaryTeam, substituteTeam] = sharedTeams;
    matchup.textContent = `${sharedPlayer} plays for Teams ${primaryTeam} and ${substituteTeam}. They meet in Round ${headToHeadRound}. Choose a player from Team ${byeTeam.id}, which has a bye, to fill in on Team ${substituteTeam}.`;
    substitute.replaceChildren();
    addOption(substitute, '', 'Choose substitute');
    for (const player of byeTeam.players) addOption(substitute, player);
    substitute.value = byeTeam.players.includes(substituteValue) ? substituteValue : '';
    substituteValue = substitute.value;
    substitute.disabled = false;
    summary.hidden = false;
    return details;
  }

  rows.addEventListener('change', () => review());
  substitute.addEventListener('change', () => {
    substituteValue = substitute.value;
    showError();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (controls.disabled) return;
    const details = review(true);
    if (!details) return;

    if (details.sharedPlayer && !substitute.value) {
      showError('Choose a substitute for the match between the shared player’s two teams.');
      substitute.focus();
      return;
    }

    const selectedPlayer = details.sharedPlayer ? substitute.value : null;
    controls.disabled = true;
    form.setAttribute('aria-busy', 'true');
    submit.textContent = 'Saving…';
    try {
      await onSave(details.teams, selectedPlayer);
    } catch (failure) {
      showError(failure.message || 'Couldn’t save the draw. Try again.');
      error.focus();
    } finally {
      controls.disabled = false;
      form.removeAttribute('aria-busy');
      submit.textContent = 'Save draw';
    }
  });

  review();
  return form;
}
