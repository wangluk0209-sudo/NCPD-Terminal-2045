(() => {
  const WORLD_UNITS_PER_PARSEC = 100;

  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');

  const pauseBtn = document.getElementById('pauseBtn');
  const speed1Btn = document.getElementById('speed1');
  const speed5Btn = document.getElementById('speed5');
  const speed20Btn = document.getElementById('speed20');

  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const resetViewBtn = document.getElementById('resetView');

  const emptyState = document.getElementById('emptyState');
  const entityCard = document.getElementById('entityCard');
  const entityName = document.getElementById('entityName');
  const entityType = document.getElementById('entityType');
  const entityCode = document.getElementById('entityCode');
  const entityDescription = document.getElementById('entityDescription');

  const routeFrom = document.getElementById('routeFrom');
  const routeTo = document.getElementById('routeTo');
  const addRouteBtn = document.getElementById('addRoute');
  const clearRoutesBtn = document.getElementById('clearRoutes');

  const state = {
    data: null,
    zoom: 0.5,
    panX: 0,
    panY: 0,
    dragging: false,
    dragStartX: 0,
    dragStartY: 0,
    selectedId: null,
    hitTargets: [],
    simSeconds: 0,
    lastFrameTs: 0,
    paused: false,
    timeScale: 1,
    worldPositions: new Map(),
    customRoutes: []
  };

  const degToRad = (deg) => (deg * Math.PI) / 180;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function toScreen(worldX, worldY) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const tilt = state.data.view.pseudo3dTilt;

    return {
      x: cx + worldX * state.zoom + state.panX,
      y: cy + worldY * state.zoom * tilt + state.panY
    };
  }

  function toCanvasCoords(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function registerHit(id, x, y, radius) {
    state.hitTargets.push({ id, x, y, radius });
  }

  function worldPositionAtTime(entity) {
    const dynamicAngle = entity.initialAngle + state.simSeconds * entity.angularSpeed * 60;
    const angle = degToRad(dynamicAngle);
    return {
      x: Math.cos(angle) * entity.orbitRadius,
      y: Math.sin(angle) * entity.orbitRadius * (entity.pseudo3dScale || 1)
    };
  }

  function staticOrbitPosition(entity) {
    const angle = degToRad(entity.initialAngle);
    return {
      x: Math.cos(angle) * entity.orbitRadius,
      y: Math.sin(angle) * entity.orbitRadius * (entity.pseudo3dScale || 1)
    };
  }

  function computeEntityPositions() {
    state.worldPositions.clear();
    state.worldPositions.set(state.data.star.id, { x: 0, y: 0 });
    state.worldPositions.set(state.data.primeRing.id, { x: 0, y: 0 });

    for (const world of state.data.worlds) {
      state.worldPositions.set(world.id, worldPositionAtTime(world));
    }

    for (const object of state.data.objects) {
      state.worldPositions.set(object.id, staticOrbitPosition(object));
    }
  }

  function getEntityWorldPosition(entityId) {
    return state.worldPositions.get(entityId) || null;
  }

  function worldDistance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.hypot(dx, dy);
  }

  function worldDistanceToParsecs(distance) {
    return Math.max(1, Math.round(distance / WORLD_UNITS_PER_PARSEC));
  }

  function drawDashedRoute(fromScreen, toScreenPos, parsecDashes, style) {
    const dx = toScreenPos.x - fromScreen.x;
    const dy = toScreenPos.y - fromScreen.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0.001) return;

    const ux = dx / length;
    const uy = dy / length;
    const gapRatio = 0.8;
    const dashLen = length / (parsecDashes + (parsecDashes - 1) * gapRatio);
    const gapLen = dashLen * gapRatio;

    ctx.save();
    ctx.lineCap = 'round';

    ctx.strokeStyle = style.glow;
    ctx.lineWidth = style.glowWidth;
    ctx.beginPath();
    ctx.moveTo(fromScreen.x, fromScreen.y);
    ctx.lineTo(toScreenPos.x, toScreenPos.y);
    ctx.stroke();

    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;

    for (let i = 0; i < parsecDashes; i += 1) {
      const start = i * (dashLen + gapLen);
      const end = start + dashLen;
      const sx = fromScreen.x + ux * start;
      const sy = fromScreen.y + uy * start;
      const ex = fromScreen.x + ux * end;
      const ey = fromScreen.y + uy * end;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }

    ctx.restore();
  }

  function routeStyle(route, isCustom = false) {
    if (isCustom) {
      return {
        color: '#67e8f9',
        glow: 'rgba(103, 232, 249, 0.18)',
        width: 2.0,
        glowWidth: 6.5
      };
    }

    if (route.isMain) {
      return {
        color: route.color || '#ffd680',
        glow: 'rgba(255, 214, 128, 0.24)',
        width: 2.6,
        glowWidth: 8
      };
    }

    return {
      color: route.color || '#f0b84f',
      glow: 'rgba(240, 184, 79, 0.14)',
      width: 1.8,
      glowWidth: 5.5
    };
  }

  function drawRoutes() {
    for (const route of state.data.officialRoutes) {
      const aWorld = getEntityWorldPosition(route.from);
      const bWorld = getEntityWorldPosition(route.to);
      if (!aWorld || !bWorld) continue;

      const parsecs = worldDistanceToParsecs(worldDistance(aWorld, bWorld));
      const a = toScreen(aWorld.x, aWorld.y);
      const b = toScreen(bWorld.x, bWorld.y);
      drawDashedRoute(a, b, parsecs, routeStyle(route, false));
    }

    for (const route of state.customRoutes) {
      const aWorld = getEntityWorldPosition(route.from);
      const bWorld = getEntityWorldPosition(route.to);
      if (!aWorld || !bWorld) continue;

      const parsecs = worldDistanceToParsecs(worldDistance(aWorld, bWorld));
      const a = toScreen(aWorld.x, aWorld.y);
      const b = toScreen(bWorld.x, bWorld.y);
      drawDashedRoute(a, b, parsecs, routeStyle(route, true));
    }
  }

  function drawSpaceStars() {
    ctx.save();
    for (let i = 0; i < 120; i += 1) {
      const x = (i * 97) % canvas.width;
      const y = (i * 57) % canvas.height;
      const r = ((i % 3) + 1) * 0.6;
      ctx.fillStyle = i % 5 === 0 ? '#9bb0cb' : '#6b7f9a';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawOrbit(radius, color = 'rgba(125,211,252,0.2)') {
    const center = toScreen(0, 0);
    const tilt = state.data.view.pseudo3dTilt;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, radius * state.zoom, radius * state.zoom * tilt, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawLabel(text, x, y) {
    ctx.fillStyle = '#dbe7f5';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText(text, x, y);
  }

  function drawStar() {
    const star = state.data.star;
    const center = toScreen(star.position.x, star.position.y);
    const radius = Math.max(8, star.render.radius * state.zoom * 0.22);

    const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.4, center.x, center.y, radius * 3.5);
    glow.addColorStop(0, 'rgba(255, 213, 108, 0.9)');
    glow.addColorStop(1, 'rgba(255, 213, 108, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 3.5, 0, Math.PI * 2);
    ctx.fill();

    const fill = ctx.createRadialGradient(center.x - radius * 0.3, center.y - radius * 0.3, radius * 0.3, center.x, center.y, radius);
    fill.addColorStop(0, star.render.palette[0]);
    fill.addColorStop(1, star.render.palette[2]);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();

    registerHit(star.id, center.x, center.y, radius + 6);
    drawLabel(star.name, center.x + 12, center.y - 12);
  }

  function drawPrimeRing() {
    const ring = state.data.primeRing;
    const center = toScreen(0, 0);
    const tilt = state.data.view.pseudo3dTilt;

    ctx.strokeStyle = '#f0b84f';
    ctx.lineWidth = Math.max(2, ring.render.ringThickness * state.zoom * 0.18);
    ctx.beginPath();
    ctx.ellipse(
      center.x,
      center.y,
      ring.render.ringRadiusX * state.zoom,
      ring.render.ringRadiusY * state.zoom * tilt,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();

    registerHit(ring.id, center.x + ring.render.ringRadiusX * state.zoom, center.y, 12);
    drawLabel(ring.name, center.x + ring.render.labelOffset.x * 0.45, center.y + ring.render.labelOffset.y * 0.45);
  }

  function drawBody(entity, x, y, radius, palette) {
    const gradient = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.35, radius * 0.2, x, y, radius);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(1, palette[palette.length - 1]);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (state.selectedId === entity.id) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    registerHit(entity.id, x, y, radius + 6);
  }

  function drawWorlds() {
    for (const world of state.data.worlds) {
      drawOrbit(world.orbitRadius);
      const pos = getEntityWorldPosition(world.id);
      if (!pos) continue;

      const screen = toScreen(pos.x, pos.y);
      const radius = Math.max(5, world.render.radius * state.zoom * 0.14);
      drawBody(world, screen.x, screen.y, radius, world.render.palette);
      drawLabel(world.name, screen.x + world.render.labelOffset.x * 0.35, screen.y + world.render.labelOffset.y * 0.35);
    }
  }

  function drawObjects() {
    for (const object of state.data.objects) {
      const pos = getEntityWorldPosition(object.id);
      if (!pos) continue;

      const screen = toScreen(pos.x, pos.y);

      if (object.render.kind === 'anomaly_ring') {
        const radius = Math.max(7, object.render.radius * state.zoom * 0.2);
        ctx.strokeStyle = '#a78bfa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        registerHit(object.id, screen.x, screen.y, radius + 6);
      } else if (object.render.kind === 'belt_cluster') {
        ctx.fillStyle = '#9aa6b2';
        for (let i = 0; i < 24; i += 1) {
          const ox = ((i * 13) % 40) - 20;
          const oy = ((i * 17) % 26) - 13;
          ctx.fillRect(screen.x + ox, screen.y + oy, 2, 2);
        }
        registerHit(object.id, screen.x, screen.y, 16);
      } else {
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(screen.x - 4, screen.y - 4, 8, 8);
        registerHit(object.id, screen.x, screen.y, 12);
      }

      drawLabel(object.name, screen.x + object.render.labelOffset.x * 0.35, screen.y + object.render.labelOffset.y * 0.35);
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.hitTargets = [];

    drawSpaceStars();
    drawRoutes();
    drawStar();
    drawPrimeRing();
    drawWorlds();
    drawObjects();
  }

  function findEntityById(id) {
    const all = [state.data.star, state.data.primeRing, ...state.data.worlds, ...state.data.objects];
    return all.find((item) => item.id === id) || null;
  }

  function showEntity(entityId) {
    const entity = findEntityById(entityId);
    if (!entity) return;

    state.selectedId = entity.id;
    emptyState.classList.add('hidden');
    entityCard.classList.remove('hidden');

    entityName.textContent = entity.name;
    entityType.textContent = `Тип: ${entity.type}`;
    entityCode.textContent = entity.code ? `Код: ${entity.code}` : 'Код: —';
    entityDescription.textContent = entity.shortDescription || entity.description || 'Описание отсутствует.';
  }

  function pickEntity(screenX, screenY) {
    for (let i = state.hitTargets.length - 1; i >= 0; i -= 1) {
      const target = state.hitTargets[i];
      const distance = Math.hypot(screenX - target.x, screenY - target.y);
      if (distance <= target.radius) {
        showEntity(target.id);
        return;
      }
    }
  }

  function applyZoom(nextZoom, focusX, focusY) {
    const minZoom = state.data.view.minZoom * 0.45;
    const maxZoom = state.data.view.maxZoom * 0.95;
    const clamped = clamp(nextZoom, minZoom, maxZoom);

    const scaleRatio = clamped / state.zoom;
    state.panX = focusX - (focusX - state.panX) * scaleRatio;
    state.panY = focusY - (focusY - state.panY) * scaleRatio;
    state.zoom = clamped;
  }

  function setSpeedButtonActive(button) {
    for (const btn of [speed1Btn, speed5Btn, speed20Btn]) {
      btn.classList.toggle('is-active', btn === button);
    }
  }

  function setupTimeControls() {
    pauseBtn.addEventListener('click', () => {
      state.paused = !state.paused;
      pauseBtn.setAttribute('aria-pressed', String(state.paused));
      pauseBtn.classList.toggle('is-active', state.paused);
      pauseBtn.textContent = state.paused ? 'Продолжить' : 'Пауза';
    });

    speed1Btn.addEventListener('click', () => {
      state.timeScale = 1;
      setSpeedButtonActive(speed1Btn);
    });

    speed5Btn.addEventListener('click', () => {
      state.timeScale = 5;
      setSpeedButtonActive(speed5Btn);
    });

    speed20Btn.addEventListener('click', () => {
      state.timeScale = 20;
      setSpeedButtonActive(speed20Btn);
    });
  }

  function saveCustomRoutes() {
    const key = state.data.userRouteConfig.customRouteStorageKey;
    localStorage.setItem(key, JSON.stringify(state.customRoutes));
  }

  function addCustomRoute(from, to) {
    if (!from || !to || from === to) return;

    const exists = state.customRoutes.some((route) =>
      (route.from === from && route.to === to) || (route.from === to && route.to === from)
    );

    if (exists) return;

    state.customRoutes.push({ from, to });
    saveCustomRoutes();
  }

  function setupRouteBuilder() {
    const entities = [state.data.primeRing, ...state.data.worlds, ...state.data.objects];
    const options = entities.map((entity) => `<option value="${entity.id}">${entity.name}</option>`).join('');

    routeFrom.innerHTML = options;
    routeTo.innerHTML = options;

    addRouteBtn.addEventListener('click', () => {
      addCustomRoute(routeFrom.value, routeTo.value);
    });

    clearRoutesBtn.addEventListener('click', () => {
      state.customRoutes = [];
      saveCustomRoutes();
    });
  }

  function setupInteractions() {
    canvas.addEventListener('click', (event) => {
      const { x, y } = toCanvasCoords(event);
      pickEntity(x, y);
    });

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const { x, y } = toCanvasCoords(event);
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      applyZoom(state.zoom * factor, x, y);
    }, { passive: false });

    canvas.addEventListener('mousedown', (event) => {
      state.dragging = true;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (event) => {
      if (!state.dragging) return;
      const dx = event.clientX - state.dragStartX;
      const dy = event.clientY - state.dragStartY;
      state.dragStartX = event.clientX;
      state.dragStartY = event.clientY;
      state.panX += dx * (canvas.width / canvas.getBoundingClientRect().width);
      state.panY += dy * (canvas.height / canvas.getBoundingClientRect().height);
    });

    window.addEventListener('mouseup', () => {
      state.dragging = false;
      canvas.style.cursor = 'default';
    });

    zoomInBtn.addEventListener('click', () => applyZoom(state.zoom * 1.15, canvas.width / 2, canvas.height / 2));
    zoomOutBtn.addEventListener('click', () => applyZoom(state.zoom * 0.85, canvas.width / 2, canvas.height / 2));
    resetViewBtn.addEventListener('click', () => {
      state.zoom = state.data.view.defaultZoom * 0.5;
      state.panX = 0;
      state.panY = 0;
    });
  }

  function frame(ts) {
    if (state.lastFrameTs === 0) state.lastFrameTs = ts;
    const delta = (ts - state.lastFrameTs) / 1000;
    state.lastFrameTs = ts;

    if (!state.paused) {
      state.simSeconds += delta * state.timeScale;
    }

    computeEntityPositions();
    render();
    requestAnimationFrame(frame);
  }

  function loadCustomRoutes() {
    const key = state.data.userRouteConfig.customRouteStorageKey;
    const raw = localStorage.getItem(key);
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && item.from && item.to);
    } catch {
      return [];
    }
  }

  async function init() {
    const response = await fetch('./data/helios.json');
    state.data = await response.json();

    state.zoom = state.data.view.defaultZoom * 0.5;
    state.customRoutes = loadCustomRoutes();

    computeEntityPositions();
    setupTimeControls();
    setupRouteBuilder();
    setupInteractions();
    requestAnimationFrame(frame);
  }

  init();
})();
