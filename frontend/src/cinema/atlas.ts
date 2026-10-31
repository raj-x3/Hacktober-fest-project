/** Procedural textures for the spiral: a 4x4 icon atlas and one repository card. Drawn once, at start-up. */

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const CELL = 128;
export const ATLAS_COLUMNS = 4;

type Ctx = CanvasRenderingContext2D;

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function text(c: Ctx, value: string, x: number, y: number, size: number, alpha = 1, align: CanvasTextAlign = 'left'): void {
  c.font = `600 ${size}px ${MONO}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.fillStyle = `rgba(255,255,255,${alpha})`;
  c.fillText(value, x, y);
}

function bar(c: Ctx, x: number, y: number, w: number, alpha = 0.55, h = 5): void {
  c.fillStyle = `rgba(255,255,255,${alpha})`;
  roundRect(c, x, y - h / 2, w, h, h / 2);
  c.fill();
}

function dot(c: Ctx, x: number, y: number, r: number, filled: boolean): void {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  if (filled) {
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.fill();
  } else {
    c.fillStyle = 'rgba(4,9,11,0.9)';
    c.fill();
    c.stroke();
  }
}

type Tile = (c: Ctx) => void;

const TILES: Tile[] = [
  // 0 source file
  (c) => {
    c.beginPath();
    c.moveTo(36, 22);
    c.lineTo(76, 22);
    c.lineTo(96, 42);
    c.lineTo(96, 106);
    c.lineTo(36, 106);
    c.closePath();
    c.moveTo(76, 22);
    c.lineTo(76, 42);
    c.lineTo(96, 42);
    c.stroke();
    bar(c, 46, 58, 40);
    bar(c, 46, 70, 28, 0.4);
    bar(c, 46, 82, 36);
    bar(c, 46, 94, 20, 0.4);
  },
  // 1 commit history
  (c) => {
    c.beginPath();
    c.moveTo(38, 18);
    c.lineTo(38, 110);
    c.stroke();
    dot(c, 38, 34, 7, false);
    dot(c, 38, 64, 7, true);
    dot(c, 38, 94, 7, false);
    text(c, 'a3f9c1e', 54, 34, 13, 0.85);
    bar(c, 54, 49, 44, 0.35, 4);
    text(c, '7be21d0', 54, 64, 13, 0.85);
    bar(c, 54, 79, 36, 0.35, 4);
    text(c, '0c4d8aa', 54, 94, 13, 0.85);
  },
  // 2 diff
  (c) => {
    text(c, '+', 26, 36, 22);
    bar(c, 42, 36, 58, 0.8);
    text(c, '−', 26, 60, 22, 0.8);
    bar(c, 42, 60, 36, 0.5);
    text(c, '+', 26, 84, 22);
    bar(c, 42, 84, 66, 0.8);
    bar(c, 42, 104, 30, 0.25);
  },
  // 3 commit hash
  (c) => {
    text(c, 'commit', 64, 38, 13, 0.6, 'center');
    text(c, 'a3f9c1e', 64, 64, 21, 1, 'center');
    bar(c, 34, 88, 60, 0.35, 4);
    bar(c, 34, 100, 36, 0.25, 4);
  },
  // 4 branch
  (c) => {
    c.beginPath();
    c.moveTo(44, 30);
    c.lineTo(44, 98);
    c.moveTo(44, 78);
    c.bezierCurveTo(44, 58, 84, 68, 84, 50);
    c.stroke();
    dot(c, 44, 28, 8, false);
    dot(c, 44, 100, 8, false);
    dot(c, 84, 48, 8, true);
  },
  // 5 code
  (c) => {
    text(c, '{ }', 64, 52, 40, 1, 'center');
    bar(c, 34, 88, 58, 0.5);
    bar(c, 34, 102, 36, 0.3);
  },
  // 6 connected nodes
  (c) => {
    const nodes: Array<[number, number]> = [
      [30, 42],
      [66, 28],
      [98, 50],
      [48, 90],
      [88, 96],
    ];
    c.beginPath();
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [0, 3],
      [1, 3],
      [2, 4],
      [3, 4],
    ] as const) {
      const p = nodes[a] as [number, number];
      const q = nodes[b] as [number, number];
      c.moveTo(p[0], p[1]);
      c.lineTo(q[0], q[1]);
    }
    c.stroke();
    nodes.forEach(([x, y], i) => dot(c, x, y, i === 1 ? 8 : 6, i === 1));
  },
  // 7 finding chip
  (c) => {
    text(c, 'confidence', 64, 34, 11, 0.6, 'center');
    roundRect(c, 16, 48, 96, 34, 17);
    c.stroke();
    dot(c, 36, 65, 5, true);
    text(c, 'finding', 50, 65, 15);
    bar(c, 28, 100, 72, 0.3, 4);
  },
  // 8 magnifier
  (c) => {
    bar(c, 26, 96, 40, 0.3, 4);
    bar(c, 26, 108, 24, 0.3, 4);
    c.beginPath();
    c.arc(56, 52, 24, 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(74, 70);
    c.lineTo(98, 94);
    c.stroke();
  },
  // 9 evidence reference
  (c) => {
    text(c, 'E04', 64, 54, 34, 1, 'center');
    text(c, '↗ source', 64, 90, 13, 0.65, 'center');
  },
  // 10 highlighted passage
  (c) => {
    c.beginPath();
    c.moveTo(38, 28);
    c.lineTo(26, 28);
    c.lineTo(26, 100);
    c.lineTo(38, 100);
    c.moveTo(90, 28);
    c.lineTo(102, 28);
    c.lineTo(102, 100);
    c.lineTo(90, 100);
    c.stroke();
    bar(c, 40, 48, 48, 0.4);
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.fillRect(38, 58, 52, 14);
    bar(c, 42, 65, 44, 0.9);
    bar(c, 40, 84, 36, 0.4);
  },
  // 11 report document
  (c) => {
    roundRect(c, 32, 16, 64, 96, 4);
    c.stroke();
    bar(c, 42, 30, 34, 0.95, 6);
    bar(c, 42, 46, 44, 0.5);
    bar(c, 42, 57, 40, 0.5);
    bar(c, 42, 68, 44, 0.5);
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.fillRect(42, 80, 44, 20);
    bar(c, 46, 90, 18, 0.7);
  },
  // 12 checklist
  (c) => {
    [34, 62, 90].forEach((y, i) => {
      c.strokeRect(24, y - 8, 16, 16);
      if (i < 2) {
        c.beginPath();
        c.moveTo(27, y);
        c.lineTo(32, y + 5);
        c.lineTo(38, y - 5);
        c.stroke();
      }
      bar(c, 50, y, 54 - i * 8, 0.55);
    });
  },
  // 13 chart
  (c) => {
    c.beginPath();
    c.moveTo(24, 22);
    c.lineTo(24, 102);
    c.lineTo(108, 102);
    c.stroke();
    [24, 46, 36, 64].forEach((h, i) => {
      c.fillStyle = `rgba(255,255,255,${0.35 + i * 0.15})`;
      c.fillRect(34 + i * 19, 102 - h, 12, h);
    });
  },
  // 14 verified
  (c) => {
    c.beginPath();
    c.moveTo(64, 20);
    c.lineTo(98, 32);
    c.lineTo(98, 62);
    c.bezierCurveTo(98, 82, 82, 96, 64, 106);
    c.bezierCurveTo(46, 96, 30, 82, 30, 62);
    c.lineTo(30, 32);
    c.closePath();
    c.stroke();
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(48, 62);
    c.lineTo(60, 74);
    c.lineTo(82, 48);
    c.stroke();
  },
  // 15 stacked pages
  (c) => {
    [
      [26, 20],
      [38, 30],
      [50, 40],
    ].forEach(([x, y], i) => {
      roundRect(c, x as number, y as number, 54, 70, 4);
      c.fillStyle = 'rgba(4,9,11,0.92)';
      c.fill();
      c.stroke();
      if (i === 2) {
        bar(c, 60, 56, 30, 0.9, 5);
        bar(c, 60, 70, 34, 0.45);
        bar(c, 60, 82, 26, 0.45);
      }
    });
  },
];

export function drawAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = CELL * ATLAS_COLUMNS;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  TILES.forEach((draw, index) => {
    c.save();
    c.translate((index % ATLAS_COLUMNS) * CELL, Math.floor(index / ATLAS_COLUMNS) * CELL);
    roundRect(c, 4, 4, CELL - 8, CELL - 8, 10);
    c.fillStyle = 'rgba(4,9,11,0.64)';
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 2.4;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    draw(c);
    c.restore();
  });
  return canvas;
}

/** A generic repository page. The names and messages are illustration, not real data. */
export function drawRepoCard(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const c = canvas.getContext('2d');
  if (!c) return canvas;
  roundRect(c, 3, 3, 506, 378, 16);
  c.fillStyle = 'rgba(6,11,14,0.9)';
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.lineWidth = 2;
  c.stroke();

  // header: repository icon, name, visibility
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 2.4;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(30, 62);
  c.lineTo(30, 30);
  c.lineTo(52, 30);
  c.lineTo(52, 62);
  c.lineTo(30, 62);
  c.moveTo(30, 54);
  c.lineTo(52, 54);
  c.stroke();
  text(c, 'owner / repository', 68, 46, 24, 1);
  roundRect(c, 400, 32, 80, 28, 14);
  c.lineWidth = 1.5;
  c.stroke();
  text(c, 'Public', 440, 46, 14, 0.85, 'center');
  c.fillStyle = 'rgba(255,255,255,0.18)';
  c.fillRect(24, 80, 464, 1.5);

  // branch row
  roundRect(c, 28, 94, 84, 28, 8);
  c.stroke();
  text(c, '⑂ main', 70, 108, 15, 0.9, 'center');
  text(c, '30 commits sampled', 130, 108, 14, 0.55);

  // files
  const rows: Array<[string, string, boolean]> = [
    ['src', 'update', true],
    ['tests', 'add tests', true],
    ['docs', 'edit docs', true],
    ['README.md', 'initial commit', false],
    ['package.json', 'bump version', false],
  ];
  rows.forEach(([name, message, folder], i) => {
    const y = 152 + i * 36;
    c.fillStyle = 'rgba(255,255,255,0.1)';
    c.fillRect(24, y + 17, 464, 1);
    c.lineWidth = 1.8;
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    if (folder) {
      c.moveTo(30, y - 6);
      c.lineTo(38, y - 6);
      c.lineTo(41, y - 2);
      c.lineTo(52, y - 2);
      c.lineTo(52, y + 10);
      c.lineTo(30, y + 10);
      c.closePath();
    } else {
      c.moveTo(34, y - 7);
      c.lineTo(44, y - 7);
      c.lineTo(50, y - 1);
      c.lineTo(50, y + 10);
      c.lineTo(34, y + 10);
      c.closePath();
    }
    c.stroke();
    text(c, name, 66, y + 2, 17, 0.95);
    text(c, message, 250, y + 2, 15, 0.5);
    text(c, `${i + 2}d`, 480, y + 2, 14, 0.4, 'right');
  });

  // language bar
  const parts: Array<[number, string]> = [
    [0.62, 'rgba(111,224,168,0.95)'],
    [0.24, 'rgba(240,166,83,0.95)'],
    [0.14, 'rgba(149,185,230,0.95)'],
  ];
  let x = 28;
  for (const [share, colour] of parts) {
    const w = share * 456;
    c.fillStyle = colour;
    c.fillRect(x, 346, w - 3, 8);
    x += w;
  }
  return canvas;
}
