const pageBase = new URL('.', import.meta.url);
const externalApi = document.querySelector('meta[name="scoreboard-api-origin"]')?.content;
const apiBase = externalApi ? new URL(externalApi) : pageBase;

export const pageUrl = path => new URL(path, pageBase);
export const apiUrl = path => new URL(path, apiBase);
