/**
 * Space Invaders — TypeScript IL game spec using @engine SDK.
 *
 * Classic space invaders with a grid of aliens marching side-to-side,
 * dropping down when hitting edges. Player ship at bottom fires bullets
 * upward; aliens fire bullets downward. Speed increases as aliens are
 * destroyed. Score per alien killed.
 */

import { defineGame } from '@engine/core';
import { consumeAction } from '@engine/input';
import {
  clearCanvas, drawRoundedRect, drawCircle,
  drawLabel, drawGameOver,
} from '@engine/render';
import { drawTouchOverlay } from '@engine/touch';
import { rectRectCollision, clamp } from '@engine/physics';

// ── Constants ───────────────────────────────────────────────────────

const CANVAS_W = 480;
const CANVAS_H = 560;

const PLAYER_W = 36;
const PLAYER_H = 20;
const PLAYER_Y = CANVAS_H - 50;
const PLAYER_SPEED = 5;

const BULLET_W = 3;
const BULLET_H = 10;
const BULLET_SPEED = 6;

const ALIEN_ROWS = 5;
const ALIEN_COLS = 10;
const ALIEN_W = 28;
const ALIEN_H = 20;
const ALIEN_GAP_X = 12;
const ALIEN_GAP_Y = 10;
const ALIEN_START_X = 30;
const ALIEN_START_Y = 60;
const ALIEN_DROP = 16;

const ALIEN_BULLET_W = 3;
const ALIEN_BULLET_H = 12;
const ALIEN_BULLET_SPEED = 3.5;
const ALIEN_FIRE_CHANCE = 0.008;

const ROW_POINTS = [30, 25, 20, 15, 10];
const ROW_COLORS = ['#E53935', '#FF9800', '#FDD835', '#4CAF50', '#42A5F5'];

const BG_COLOR = '#0a0a1a';
const PLAYER_COLOR = '#4CAF50';
const BULLET_COLOR = '#fff';
const ALIEN_BULLET_COLOR = '#FF5722';

const AI_MOVE_DELAY = 40;
const AI_FIRE_DELAY = 200;

// ── Game Definition ─────────────────────────────────────────────────

const game = defineGame({
  display: {
    type: 'custom',
    width: 16,
    height: 19,
    cellSize: 30,
    canvasWidth: CANVAS_W,
    canvasHeight: CANVAS_H,
    offsetX: 0,
    offsetY: 0,
    background: BG_COLOR,
  },
  input: {
    left:    { keys: ['ArrowLeft', 'a'] },
    right:   { keys: ['ArrowRight', 'd'] },
    select:  { keys: [' ', 'Enter'] },
    restart: { keys: ['r', 'R'] },
  },
});

// ── Resources ───────────────────────────────────────────────────────

game.resource('state', {
  score: 0,
  gameOver: false,
  won: false,
  lives: 3,
  level: 1,
});

game.resource('player', {
  x: CANVAS_W / 2 - PLAYER_W / 2,
  y: PLAYER_Y,
});

game.resource('aliens', {
  grid: [],       // [row][col] = { alive, color, points, x, y }
  dirX: 1,        // 1 = right, -1 = left
  speed: 0.6,
  moveAccum: 0,
  alive: ALIEN_ROWS * ALIEN_COLS,
  initialized: false,
});

game.resource('bullets', {
  player: [],     // [{ x, y }]
  alien: [],      // [{ x, y }]
});

game.resource('_aiTimer', { elapsed: 0, fireElapsed: 0 });

// ── Init System ─────────────────────────────────────────────────────

game.system('init', function initSystem(world, _dt) {
  var aliens = world.getResource('aliens');
  if (aliens.initialized) return;
  aliens.initialized = true;

  aliens.grid = [];
  for (var r = 0; r < ALIEN_ROWS; r++) {
    var row = [];
    for (var c = 0; c < ALIEN_COLS; c++) {
      row.push({
        alive: true,
        color: ROW_COLORS[r],
        points: ROW_POINTS[r],
        x: ALIEN_START_X + c * (ALIEN_W + ALIEN_GAP_X),
        y: ALIEN_START_Y + r * (ALIEN_H + ALIEN_GAP_Y),
      });
    }
    aliens.grid.push(row);
  }
  aliens.dirX = 1;
  aliens.speed = 0.6;
  aliens.moveAccum = 0;
  aliens.alive = ALIEN_ROWS * ALIEN_COLS;
});

