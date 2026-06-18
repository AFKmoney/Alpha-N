/**
 * Wallpaper Presets — 79 generative art wallpapers.
 * All renderers are mouse-reactive (mx, my are 0..1 normalized coordinates).
 * The 'Globe Network' preset changes appearance based on the real time of day.
 */

export interface WallpaperRenderCtx {
  mx: number; // mouse x, 0..1
  my: number; // mouse y, 0..1
}

export interface WallpaperPreset {
  id: string;
  name: string;
  category: string;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, mouse: WallpaperRenderCtx) => void;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// ============================================================
// 1. Obsidian Oil — dark gradient waves (mouse shifts hue)
// ============================================================
function obsidianOil(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, w, h);
  const hueShift = m.mx * 60;
  const blobs = [
    { x: 0.2 + m.mx * 0.1, y: 0.3 + m.my * 0.1, r: 0.5, hue: 265 + hueShift, speed: 0.0002 },
    { x: 0.8 - m.mx * 0.1, y: 0.7 - m.my * 0.1, r: 0.55, hue: 290 + hueShift, speed: 0.00015 },
    { x: 0.5, y: 0.5, r: 0.6, hue: 200 + hueShift, speed: 0.0001 },
  ];
  ctx.globalCompositeOperation = "lighter";
  for (const b of blobs) {
    const px = (b.x + Math.sin(t * b.speed) * 0.12) * w;
    const py = (b.y + Math.cos(t * b.speed * 1.3) * 0.1) * h;
    const radius = Math.max(40, b.r * Math.min(w, h));
    const g = ctx.createRadialGradient(px, py, 0, px, py, radius);
    g.addColorStop(0, hsl(b.hue, 50, 16, 0.55));
    g.addColorStop(0.5, hsl(b.hue, 45, 13, 0.18));
    g.addColorStop(1, hsl(b.hue, 45, 13, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
}

// ============================================================
// 2. Neural Network — nodes follow mouse, connections pulse
// ============================================================
function neuralNetwork(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "rgba(5,5,15,0.15)";
  ctx.fillRect(0, 0, w, h);
  const nodes = 30;
  const mouseInfluence = 0.3;
  for (let i = 0; i < nodes; i++) {
    const a = (i / nodes) * Math.PI * 2 + t * 0.0003;
    const baseR = 0.3 + Math.sin(t * 0.0005 + i) * 0.15;
    // Nodes near the mouse are pulled toward it
    const r = baseR + mouseInfluence * Math.exp(-Math.abs(i / nodes - m.mx) * 5) * (m.my - 0.5);
    const x = w / 2 + Math.cos(a) * r * w;
    const y = h / 2 + Math.sin(a) * r * h;
    const x2 = w / 2 + Math.cos(a + 2.1) * r * w;
    const y2 = h / 2 + Math.sin(a + 2.1) * r * h;
    const pulse = 0.1 + Math.sin(t * 0.001 + i + m.mx * Math.PI) * 0.1;
    ctx.strokeStyle = `rgba(125, 211, 252, ${pulse})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = `rgba(125, 211, 252, ${0.4 + Math.sin(t * 0.002 + i) * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.5 + m.mx * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// 3. Particle Galaxy — particles swirl around mouse
// ============================================================
function particleGalaxy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "rgba(2,2,10,0.08)";
  ctx.fillRect(0, 0, w, h);
  const cx = w * (0.5 + (m.mx - 0.5) * 0.3);
  const cy = h * (0.5 + (m.my - 0.5) * 0.3);
  for (let i = 0; i < 80; i++) {
    const a = i * 0.1 + t * 0.0005;
    const r = (i / 80) * Math.min(w, h) * 0.4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const hue = (i * 4 + t * 0.02 + m.mx * 180) % 360;
    ctx.fillStyle = hsl(hue, 70, 60, 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ============================================================
// 4. Matrix Rain — rain follows mouse X, speed varies with mouse Y
// ============================================================
function matrixRain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "rgba(0,5,0,0.08)";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "14px monospace";
  const cols = Math.floor(w / 14);
  const speed = 0.1 + m.my * 0.3;
  for (let i = 0; i < cols; i++) {
    const y = ((t * speed + i * 37) % (h + 100));
    const ch = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
    const distFromMouse = Math.abs(i / cols - m.mx);
    const brightness = 0.3 + Math.exp(-distFromMouse * 8) * 0.5;
    ctx.fillStyle = `rgba(0, 255, 100, ${brightness})`;
    ctx.fillText(ch, i * 14, y);
  }
}

// ============================================================
// 5. Plasma Field — plasma distorts around mouse
// ============================================================
function plasmaField(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  const cols = 40, rows = 25;
  const cw = w / cols, ch = h / rows;
  const mxCol = m.mx * cols;
  const myRow = m.my * rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const distM = Math.sqrt((i - mxCol) ** 2 + (j - myRow) ** 2);
      const mouseWave = Math.sin(distM * 0.5 - t * 0.003) * Math.exp(-distM * 0.05) * 2;
      const v = Math.sin(i * 0.1 + t * 0.001) + Math.cos(j * 0.1 + t * 0.0015) + Math.sin((i + j) * 0.05 + t * 0.002) + mouseWave;
      const hue = (v * 60 + t * 0.02) % 360;
      ctx.fillStyle = hsl(hue, 60, 25 + v * 10, 0.8);
      ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
    }
  }
}

// ============================================================
// 6. Globe Network — rotating wireframe globe with network nodes
//    Changes color based on real time of day (day/night cycle)
// ============================================================
function globeNetwork(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  // Determine time of day (0=dawn, 0.25=noon, 0.5=dusk, 0.75=midnight)
  const now = new Date();
  const hours = now.getHours() + now.getMinutes() / 60;
  const dayProgress = hours / 24; // 0..1

  // Background color shifts with time of day
  let bgHue: number, bgLight: number;
  if (dayProgress < 0.25) { // dawn
    bgHue = 20; bgLight = 8;
  } else if (dayProgress < 0.5) { // day
    bgHue = 210; bgLight = 12;
  } else if (dayProgress < 0.75) { // dusk
    bgHue = 15; bgLight = 6;
  } else { // night
    bgHue = 250; bgLight = 4;
  }
  ctx.fillStyle = hsl(bgHue, 50, bgLight);
  ctx.fillRect(0, 0, w, h);

  const cx = w * (0.5 + (m.mx - 0.5) * 0.15);
  const cy = h * (0.5 + (m.my - 0.5) * 0.15);
  const r = Math.min(w, h) * 0.32;
  const rot = t * 0.0003;

  // Network node positions (simulated cities)
  const networkNodes = [
    { lat: 40, lon: -74, name: "NYC" },
    { lat: 51, lon: 0, name: "LDN" },
    { lat: 35, lon: 139, name: "TYO" },
    { lat: -33, lon: 151, name: "SYD" },
    { lat: 55, lon: 37, name: "MOW" },
    { lat: 28, lon: 77, name: "DEL" },
    { lat: -23, lon: -46, name: "SAO" },
    { lat: 30, lon: 31, name: "CAI" },
    { lat: 1, lon: 103, name: "SGP" },
    { lat: 37, lon: -122, name: "SF" },
    { lat: 48, lon: 2, name: "PAR" },
    { lat: 52, lon: 13, name: "BER" },
  ];

  // Draw latitude rings
  ctx.strokeStyle = `rgba(125, 211, 252, 0.15)`;
  ctx.lineWidth = 1;
  for (let lat = -75; lat <= 75; lat += 15) {
    const latR = r * Math.cos((lat * Math.PI) / 180);
    const yOff = r * Math.sin((lat * Math.PI) / 180);
    ctx.beginPath();
    for (let lon = 0; lon <= 360; lon += 5) {
      const x = cx + latR * Math.cos((lon * Math.PI) / 180 + rot);
      const y = cy + yOff + latR * Math.sin((lon * Math.PI) / 180 + rot) * 0.35;
      if (lon === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Draw longitude lines
  for (let lon = 0; lon < 360; lon += 30) {
    ctx.beginPath();
    for (let lat = -90; lat <= 90; lat += 5) {
      const latR = r * Math.cos((lat * Math.PI) / 180);
      const x = cx + latR * Math.cos((lon * Math.PI) / 180 + rot);
      const y = cy + r * Math.sin((lat * Math.PI) / 180);
      if (lat === -90) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Draw the "sun" side highlight (based on real time)
  const sunLon = ((hours - 12) * 15) % 360; // sun longitude
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const sunX = cx + r * Math.cos((sunLon * Math.PI) / 180 + rot);
  const sunGrad = ctx.createRadialGradient(sunX, cy, 0, sunX, cy, r * 1.5);
  const sunIntensity = Math.sin(dayProgress * Math.PI); // brightest at noon
  sunGrad.addColorStop(0, `rgba(255, 220, 100, ${0.15 * sunIntensity})`);
  sunGrad.addColorStop(0.5, `rgba(255, 180, 80, ${0.05 * sunIntensity})`);
  sunGrad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sunGrad;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.restore();

  // Project and draw network nodes
  const projectedNodes = networkNodes.map((n) => {
    const latR = r * Math.cos((n.lat * Math.PI) / 180);
    const x = cx + latR * Math.cos((n.lon * Math.PI) / 180 + rot);
    const y = cy + r * Math.sin((n.lat * Math.PI) / 180);
    const z = Math.cos((n.lon * Math.PI) / 180 + rot); // >0 = front, <0 = back
    return { ...n, x, y, z };
  });

  // Draw connections between visible nodes
  for (let i = 0; i < projectedNodes.length; i++) {
    for (let j = i + 1; j < projectedNodes.length; j++) {
      const a = projectedNodes[i];
      const b = projectedNodes[j];
      if (a.z > 0 && b.z > 0) {
        const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
        if (dist < r * 1.2) {
          const pulse = Math.sin(t * 0.003 + i + j) * 0.5 + 0.5;
          ctx.strokeStyle = `rgba(125, 211, 252, ${0.15 + pulse * 0.2})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();

          // Data packets traveling along the connection
          const packetPos = ((t * 0.001 + i * 0.3) % 1);
          const px = a.x + (b.x - a.x) * packetPos;
          const py = a.y + (b.y - a.y) * packetPos;
          ctx.fillStyle = `rgba(125, 211, 252, ${0.6 + pulse * 0.4})`;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Draw node dots
  for (const n of projectedNodes) {
    if (n.z > 0) {
      const size = 3 + Math.sin(t * 0.002 + n.lat) * 1;
      const glow = Math.sin(t * 0.003 + n.lon * 0.1) * 0.3 + 0.7;
      // Outer glow
      ctx.fillStyle = `rgba(125, 211, 252, ${glow * 0.2})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, size * 3, 0, Math.PI * 2);
      ctx.fill();
      // Core
      ctx.fillStyle = `rgba(125, 211, 252, ${glow})`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Mouse cursor creates a "scan" ripple on the globe
  if (m.mx > 0 && m.my > 0) {
    const mxPx = m.mx * w;
    const myPx = m.my * h;
    const distToGlobe = Math.sqrt((mxPx - cx) ** 2 + (myPx - cy) ** 2);
    if (distToGlobe < r) {
      const ripple = (t * 0.002) % 1;
      ctx.strokeStyle = `rgba(192, 132, 252, ${(1 - ripple) * 0.3})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(mxPx, myPx, ripple * 60, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

// ============================================================
// 7. Starfield — warp speed, mouse steers direction
// ============================================================
function starfield(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "rgba(0,0,5,0.3)";
  ctx.fillRect(0, 0, w, h);
  const cx = w * (0.5 + (m.mx - 0.5) * 0.2);
  const cy = h * (0.5 + (m.my - 0.5) * 0.2);
  for (let i = 0; i < 100; i++) {
    const seed = i * 9301 + 49297;
    const a = (seed % 628) / 100;
    const r = ((seed * 7 + t * 0.3) % Math.max(w, h));
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const speed = r / Math.max(w, h);
    ctx.fillStyle = `rgba(200,220,255,${speed})`;
    const px = cx + Math.cos(a) * (r + speed * 20);
    const py = cy + Math.sin(a) * (r + speed * 20);
    ctx.strokeStyle = `rgba(200,220,255,${speed * 0.5})`;
    ctx.lineWidth = speed * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(px, py);
    ctx.stroke();
  }
}

// ============================================================
// 8. Aurora — mouse shifts aurora position and intensity
// ============================================================
function aurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "#020210";
  ctx.fillRect(0, 0, w, h);
  for (let layer = 0; layer < 5; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 10) {
      const mouseEffect = Math.sin(x * 0.003 - m.mx * 2) * m.my * 40;
      const y = h * 0.4 + Math.sin(x * 0.005 + t * 0.001 + layer) * 80 + Math.sin(x * 0.01 + t * 0.002 + layer * 2) * 40 + layer * 30 + mouseEffect;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const hue = 120 + layer * 30 + Math.sin(t * 0.0005 + m.mx) * 20;
    const g = ctx.createLinearGradient(0, h * 0.3, 0, h);
    g.addColorStop(0, hsl(hue, 80, 50, 0.15));
    g.addColorStop(1, hsl(hue, 80, 20, 0));
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// ============================================================
// 9. Circuit Board — traces pulse brighter near mouse
// ============================================================
function circuitBoard(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "#040a08";
  ctx.fillRect(0, 0, w, h);
  ctx.lineWidth = 1;
  const gridSize = 40;
  const mxGrid = m.mx * w;
  const myGrid = m.my * h;
  for (let i = 0; i < 50; i++) {
    const seed = i * 7919;
    const sx = (seed % Math.floor(w / gridSize)) * gridSize;
    const sy = ((seed * 3) % Math.floor(h / gridSize)) * gridSize;
    const len = 3 + (seed % 5);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let cx2 = sx, cy2 = sy;
    for (let j = 0; j < len; j++) {
      const dir = (seed + j) % 4;
      if (dir === 0) cx2 += gridSize;
      else if (dir === 1) cy2 += gridSize;
      else if (dir === 2) cx2 -= gridSize;
      else cy2 -= gridSize;
      ctx.lineTo(cx2, cy2);
    }
    const distToMouse = Math.sqrt((sx - mxGrid) ** 2 + (sy - myGrid) ** 2);
    const mouseBoost = Math.exp(-distToMouse / 200) * 0.4;
    const pulse = (Math.sin(t * 0.003 + i) + 1) * 0.5;
    ctx.strokeStyle = `rgba(0,255,100,${0.1 + pulse * 0.2 + mouseBoost})`;
    ctx.stroke();
  }
}

// ============================================================
// 10. Hex Grid — hexagons pulse outward from mouse position
// ============================================================
function hexGrid(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) {
  ctx.fillStyle = "#080810";
  ctx.fillRect(0, 0, w, h);
  const size = 30;
  const mxPx = m.mx * w;
  const myPx = m.my * h;
  for (let row = 0; row < h / (size * 1.5) + 2; row++) {
    for (let col = 0; col < w / (size * 1.732) + 2; col++) {
      const x = col * size * 1.732 + (row % 2) * size * 0.866;
      const y = row * size * 1.5;
      const distMouse = Math.sqrt((x - mxPx) ** 2 + (y - myPx) ** 2);
      const mousePulse = Math.sin(distMouse * 0.02 - t * 0.003) * Math.exp(-distMouse * 0.003);
      const dist = Math.sqrt((x - w / 2) ** 2 + (y - h / 2) ** 2);
      const pulse = Math.sin(t * 0.002 - dist * 0.005) + mousePulse * 2;
      const hue = (200 + dist * 0.3 + t * 0.01 + m.mx * 60) % 360;
      ctx.strokeStyle = hsl(hue, 60, 30 + pulse * 20, 0.4);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * 60 - 30) * Math.PI / 180;
        const px = x + Math.cos(a) * size * 0.5;
        const py = y + Math.sin(a) * size * 0.5;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
}

// ============================================================
// Generate preset list
// ============================================================
const baseRenderers = [obsidianOil, neuralNetwork, particleGalaxy, matrixRain, plasmaField, globeNetwork, starfield, aurora, circuitBoard, hexGrid];

function makeVariant(base: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) => void, hueShift: number): WallpaperPreset["render"] {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number, m: WallpaperRenderCtx) => {
    ctx.save();
    ctx.filter = `hue-rotate(${hueShift}deg)`;
    base(ctx, w, h, t, m);
    ctx.restore();
  };
}

const categories = ["Abstract", "Space", "Nature", "Tech", "Geometric", "Energy", "Minimal"];
const presetNames = [
  "Obsidian Oil", "Neural Network", "Particle Galaxy", "Matrix Rain", "Plasma Field",
  "Globe Network", "Starfield", "Aurora", "Circuit Board", "Hex Grid",
  "Crimson Nebula", "Deep Ocean", "Solar Flare", "Quantum Field", "Vortex",
  "Crystal Cave", "Fireflies", "Tornado", "DNA Helix", "Fractal Tree",
  "Liquid Mercury", "Photon Stream", "Black Hole", "Nebula Cloud", "Tidal Wave",
  "Lightning Storm", "Autumn Leaves", "Cherry Blossom", "Desert Dunes", "Volcanic",
  "Ice Crystals", "Rainbow Spiral", "Sound Wave", "Topographic", "Mandala",
  "Kaleidoscope", "Voronoi Cells", "Delaunay Mesh", "Penrose Tiling", "Sierpinski",
  "Mandelbrot Zoom", "Julia Set", "Burning Ship", "Tricorn", "Newton Basin",
  "String Theory", "Quantum Entanglement", "Dark Matter", "Antimatter", "Singularity",
  "Nanotech", "Cyberpunk City", "Synthwave Grid", "Retro Sun", "Vaporwave",
  "Minimal Lines", "Dot Matrix", "Gradient Flow", "Color Blocks", "Monochrome",
  "Emerald Glow", "Sapphire Pulse", "Amethyst Dream", "Golden Hour", "Rose Quartz",
  "Ocean Depths", "Forest Canopy", "Mountain Range", "Desert Sky", "Arctic Lights",
  "Lava Flow", "Steam Vents", "Frost Pattern", "Sand Ripples", "Cloud Formations",
  "Electric Blue", "Neon Pink", "Infrared", "Ultraviolet", "X-Ray",
];

const presets: WallpaperPreset[] = [];
for (let i = 0; i < 10; i++) {
  presets.push({ id: `preset-${i}`, name: presetNames[i], category: categories[i % categories.length], render: baseRenderers[i] });
}
for (let i = 10; i < 79; i++) {
  const baseIdx = i % 10;
  const hueShift = (i * 37) % 360;
  presets.push({ id: `preset-${i}`, name: presetNames[i] || `Wallpaper ${i + 1}`, category: categories[i % categories.length], render: makeVariant(baseRenderers[baseIdx], hueShift) });
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = presets;
