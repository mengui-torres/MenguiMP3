(() => {
  "use strict";

  // ---------- IndexedDB ----------
  const DB_NAME = "practica-bateria";
  const DB_VERSION = 2;
  const SONGS_STORE = "songs";
  const PLAYLISTS_STORE = "playlists";
  const DEFAULT_PLAYLIST_NAME = "Tus canciones";
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const tx = event.target.transaction;

        if (!db.objectStoreNames.contains(SONGS_STORE)) {
          db.createObjectStore(SONGS_STORE, { keyPath: "id", autoIncrement: true });
        }

        if (event.oldVersion < 2) {
          const playlists = db.createObjectStore(PLAYLISTS_STORE, { keyPath: "id", autoIncrement: true });
          const addReq = playlists.add({ name: DEFAULT_PLAYLIST_NAME, createdAt: Date.now() });
          addReq.onsuccess = () => {
            const defaultId = addReq.result;
            const cursorReq = tx.objectStore(SONGS_STORE).openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              const record = cursor.value;
              if (record.playlistId == null) {
                record.playlistId = defaultId;
                record.position = record.position != null ? record.position : record.addedAt;
                cursor.update(record);
              }
              cursor.continue();
            };
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // ---------- Playlists CRUD ----------
  async function addPlaylist(name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, "readwrite");
      const req = tx.objectStore(PLAYLISTS_STORE).add({ name, createdAt: Date.now() });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllPlaylists() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, "readonly");
      const req = tx.objectStore(PLAYLISTS_STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function renamePlaylist(id, name) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PLAYLISTS_STORE, "readwrite");
      const store = tx.objectStore(PLAYLISTS_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return;
        record.name = name;
        store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deletePlaylist(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([PLAYLISTS_STORE, SONGS_STORE], "readwrite");
      tx.objectStore(PLAYLISTS_STORE).delete(id);
      const cursorReq = tx.objectStore(SONGS_STORE).openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        if (cursor.value.playlistId === id) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- Songs CRUD ----------
  async function addSong(name, blob, playlistId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SONGS_STORE, "readwrite");
      const now = Date.now();
      const req = tx.objectStore(SONGS_STORE).add({
        name, blob, playlistId, addedAt: now, duration: null, position: now,
      });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getSongsByPlaylist(playlistId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SONGS_STORE, "readonly");
      const req = tx.objectStore(SONGS_STORE).getAll();
      req.onsuccess = () => {
        resolve(req.result.filter((s) => s.playlistId === playlistId).sort((a, b) => a.position - b.position));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSong(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SONGS_STORE, "readwrite");
      tx.objectStore(SONGS_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateSongDuration(id, duration) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SONGS_STORE, "readwrite");
      const store = tx.objectStore(SONGS_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result;
        if (!record) return resolve();
        record.duration = duration;
        store.put(record);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function swapSongPositions(idA, posA, idB, posB) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SONGS_STORE, "readwrite");
      const store = tx.objectStore(SONGS_STORE);
      const reqA = store.get(idA);
      reqA.onsuccess = () => {
        const recA = reqA.result;
        recA.position = posB;
        store.put(recA);
      };
      const reqB = store.get(idB);
      reqB.onsuccess = () => {
        const recB = reqB.result;
        recB.position = posA;
        store.put(recB);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---------- State ----------
  const state = {
    songs: [],
    playlists: [],
    activePlaylistId: null,
    currentId: null,
    currentPlaylistId: null,
    objectUrl: null,
    loopA: null,
    loopB: null,
    loopEnabled: false,
    playMode: "none", // "none" | "sequential" | "repeatSong"
  };

  // ---------- DOM ----------
  const el = {
    addBtn: document.getElementById("addBtn"),
    fileInput: document.getElementById("fileInput"),
    songTitle: document.getElementById("songTitle"),
    seek: document.getElementById("seek"),
    curTime: document.getElementById("curTime"),
    durTime: document.getElementById("durTime"),
    markerA: document.getElementById("markerA"),
    markerB: document.getElementById("markerB"),
    loopRange: document.getElementById("loopRange"),
    back10: document.getElementById("back10"),
    back5: document.getElementById("back5"),
    fwd5: document.getElementById("fwd5"),
    fwd10: document.getElementById("fwd10"),
    playPause: document.getElementById("playPause"),
    setA: document.getElementById("setA"),
    setB: document.getElementById("setB"),
    toggleLoop: document.getElementById("toggleLoop"),
    clearLoop: document.getElementById("clearLoop"),
    modeSequential: document.getElementById("modeSequential"),
    modeRepeatSong: document.getElementById("modeRepeatSong"),
    speed: document.getElementById("speed"),
    speedValue: document.getElementById("speedValue"),
    playlistTabs: document.getElementById("playlistTabs"),
    activePlaylistName: document.getElementById("activePlaylistName"),
    renamePlaylistBtn: document.getElementById("renamePlaylistBtn"),
    deletePlaylistBtn: document.getElementById("deletePlaylistBtn"),
    songList: document.getElementById("songList"),
    libraryEmpty: document.getElementById("libraryEmpty"),
    audio: document.getElementById("audio"),
  };

  const playerControls = [
    el.seek, el.back10, el.back5, el.fwd5, el.fwd10, el.playPause,
    el.setA, el.setB, el.speed, el.modeSequential, el.modeRepeatSong,
  ];

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function setPreservesPitch(audio) {
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;
  }

  // ---------- Playlist tabs ----------
  async function renderPlaylistTabs() {
    state.playlists = await getAllPlaylists();
    el.playlistTabs.innerHTML = "";

    for (const pl of state.playlists) {
      const btn = document.createElement("button");
      btn.className = "tab-pill" + (pl.id === state.activePlaylistId ? " active" : "");
      btn.textContent = pl.name;
      btn.addEventListener("click", () => selectPlaylist(pl.id));
      el.playlistTabs.appendChild(btn);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "tab-pill tab-add";
    addBtn.textContent = "＋";
    addBtn.setAttribute("aria-label", "Nueva lista de reproducción");
    addBtn.addEventListener("click", createPlaylist);
    el.playlistTabs.appendChild(addBtn);

    const active = state.playlists.find((p) => p.id === state.activePlaylistId);
    el.activePlaylistName.textContent = active ? active.name : "";
    el.deletePlaylistBtn.disabled = state.playlists.length <= 1;
  }

  async function selectPlaylist(id) {
    state.activePlaylistId = id;
    await renderPlaylistTabs();
    await refreshLibrary();
  }

  async function createPlaylist() {
    const name = prompt("Nombre de la nueva lista de reproducción:");
    if (!name || !name.trim()) return;
    const id = await addPlaylist(name.trim());
    state.activePlaylistId = id;
    await renderPlaylistTabs();
    await refreshLibrary();
  }

  el.renamePlaylistBtn.addEventListener("click", async () => {
    const active = state.playlists.find((p) => p.id === state.activePlaylistId);
    if (!active) return;
    const name = prompt("Nuevo nombre para la lista:", active.name);
    if (!name || !name.trim()) return;
    await renamePlaylist(active.id, name.trim());
    await renderPlaylistTabs();
  });

  el.deletePlaylistBtn.addEventListener("click", async () => {
    if (state.playlists.length <= 1) return;
    const active = state.playlists.find((p) => p.id === state.activePlaylistId);
    if (!active) return;
    const ok = confirm(`¿Eliminar la lista "${active.name}" y todas sus canciones? Esta acción no se puede deshacer.`);
    if (!ok) return;
    await deletePlaylist(active.id);
    if (state.currentPlaylistId === active.id) resetPlayer();
    state.playlists = await getAllPlaylists();
    state.activePlaylistId = state.playlists[0].id;
    await renderPlaylistTabs();
    await refreshLibrary();
  });

  // ---------- Library rendering ----------
  async function refreshLibrary() {
    state.songs = await getSongsByPlaylist(state.activePlaylistId);
    el.libraryEmpty.classList.toggle("hidden", state.songs.length > 0);
    el.songList.innerHTML = "";

    state.songs.forEach((song, index) => {
      const li = document.createElement("li");
      li.className = "song-item" + (song.id === state.currentId ? " playing" : "");
      li.dataset.id = song.id;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = song.name;

      const dur = document.createElement("span");
      dur.className = "dur";
      dur.textContent = song.duration ? formatTime(song.duration) : "";

      const up = document.createElement("button");
      up.className = "reorder-btn";
      up.textContent = "▲";
      up.setAttribute("aria-label", "Subir " + song.name);
      up.disabled = index === 0;
      up.addEventListener("click", async (e) => {
        e.stopPropagation();
        const prev = state.songs[index - 1];
        await swapSongPositions(song.id, song.position, prev.id, prev.position);
        refreshLibrary();
      });

      const down = document.createElement("button");
      down.className = "reorder-btn";
      down.textContent = "▼";
      down.setAttribute("aria-label", "Bajar " + song.name);
      down.disabled = index === state.songs.length - 1;
      down.addEventListener("click", async (e) => {
        e.stopPropagation();
        const next = state.songs[index + 1];
        await swapSongPositions(song.id, song.position, next.id, next.position);
        refreshLibrary();
      });

      const del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.setAttribute("aria-label", "Eliminar " + song.name);
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteSong(song.id);
        if (state.currentId === song.id) resetPlayer();
        refreshLibrary();
      });

      li.appendChild(name);
      li.appendChild(dur);
      li.appendChild(up);
      li.appendChild(down);
      li.appendChild(del);
      li.addEventListener("click", () => loadSong(song));
      el.songList.appendChild(li);

      if (song.duration == null) {
        probeDuration(song);
      }
    });
  }

  function probeDuration(song) {
    const tmp = new Audio();
    const url = URL.createObjectURL(song.blob);
    tmp.preload = "metadata";
    tmp.src = url;
    tmp.addEventListener("loadedmetadata", () => {
      updateSongDuration(song.id, tmp.duration).then(refreshLibrary);
      URL.revokeObjectURL(url);
    });
  }

  // ---------- Player ----------
  function resetPlayer() {
    state.currentId = null;
    state.currentPlaylistId = null;
    state.loopA = null;
    state.loopB = null;
    state.loopEnabled = false;
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    el.audio.removeAttribute("src");
    el.songTitle.textContent = "Selecciona una canción";
    playerControls.forEach((c) => (c.disabled = true));
    el.toggleLoop.disabled = true;
    el.clearLoop.disabled = true;
    el.playPause.textContent = "▶";
    updateLoopUI();
  }

  function loadSong(song) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.currentId = song.id;
    state.currentPlaylistId = song.playlistId;
    state.loopA = null;
    state.loopB = null;
    state.loopEnabled = false;
    state.objectUrl = URL.createObjectURL(song.blob);
    el.audio.src = state.objectUrl;
    setPreservesPitch(el.audio);
    el.audio.playbackRate = Number(el.speed.value) / 100;
    el.songTitle.textContent = song.name;

    playerControls.forEach((c) => (c.disabled = false));
    el.toggleLoop.disabled = true;
    el.clearLoop.disabled = true;
    updateLoopUI();
    updateModeUI();

    el.audio.play().catch(() => {});
    [...el.songList.children].forEach((li) => {
      li.classList.toggle("playing", Number(li.dataset.id) === song.id);
    });
  }

  function clampTime(t) {
    const d = el.audio.duration || 0;
    return Math.min(Math.max(t, 0), d);
  }

  function updateLoopUI() {
    const d = el.audio.duration || 0;
    const hasA = state.loopA != null;
    const hasB = state.loopB != null;

    el.markerA.classList.toggle("hidden", !hasA);
    el.markerB.classList.toggle("hidden", !hasB);
    el.loopRange.classList.toggle("hidden", !(hasA && hasB));

    if (hasA && d > 0) {
      el.markerA.style.left = (state.loopA / d) * 100 + "%";
    }
    if (hasB && d > 0) {
      el.markerB.style.left = (state.loopB / d) * 100 + "%";
    }
    if (hasA && hasB && d > 0) {
      const start = Math.min(state.loopA, state.loopB);
      const end = Math.max(state.loopA, state.loopB);
      el.loopRange.style.left = (start / d) * 100 + "%";
      el.loopRange.style.width = ((end - start) / d) * 100 + "%";
      el.toggleLoop.disabled = false;
      el.clearLoop.disabled = false;
    } else {
      el.toggleLoop.disabled = true;
    }
    el.toggleLoop.classList.toggle("active", state.loopEnabled);
  }

  function updateModeUI() {
    el.modeSequential.classList.toggle("active", state.playMode === "sequential");
    el.modeRepeatSong.classList.toggle("active", state.playMode === "repeatSong");
  }

  // ---------- Events: file input ----------
  el.addBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", async () => {
    const files = [...el.fileInput.files];
    for (const file of files) {
      const name = file.name.replace(/\.mp3$/i, "");
      await addSong(name, file, state.activePlaylistId);
    }
    el.fileInput.value = "";
    refreshLibrary();
  });

  // ---------- Events: transport ----------
  el.playPause.addEventListener("click", () => {
    if (el.audio.paused) el.audio.play().catch(() => {});
    else el.audio.pause();
  });

  el.audio.addEventListener("play", () => (el.playPause.textContent = "⏸"));
  el.audio.addEventListener("pause", () => (el.playPause.textContent = "▶"));

  el.audio.addEventListener("ended", async () => {
    el.playPause.textContent = "▶";

    if (state.playMode === "repeatSong") {
      el.audio.currentTime = 0;
      el.audio.play().catch(() => {});
      return;
    }

    if (state.playMode === "sequential" && state.currentPlaylistId != null) {
      const list = await getSongsByPlaylist(state.currentPlaylistId);
      const idx = list.findIndex((s) => s.id === state.currentId);
      const next = idx >= 0 ? list[idx + 1] : null;
      if (next) loadSong(next);
    }
  });

  el.back10.addEventListener("click", () => (el.audio.currentTime = clampTime(el.audio.currentTime - 10)));
  el.back5.addEventListener("click", () => (el.audio.currentTime = clampTime(el.audio.currentTime - 5)));
  el.fwd5.addEventListener("click", () => (el.audio.currentTime = clampTime(el.audio.currentTime + 5)));
  el.fwd10.addEventListener("click", () => (el.audio.currentTime = clampTime(el.audio.currentTime + 10)));

  el.audio.addEventListener("loadedmetadata", () => {
    el.durTime.textContent = formatTime(el.audio.duration);
    updateLoopUI();
  });

  let seeking = false;
  el.seek.addEventListener("input", () => {
    seeking = true;
    const d = el.audio.duration || 0;
    el.audio.currentTime = (Number(el.seek.value) / 1000) * d;
  });
  el.seek.addEventListener("change", () => (seeking = false));

  el.audio.addEventListener("timeupdate", () => {
    const d = el.audio.duration || 0;
    if (d > 0 && !seeking) {
      el.seek.value = String((el.audio.currentTime / d) * 1000);
    }
    el.curTime.textContent = formatTime(el.audio.currentTime);

    if (state.loopEnabled && state.loopA != null && state.loopB != null) {
      const start = Math.min(state.loopA, state.loopB);
      const end = Math.max(state.loopA, state.loopB);
      if (el.audio.currentTime >= end) {
        el.audio.currentTime = start;
      }
    }
  });

  // ---------- Events: loop markers ----------
  el.setA.addEventListener("click", () => {
    state.loopA = el.audio.currentTime;
    updateLoopUI();
  });
  el.setB.addEventListener("click", () => {
    state.loopB = el.audio.currentTime;
    updateLoopUI();
  });
  el.toggleLoop.addEventListener("click", () => {
    state.loopEnabled = !state.loopEnabled;
    updateLoopUI();
  });
  el.clearLoop.addEventListener("click", () => {
    state.loopA = null;
    state.loopB = null;
    state.loopEnabled = false;
    updateLoopUI();
  });

  // ---------- Events: playback mode ----------
  el.modeSequential.addEventListener("click", () => {
    state.playMode = state.playMode === "sequential" ? "none" : "sequential";
    updateModeUI();
  });
  el.modeRepeatSong.addEventListener("click", () => {
    state.playMode = state.playMode === "repeatSong" ? "none" : "repeatSong";
    updateModeUI();
  });

  // ---------- Events: speed ----------
  function applySpeed(raw) {
    const rate = raw / 100;
    el.audio.playbackRate = rate;
    setPreservesPitch(el.audio);
    el.speedValue.textContent = rate.toFixed(2) + "×";
  }
  el.speed.addEventListener("input", () => applySpeed(Number(el.speed.value)));
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = Number(btn.dataset.speed);
      el.speed.value = String(v);
      applySpeed(v);
    });
  });

  // ---------- Init ----------
  async function init() {
    resetPlayer();
    updateModeUI();
    state.playlists = await getAllPlaylists();
    state.activePlaylistId = state.playlists[0].id;
    await renderPlaylistTabs();
    await refreshLibrary();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch(() => {});
      });
    }
  }
  init();
})();