// ── Restart System ──────────────────────────────────────────────────

game.system('restart', function restartSystem(world, _dt) {
  var input = world.getResource('input');
  var state = world.getResource('state');

  if (consumeAction(input, 'restart') && state.gameOver) {
    state.score = 0;
    state.gameOver = false;
    state.won = false;
    state.lives = 3;
    state.level = 1;

    var player = world.getResource('player');
    player.x = CANVAS_W / 2 - PLAYER_W / 2;

    var aliens = world.getResource('aliens');
    aliens.initialized = false;

    var bullets = world.getResource('bullets');
    bullets.player = [];
    bullets.alien = [];

    var timer = world.getResource('_aiTimer');
    timer.elapsed = 0;
    timer.fireElapsed = 0;
  }
});

// ── Player Input System ─────────────────────────────────────────────

game.system('playerInput', function playerInputSystem(world, _dt) {
  var gm = world.getResource('gameMode');
  if (!gm || gm.mode !== 'playerVsAi') return;

  var state = world.getResource('state');
  if (state.gameOver) return;

  var input = world.getResource('input');
  var player = world.getResource('player');
  var bullets = world.getResource('bullets');

  if (input.left) {
    player.x -= PLAYER_SPEED;
    input.left = false;
  }
  if (input.right) {
    player.x += PLAYER_SPEED;
    input.right = false;
  }
  player.x = clamp(player.x, 5, CANVAS_W - PLAYER_W - 5);

  if (consumeAction(input, 'select')) {
    if (bullets.player.length < 3) {
      bullets.player.push({
        x: player.x + PLAYER_W / 2 - BULLET_W / 2,
        y: player.y - BULLET_H,
      });
    }
  }
});

// ── AI System ───────────────────────────────────────────────────────

game.system('ai', function aiSystem(world, dt) {
  var gm = world.getResource('gameMode');
  if (gm && gm.mode === 'playerVsAi') return;

  var state = world.getResource('state');
  if (state.gameOver) return;

  var timer = world.getResource('_aiTimer');
  var player = world.getResource('player');
  var bullets = world.getResource('bullets');
  var aliens = world.getResource('aliens');

  timer.elapsed += dt;
  timer.fireElapsed += dt;

  // AI movement: track the lowest alive alien column center
  if (timer.elapsed >= AI_MOVE_DELAY) {
    timer.elapsed = 0;

    // Find the column with the lowest alive alien
    var bestCol = -1;
    var lowestY = -1;
    for (var r = ALIEN_ROWS - 1; r >= 0; r--) {
      for (var c = 0; c < ALIEN_COLS; c++) {
        if (aliens.grid.length > r && aliens.grid[r][c] && aliens.grid[r][c].alive) {
          if (aliens.grid[r][c].y > lowestY) {
            lowestY = aliens.grid[r][c].y;
            bestCol = c;
          }
        }
      }
      if (bestCol >= 0) break;
    }

    if (bestCol >= 0) {
      // Find the topmost alien in that column to aim at
      var targetX = 0;
      for (var r2 = 0; r2 < ALIEN_ROWS; r2++) {
        if (aliens.grid[r2] && aliens.grid[r2][bestCol] && aliens.grid[r2][bestCol].alive) {
          targetX = aliens.grid[r2][bestCol].x + ALIEN_W / 2 - PLAYER_W / 2;
          break;
        }
      }

      var diff = targetX - player.x;
      if (Math.abs(diff) > 3) {
        player.x += clamp(diff, -PLAYER_SPEED, PLAYER_SPEED);
      }
      player.x = clamp(player.x, 5, CANVAS_W - PLAYER_W - 5);
    }
  }

  // AI firing
  if (timer.fireElapsed >= AI_FIRE_DELAY) {
    timer.fireElapsed = 0;
    if (bullets.player.length < 2) {
      bullets.player.push({
        x: player.x + PLAYER_W / 2 - BULLET_W / 2,
        y: player.y - BULLET_H,
      });
    }
  }
});

// ── Alien Movement System ───────────────────────────────────────────

