(() => {
  "use strict";

  // ---------- IndexedDB ----------
  const DB_NAME = "practica-bateria";
  const STORE = "songs";
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function addSong(name, blob) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const req = store.add({ name, blob, addedAt: Date.now(), duration: null });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllSongs() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result.sort((a, b) => a.addedAt - b.addedAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteSong(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function updateSongDuration(id, duration) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
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

  // ---------- State ----------
  const state = {
    songs: [],
    currentId: null,
    objectUrl: null,
    loopA: null,
    loopB: null,
    loopEnabled: false,
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
    speed: document.getElementById("speed"),
    speedValue: document.getElementById("speedValue"),
    songList: document.getElementById("songList"),
    libraryEmpty: document.getElementById("libraryEmpty"),
    audio: document.getElementById("audio"),
  };

  const playerControls = [
    el.seek, el.back10, el.back5, el.fwd5, el.fwd10, el.playPause,
    el.setA, el.setB, el.speed,
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

  // ---------- Library rendering ----------
  async function refreshLibrary() {
    state.songs = await getAllSongs();
    el.libraryEmpty.classList.toggle("hidden", state.songs.length > 0);
    el.songList.innerHTML = "";
    for (const song of state.songs) {
      const li = document.createElement("li");
      li.className = "song-item" + (song.id === state.currentId ? " playing" : "");
      li.dataset.id = song.id;

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = song.name;

      const dur = document.createElement("span");
      dur.className = "dur";
      dur.textContent = song.duration ? formatTime(song.duration) : "";

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
      li.appendChild(del);
      li.addEventListener("click", () => loadSong(song));
      el.songList.appendChild(li);

      if (song.duration == null) {
        probeDuration(song);
      }
    }
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

  // ---------- Events: file input ----------
  el.addBtn.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", async () => {
    const files = [...el.fileInput.files];
    for (const file of files) {
      const name = file.name.replace(/\.mp3$/i, "");
      await addSong(name, file);
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
  el.audio.addEventListener("ended", () => (el.playPause.textContent = "▶"));

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
  resetPlayer();
  refreshLibrary();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
