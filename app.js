(() => {
  const WORLD_UNITS_PER_PARSEC = 100;
  const STORAGE_KEYS = {
    customRoutes: 'helios_custom_routes',
    notes: 'helios_notes_bundle_v1',
    selected: 'helios_last_selected'
  };

  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');

  const pauseBtn = document.getElementById('pauseBtn');
  const speed1Btn = document.getElementById('speed1');
  const speed5Btn = document.getElementById('speed5');
  const speed20Btn = document.getElementById('speed20');

  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const resetViewBtn = document.getElementById('resetView');

  const tabButtons = {
    info: document.getElementById('tabInfo'),
    master: document.getElementById('tabMaster'),
    planets: document.getElementById('tabPlanets'),
    stations: document.getElementById('tabStations'),
    economy: document.getElementById('tabEconomy')
  };

  const panelSections = {
    info: document.getElementById('panelInfo'),
    master: document.getElementById('panelMaster'),
    planets: document.getElementById('panelPlanets'),
    stations: document.getElementById('panelStations'),
    economy: document.getElementById('panelEconomy')
  };

  const emptyState = document.getElementById('emptyState');
  const entityCard = document.getElementById('entityCard');
  const entityName = document.getElementById('entityName');
  const entityType = document.getElementById('entityType');
  const entityCode = document.getElementById('entityCode');
  const entityDescription = document.getElementById('entityDescription');
  const entityNotes = document.getElementById('entityNotes');
  const saveEntityNoteBtn = document.getElementById('saveEntityNote');
  const clearEntityNoteBtn = document.getElementById('clearEntityNote');

  const masterNotes = document.getElementById('masterNotes');
  const saveMasterNotesBtn = document.getElementById('saveMasterNotes');
  const economyNotes = document.getElementById('economyNotes');
  const saveEconomyNotesBtn = document.getElementById('saveEconomyNotes');
  const planetNotesList = document.getElementById('planetNotesList');
  const stationNotesList = document.getElementById('stationNotesList');

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
    customRoutes: [],
    activeTab: 'info',
    notes: {
      entity: {},
      master: '',
      economy: '',
      planets: {},
      stations: {}
    }
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
    return Math.hypot(b.x - a.x, b.y - a.y);
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
    const gapRatio = 0.72;
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
      ctx.beginPath();
      ctx.moveTo(fromScreen.x + ux * start, fromScreen.y + uy * start);
      ctx.lineTo(fromScreen.x + ux * end, fromScreen.y + uy * end);
      ctx.stroke();
    }
    ctx.restore();
  }

  function routeStyle(route, isCustom = false) {
    if (isCustom) return { color: '#67e8f9', glow: 'rgba(103,232,249,0.14)', width: 1.9, glowWidth: 5.8 };
    if (route.isMain) return { color: route.color || '#ffd680', glow: 'rgba(255,214,128,0.26)', width: 2.8, glowWidth: 8.4 };
    return { color: route.color || '#f0b84f', glow: 'rgba(240,184,79,0.14)', width: 1.9, glowWidth: 5.8 };
  }

  function drawRoutes() {
    for (const route of state.data.officialRoutes) {
      const from = getEntityWorldPosition(route.from);
      const to = getEntityWorldPosition(route.to);
      if (!from || !to) continue;
      const parsecs = worldDistanceToParsecs(worldDistance(from, to));
      drawDashedRoute(toScreen(from.x, from.y), toScreen(to.x, to.y), parsecs, routeStyle(route));
    }

    for (const route of state.customRoutes) {
      const from = getEntityWorldPosition(route.from);
      const to = getEntityWorldPosition(route.to);
      if (!from || !to) continue;
      const parsecs = worldDistanceToParsecs(worldDistance(from, to));
      drawDashedRoute(toScreen(from.x, from.y), toScreen(to.x, to.y), parsecs, routeStyle(route, true));
    }
  }

  function drawSpaceBackground() {
    const n1 = ctx.createRadialGradient(canvas.width * 0.24, canvas.height * 0.8, 0, canvas.width * 0.24, canvas.height * 0.8, canvas.width * 0.36);
    n1.addColorStop(0, 'rgba(86, 189, 255, 0.1)');
    n1.addColorStop(1, 'rgba(86, 189, 255, 0)');
    ctx.fillStyle = n1;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const n2 = ctx.createRadialGradient(canvas.width * 0.78, canvas.height * 0.2, 0, canvas.width * 0.78, canvas.height * 0.2, canvas.width * 0.32);
    n2.addColorStop(0, 'rgba(110, 96, 255, 0.1)');
    n2.addColorStop(1, 'rgba(110, 96, 255, 0)');
    ctx.fillStyle = n2;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 150; i += 1) {
      const x = (i * 79) % canvas.width;
      const y = (i * 53) % canvas.height;
      const r = ((i % 3) + 1) * 0.5;
      ctx.fillStyle = i % 4 === 0 ? 'rgba(183, 213, 250, 0.85)' : 'rgba(117, 141, 170, 0.7)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOrbit(radius, color = 'rgba(125,211,252,0.18)') {
    const c = toScreen(0, 0);
    const tilt = state.data.view.pseudo3dTilt;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, radius * state.zoom, radius * state.zoom * tilt, 0, 0, Math.PI * 2);
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
    const radius = Math.max(8, star.render.radius * state.zoom * 0.24);

    const glow = ctx.createRadialGradient(center.x, center.y, radius * 0.3, center.x, center.y, radius * 4);
    glow.addColorStop(0, 'rgba(255, 219, 140, 0.96)');
    glow.addColorStop(1, 'rgba(255, 219, 140, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 3.6, 0, Math.PI * 2);
    ctx.fill();

    const fill = ctx.createRadialGradient(center.x - radius * 0.4, center.y - radius * 0.45, radius * 0.25, center.x, center.y, radius);
    fill.addColorStop(0, star.render.palette[0]);
    fill.addColorStop(1, star.render.palette[3]);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fill();

    registerHit(star.id, center.x, center.y, radius + 6);
    drawLabel(star.name, center.x + 13, center.y - 12);
  }

  function drawPrimeRing() {
    const ring = state.data.primeRing;
    const center = toScreen(0, 0);
    const tilt = state.data.view.pseudo3dTilt;

    ctx.strokeStyle = 'rgba(240, 184, 79, 0.86)';
    ctx.lineWidth = Math.max(2, ring.render.ringThickness * state.zoom * 0.16);
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, ring.render.ringRadiusX * state.zoom, ring.render.ringRadiusY * state.zoom * tilt, 0, 0, Math.PI * 2);
    ctx.stroke();

    registerHit(ring.id, center.x + ring.render.ringRadiusX * state.zoom, center.y, 12);
    drawLabel(ring.name, center.x + ring.render.labelOffset.x * 0.45, center.y + ring.render.labelOffset.y * 0.45);
  }

  function drawWorldBody(entity, x, y, radius, palette) {
    const shadowY = radius * 0.45;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x + radius * 0.12, y + shadowY, radius * 0.9, radius * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    const gradient = ctx.createRadialGradient(x - radius * 0.45, y - radius * 0.45, radius * 0.2, x, y, radius * 1.05);
    gradient.addColorStop(0, palette[0]);
    gradient.addColorStop(0.45, palette[Math.min(1, palette.length - 1)]);
    gradient.addColorStop(1, palette[palette.length - 1]);

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(235, 245, 255, 0.24)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x - radius * 0.16, y - radius * 0.18, radius * 0.62, Math.PI * 1.1, Math.PI * 1.86);
    ctx.stroke();

    if (state.selectedId === entity.id) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    registerHit(entity.id, x, y, radius + 6);
  }

  function drawStationGlyph(x, y) {
    ctx.save();
    ctx.strokeStyle = 'rgba(137, 229, 255, 0.95)';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
    ctx.lineWidth = 1.3;

    ctx.beginPath();
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x + 7, y - 2);
    ctx.lineTo(x + 4, y + 7);
    ctx.lineTo(x - 4, y + 7);
    ctx.lineTo(x - 7, y - 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 10, y);
    ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 11);
    ctx.lineTo(x, y + 11);
    ctx.stroke();
    ctx.restore();
  }

  function drawWorlds() {
    for (const world of state.data.worlds) {
      drawOrbit(world.orbitRadius);
      const pos = getEntityWorldPosition(world.id);
      if (!pos) continue;
      const screen = toScreen(pos.x, pos.y);
      const radius = Math.max(5, world.render.radius * state.zoom * 0.14);
      drawWorldBody(world, screen.x, screen.y, radius, world.render.palette);
      drawLabel(world.name, screen.x + world.render.labelOffset.x * 0.35, screen.y + world.render.labelOffset.y * 0.35);
    }
  }

  function drawObjects() {
    for (const object of state.data.objects) {
      const pos = getEntityWorldPosition(object.id);
      if (!pos) continue;
      const screen = toScreen(pos.x, pos.y);

      if (object.render.kind === 'anomaly_ring') {
        const radius = Math.max(8, object.render.radius * state.zoom * 0.2);
        ctx.strokeStyle = 'rgba(182, 151, 255, 0.92)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        registerHit(object.id, screen.x, screen.y, radius + 6);
      } else if (object.render.kind === 'belt_cluster') {
        ctx.fillStyle = 'rgba(189, 203, 216, 0.78)';
        for (let i = 0; i < 24; i += 1) {
          const ox = ((i * 13) % 40) - 20;
          const oy = ((i * 17) % 26) - 13;
          ctx.fillRect(screen.x + ox, screen.y + oy, 2, 2);
        }
        registerHit(object.id, screen.x, screen.y, 16);
      } else {
        drawStationGlyph(screen.x, screen.y);
        if (state.selectedId === object.id) {
          ctx.strokeStyle = '#e2e8f0';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, 14, 0, Math.PI * 2);
          ctx.stroke();
        }
        registerHit(object.id, screen.x, screen.y, 14);
      }

      drawLabel(object.name, screen.x + object.render.labelOffset.x * 0.35, screen.y + object.render.labelOffset.y * 0.35);
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.hitTargets = [];
    drawSpaceBackground();
    drawRoutes();
    drawStar();
    drawPrimeRing();
    drawWorlds();
    drawObjects();
  }

  function getAllEntities() {
    return [state.data.star, state.data.primeRing, ...state.data.worlds, ...state.data.objects];
  }

  function findEntityById(id) {
    return getAllEntities().find((item) => item.id === id) || null;
  }

  function getEntityNoteKey(entity) {
    return entity.notesKey || entity.id;
  }

  function saveNotesBundle() {
    localStorage.setItem(STORAGE_KEYS.notes, JSON.stringify(state.notes));
  }

  function showEntity(entityId) {
    const entity = findEntityById(entityId);
    if (!entity) return;

    state.selectedId = entity.id;
    localStorage.setItem(STORAGE_KEYS.selected, entity.id);

    emptyState.classList.add('hidden');
    entityCard.classList.remove('hidden');

    entityName.textContent = entity.name;
    entityType.textContent = `Тип: ${entity.type}`;
    entityCode.textContent = entity.code ? `Код: ${entity.code}` : 'Код: —';
    entityDescription.textContent = entity.shortDescription || entity.description || 'Описание отсутствует.';
    entityNotes.value = state.notes.entity[getEntityNoteKey(entity)] || '';
  }

  function pickEntity(screenX, screenY) {
    for (let i = state.hitTargets.length - 1; i >= 0; i -= 1) {
      const target = state.hitTargets[i];
      if (Math.hypot(screenX - target.x, screenY - target.y) <= target.radius) {
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

  function setActiveTab(tabName) {
    state.activeTab = tabName;
    for (const [key, button] of Object.entries(tabButtons)) {
      button.classList.toggle('is-active', key === tabName);
    }
    for (const [key, panel] of Object.entries(panelSections)) {
      panel.classList.toggle('is-active', key === tabName);
    }
  }

  function setupTabs() {
    tabButtons.info.addEventListener('click', () => setActiveTab('info'));
    tabButtons.master.addEventListener('click', () => setActiveTab('master'));
    tabButtons.planets.addEventListener('click', () => setActiveTab('planets'));
    tabButtons.stations.addEventListener('click', () => setActiveTab('stations'));
    tabButtons.economy.addEventListener('click', () => setActiveTab('economy'));
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
    localStorage.setItem(STORAGE_KEYS.customRoutes, JSON.stringify(state.customRoutes));
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

  function renderEntityNotesPanels() {
    const worldItems = state.data.worlds.map((world) => `
      <div class="notes-item">
        <label for="planet_note_${world.id}">${world.name}</label>
        <textarea id="planet_note_${world.id}" data-planet-note-id="${world.id}" rows="4" placeholder="Заметка по планете"></textarea>
      </div>
    `).join('');
    planetNotesList.innerHTML = worldItems;

    const stationObjects = state.data.objects.filter((obj) => obj.type.includes('station') || obj.type.includes('shipyard') || obj.type.includes('fort'));
    const stationItems = stationObjects.map((station) => `
      <div class="notes-item">
        <label for="station_note_${station.id}">${station.name}</label>
        <textarea id="station_note_${station.id}" data-station-note-id="${station.id}" rows="4" placeholder="Заметка по станции"></textarea>
      </div>
    `).join('');
    stationNotesList.innerHTML = stationItems;

    for (const textarea of planetNotesList.querySelectorAll('textarea[data-planet-note-id]')) {
      const id = textarea.dataset.planetNoteId;
      textarea.value = state.notes.planets[id] || '';
      textarea.addEventListener('input', () => {
        state.notes.planets[id] = textarea.value;
        saveNotesBundle();
      });
    }

    for (const textarea of stationNotesList.querySelectorAll('textarea[data-station-note-id]')) {
      const id = textarea.dataset.stationNoteId;
      textarea.value = state.notes.stations[id] || '';
      textarea.addEventListener('input', () => {
        state.notes.stations[id] = textarea.value;
        saveNotesBundle();
      });
    }
  }

  function setupNotes() {
    saveEntityNoteBtn.addEventListener('click', () => {
      const entity = findEntityById(state.selectedId);
      if (!entity) return;
      state.notes.entity[getEntityNoteKey(entity)] = entityNotes.value;
      saveNotesBundle();
    });

    clearEntityNoteBtn.addEventListener('click', () => {
      const entity = findEntityById(state.selectedId);
      if (!entity) return;
      delete state.notes.entity[getEntityNoteKey(entity)];
      entityNotes.value = '';
      saveNotesBundle();
    });

    masterNotes.value = state.notes.master || '';
    saveMasterNotesBtn.addEventListener('click', () => {
      state.notes.master = masterNotes.value;
      saveNotesBundle();
    });

    economyNotes.value = state.notes.economy || '';
    saveEconomyNotesBtn.addEventListener('click', () => {
      state.notes.economy = economyNotes.value;
      saveNotesBundle();
    });

    renderEntityNotesPanels();
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
    const raw = localStorage.getItem(STORAGE_KEYS.customRoutes);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && item.from && item.to);
    } catch {
      return [];
    }
  }

  function loadNotes() {
    const raw = localStorage.getItem(STORAGE_KEYS.notes);
    if (!raw) return { entity: {}, master: '', economy: '', planets: {}, stations: {} };
    try {
      const parsed = JSON.parse(raw);
      return {
        entity: parsed.entity && typeof parsed.entity === 'object' ? parsed.entity : {},
        master: typeof parsed.master === 'string' ? parsed.master : '',
        economy: typeof parsed.economy === 'string' ? parsed.economy : '',
        planets: parsed.planets && typeof parsed.planets === 'object' ? parsed.planets : {},
        stations: parsed.stations && typeof parsed.stations === 'object' ? parsed.stations : {}
      };
    } catch {
      return { entity: {}, master: '', economy: '', planets: {}, stations: {} };
    }
  }

  async function init() {
    const response = await fetch('./data/helios.json');
    state.data = await response.json();

    state.zoom = state.data.view.defaultZoom * 0.5;
    state.customRoutes = loadCustomRoutes();
    state.notes = loadNotes();

    computeEntityPositions();
    setupTabs();
    setupTimeControls();
    setupRouteBuilder();
    setupNotes();
    setupInteractions();

    const lastSelected = localStorage.getItem(STORAGE_KEYS.selected);
    if (lastSelected && findEntityById(lastSelected)) {
      showEntity(lastSelected);
    }

    requestAnimationFrame(frame);
  }

  init();
})();