game.system('alienMove', function alienMoveSystem(world, dt) {
  var state = world.getResource('state');
  if (state.gameOver) return;

  var aliens = world.getResource('aliens');
  if (!aliens.initialized) return;

  // Speed scales with fewer aliens alive
  var speedMultiplier = 1 + (ALIEN_ROWS * ALIEN_COLS - aliens.alive) * 0.04;
  var moveAmount = aliens.speed * speedMultiplier * (dt / 16);

  // Check edges
  var hitEdge = false;
  for (var r = 0; r < ALIEN_ROWS; r++) {
    for (var c = 0; c < ALIEN_COLS; c++) {
      var a = aliens.grid[r][c];
      if (!a.alive) continue;
      var nextX = a.x + aliens.dirX * moveAmount;
      if (nextX <= 5 || nextX + ALIEN_W >= CANVAS_W - 5) {
        hitEdge = true;
        break;
      }
    }
    if (hitEdge) break;
  }

  if (hitEdge) {
    aliens.dirX *= -1;
    // Drop down
    for (var r2 = 0; r2 < ALIEN_ROWS; r2++) {
      for (var c2 = 0; c2 < ALIEN_COLS; c2++) {
        if (aliens.grid[r2][c2].alive) {
          aliens.grid[r2][c2].y += ALIEN_DROP;
        }
      }
    }
  } else {
    for (var r3 = 0; r3 < ALIEN_ROWS; r3++) {
      for (var c3 = 0; c3 < ALIEN_COLS; c3++) {
        if (aliens.grid[r3][c3].alive) {
          aliens.grid[r3][c3].x += aliens.dirX * moveAmount;
        }
      }
    }
  }

  // Check if aliens reached player level
  for (var r4 = 0; r4 < ALIEN_ROWS; r4++) {
    for (var c4 = 0; c4 < ALIEN_COLS; c4++) {
      if (aliens.grid[r4][c4].alive && aliens.grid[r4][c4].y + ALIEN_H >= PLAYER_Y - 10) {
        state.gameOver = true;
        state.won = false;
        return;
      }
    }
  }
});

// ── Alien Firing System ─────────────────────────────────────────────

game.system('alienFire', function alienFireSystem(world, dt) {
  var state = world.getResource('state');
  if (state.gameOver) return;

  var aliens = world.getResource('aliens');
  var bullets = world.getResource('bullets');

  // Each alive alien has a small chance to fire each frame
  for (var r = 0; r < ALIEN_ROWS; r++) {
    for (var c = 0; c < ALIEN_COLS; c++) {
      var a = aliens.grid[r][c];
      if (!a.alive) continue;

      // Only bottom-most alive alien in each column fires
      var isBottom = true;
      for (var r2 = r + 1; r2 < ALIEN_ROWS; r2++) {
        if (aliens.grid[r2][c].alive) { isBottom = false; break; }
      }
      if (!isBottom) continue;

      if (Math.random() < ALIEN_FIRE_CHANCE && bullets.alien.length < 8) {
        bullets.alien.push({
          x: a.x + ALIEN_W / 2 - ALIEN_BULLET_W / 2,
          y: a.y + ALIEN_H,
        });
      }
    }
  }
});

// ── Bullet Physics System ───────────────────────────────────────────

game.system('bulletPhysics', function bulletPhysicsSystem(world, dt) {
  var state = world.getResource('state');
  if (state.gameOver) return;

  var bullets = world.getResource('bullets');
  var aliens = world.getResource('aliens');
  var player = world.getResource('player');

  // Move player bullets upward
  for (var i = bullets.player.length - 1; i >= 0; i--) {
    var b = bullets.player[i];
    b.y -= BULLET_SPEED;

    // Off screen
    if (b.y + BULLET_H < 0) {
      bullets.player.splice(i, 1);
      continue;
    }

    // Check collision with aliens
    var hit = false;
    for (var r = 0; r < ALIEN_ROWS && !hit; r++) {
      for (var c = 0; c < ALIEN_COLS && !hit; c++) {
        var a = aliens.grid[r][c];
        if (!a.alive) continue;

        var col = rectRectCollision(b.x, b.y, BULLET_W, BULLET_H, a.x, a.y, ALIEN_W, ALIEN_H);
        if (col.hit) {
          a.alive = false;
          aliens.alive--;
          state.score += a.points;
          bullets.player.splice(i, 1);
          hit = true;
        }
      }
    }

    // Check win condition
    if (aliens.alive <= 0) {
      state.gameOver = true;
      state.won = true;
      state.score += 500;
    }
  }

  // Move alien bullets downward
  for (var j = bullets.alien.length - 1; j >= 0; j--) {
    var ab = bullets.alien[j];
    ab.y += ALIEN_BULLET_SPEED;

    // Off screen
    if (ab.y > CANVAS_H) {
      bullets.alien.splice(j, 1);
      continue;
    }

    // Check collision with player
    var pcol = rectRectCollision(ab.x, ab.y, ALIEN_BULLET_W, ALIEN_BULLET_H,
                                  player.x, player.y, PLAYER_W, PLAYER_H);
    if (pcol.hit) {
      bullets.alien.splice(j, 1);
      state.lives--;
      if (state.lives <= 0) {
        state.gameOver = true;
        state.won = false;
      }
    }
  }
});

