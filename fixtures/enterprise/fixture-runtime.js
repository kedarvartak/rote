/* global document, fetch */
const oracleOrigin = '{{ORACLE_ORIGIN}}';

export async function postAuthoritativeEvent(event) {
  const response = await fetch(`${oracleOrigin}/api/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!response.ok) throw new Error(`authoritative event rejected: ${response.status}`);
  return response.json();
}

export function markUiStatus(text) {
  const status = document.querySelector('[data-ui-status]');
  if (status) status.textContent = text;
}
