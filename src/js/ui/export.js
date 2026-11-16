// Saving text as a file and copying it to the clipboard, offline.

export function downloadText(fileName, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Resolves true if the text was copied.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall back below */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

// Briefly change a button's label ("Copied").
export function flashLabel(btn, text, ms = 1500) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  clearTimeout(Number(btn.dataset.timer));
  btn.dataset.timer = String(setTimeout(() => { btn.textContent = old; delete btn.dataset.label; }, ms));
}

// "Pendulum data" -> "pendulum-data.csv"
export function fileNameFor(name, ext = 'csv') {
  const base = String(name || 'data').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'data';
  return `${base}.${ext}`;
}