// ── Render System ───────────────────────────────────────────────────

game.system('render', function renderSystem(world, _dt) {
  var renderer = world.getResource('renderer');
  if (!renderer) return;

  var ctx = renderer.ctx;
  var state = world.getResource('state');
  var player = world.getResource('player');
  var aliens = world.getResource('aliens');
  var bullets = world.getResource('bullets');

  clearCanvas(ctx, BG_COLOR);

  // ── Stars background ──
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.3;
  for (var s = 0; s < 40; s++) {
    var sx = (s * 97 + 13) % CANVAS_W;
    var sy = (s * 71 + 37) % (CANVAS_H - 80);
    ctx.fillRect(sx, sy, 1, 1);
  }
  ctx.globalAlpha = 1;

  // ── Title & HUD ──
  drawLabel(ctx, 'SPACE INVADERS', CANVAS_W / 2, 22, {
    color: '#fff', fontSize: 18, align: 'center',
  });
  drawLabel(ctx, 'Score: ' + state.score, 15, 42, {
    color: '#888', fontSize: 12,
  });
  drawLabel(ctx, 'Lives: ' + state.lives, CANVAS_W - 15, 42, {
    color: '#E53935', fontSize: 12, align: 'right',
  });

  // ── Draw aliens ──
  for (var r = 0; r < ALIEN_ROWS; r++) {
    for (var c = 0; c < ALIEN_COLS; c++) {
      var a = aliens.grid[r] && aliens.grid[r][c];
      if (!a || !a.alive) continue;

      drawRoundedRect(ctx, a.x, a.y, ALIEN_W, ALIEN_H, 4, a.color);

      // Eyes
      ctx.fillStyle = '#000';
      ctx.fillRect(a.x + 8, a.y + 6, 3, 4);
      ctx.fillRect(a.x + ALIEN_W - 11, a.y + 6, 3, 4);
    }
  }

  // ── Draw player ship ──
  drawRoundedRect(ctx, player.x, player.y, PLAYER_W, PLAYER_H, 4, PLAYER_COLOR);
  // Ship cannon
  drawRoundedRect(ctx, player.x + PLAYER_W / 2 - 2, player.y - 6, 4, 8, 2, '#81C784');

  // ── Draw player bullets ──
  for (var i = 0; i < bullets.player.length; i++) {
    var b = bullets.player[i];
    drawRoundedRect(ctx, b.x, b.y, BULLET_W, BULLET_H, 1, BULLET_COLOR);
  }

  // ── Draw alien bullets ──
  for (var j = 0; j < bullets.alien.length; j++) {
    var ab = bullets.alien[j];
    drawRoundedRect(ctx, ab.x, ab.y, ALIEN_BULLET_W, ALIEN_BULLET_H, 1, ALIEN_BULLET_COLOR);
  }

  // ── Ground line ──
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, CANVAS_H - 25);
  ctx.lineTo(CANVAS_W, CANVAS_H - 25);
  ctx.stroke();

  // ── Controls hint ──
  if (!state.gameOver) {
    drawLabel(ctx, '\u2190\u2192 move  SPACE fire  R restart', CANVAS_W / 2, CANVAS_H - 8, {
      color: '#444', fontSize: 11, align: 'center',
    });
  }

  // ── Game Over ──
  if (state.gameOver) {
    drawGameOver(ctx, 40, 100, CANVAS_W - 80, 300, {
      title: state.won ? 'VICTORY!' : 'GAME OVER',
      titleColor: state.won ? '#4CAF50' : '#E53935',
      subtitle: 'Score: ' + state.score + ' | Press R',
    });
  }

  drawTouchOverlay(ctx, ctx.canvas.width, ctx.canvas.height);
});

export default game;
