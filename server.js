const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

const WORLD = 2000;
const MAX_PLAYERS = 30;
const REFRESH_MS = 5 * 60 * 1000; // تجديد السرقات كل 5 دقائق

const BUILDINGS = [
  { id: 'bank',  x: 850,  y: 160,  w: 300, h: 200, col: '#d97706', title: '🏦 البنك' },
  { id: 'jewel', x: 1480, y: 320,  w: 240, h: 180, col: '#7c3aed', title: '💎 المجوهرات' },
  { id: 'ware',  x: 240,  y: 340,  w: 260, h: 200, col: '#475569', title: '📦 المستودعات' },
  { id: 'tech',  x: 260,  y: 1120, w: 230, h: 180, col: '#0284c7', title: '📱 الإلكترونيات' },
  { id: 'store', x: 1460, y: 1140, w: 230, h: 180, col: '#ea580c', title: '🏪 المتجر' }
];

const SELL_ZONES = [
  { x: 1000, y: 1750, r: 85, title: '💰 بيع الغنائم (الجنوب)' },
  { x: 1000, y: 980,  r: 75, title: '💰 بيع الغنائم (الوسط)' }
];

const LOOTS = [
  { id: 1, x: 930,  y: 390,  name: '🪙 ذهب البنك',    val: 450, takenUntil: 0 },
  { id: 2, x: 1070, y: 390,  name: '💵 خزنة البنك',   val: 550, takenUntil: 0 },
  { id: 3, x: 1600, y: 530,  name: '💎 مجوهرات',      val: 350, takenUntil: 0 },
  { id: 4, x: 370,  y: 570,  name: '📦 صناديق نادرة', val: 240, takenUntil: 0 },
  { id: 5, x: 375,  y: 1330, name: '📱 أجهزة ذكية',   val: 280, takenUntil: 0 },
  { id: 6, x: 1575, y: 1350, name: '🛒 بضاعة متجر',   val: 160, takenUntil: 0 }
];

const players = {};
const bullets = [];

function resolveWalls(ent) {
  ent.x = Math.max(20, Math.min(WORLD - 20, ent.x));
  ent.y = Math.max(20, Math.min(WORLD - 20, ent.y));
  for (const b of BUILDINGS) {
    const cx = Math.max(b.x, Math.min(ent.x, b.x + b.w));
    const cy = Math.max(b.y, Math.min(ent.y, b.y + b.h));
    const dx = ent.x - cx, dy = ent.y - cy, d = Math.hypot(dx, dy);
    if (d < 18) {
      if (d === 0) { ent.x += 18; continue; }
      ent.x += (dx / d) * (18 - d);
      ent.y += (dy / d) * (18 - d);
    }
  }
}

