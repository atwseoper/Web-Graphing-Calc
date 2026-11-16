// "Add to Home screen": a web app manifest and icons, made on the page itself so the
// HTML stays one self-contained file. Only used when the page is served over http(s)
// (GitHub Pages); a file opened from disk can't be installed anyway.
//
// The manifest is a data: URL with absolute start_url and scope; the icons are PNG
// data URLs drawn on a canvas. Nothing is fetched.

function drawIcon(size, { maskable = false } = {}) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const s = size / 100;
  g.scale(s, s);
  // Background: full bleed for maskable icons, a rounded square otherwise.
  g.fillStyle = '#2f6fed';
  if (maskable) {
    g.fillRect(0, 0, 100, 100);
  } else {
    g.beginPath();
    g.roundRect ? g.roundRect(4, 4, 92, 92, 22) : g.rect(4, 4, 92, 92);
    g.fill();
  }
  // Keep the drawing inside the maskable safe zone (central 80%).
  const inset = maskable ? 10 : 0;
  g.translate(inset, inset);
  g.scale((100 - 2 * inset) / 100, (100 - 2 * inset) / 100);
  // Axes
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(20, 55);
  g.lineTo(80, 55);
  g.moveTo(32, 20);
  g.lineTo(32, 80);
  g.stroke();
  // A sine-like curve
  g.strokeStyle = '#ffffff';
  g.lineWidth = 7;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const x = 18 + i;
    const y = 55 - 22 * Math.sin((i / 60) * 2 * Math.PI * 0.85 + 0.2);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  // A data point
  g.fillStyle = '#ffd43b';
  g.beginPath();
  g.arc(70, 66, 6, 0, 2 * Math.PI);
  g.fill();
  return c.toDataURL('image/png');
}

// A tab icon, so browsers don't request /favicon.ico.
function setFavicon() {
  try {
    const link = document.createElement('link');
    link.rel = 'icon';
    link.href = drawIcon(64);
    document.head.append(link);
  } catch { /* canvas unavailable */ }
}

export function setUpInstall() {
  setFavicon();
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const start = location.href.split('#')[0].split('?')[0];
    const scope = start.slice(0, start.lastIndexOf('/') + 1);
    const manifest = {
      name: 'Graphing Calculator',
      short_name: 'Graphs',
      description: 'Graphs, equation solving and curve fitting',
      start_url: start,
      scope,
      id: scope,
      display: 'standalone',
      orientation: 'any',
      background_color: '#f7f8fa',
      theme_color: '#2f6fed',
      icons: [
        { src: drawIcon(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: drawIcon(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: drawIcon(512, { maskable: true }), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(manifest))}`;
    document.head.append(link);

    const apple = document.createElement('link');
    apple.rel = 'apple-touch-icon';
    apple.href = drawIcon(180, { maskable: true });
    document.head.append(apple);
    for (const [name, content] of [['apple-mobile-web-app-capable', 'yes'], ['mobile-web-app-capable', 'yes'], ['apple-mobile-web-app-title', 'Graphs']]) {
      const m = document.createElement('meta');
      m.name = name;
      m.content = content;
      document.head.append(m);
    }
    return true;
  } catch {
    return false;
  }
}
