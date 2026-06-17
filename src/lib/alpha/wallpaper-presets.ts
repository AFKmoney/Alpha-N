/**
 * Wallpaper Presets — 79 generative art wallpapers.
 * Each preset has an `id`, `name`, `category`, and `render` function.
 * The render function draws on a canvas context every frame.
 */

export interface WallpaperPreset {
  id: string;
  name: string;
  category: string;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}

// Helper: HSL color
function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
}

// ---- RENDER FUNCTIONS ----

// 1. Obsidian Oil — the default, dark gradient waves
function obsidianOil(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#0a0a14";
  ctx.fillRect(0, 0, w, h);
  const blobs = [
    { x: 0.2, y: 0.3, r: 0.5, hue: 265, speed: 0.0002 },
    { x: 0.8, y: 0.7, r: 0.55, hue: 290, speed: 0.00015 },
    { x: 0.5, y: 0.5, r: 0.6, hue: 200, speed: 0.0001 },
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

// 2. Neural Network — animated nodes + connections
function neuralNetwork(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "rgba(5,5,15,0.15)";
  ctx.fillRect(0, 0, w, h);
  const nodes = 30;
  for (let i = 0; i < nodes; i++) {
    const a = (i / nodes) * Math.PI * 2 + t * 0.0003;
    const r = 0.3 + Math.sin(t * 0.0005 + i) * 0.15;
    const x = w / 2 + Math.cos(a) * r * w;
    const y = h / 2 + Math.sin(a) * r * h;
    const x2 = w / 2 + Math.cos(a + 2.1) * r * w;
    const y2 = h / 2 + Math.sin(a + 2.1) * r * h;
    ctx.strokeStyle = `rgba(125, 211, 252, ${0.1 + Math.sin(t * 0.001 + i) * 0.1})`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = `rgba(125, 211, 252, ${0.4 + Math.sin(t * 0.002 + i) * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 3. Particle Galaxy — swirling particles
function particleGalaxy(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "rgba(2,2,10,0.08)";
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < 80; i++) {
    const a = i * 0.1 + t * 0.0005;
    const r = (i / 80) * Math.min(w, h) * 0.4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const hue = (i * 4 + t * 0.02) % 360;
    ctx.fillStyle = hsl(hue, 70, 60, 0.6);
    ctx.beginPath();
    ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 4. Matrix Rain — digital rain
function matrixRain(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "rgba(0,5,0,0.08)";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "14px monospace";
  const cols = Math.floor(w / 14);
  for (let i = 0; i < cols; i++) {
    const y = ((t * 0.1 + i * 37) % (h + 100));
    const ch = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
    ctx.fillStyle = `rgba(0, 255, 100, ${0.3 + Math.random() * 0.4})`;
    ctx.fillText(ch, i * 14, y);
  }
}

// 5. Plasma Field — flowing plasma
function plasmaField(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cols = 40, rows = 25;
  const cw = w / cols, ch = h / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const v = Math.sin(i * 0.1 + t * 0.001) + Math.cos(j * 0.1 + t * 0.0015) + Math.sin((i + j) * 0.05 + t * 0.002);
      const hue = (v * 60 + t * 0.02) % 360;
      ctx.fillStyle = hsl(hue, 60, 25 + v * 10, 0.8);
      ctx.fillRect(i * cw, j * ch, cw + 1, ch + 1);
    }
  }
}

// 6. Globe — rotating wireframe globe
function globe(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#050510";
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  const r = Math.min(w, h) * 0.35;
  const rot = t * 0.0005;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.3)";
  ctx.lineWidth = 1;
  // Latitude rings
  for (let lat = -80; lat <= 80; lat += 20) {
    const latR = r * Math.cos((lat * Math.PI) / 180);
    const yOff = r * Math.sin((lat * Math.PI) / 180);
    ctx.beginPath();
    for (let lon = 0; lon <= 360; lon += 5) {
      const x = cx + latR * Math.cos((lon * Math.PI) / 180 + rot);
      const y = cy + yOff + latR * Math.sin((lon * Math.PI) / 180 + rot) * 0.3;
      if (lon === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // Longitude lines
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
}

// 7. Starfield — warp speed
function starfield(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "rgba(0,0,5,0.3)";
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < 100; i++) {
    const seed = i * 9301 + 49297;
    const a = (seed % 628) / 100;
    const r = ((seed * 7 + t * 0.3) % (Math.max(w, h)));
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const speed = (r / Math.max(w, h));
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

// 8. Aurora — northern lights
function aurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#020210";
  ctx.fillRect(0, 0, w, h);
  for (let layer = 0; layer < 5; layer++) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 10) {
      const y = h * 0.4 + Math.sin(x * 0.005 + t * 0.001 + layer) * 80 + Math.sin(x * 0.01 + t * 0.002 + layer * 2) * 40 + layer * 30;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const hue = 120 + layer * 30 + Math.sin(t * 0.0005) * 20;
    const g = ctx.createLinearGradient(0, h * 0.3, 0, h);
    g.addColorStop(0, hsl(hue, 80, 50, 0.15));
    g.addColorStop(1, hsl(hue, 80, 20, 0));
    ctx.fillStyle = g;
    ctx.fill();
  }
}

// 9. Circuit Board — animated PCB traces
function circuitBoard(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#040a08";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(0,255,100,0.3)";
  ctx.lineWidth = 1;
  const gridSize = 40;
  for (let i = 0; i < 50; i++) {
    const seed = i * 7919;
    const sx = (seed % Math.floor(w / gridSize)) * gridSize;
    const sy = ((seed * 3) % Math.floor(h / gridSize)) * gridSize;
    const len = 3 + (seed % 5);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    let cx = sx, cy = sy;
    for (let j = 0; j < len; j++) {
      const dir = (seed + j) % 4;
      if (dir === 0) cx += gridSize;
      else if (dir === 1) cy += gridSize;
      else if (dir === 2) cx -= gridSize;
      else cy -= gridSize;
      ctx.lineTo(cx, cy);
    }
    const pulse = (Math.sin(t * 0.003 + i) + 1) * 0.5;
    ctx.strokeStyle = `rgba(0,255,100,${0.1 + pulse * 0.3})`;
    ctx.stroke();
  }
}

// 10. Hex Grid — pulsing hexagons
function hexGrid(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  ctx.fillStyle = "#080810";
  ctx.fillRect(0, 0, w, h);
  const size = 30;
  for (let row = 0; row < h / (size * 1.5) + 2; row++) {
    for (let col = 0; col < w / (size * 1.732) + 2; col++) {
      const x = col * size * 1.732 + (row % 2) * size * 0.866;
      const y = row * size * 1.5;
      const dist = Math.sqrt((x - w / 2) ** 2 + (y - h / 2) ** 2);
      const pulse = Math.sin(t * 0.002 - dist * 0.005);
      const hue = (200 + dist * 0.3 + t * 0.01) % 360;
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

// ---- Generate remaining presets using variations ----
const baseRenderers = [obsidianOil, neuralNetwork, particleGalaxy, matrixRain, plasmaField, globe, starfield, aurora, circuitBoard, hexGrid];

// Generate 69 more presets by creating color/parameter variations
function makeVariant(base: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void, hueShift: number, name: string, category: string): WallpaperPreset["render"] {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => {
    ctx.save();
    ctx.filter = `hue-rotate(${hueShift}deg)`;
    base(ctx, w, h, t);
    ctx.restore();
  };
}

// Build the full 79 preset list
const categories = ["Abstract", "Space", "Nature", "Tech", "Geometric", "Energy", "Minimal"];
const presetNames = [
  "Obsidian Oil", "Neural Network", "Particle Galaxy", "Matrix Rain", "Plasma Field",
  "Globe", "Starfield", "Aurora", "Circuit Board", "Hex Grid",
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

// First 10 presets use unique renderers
for (let i = 0; i < 10; i++) {
  presets.push({
    id: `preset-${i}`,
    name: presetNames[i],
    category: categories[i % categories.length],
    render: baseRenderers[i],
  });
}

// Remaining 69 presets use hue-rotated variants of the base renderers
for (let i = 10; i < 79; i++) {
  const baseIdx = i % 10;
  const hueShift = (i * 37) % 360;
  presets.push({
    id: `preset-${i}`,
    name: presetNames[i] || `Wallpaper ${i + 1}`,
    category: categories[i % categories.length],
    render: makeVariant(baseRenderers[baseIdx], hueShift, presetNames[i] || `Wallpaper ${i + 1}`, categories[i % categories.length]),
  });
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = presets;
