// Who is using the tool on this browser. Used to attribute feedback, test results and edits.
const KEY = 'crm.me';
let team = [];
const openHooks = [];
/** Run `fn(dialog)` each time the dialog opens (used to render feedback settings into it). */
export const onMeOpen = (fn) => openHooks.push(fn);

export const setTeam = (names) => { team = names; };
export function getMe() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
function setMe(name) {
  try { localStorage.setItem(KEY, name); } catch {}
  document.querySelectorAll('[data-me]').forEach((el) => { el.textContent = name || 'Set your name'; });
}

/** Resolve to the user's name, asking once if we don't know it yet. */
export function ensureMe({ force = false } = {}) {
  const current = getMe();
  if (current && !force) return Promise.resolve(current);
  const dlg = document.querySelector('#meDlg');
  const input = dlg.querySelector('input');
  dlg.querySelector('datalist').innerHTML = team.map((n) => `<option value="${n.replace(/"/g, '&quot;')}">`).join('');
  input.value = current;
  openHooks.forEach((fn) => fn(dlg));
  dlg.showModal();
  input.focus();
  return new Promise((resolve) => {
    dlg.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      setMe(name);
      dlg.close();
      resolve(name);
    };
    dlg.onclose = () => resolve(getMe());
  });
}

export function initMe() {
  setMe(getMe());
  document.querySelector('#meBtn').addEventListener('click', () => ensureMe({ force: true }));
}
