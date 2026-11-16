// "Share and save" popover: share link, PNG image, project file save / open.
import { h, setText } from './dom.js';
import { ICONS } from './icons.js';
import { copyText, downloadText } from './export.js';
import { graphPng, legendEntries } from './image-export.js';
import { shareLink, projectJson, openProject } from '../state/share.js';

const isHttp = () => /^https?:$/.test(location.protocol);

function downloadBlob(fileName, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

export function createShareMenu({ popover, toggleBtn, store, graph, getAnalysis, getFits, onOpen }) {
  const status = h('p', { class: 'menu-status', 'aria-live': 'polite' });
  const say = (text, isError = false) => {
    setText(status, text);
    status.classList.toggle('is-error', isError);
  };

  const item = (icon, label, sub, onClick) => {
    const b = h('button', { type: 'button', class: 'menu-item', onClick },
      h('span', { class: 'menu-icon', html: ICONS[icon] }),
      h('span', { class: 'menu-text' }, h('span', { class: 'menu-label' }, label), sub ? h('span', { class: 'menu-sub' }, sub) : null));
    return b;
  };

  // ---- share link ------------------------------------------------------------------------
  async function link() {
    const base = isHttp() ? location.href : 'https://atwseoper.github.io/Web-Graphing-Calc/';
    return shareLink(store.get(), base);
  }
  const canNativeShare = () => typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;

  const linkBtn = item('link', 'Share a link', 'Graphs, data and fits, all in the link', async () => {
    say('');
    let r;
    try {
      r = await link();
    } catch {
      say('Couldn’t make a link in this browser. Use “Save project file” instead.', true);
      return;
    }
    if (r.tooLong) {
      say(`This project is too big for a link (${Math.round(r.length / 1000)} k characters). Use “Save project file” and send the file instead.`, true);
      return;
    }
    if (canNativeShare()) {
      try {
        await navigator.share({ title: 'Graph', url: r.url });
        say('');
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    say(await copyText(r.url) ? 'Link copied. Anyone who opens it gets a copy of this project.' : 'Couldn’t copy the link.', false);
  });

  // ---- image -------------------------------------------------------------------------------
  const imageBtn = item('image', 'Save image', 'PNG of the graph with a key', async () => {
    say('');
    const s = store.get();
    const blob = await graphPng(graph, legendEntries(s, getAnalysis(), getFits()));
    if (!blob) {
      say('Open the Graph tab first, so the graph has a size.', true);
      return;
    }
    const name = `graph-${stamp()}.png`;
    const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
    if (file && canNativeShare() && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Graph' });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    downloadBlob(name, blob);
    say(`Saved ${name}.`);
  });

  // ---- project file ------------------------------------------------------------------------
  const saveBtn = item('download', 'Save project file', 'A .json file to open again later', () => {
    const name = `graph-project-${stamp()}.json`;
    downloadText(name, projectJson(store.get(), { pretty: true }), 'application/json');
    say(`Saved ${name}.`);
  });

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (file) openFile(file);
  });
  const openBtn = item('open', 'Open project file', 'Replaces what’s here (you can undo)', () => fileInput.click());

  function openFile(file) {
    if (file.size > 20 * 1024 * 1024) {
      say('That file is too big to be a project.', true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const r = openProject(store.get(), String(reader.result));
      if (r.error) {
        say(r.error, true);
        open();
        return;
      }
      onOpen(r.state, `Opened ${file.name}`);
      close();
    };
    reader.onerror = () => say('Couldn’t read that file.', true);
    reader.readAsText(file);
  }

  popover.append(
    h('h2', { class: 'popover-title' }, 'Share and save'),
    h('div', { class: 'menu-list' }, linkBtn, imageBtn, saveBtn, openBtn),
    status,
    fileInput,
  );

  function open() {
    popover.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
  }
  function close() {
    popover.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
  }
  toggleBtn.addEventListener('click', () => {
    if (popover.hidden) {
      say('');
      open();
    } else close();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !toggleBtn.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) {
      close();
      toggleBtn.focus();
    }
  });

  return { close, openFile };
}