io.on('connection', (socket) => {
  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit('roomFull');
    socket.disconnect();
    return;
  }

  socket.on('join', (name) => {
    players[socket.id] = {
      id: socket.id,
      name: String(name || 'لاعب').slice(0, 14),
      x: 900 + Math.random() * 200,
      y: 1550 + Math.random() * 100,
      angle: 0,
      hp: 100,
      cash: 0,
      bag: [],
      bagCap: 4,
      bagLv: 1,
      col: `hsl(${Math.floor(Math.random() * 360)}, 75%, 55%)`,
      vx: 0, vy: 0, shootCd: 0
    };
    socket.emit('init', { id: socket.id, WORLD, BUILDINGS, SELL_ZONES });
  });

  socket.on('input', (inp) => {
    const p = players[socket.id];
    if (!p || !inp) return;
    const mag = Math.hypot(inp.x || 0, inp.y || 0);
    if (mag > 0.05) {
      const nx = inp.x / Math.max(1, mag), ny = inp.y / Math.max(1, mag);
      p.vx = nx * 240; p.vy = ny * 240;
      p.angle = Math.atan2(ny, nx);
    } else {
      p.vx = 0; p.vy = 0;
    }
  });

  socket.on('shoot', () => {
    const p = players[socket.id];
    if (!p || p.shootCd > 0) return;
    p.shootCd = 0.35;
    bullets.push({
      owner: socket.id,
      x: p.x + Math.cos(p.angle) * 24,
      y: p.y + Math.sin(p.angle) * 24,
      vx: Math.cos(p.angle) * 580,
      vy: Math.sin(p.angle) * 580,
      life: 1.0
    });
  });

  socket.on('interact', () => {
    const p = players[socket.id];
    if (!p) return;
    const now = Date.now();

    for (const s of SELL_ZONES) {
      if (Math.hypot(p.x - s.x, p.y - s.y) < s.r && p.bag.length > 0) {
        const earned = p.bag.reduce((sum, it) => sum + it.val, 0);
        p.cash += earned;
        p.bag = [];
        socket.emit('msg', `💵 بعت الغنائم بـ $${earned}!`);
        return;
      }
    }

    for (const l of LOOTS) {
      if (now >= l.takenUntil && Math.hypot(p.x - l.x, p.y - l.y) < 55) {
        if (p.bag.length >= p.bagCap) {
          socket.emit('msg', '🎒 الحقيبة ممتلئة! توجه لبيع الغنائم');
          return;
        }
        l.takenUntil = now + REFRESH_MS;
        p.bag.push({ name: l.name, val: l.val });
        socket.emit('msg', `💰 أخذت ${l.name} ($${l.val})`);
        return;
      }
    }
  });

  socket.on('upgradeBag', () => {
    const p = players[socket.id];
    if (!p || p.bagLv >= 5) return;
    const cost = p.bagLv * 400;
    if (p.cash >= cost) {
      p.cash -= cost;
      p.bagLv++;
      p.bagCap += 3;
      socket.emit('msg', `🎒 تم تطوير الحقيبة إلى ${p.bagCap} خانات!`);
    } else {
      socket.emit('msg', `💵 تحتاج $${cost} لتطوير الحقيبة!`);
    }
  });

  socket.on('disconnect', () => { delete players[socket.id]; });
});

const DT = 0.05;
setInterval(() => {
  const now = Date.now();
  for (const id in players) {
    const p = players[id];
    if (p.shootCd > 0) p.shootCd -= DT;
    p.x += p.vx * DT; p.y += p.vy * DT;
    resolveWalls(p);
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * DT; b.y += b.vy * DT; b.life -= DT;
    let remove = b.life <= 0 || b.x < 0 || b.x > WORLD || b.y < 0 || b.y > WORLD;
    if (!remove) {
      for (const bd of BUILDINGS) {
        if (b.x > bd.x && b.x < bd.x + bd.w && b.y > bd.y && b.y < bd.y + bd.h) { remove = true; break; }
      }
    }
    if (!remove) {
      for (const id in players) {
        if (id === b.owner) continue;
        const p = players[id];
        if (Math.hypot(b.x - p.x, b.y - p.y) < 20) {
          p.hp -= 25; remove = true;
          if (p.hp <= 0) {
            p.bag = [];
            p.hp = 100;
            p.x = 900 + Math.random() * 200; p.y = 1580;
            io.to(id).emit('msg', '🚨 هُزمت! خسرت الغنائم التي في حقيبتك');
          }
          break;
        }
      }
    }
    if (remove) bullets.splice(i, 1);
  }

  io.emit('state', {
    players,
    bullets,
    loots: LOOTS.map(l => ({
      ...l,
      ready: now >= l.takenUntil,
      leftSec: Math.max(0, Math.ceil((l.takenUntil - now) / 1000))
    }))
  });
}, 50);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('\n🚀 سيرفر HEIST CLASH شغال بنجاح!');
  if (!fs.existsSync(path.join(publicDir, 'index.html'))) {
    console.log('⚠️ تنبيه: لم يتم العثور على ملف index.html داخل مجلد public!');
  }
  console.log(`💻 من اللابتوب: http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`📱 من متصفح الجوالين (نفس الواي فاي): http://${net.address}:${PORT}`);
      }
    }
  }
});
