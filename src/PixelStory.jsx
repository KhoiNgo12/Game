import React, { useEffect, useMemo, useRef, useState } from "react";

/** 8-Bit Storytelling Game — Day/Night + more characters + bigger story
 *  - Time advances every choice. Click “Wait ☀/☾” to advance manually.
 *  - Some choices require { time: "day" | "night" } or items.
 *  - Interconnected questlines: Festival/Curfew (Town), Obelisk/Well (Forest), Vault (Cave), Eclipse finale.
 */

export default function PixelStory() {
  const SAVE_KEY = "pixel_story_save_v1";

  const initialState = useMemo(
    () => ({
      node: "intro",
      hp: 5,
      coins: 0,
      karma: 0,
      items: {},
      history: [],
      seed: makeSeed(),
      tick: 0,
      time: "day",
      uses: {},
      rngOnce: {},
      fx: { hitTrigger: 0, hitVisible: false, omen: 0 },
    }),
    []
  );

  const [state, setState] = useState(initialState);
  const [loaded, setLoaded] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [openItemId, setOpenItemId] = useState(null);
  const [started, setStarted] = useState(false);
  const audioRef = useRef({});

  function startGame() {
    setStarted(true);
    // kick BG music on the user gesture if sound is ON
    const a = audioRef.current;
    if (soundOn && a?.bg) a.bg.play().catch(() => {});
  }

  // --- Audio state ---
  const [soundOn, setSoundOn] = useState(true);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("sound_on");
      if (saved === null)
        localStorage.setItem("sound_on", "1"); // default ON first run
      else setSoundOn(saved === "1"); // respect previous choice
    } catch {}
  }, []);

  // Day/Night cycle length (used by weather)
  const CYCLE_LEN = 8;
  // Compute weather BEFORE any effects that depend on it
  const weather = useMemo(
    () => weatherOf(state.seed, state.tick, CYCLE_LEN),
    [state.seed, state.tick]
  );

  // NEW: track active one-shot SFX clones so we can stop them on OFF
  const activeSfxRef = useRef(new Set());

  // NEW: flag to stop combat on the first scene change after it starts
  const combatActiveRef = useRef(false);

  // NEW: keep latest values inside event listeners
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  // keep latest time for event handlers (combat ended, etc.)
  const timeRef = useRef(state.time);
  useEffect(() => {
    timeRef.current = state.time;
  }, [state.time]);

  // --- Master volume (persisted) ---
  const readVol = (k, def) => {
    if (typeof window === "undefined") return def;
    const v = parseFloat(localStorage.getItem(k));
    return Number.isFinite(v) ? v : def;
  };

  const [volMusic, setVolMusic] = useState(() => readVol("vol_music", 0.8));
  const [volSfx, setVolSfx] = useState(() => readVol("vol_sfx", 1.0));
  const [volNpc, setVolNpc] = useState(() => readVol("vol_npc", 1.0));

  const clamp01 = (n) => Math.max(0, Math.min(1, n));
  function getVolumeFor(name) {
    const base = SOUND_VOL[name] ?? 0.7;
    const group = SOUND_GROUP[name] || "sfx";
    const mult =
      group === "music" ? volMusic : group === "npc" ? volNpc : volSfx;
    return clamp01(base * mult);
  }

  /* === ADD THIS BLOCK HERE === */
  // optional rain flag you can flip later from story/UI
  const rainOnRef = useRef(false);

  // generic loop toggler
  function setAmbient(name, on) {
    const a = audioRef.current?.[name];
    if (!a) return;
    if (on && soundOn) {
      a.volume = getVolumeFor(name);
      a.play().catch(() => {});
    } else {
      a.pause();
      try {
        a.currentTime = 0;
      } catch {}
    }
  }

  // turn Night ambience on/off with time
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    // stop both first to avoid any overlap
    a.bg?.pause();
    a.night?.pause();

    if (!soundOn || combatActiveRef.current) return;

    if (state.time === "night") {
      if (a.night) {
        a.night.volume = getVolumeFor("night");
        a.night.play().catch(() => {});
      }
    } else {
      if (a.bg) {
        a.bg.volume = getVolumeFor("bg");
        a.bg.play().catch(() => {});
      }
    }
  }, [state.time, soundOn, volMusic]);

  useEffect(() => {
    setAmbient("rain", weather === "rain" || weather === "storm");
    setAmbient("wind", weather === "storm");
  }, [weather, soundOn, volMusic]);

  // Create <audio> elements once
  // Keep bg music in sync with toggle
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    if (soundOn) {
      // Only one base layer at a time unless combat is active
      if (!combatActiveRef.current) {
        if (state.time === "night") {
          a.bg?.pause();
          if (a.night) {
            a.night.volume = getVolumeFor("night");
            a.night.play().catch(() => {});
          }
        } else {
          a.night?.pause();
          if (a.bg) {
            a.bg.volume = getVolumeFor("bg");
            a.bg.play().catch(() => {});
          }
        }
      }
      if (rainOnRef.current) a.rain?.play().catch(() => {});
    } else {
      a.bg?.pause();
      a.night?.pause();
      a.rain?.pause();
      a.wind?.pause();
      if (a.combat) {
        a.combat.pause();
        a.combat.currentTime = 0;
      }
      combatActiveRef.current = false;
      activeSfxRef.current.forEach((el) => {
        el.pause();
        try {
          el.currentTime = 0;
        } catch {}
      });
      activeSfxRef.current.clear();
    }

    try {
      localStorage.setItem("sound_on", soundOn ? "1" : "0");
    } catch {}
  }, [soundOn, state.time]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    if (a.bg) a.bg.volume = getVolumeFor("bg");
    if (a.night) a.night.volume = getVolumeFor("night");
    if (a.rain) a.rain.volume = getVolumeFor("rain");
    if (a.wind) a.wind.volume = getVolumeFor("wind");

    if (a.combat) {
      a.combat.volume = getVolumeFor("combat");
      // If music is effectively muted, stop combat and resume correct base layer
      if (a.combat.volume <= 0.0001 && !a.combat.paused) {
        a.combat.pause();
        a.combat.currentTime = 0;
        combatActiveRef.current = false;
        if (soundOn) {
          if (state.time === "night" && a.night && getVolumeFor("night") > 0) {
            a.night.play().catch(() => {});
          } else if (a.bg && getVolumeFor("bg") > 0) {
            a.bg.play().catch(() => {});
          }
        }
      }
    }
  }, [volMusic, soundOn, state.time]);

  useEffect(() => {
    const a = {};
    for (const [name, src] of Object.entries(SOUND_FILES)) {
      const el = new Audio(src);
      el.preload = "auto";
      el.volume = clamp01(SOUND_VOL[name] ?? 0.7);
      if (
        name === "bg" ||
        name === "night" ||
        name === "rain" ||
        name === "wind"
      ) {
        el.loop = true;
      }
      a[name] = el;
    }

    // resume proper base layer after combat ends
    if (a.combat) {
      a.combat.addEventListener("ended", () => {
        combatActiveRef.current = false;
        if (!soundOnRef.current) return;
        if (timeRef.current === "night") {
          a.night?.play().catch(() => {});
        } else {
          a.bg?.play().catch(() => {});
        }
      });
    }

    audioRef.current = a;

    if (soundOnRef.current) {
      if (state.time === "night") {
        a.night?.play().catch(() => {});
      } else {
        a.bg?.play().catch(() => {});
      }
      if (rainOnRef.current) a.rain?.play().catch(() => {});
    }

    return () => {
      Object.values(a).forEach((el) => {
        el.pause();
        el.src = "";
      });
      activeSfxRef.current.forEach((el) => el.pause());
      activeSfxRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function playSfx(name) {
    if (!soundOnRef.current) return;
    const el = audioRef.current[name];
    if (!el) return;

    if (name === "combat") {
      playCombatTrack();
      return;
    }

    const copy = el.cloneNode(true);
    copy.volume = getVolumeFor(name);
    copy._sfxName = name;
    copy._sfxGroup = SOUND_GROUP[name] || "sfx";
    copy._spawnNode = state.node;
    copy._spawnTick = state.tick;

    activeSfxRef.current.add(copy);
    copy.addEventListener("ended", () => activeSfxRef.current.delete(copy));
    copy.play().catch(() => activeSfxRef.current.delete(copy));
  }

  function playClick() {
    playSfx("click");
  }

  function toggleSound() {
    setSoundOn((v) => !v);
  }

  function playCombatTrack() {
    const a = audioRef.current;
    if (!a?.combat) return;

    // If music slider is 0 or sound is OFF, don't start combat
    if (!soundOn || getVolumeFor("combat") <= 0) return;

    combatActiveRef.current = true;

    // Pause base layers while combat runs
    a.bg?.pause();
    a.night?.pause();

    // If already playing, restart from the top (prevents layering)
    if (!a.combat.paused) {
      try {
        a.combat.currentTime = 0;
      } catch {}
    } else {
      a.combat.volume = getVolumeFor("combat");
      a.combat.play().catch(() => {});
    }
  }

  useEffect(() => {
    const a = audioRef.current;
    if (!a?.combat) return;

    // If combat is currently active, this node change means we left the fight.
    if (!a.combat.paused && combatActiveRef.current) {
      combatActiveRef.current = false;
      a.combat.pause();
      a.combat.currentTime = 0;

      // Resume the right ambience for the current phase
         if (!soundOn) return;
         if (state.time === "night") {
           if (a.night && getVolumeFor("night") > 0) {
             a.night.volume = getVolumeFor("night");
             a.night.play().catch(() => {});
           }
         } else {
           if (a.bg && getVolumeFor("bg") > 0) {
             a.bg.volume = getVolumeFor("bg");
             a.bg.play().catch(() => {});
           }
         }
        } 
      }, [state.node, state.time, soundOn]);

  // Play queued SFX (set by takeChoice)
  useEffect(() => {
    const sfxQ = state.fx?.sfxQueue || [];
    if (!sfxQ.length) return;
    sfxQ.forEach((n) => playSfx(n));
    // clear the queue
    setState((s) => ({ ...s, fx: { ...(s.fx || {}), sfxQueue: [] } }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fx?.sfxTrigger]);

  // Stop lingering NPC voice lines when the scene changes
  const prevNodeRef = useRef(state.node);
  const prevTickRef = useRef(state.tick);

  useEffect(() => {
    const prevNode = prevNodeRef.current;
    const prevTick = prevTickRef.current;

    activeSfxRef.current.forEach((el) => {
      const isOldScene =
        (el._spawnNode && el._spawnNode === prevNode) ||
        (typeof el._spawnTick === "number" && el._spawnTick <= prevTick);

      if (el._sfxGroup === "npc" && isOldScene) {
        try {
          el.pause();
          el.currentTime = 0;
        } catch {}
        activeSfxRef.current.delete(el);
      }
    });

    prevNodeRef.current = state.node;
    prevTickRef.current = state.tick;
  }, [state.node, state.tick]);

  // close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setConfirmRestart(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load save
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) setState((s) => ({ ...s, ...JSON.parse(raw) }));
    } catch {}
    setLoaded(true);
  }, []);

  // Persist save
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(serializeForSave(state)));
    } catch {}
  }, [state, loaded]);

  // Save sliders as they change
  useEffect(
    () => localStorage.setItem("vol_music", String(volMusic)),
    [volMusic]
  );
  useEffect(() => localStorage.setItem("vol_sfx", String(volSfx)), [volSfx]);
  useEffect(() => localStorage.setItem("vol_npc", String(volNpc)), [volNpc]);

  // Keep background track volume in sync with the Music slider
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.bg) a.bg.volume = getVolumeFor("bg");
    if (a.combat) a.combat.volume = getVolumeFor("combat");
    if (a.night) a.night.volume = getVolumeFor("night");
    if (a.rain) a.rain.volume = getVolumeFor("rain");
    if (a.wind) a.wind.volume = getVolumeFor("wind");

    if (getVolumeFor("combat") <= 0 && a.combat && !a.combat.paused) {
      a.combat.pause();
      a.combat.currentTime = 0;
      combatActiveRef.current = false;
    }
  }, [volMusic]);

  /* === Weather-aware volume ducking (music vs ambience) === */
  // how hard to duck the background track when weather is active
  const WX_MUSIC_DUCK = { rain: 0.35, storm: 0.22 };

  function applyWeatherVolumes() {
    const a = audioRef.current;
    if (!a) return;

    // pick a ducking factor based on current weather
    const duck = WX_MUSIC_DUCK[weather] ?? 1;

    // 1) Duck the background music during rain/storm, restore otherwise
    if (a.bg) a.bg.volume = clamp01(getVolumeFor("bg") * duck);

    // 2) Keep ambience audible (slightly hotter in storms)
    if (a.rain)
      a.rain.volume = clamp01(
        getVolumeFor("rain") * (weather === "storm" ? 1.15 : 1)
      );
    if (a.wind)
      a.wind.volume = clamp01(
        getVolumeFor("wind") * (weather === "storm" ? 1.2 : 1)
      );

    // 3) Leave night bed alone (it already mixes well)
    if (a.night) a.night.volume = clamp01(getVolumeFor("night"));
  }

  // re-apply mix whenever weather or music slider changes
  useEffect(() => {
    applyWeatherVolumes();
  }, [weather, volMusic]);

  const story = useMemo(() => buildStory(), []);
  const node = story[state.node];
  const available = (node?.choices || []).filter((c) =>
    meetsReq(state, c.require)
  );
  const isEnding = node?.type === "ending" || state.hp <= 0;
  const PATH_MAX = 60; // how many steps to keep in memory
  const SAVE_HISTORY_MAX = 30; // how many *lite* steps to persist

  const night = state.time === "night";

  // Schedule lightning during storms
  const [lightningKey, setLightningKey] = useState(0);
  useEffect(() => {
    if (!started || weather !== "storm" || !soundOn) return;
    let alive = true,
      t;
    const loop = () => {
      const next = 1800 + Math.random() * 5200;
      t = setTimeout(() => {
        if (!alive) return;
        setLightningKey((k) => k + 1);
        loop();
      }, next);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [weather, started, soundOn]);

  useEffect(() => {
    if (!started || weather !== "storm" || !soundOn) return;
    const delay = 80 + Math.random() * 320; // ms
    const t = setTimeout(() => {
      if (soundOnRef.current) playSfx("thunder");
    }, delay);
    return () => clearTimeout(t);
  }, [lightningKey, weather, started, soundOn]);

  // ---------- FX timers (TOP-LEVEL HOOKS) ----------
  const hitTimersRef = useRef([]);

  // 1) Clear any previous flash when the scene (node) changes
  useEffect(() => {
    hitTimersRef.current.forEach(clearTimeout);
    hitTimersRef.current = [];
    if (state.fx?.hitVisible) {
      setState((s) => ({ ...s, fx: { ...s.fx, hitVisible: false } }));
    }
  }, [state.node]);

  // 2) Start a flash when the damage trigger increments
  useEffect(() => {
    const trigger = state.fx?.hitTrigger ?? 0;
    if (!trigger) return;

    const BURSTS = 3;
    const ON_MS = 250;
    const GAP_MS = 1000;

    for (let i = 0; i < BURSTS; i++) {
      const tOn = setTimeout(() => {
        setState((s) => ({ ...s, fx: { ...s.fx, hitVisible: true } }));
      }, i * GAP_MS);

      const tOff = setTimeout(() => {
        setState((s) => ({ ...s, fx: { ...s.fx, hitVisible: false } }));
      }, i * GAP_MS + ON_MS);

      hitTimersRef.current.push(tOn, tOff);
    }

    return () => {
      hitTimersRef.current.forEach(clearTimeout);
      hitTimersRef.current = [];
    };
  }, [state.fx?.hitTrigger]);

  // --- Actions ---
  function restart(hard = false) {
    stopAllAudio(); // <-- stop anything ringing out
    if (hard) {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}
    }
    setState((s) =>
      hard
        ? { ...initialState, seed: makeSeed() }
        : { ...initialState, seed: s.seed }
    );
  }

  function stopAllAudio() {
    const a = audioRef.current;
    if (!a) return;
    a.bg?.pause();
    a.night?.pause();
    a.rain?.pause();
    a.wind?.pause();
    if (a.combat) {
      a.combat.pause();
      a.combat.currentTime = 0;
    }
    combatActiveRef.current = false;
    activeSfxRef.current.forEach((el) => {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {}
    });
    activeSfxRef.current.clear();
  }

  function backOne() {
    setState((s) => {
      const h = [...s.history];
      const last = h.pop();
      if (!last) return s;
      const snapshot = last.snapshot; // lightweight snapshot
      return { ...s, ...snapshot, history: h };
    });
  }

  function advanceTime(steps = 1) {
    setState((s) => {
      const nextTick = s.tick + steps;
      return { ...s, tick: nextTick, time: timeOf(nextTick) };
    });
  }

  function takeChoice(choice) {
    setState((s) => {
      // Make a *shallow* snapshot for undo, without recursively nesting history
      const { history: _ignore, ...snapshot } = s; // drop history inside snapshot

      let next = { ...s };
      // --- SFX detection bucket ---
      const sfx = new Set();

      // Apply stat/item deltas + mark SFX
      if (choice.set) {
        for (const [k, v] of Object.entries(choice.set)) {
          if (k === "items") {
            const before = { ...(next.items || {}) };
            next.items = { ...next.items, ...v };
            // any newly-true item counts as a collect
            if (Object.entries(v).some(([ik, iv]) => iv && !before[ik])) {
              sfx.add("collect");
            }
            continue;
          }

          const prev = next[k] ?? 0;
          const newVal = clampNumber(prev + Number(v));
          next[k] = newVal;

          if (k === "hp") {
            if (newVal > prev) sfx.add("collect"); // HP gain
            if (newVal < prev) sfx.add("damage"); // HP loss
          } else if (k === "coins") {
            if (newVal > prev) sfx.add("collect"); // coin gain
          } else if (k === "karma") {
            if (Number(v) > 0) sfx.add("collect"); // positive karma only
          }
          // all other fields: no collect sound
        }
      }

      // Decide destination first (so we can inspect it)
      const dest = resolveGoto(choice.to, next);
      const destDef = story[dest];

      // Heuristic: combat-y button texts
      if (
        /fight|draw sword|patrol/i.test(choice.text) &&
        destDef?.type !== "ending"
      ) {
        sfx.add("combat");
      }

      // --- FX: red flash if HP went down this click
      const hpWentDown = next.hp < s.hp;
      if (hpWentDown) {
        next.fx = {
          ...(next.fx || {}),
          hitTrigger: (next.fx?.hitTrigger || 0) + 1,
        };
      }

      // Random minor coin drip if current node marks rng
      // Random minor coin drip
      const currentNode = story[s.node];
      if (currentNode?.rng) {
        const r = rng(`${next.seed}:${next.tick}`);
        if (r() < 0.35) {
          next.coins += 1;
          sfx.add("collect");
        }
      }

      // Record limited-usage gates (phaseOnce / limit)
      const req = choice.require || {};
      if (req.phaseOnce) {
        const key = scopeKey(next, req.phaseOnce, "phase");
        next.uses = { ...next.uses, [key]: (next.uses?.[key] ?? 0) + 1 };
      }
      if (req.limit?.id) {
        const key = scopeKey(next, req.limit.id, req.limit.scope || "run");
        next.uses = { ...next.uses, [key]: (next.uses?.[key] ?? 0) + 1 };
      }

      // --- Scene-based SFX
      if (dest === "meet_beggar") sfx.add("beggar");

      // dying this click → play FAIL (and suppress the normal damage grunt)
      const diedNow = next.hp <= 0 && s.hp > 0;
      if (diedNow) {
        sfx.delete("damage"); // avoid double-up
        sfx.add("fail");
      }

      // jingle on endings
      if (destDef?.type === "ending") {
        const GOOD_ENDINGS = new Set([
          "good_end",
          "harmony_end",
          "eclipse_keeper_end",
          "dawn_warden_end",
        ]);
        const BAD_ENDINGS = new Set([
          "bad_end",
          "moon_cursed_end",
          "power_end",
          "shadow_sovereign_end",
        ]);

        if (GOOD_ENDINGS.has(dest)) sfx.add("victory");
        else if (BAD_ENDINGS.has(dest)) sfx.add("defeated");
      }

      // Character / creature cue by NPC type
      const npcCue = {
        wolf: "wolf",
        spider: "spider",
        witch: "witch",
        spirit: "spirit",
        innkeeper: "innkeeper",
        ranger: "ranger",
        golem: "golem",
        vendor: "vendor",
        owl: "owl",
        guard: "guard",
        blacksmith: "blacksmith",
        beggar: "beggar",
      };
      const cue = npcCue[destDef?.npc];
      if (cue) sfx.add(cue);

      // --- Ending/omen influence (compute BEFORE using)
      const ENDING_KEYS = new Set([
        "feather",
        "glyph_sun",
        "glyph_moon",
        "sigil",
        "writ",
      ]);
      let affectsEnding = !!choice.set?.karma;

      if (choice.set?.items) {
        for (const k of Object.keys(choice.set.items)) {
          if (ENDING_KEYS.has(k)) {
            affectsEnding = true;
            break;
          }
        }
      }
      if (destDef?.type === "ending" || dest === "eclipse_gate")
        affectsEnding = true;

      // Trigger omen FX if relevant
      if (affectsEnding) {
        next.fx = { ...(next.fx || {}), omen: (next.fx?.omen || 0) + 1 };
      }
      // queue SFX (so useEffect on fx.sfxTrigger will play them)
      if (sfx.size) {
        next.fx = {
          ...(next.fx || {}),
          sfxQueue: [...(next.fx?.sfxQueue || []), ...Array.from(sfx)],
          sfxTrigger: (next.fx?.sfxTrigger || 0) + 1,
        };
      }

      // Move to next node
      next.node = dest;

      // advance time
      next.tick = next.tick + 1;
      next.time = timeOf(next.tick);

      // push a *compact* history entry, keep only last PATH_MAX
      const historyEntry = {
        node: s.node,
        choiceText: choice.text,
        time: Date.now(),
        snapshot,
      };
      next.history = [...next.history, historyEntry].slice(-PATH_MAX);

      return next;
    });
  }

  function cycleOf(tick) {
    return Math.floor(tick / CYCLE_LEN);
  }

  function scopeKey(state, id, scope = "run") {
    const cyc = cycleOf(state.tick);
    if (scope === "phase") return `${id}|phase|${state.time}|${cyc}`; // once per day or night
    if (scope === "cycle") return `${id}|cycle|${cyc}`; // once per full cycle
    return `${id}|run`; // once per run
  }

  function summarizePath(history, currentNode, maxSegments = 20) {
    const nodes = [...history.map((h) => h.node), currentNode].filter(Boolean);
    if (!nodes.length) return "";
    const segs = [];
    let run = 1;
    for (let i = 1; i <= nodes.length; i++) {
      if (i < nodes.length && nodes[i] === nodes[i - 1]) run++;
      else {
        segs.push(run > 1 ? `${nodes[i - 1]}×${run}` : nodes[i - 1]);
        run = 1;
      }
    }
    const hidden = Math.max(0, segs.length - maxSegments);
    const tail = segs.slice(-maxSegments).join(" → ");
    return hidden ? `(+${hidden} earlier) ${tail}` : tail;
  }

  // Strip heavy fields before saving to localStorage
  function serializeForSave(state) {
    const liteHistory = state.history
      .slice(-SAVE_HISTORY_MAX)
      .map(({ node, choiceText, time }) => ({ node, choiceText, time })); // no snapshot
    return {
      ...state,
      history: liteHistory,
      // reset visual effects on save
      fx: { hitTrigger: 0, hitVisible: false, omen: 0 },
    };
  }

  function VolRow({ label, value, onChange }) {
    const ref = React.useRef(null);

    const clamp01 = (n) => Math.max(0, Math.min(1, n));
    const snap = (v, step) => Math.round(v / step) * step;

    const setFromX = React.useCallback(
      (clientX) => {
        const el = ref.current;
        if (!el) return;
        const { left, width } = el.getBoundingClientRect();
        const pct = clamp01((clientX - left) / width);
        const step = parseFloat(el.step || "0.01");
        onChange(+snap(pct, step).toFixed(2));
      },
      [onChange]
    );

    // mouse drag (LMB)
    const onMouseDown = (e) => {
      if (e.button !== 0) return; // left button only
      setFromX(e.clientX); // jump immediately to press point
      document.body.style.userSelect = "none";
      const onMove = (ev) => setFromX(ev.clientX);
      const onUp = () => {
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    // touch drag
    const onTouchStart = (e) => {
      const t = e.touches[0];
      if (!t) return;
      setFromX(t.clientX);
      document.body.style.userSelect = "none";
      const onMove = (ev) => {
        const tt = ev.touches[0];
        if (tt) setFromX(tt.clientX);
      };
      const onEnd = () => {
        document.body.style.userSelect = "";
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onEnd);
        window.removeEventListener("touchcancel", onEnd);
      };
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onEnd);
      window.addEventListener("touchcancel", onEnd);
    };

    // wheel-to-adjust
    React.useEffect(() => {
      const el = ref.current;
      if (!el) return;
      const onWheel = (e) => {
        e.preventDefault();
        const delta =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const dir = Math.sign(delta);
        const step = e.shiftKey ? 0.1 : 0.02;
        const next = clamp01(value - dir * step);
        onChange(+next.toFixed(2));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [value, onChange]);

    // keyboard arrows (Shift = big steps)
    const onKeyDown = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.02;
      const dir = e.key === "ArrowRight" ? 1 : -1;
      onChange(+clamp01(value + dir * step).toFixed(2));
    };

    return (
      <div className="flex items-center gap-2 text-[11px] pixel">
        <span className="w-12 text-green-300/80">{label}</span>
        <input
          ref={ref}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          onMouseDown={onMouseDown}
          onTouchStart={onTouchStart}
          onKeyDown={onKeyDown}
          onChange={(e) => onChange(parseFloat(e.currentTarget.value))} // keyboard/programmatic
          className="flex-1 accent-green-400"
          title={`${label} volume (drag, scroll; Shift=big step)`}
          style={{ cursor: "pointer" }} // IMPORTANT: no touchAction: "none"
          draggable={false}
        />
        <span className="w-8 text-right text-green-400/80">
          {Math.round(value * 100)}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 ${
        night ? "theme-night" : "theme-day"
      } wx-${weather}`}
    >
      {/* Full-screen weather overlay (BEHIND panels) */}
      {(weather === "rain" || weather === "storm") && (
        <div
          aria-hidden
          className={`wx-overlay ${
            weather === "storm" ? "wx-overlay-storm" : "wx-overlay-rain"
          }`}
        />
      )}

      {/* Game UI only after Start */}
      {started && (
        <>
          {/* Floating audio controls (outside frames) */}
          <div className="fixed top-4 right-4 z-50">
            <div className="flex gap-3 justify-end">
              {/* Sound ON/OFF */}
              <button
                onClick={() => {
                  playClick();
                  toggleSound();
                }}
                className={`px-4 py-2 rounded-xl border-2 pixel text-sm font-black tracking-wide
                  ${
                    soundOn
                      ? "border-green-400 text-green-100 bg-green-900/20"
                      : "border-green-700 text-green-500 bg-black/40"
                  } hover:bg-green-900/30`}
                style={{ minWidth: 110, lineHeight: 1.1 }}
                title="Toggle sound"
              >
                <span className="text-base">🔊</span> {soundOn ? "ON" : "OFF"}
              </button>

              {/* Audio panel toggle */}
              <button
                onClick={() => {
                  playClick();
                  setShowAudio((v) => !v);
                }}
                className="px-4 py-2 rounded-xl border-2 border-green-500 pixel text-sm font-black
                           text-green-100 bg-black/40 hover:bg-green-900/30"
                style={{ minWidth: 110, lineHeight: 1.1 }}
                title="Audio sliders"
              >
                <span className="text-base">🎚</span> Audio
              </button>
            </div>

            {showAudio && (
              <div className="mt-3 w-[320px] space-y-3 p-4 rounded-xl border border-green-700 bg-black/85 backdrop-blur-sm shadow-2xl">
                <VolRow label="Music" value={volMusic} onChange={setVolMusic} />
                <VolRow label="SFX" value={volSfx} onChange={setVolSfx} />
                <VolRow label="NPC" value={volNpc} onChange={setVolNpc} />
              </div>
            )}
          </div>

          <div className="grid gap-3 w-full max-w-6xl md:grid-cols-[300px,1fr]">
            {/* Sidebar */}
            <aside
              className={`relative p-3 rounded-2xl border shadow-xl backdrop-blur-sm crt pb-28 flex flex-col ${
                night ? "border-indigo-700" : "border-emerald-700"
              }`}
            >
              <h1 className="text-2xl font-bold tracking-widest pixel relative">
                8-BIT QUEST
              </h1>

              <div className="mt-3 grid grid-cols-4 gap-2">
                <PxStat variant="red" label="HP" value={state.hp} icon="❤" />
                <PxStat
                  variant="yellow"
                  label="COIN"
                  value={state.coins}
                  icon="◎"
                />
                <PxStat
                  variant="blue"
                  label="KARMA"
                  value={state.karma}
                  icon="✚"
                />
                <PxStat
                  variant="violet" // fits day/night vibe nicely
                  label={night ? "NIGHT" : "DAY"}
                  value=""
                  icon={night ? "☾" : "☀"}
                />
              </div>

              {/* Inventory */}
              <div className="mt-3 flex-1 min-h-0 flex flex-col">
                <h2 className="text-sm font-bold text-green-400/90">
                  Inventory
                </h2>

                {/* framed panel that expands to the buttons */}
                <div className="mt-2 flex-1 min-h-0">
                  <div className="relative w-full h-full rounded-xl border border-green-700/80 bg-black/35 shadow-inner p-2 overflow-auto">
                    <div className="grid grid-cols-2 gap-2">
                      {Object.keys(state.items).length === 0 && (
                        <Badge>empty</Badge>
                      )}
                      {Object.entries(state.items).map(([k, v]) =>
                        v ? (
                          <ItemChip
                            key={k}
                            id={k}
                            onClick={() => {
                              playClick();
                              setOpenItemId(k);
                            }}
                          />
                        ) : null
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="absolute left-3 right-3 bottom-3 grid grid-cols-2 gap-2">
                <PixelBtn
                  className="w-full"
                  variant="green"
                  onClick={() => {
                    playClick();
                    backOne();
                  }}
                  disabled={state.history.length === 0}
                  icon="◀"
                  title="Go back one step"
                >
                  Back
                </PixelBtn>

                <PixelBtn
                  className="w-full"
                  variant={night ? "orange" : "blue"}
                  onClick={() => {
                    playClick();
                    advanceTime(1);
                  }}
                  icon="✦"
                  title="Advance time one step"
                >
                  Wait {night ? "☀" : "☾"}
                </PixelBtn>

                <PixelBtn
                  className="col-span-2 w-full px-center-label"
                  variant="orange"
                  icon="↻"
                  title="Restart (same seed)"
                  onClick={() => {
                    playClick();
                    setConfirmRestart({ open: true, hard: false });
                  }}
                >
                  Restart
                </PixelBtn>
              </div>

              <p className="mt-2 text-[10px] text-green-400/70">
                Auto-saves locally. Seed: {state.seed} • Time: {state.time} (t
                {state.tick})
              </p>
            </aside>

            {/* Main */}
            <main
              className={`p-4 rounded-2xl border shadow-2xl relative overflow-hidden crt ${
                night ? "border-indigo-700" : "border-emerald-700"
              } ${
                night
                  ? "bg-[linear-gradient(180deg,#02040a_0%,#05131b_100%)]"
                  : "bg-[linear-gradient(180deg,#03140e_0%,#062116_100%)]"
              }`}
            >
              <Scanlines />
              <DayNightDeco night={night} weather={weather} />
              <WeatherDeco
                weather={weather}
                night={night}
                lightningKey={lightningKey}
              />

              {/* HP loss flash overlay */}
              {state.fx?.hitVisible && (
                <div
                  aria-hidden
                  className="absolute inset-0 z-30 fx-hit pointer-events-none"
                />
              )}
              {/* Omen toast when a choice may shape the ending */}
              {(state.fx?.omen ?? 0) > 0 && (
                <div
                  key={`omen-${state.fx.omen}`}
                  className="absolute top-4 right-4 z-30 pointer-events-none"
                >
                  <div className="fx-omen pixel">
                    “The Obelisk marks your path.”
                  </div>
                </div>
              )}
              {/* starfield at night */}
              {night && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 opacity-30"
                  style={{
                    backgroundImage:
                      "radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,.8), transparent 60%)," +
                      "radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,.7), transparent 60%)," +
                      "radial-gradient(1px 1px at 40% 80%, rgba(255,255,255,.6), transparent 60%)",
                    backgroundSize: "100% 100%",
                  }}
                />
              )}
              <div className="relative z-10">
                <NodeTitle
                  node={node}
                  hp={state.hp}
                  time={state.time}
                  weather={weather}
                />
                <Avatar who={node?.npc || "you"} night={night} />

                <p className="mt-2 leading-relaxed text-green-100/90 whitespace-pre-wrap">
                  {renderText(node?.text, state)}
                </p>

                <div className="mt-4 grid gap-2">
                  {!isEnding &&
                    available.map((c, i) => (
                      <ChoiceButton
                        key={i}
                        choice={c}
                        onChoose={() => {
                          playClick();
                          takeChoice(c);
                        }}
                      />
                    ))}

                  {!isEnding && available.length === 0 && (
                    <div className="text-green-300/90 text-sm italic">
                      No valid choices… try going back or waiting.
                    </div>
                  )}

                  {isEnding && (
                    <div className="mt-4">
                      <EndingBanner node={node} hp={state.hp} />
                      <div className="mt-3 flex gap-2">
                        <PixelBtn
                          variant="green"
                          icon="⟲"
                          onClick={() => {
                            playClick();
                            restart(false);
                          }}
                        >
                          Rewind
                        </PixelBtn>

                        {/* was: onClick={() => restart(true)} */}
                        <PixelBtn
                          variant="orange"
                          className="px-center-label"
                          icon="↻"
                          onClick={() => {
                            playClick();
                            setConfirmRestart({ open: true, hard: true });
                          }}
                        >
                          Restart
                        </PixelBtn>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-6 text-[11px] text-green-400/70">
                  Path: {summarizePath(state.history, state.node, 18)}
                </div>
              </div>

              {confirmRestart && (
                <div
                  role="dialog"
                  aria-modal="true"
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
                  onClick={() => {
                    playClick();
                    setConfirmRestart(false);
                  }}
                >
                  {/* click backdrop to close */}
                  <div
                    className="pixel rounded-2xl border border-green-600 shadow-2xl p-4 w-[min(92vw,420px)]
                               bg-[linear-gradient(180deg,#03140e_0%,#062116_100%)] relative"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* don't close when clicking panel */}
                    <button
                      aria-label="Close"
                      className="absolute top-2 right-2 text-green-300/70 hover:text-green-200"
                      onClick={() => {
                        playClick();
                        setConfirmRestart(false);
                      }}
                    >
                      ✕
                    </button>

                    <div className="text-xl font-black mb-2 flex items-center gap-2">
                      <span>↻</span> Do you want to start a new run?
                    </div>
                    <p className="text-green-100/80 text-sm mb-4">
                      This will reset your stats and create a new seed.
                    </p>

                    <div className="grid grid-cols-2 gap-2">
                      <PixelBtn
                        variant="green"
                        icon="✔"
                        onClick={() => {
                          playClick();
                          setConfirmRestart(false);
                          restart(true);
                        }}
                      >
                        Yes
                      </PixelBtn>

                      {/* uses your existing .px-red variables */}
                      <PixelBtn
                        variant="red"
                        icon="✖"
                        onClick={() => {
                          playClick();
                          setConfirmRestart(false);
                        }}
                      >
                        No
                      </PixelBtn>
                    </div>

                    <span aria-hidden className="px-gloss" />
                  </div>
                </div>
              )}
              {openItemId && (
                <ItemModal
                  id={openItemId}
                  meta={ITEM_ASSETS[openItemId]}
                  onClose={() => {
                    playClick();
                    setOpenItemId(null);
                  }}
                />
              )}
            </main>
          </div>
        </>
      )}

      {/* Start overlay shown before the game begins */}
      {!started && (
        <StartOverlay
          onStart={() => {
            playClick();
            startGame();
          }}
        />
      )}
      <style>{`
        .pixel { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
        .crt { box-shadow: inset 0 0 0 2px rgba(16,185,129,0.2); image-rendering: pixelated; }
        .btn { transition: transform 0.05s ease; }
        .btn:active { transform: translateY(1px); }

        /* --- FX styles --- */
        .fx-hit {
          background:
            radial-gradient(circle at 50% 50%, rgba(255,0,0,0.35), rgba(255,0,0,0) 55%),
            rgba(127,29,29,0.35);
          animation: hitFlash 250ms ease-out;
        }
        @keyframes hitFlash {
          0% { opacity: 0 }
          10% { opacity: 1 }
          100% { opacity: 0 }
        }

        .fx-omen {
          border: 1px solid rgba(16,185,129,.45);
          background: rgba(0,0,0,.8);
          padding: .45rem .6rem;
          border-radius: .5rem;
          color: #fca5a5;
          text-shadow: 0 0 6px rgba(252,165,165,.6);
          box-shadow: inset 0 0 0 2px rgba(124,58,237,.15);
          animation: omenPulse 1200ms ease-in-out forwards;
        }
        @keyframes omenPulse {
          0%   { transform: translateY(-6px); opacity: 0 }
          15%  { transform: translateY(0);    opacity: 1 }
          85%  { opacity: 1 }
          100% { opacity: 0 }
        }
        .px-btn {
          --px-bg: #2fbf66;
          --px-bg-d: #18944a;
          --px-hi: #7ff8b3;
          --px-edge: #0f3f24;
          --px-shadow: #0c2a18;
        
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: .55rem;
          padding: .6rem .9rem;
          border: 0;
          color: #071b10;
          text-transform: uppercase;
          letter-spacing: .02em;
          user-select: none;
          cursor: pointer;
        
          /* “cartridge” vertical bevel */
          background:
            linear-gradient(#ffffff22, #ffffff00 30%) top/100% 40% no-repeat,
            linear-gradient(to bottom, var(--px-hi) 0 8%, var(--px-bg) 8% 92%, var(--px-bg-d) 92% 100%);
          border-radius: .6rem;
        
          /* pixel-ish stepped inset + drop */
          box-shadow:
            0 0 0 2px var(--px-edge) inset,
            0 0 0 4px #00000022 inset,
            0 6px 0 0 var(--px-shadow),
            0 6px 0 2px #00000055;
        
          transform: translateY(0);
          transition: transform .06s ease, box-shadow .06s ease, filter .06s ease;
        }
        
        .px-btn .px-icon {
          font-weight: 900;
          font-size: 0.95rem;
          translate: 0 1px;
        }
        
        .px-btn .px-label {
          font-weight: 900;
          font-size: .92rem;
        }
        
        /* Center the text perfectly in the button; keep icon at left */
        .px-center-label {
          display: grid !important;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
        }
        .px-center-label .px-icon   { grid-column: 1; justify-self: start; }
        .px-center-label .px-label  { grid-column: 2; justify-self: center; }
        
        .px-btn .px-gloss {
          /* diagonal shiny stripe like classic sprite UI */
          content: "";
          position: absolute;
          inset: 2px 2px 55% 2px;
          border-radius: .45rem .45rem .2rem .2rem;
          background:
            linear-gradient(135deg, #ffffff55 0 45%, #ffffff00 45% 100%);
          pointer-events: none;
          mix-blend-mode: screen;
        }
        
        /* Pressed state */
        .px-btn:active:not(.is-disabled) {
          transform: translateY(4px);
          box-shadow:
            0 0 0 2px var(--px-edge) inset,
            0 0 0 4px #00000022 inset,
            0 2px 0 0 var(--px-shadow),
            0 2px 0 2px #00000055;
        }
        
        /* Focus ring (keyboard) */
        .px-btn:focus-visible {
          outline: 0;
          filter: drop-shadow(0 0 0.25rem #66ffbb55);
        }
        
        /* Disabled */
        .px-btn.is-disabled {
          opacity: .55;
          cursor: not-allowed;
          box-shadow:
            0 0 0 2px #1f3b2b inset,
            0 0 0 4px #00000022 inset,
            0 6px 0 0 #0b1c12,
            0 6px 0 2px #00000055;
        }
        
        /* --- Color variants (picked to echo the reference sprite sheet) --- */
        .px-green {
          --px-bg: #2fbf66;
          --px-bg-d: #18944a;
          --px-hi: #8dfcbf;
          --px-edge: #0f3f24;
          --px-shadow: #0c2a18;
          color: #052313;
        }
        
        .px-orange {
          --px-bg: #f39c32;
          --px-bg-d: #cc7a16;
          --px-hi: #ffd08d;
          --px-edge: #5a2b00;
          --px-shadow: #3a1a00;
          color: #3a1600;
        }
        
        .px-blue {
          --px-bg: #2b8be6;
          --px-bg-d: #1e66b6;
          --px-hi: #a8d8ff;
          --px-edge: #0b3a5a;
          --px-shadow: #0a2740;
          color: #071d33;
        }
        
        /* tiny pixel “steps” on corners */
        .px-btn::before {
          content: "";
          position: absolute;
          inset: -2px;
          pointer-events: none;
          background:
            /* top/bottom ticks */
            linear-gradient(90deg, transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) top/100% 6px no-repeat,
            linear-gradient(90deg, transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) bottom/100% 6px no-repeat,
            /* left/right ticks */
            linear-gradient(transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) left/6px 100% no-repeat,
            linear-gradient(transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) right/6px 100% no-repeat;
          border-radius: .7rem;
          opacity: .9;
        }
        
        /* ---------- Pixel Tiles (match px-btn texture) ---------- */
        .px-tile {
          --px-bg: #2fbf66;
          --px-bg-d: #18944a;
          --px-hi: #8dfcbf;
          --px-edge: #0f3f24;
          --px-shadow: #0c2a18;
        
          position: relative;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: .15rem;
          padding: .55rem .5rem;
          min-height: 64px;
          border: 0;
        
          /* same glossy + body gradients as buttons */
          background:
            linear-gradient(#ffffff22, #ffffff00 35%) top/100% 40% no-repeat,
            linear-gradient(to bottom, var(--px-hi) 0 10%, var(--px-bg) 10% 92%, var(--px-bg-d) 92% 100%);
          border-radius: .6rem;
        
          /* same inset and drop shadows */
          box-shadow:
            0 0 0 2px var(--px-edge) inset,
            0 0 0 4px #00000022 inset,
            0 6px 0 0 var(--px-shadow),
            0 6px 0 2px #00000055;
        }
        
        /* pixel ticks on corners (like buttons) */
        .px-tile::before {
          content: "";
          position: absolute;
          inset: -2px;
          pointer-events: none;
          background:
            linear-gradient(90deg, transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) top/100% 6px no-repeat,
            linear-gradient(90deg, transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) bottom/100% 6px no-repeat,
            linear-gradient(transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) left/6px 100% no-repeat,
            linear-gradient(transparent 6px, var(--px-edge) 6px 8px, transparent 8px calc(100% - 8px), var(--px-edge) calc(100% - 8px) calc(100% - 6px), transparent calc(100% - 6px)) right/6px 100% no-repeat;
          border-radius: .7rem;
          opacity: .9;
        }
        
        /* shared inner bits */
        .px-tile .px-gloss {
          content: "";
          position: absolute;
          inset: 2px 2px 55% 2px;
          border-radius: .45rem .45rem .2rem .2rem;
          background: linear-gradient(135deg, #ffffff55 0 45%, #ffffff00 45% 100%);
          pointer-events: none;
          mix-blend-mode: screen;
        }
        .px-tile .px-title {
          font-size: 12px;
          font-weight: bolder;
          letter-spacing: .14em;
          text-transform: uppercase;
          opacity: .85;
        }
        .px-tile .px-value {
          font-weight: 900;
          font-size: 1.05rem;
          display: inline-flex;
          align-items: center;
          gap: .3rem;
        }
        .px-tile .px-icon { translate: 0 1px; }
        
        /* ---------- Color variants ---------- */
        /* HP — red */
        .px-red {
          --px-bg: #e45757;
          --px-bg-d: #bb2f2f;
          --px-hi: #ffb3b3;
          --px-edge: #5a1717;
          --px-shadow: #320c0c;
          color: #2a0b0b;
        }
        /* COIN — yellow/gold */
        .px-yellow {
          --px-bg: #f5c242;
          --px-bg-d: #d29012;
          --px-hi: #ffe6a3;
          --px-edge: #5a3a00;
          --px-shadow: #3a2500;
          color: #3a2600;
        }
        /* KARMA — reuse your button blue */
        .px-blue {
          --px-bg: #2b8be6;
          --px-bg-d: #1e66b6;
          --px-hi: #a8d8ff;
          --px-edge: #0b3a5a;
          --px-shadow: #0a2740;
          color: #071d33;
        }
        /* DAY/NIGHT — violet */
        .px-violet {
          --px-bg: #8b5cf6;
          --px-bg-d: #6d35e9;
          --px-hi: #d9ccff;
          --px-edge: #311a6b;
          --px-shadow: #20104a;
          color: #180f3a;
        }
        
        /* (Optional) Teal palette if you prefer it for Day/Night)
        .px-teal {
          --px-bg: #22c7b7;
          --px-bg-d: #129c90;
          --px-hi: #a6fff5;
          --px-edge: #0d4b45;
          --px-shadow: #0a3531;
          color: #062724;
        }
        */
               

/* ---- Day/Night theme roots ---- */
.theme-day  { background:#000; color:#d1fae5; }
.theme-night{ background:#000; color:#c7d2fe; }

/* CRT border glow shifts by theme */
.theme-day  .crt { box-shadow: inset 0 0 0 2px rgba(16,185,129,.22); }
.theme-night .crt { box-shadow: inset 0 0 0 2px rgba(99,102,241,.22); }

/* vignette tints */
.vignette-day {
  background: radial-gradient(120% 70% at 50% 30%, #ffffff22, #ffffff00 70%);
}
.vignette-night {
  background: radial-gradient(120% 70% at 50% 60%, rgba(99,102,241,.18), rgba(255,255,255,0) 72%);
}

/* ---------------- Weather → UI accents (never darken) ---------------- */

/* Lift panels above the global weather overlay */
.crt { position: relative; z-index: 2; }

/* RAIN: juicier gloss + small "puddle" under the avatar frame (accents only) */
.wx-rain .px-btn .px-gloss,
.wx-rain .px-tile .px-gloss { opacity: .95; }
.wx-rain .px-btn,
.wx-rain .px-tile { filter: saturate(1.05) contrast(1.05); }

.wx-rain .avatar-box::after {
  content:"";
  position:absolute; left:12px; right:12px; bottom:-6px; height:10px;
  background: radial-gradient(50% 60% at 50% 50%, rgba(173,216,230,.45), rgba(173,216,230,0) 60%);
  filter: blur(1px);
  pointer-events:none;
}

/* SNOW: soft snowcap highlight + frosty inset on buttons/tiles */
.wx-snow .px-btn,
.wx-snow .px-tile {
  box-shadow:
    0 -2px 0 0 #ffffff88 inset,
    0 0 0 2px #ffffff22 inset;
}
.wx-snow .avatar-box::before {
  content:"";
  position:absolute; top:0; left:0; right:0; height:10px;
  background: linear-gradient(to bottom, #ffffffcc, #ffffff00 70%);
  border-radius: .6rem .6rem 0 0;
  pointer-events:none;
}

/* FOG: gentle clarity boost (no dark veil) */
.wx-fog .crt { backdrop-filter: blur(1px) saturate(1.05); }
.wx-fog .pixel { text-shadow: 0 0 6px rgba(255,255,255,.14); }

/* STORM: subtle electric glow on interactive elements */
.wx-storm .px-btn,
.wx-storm .px-tile { animation: stormGlow 2.6s ease-in-out infinite; }
@keyframes stormGlow {
  0%,100% {
    box-shadow:
      0 0 0 2px var(--px-edge) inset,
      0 0 0 4px #00000022 inset,
      0 6px 0 0 var(--px-shadow),
      0 6px 0 2px #00000055;
    filter: contrast(1);
  }
  50% {
    box-shadow:
      0 0 0 2px var(--px-edge) inset,
      0 0 0 4px #00000022 inset,
      0 6px 0 0 var(--px-shadow),
      0 6px 0 2px #00000055,
      0 0 12px 2px rgba(180,200,255,.45);
    filter: contrast(1.06);
  }
}

.day-motes {
  background:
    radial-gradient(2px 2px at 20% 30%, #ffffffaa, #ffffff00 60%),
    radial-gradient(1.6px 1.6px at 65% 55%, #ffffff88, #ffffff00 60%),
    radial-gradient(1.8px 1.8px at 35% 75%, #ffffffaa, #ffffff00 60%);
  animation: motesDrift 8s ease-in-out infinite alternate;
  opacity: .18;
  mix-blend-mode: screen;
  filter: blur(.4px);
}

@keyframes motesDrift {
  from { transform: translateY(0);    opacity: .14; }
  to   { transform: translateY(-4px); opacity: .28; }
}

/* ---- Global weather overlays (FULL SCREEN; never inside panels) ---- */
.wx-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;              /* panels (.crt) sit above via z-index:2 */
}

/* Diagonal rain stripes */
.wx-overlay-rain,
.wx-overlay-storm {
  background-image:
    linear-gradient(120deg, rgba(173,216,230,.22) 25%, rgba(173,216,230,0) 26%),
    linear-gradient(120deg, rgba(173,216,230,.14) 25%, rgba(173,216,230,0) 26%);
  background-size: 16px 16px, 12px 12px;
  animation: rainMove 0.6s linear infinite;
  mix-blend-mode: screen;
}
@keyframes rainMove {
  from { background-position: 0 0, 0 0; }
  to   { background-position: -64px 64px, -48px 48px; }
}

/* ---- In-frame overlays kept (no rain stripes here) ---- */

/* Snow: soft drifting dots (used only if you also render a local snow layer) */
/* Snowflakes layer (in-frame only). Root still uses .wx-snow as a theme flag. */
.wx-snowflakes {
  background-image:
    radial-gradient(2px 2px at 20% 10%, rgba(255,255,255,.85), rgba(255,255,255,0) 55%),
    radial-gradient(2px 2px at 60% 35%, rgba(255,255,255,.75), rgba(255,255,255,0) 55%),
    radial-gradient(2px 2px at 80% 70%, rgba(255,255,255,.85), rgba(255,255,255,0) 55%),
    radial-gradient(2px 2px at 30% 80%, rgba(255,255,255,.75), rgba(255,255,255,0) 55%);
  animation: snowDrift 6s linear infinite;
  mix-blend-mode: screen;
}
@keyframes snowDrift {
  from { background-position: 0 -10px, 0 -20px, 0 -5px, 0 -15px; }
  to   { background-position: 0  10px, 0  20px, 0  5px, 0  15px; }
}

/* Fog: big blurred gradient (used by in-frame fog layer if you keep it) */
.wx-fog {
  background:
    radial-gradient(60% 40% at 50% 35%, rgba(210,230,240,.20), rgba(210,230,240,0) 60%),
    radial-gradient(50% 35% at 30% 70%, rgba(210,230,240,.14), rgba(210,230,240,0) 60%);
  filter: blur(0.5px);
  mix-blend-mode: screen;
}

/* Lightning flash */
.fx-lightning {
  background:
    radial-gradient(120% 60% at 40% 10%, rgba(255,255,255,.90), rgba(255,255,255,0) 60%),
    rgba(255,255,255,.1);
  animation: lightningPulse 380ms ease-out forwards;
}
@keyframes lightningPulse {
  0%   { opacity: 0; }
  10%  { opacity: .9; }
  100% { opacity: 0; }
}

/* Optional: subtle tint differences for weather at the page level */
.wx-rain  .crt { box-shadow: inset 0 0 0 2px rgba(56,189,248,.20); }
.wx-storm .crt { box-shadow: inset 0 0 0 2px rgba(99,102,241,.28); }
.wx-fog   .crt { box-shadow: inset 0 0 0 2px rgba(203,213,225,.18); }
.wx-snow  .crt { box-shadow: inset 0 0 0 2px rgba(255,255,255,.20); }

/* Item modal image crispness (optional) */
[data-item-img] { image-rendering: pixelated; }

      `}</style>
    </div>
  );
}

/* ---------- UI bits ---------- */
function NodeTitle({ node, hp, time, weather }) {
  if (hp <= 0) {
    return (
      <h2 className="pixel text-2xl font-black text-red-300">☠ You Died</h2>
    );
  }
  const isNight = time === "night";
  const timeTag = isNight ? "☾ Night" : "☀ Day";
  const wx = weatherIcon(weather); // ⛅︎/☔/🌫/⚡/❄
  return (
    <h2 className="pixel text-2xl font-black">
      {node?.emoji || "▣"} {node?.title || "Unknown"}{" "}
      <span
        className={
          isNight
            ? "text-indigo-300/80 text-base"
            : "text-amber-300/80 text-base"
        }
      >
        • {timeTag}
      </span>{" "}
      <span className="text-green-300/80 text-base">
        • {wx} {labelWeather(weather)}
      </span>
    </h2>
  );
}

function ChoiceButton({ choice, onChoose }) {
  const tag = [];
  if (choice?.set?.hp)
    tag.push(`${choice.set.hp > 0 ? "+" : ""}${choice.set.hp} HP`);
  if (choice?.set?.coins)
    tag.push(`${choice.set.coins > 0 ? "+" : ""}${choice.set.coins}c`);
  if (choice?.set?.karma)
    tag.push(`${choice.set.karma > 0 ? "+" : ""}${choice.set.karma}K`);
  const invAdd = choice?.set?.items
    ? Object.keys(choice.set.items).join(", ")
    : "";
  const reqTime = choice?.require?.time ? `(${choice.require.time})` : "";
  return (
    <button
      className="btn w-full text-left px-3 py-2 rounded-xl border border-green-600 bg-black/50 hover:bg-green-900/20 focus:outline-none pixel disabled:opacity-50"
      onClick={onChoose}
      disabled={choice.disabled}
      title={choice.disabledReason || ""}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">▶</span>
        <span className="flex-1">
          {choice.text} {reqTime}
        </span>
        <span className="text-[10px] text-green-400/80">
          {tag.join(" ")} {invAdd && `+${invAdd}`}
        </span>
      </div>
    </button>
  );
}

function ItemModal({ id, meta, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!meta) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="pixel rounded-2xl border border-green-600 shadow-2xl p-4 w-[min(92vw,460px)]
                   bg-[linear-gradient(180deg,#03140e_0%,#062116_100%)] relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="absolute top-2 right-2 text-green-300/70 hover:text-green-200"
          onClick={() => {
            onClose();
          }}
        >
          ✕
        </button>

        <div className="flex items-center gap-3">
          <div
            className="shrink-0 w-16 h-16 rounded-lg border border-green-700 bg-black/50 grid place-items-center"
            style={{ imageRendering: "pixelated" }}
          >
            {meta.file ? (
              <img
                src={meta.file}
                alt={meta.label}
                className="max-w-[80%] max-h-[80%] object-contain"
              />
            ) : (
              <span className="text-xl">{meta.emoji || "□"}</span>
            )}
          </div>

          <div>
            <div className="text-lg font-black">{meta.label}</div>
            <div className="text-green-300/80 text-sm">{meta.emoji}</div>
          </div>
        </div>

        <p className="mt-3 text-green-100/90 leading-relaxed">
          {meta.desc || "An intriguing item."}
        </p>

        <div className="mt-4 flex justify-end">
          <button
            className="px-btn px-green"
            type="button"
            onClick={onClose}
            title="Close"
          >
            <span className="px-icon">✔</span>
            <span className="px-label">OK</span>
            <span aria-hidden className="px-gloss" />
          </button>
        </div>

        <span aria-hidden className="px-gloss" />
      </div>
    </div>
  );
}

// NEW: Pixel-looking stat tile
function PxStat({ label, value, icon, variant }) {
  return (
    <div className={`px-tile pixel px-${variant}`}>
      <div className="px-title">{label}</div>
      <div className="px-value">
        <span className="px-icon">{icon}</span>
        <span>{value}</span>
      </div>
      <span aria-hidden className="px-gloss" />
    </div>
  );
}

function Badge({ children }) {
  return (
    <div className="px-2 py-1 rounded-lg border border-green-600 text-[11px] text-green-100/90 pixel">
      {children}
    </div>
  );
}

function PixelBtn({
  children,
  onClick,
  disabled,
  title,
  icon,
  variant = "green",
  className = "", // <— add this
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`px-btn pixel ${
        disabled ? "is-disabled" : ""
      } px-${variant} ${className}`}
    >
      {icon && (
        <span aria-hidden className="px-icon">
          {icon}
        </span>
      )}
      <span className="px-label">{children}</span>
      <span aria-hidden className="px-gloss" />
    </button>
  );
}

function Btn({ children, onClick, disabled, title }) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`btn px-3 py-1.5 rounded-lg border pixel ${
        disabled
          ? "border-green-700/50 text-green-700/60"
          : "border-green-600 hover:bg-green-900/20"
      }`}
    >
      {children}
    </button>
  );
}

function Scanlines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-25"
      style={{
        backgroundImage:
          "linear-gradient(rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.25) 50%)",
        backgroundSize: "100% 4px",
      }}
    />
  );
}

function DayNightDeco({ night, weather }) {
  return (
    <>
      {/* light-only vignette: uses 'screen' so it never darkens */}
      <div
        aria-hidden
        className={`absolute inset-0 pointer-events-none mix-blend-screen ${
          night ? "vignette-night" : "vignette-day"
        }`}
      />
      {/* Daytime-only accent (no overlay at night) */}
      {!night && weather === "clear" && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none day-motes"
        />
      )}
    </>
  );
}

function WeatherDeco({ weather, night, lightningKey }) {
  return (
    <>
      {/* rain */}
      {weather === "rain" && ( // <— was (weather === "rain" || weather === "storm")
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none wx-rain"
        />
      )}
      {/* snow */}
      {weather === "snow" && (
        <div aria-hidden className="absolute inset-0 pointer-events-none wx-snowflakes" />
      )}
      {/* fog */}
      {weather === "fog" && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none wx-fog"
        />
      )}
      {/* storm flashes */}
      {weather === "storm" && (
        <div
          key={lightningKey}
          aria-hidden
          className="absolute inset-0 pointer-events-none fx-lightning"
        />
      )}
    </>
  );
}

function EndingBanner({ node }) {
  return (
    <div className="p-3 rounded-xl border border-green-600 bg-black/50 pixel">
      <div className="text-xl font-black">
        {node?.emoji} {node?.title}
      </div>
      <p className="mt-1 text-green-100/90">{node?.text}</p>
    </div>
  );
}

const IMAGES = {
  you: "/avatar/You.png", // served from /public (optional)
  vendor: "/avatar/vendor.png",
  beggar: "/avatar/beggar.png",
  blacksmith: "/avatar/blacksmith.png",
  spirit: "/avatar/forest spirit.png",
  spider: "/avatar/spider.png",
  golem: "/avatar/golem.png",
  wolf: "/avatar/wolf.png",
  owl: "/avatar/owl.png",
  innkeeper: "/avatar/inn keeper.png",
  vault: "/avatar/moon vault.png",
  witch: "/avatar/witch.png",
  guard: "/avatar/guard.png",
  ranger: "/avatar/ranger.png",
};

const ITEM_ASSETS = {
  torch: {
    label: "TORCH",
    file: "/items/torch.png",
    emoji: "🔥",
    desc: "A sturdy torch. Lights caves and reveals paths where darkness hides hazards.",
  },
  key: {
    label: "KEY",
    file: "/items/key.png",
    emoji: "🗝️",
    desc: "A plain iron key. Opens certain doors, chests, and official locks.",
  },
  sword: {
    label: "SWORD",
    file: "/items/sword.png",
    emoji: "⚔",
    desc: "A well-balanced blade. Enables direct combat options and intimidation plays.",
  },
  herb: {
    label: "HERB",
    file: "/items/herb.png",
    emoji: "🌿",
    desc: "A fragrant forest herb. Useful for brews, poultices, and night preparations.",
  },
  potion: {
    label: "POTION",
    file: "/items/potion.png",
    emoji: "🧪",
    desc: "A bright tonic. Restores breath or grants short watery safety when used.",
  },
  feather: {
    label: "FEATHER",
    file: "/items/feather.png",
    emoji: "🪶",
    desc: "A pale feather from the Old Owl. Favored in dawn rites and gentle vows.",
  },
  ring: {
    label: "MOON RING",
    file: "/items/ring.png",
    emoji: "◐",
    desc: "A silver band etched with a crescent. Lets you dive the Moon Well safely at night.",
  },
  glyph_sun: {
    label: "SUN GLYPH",
    file: "/items/glyph_sun.png",
    emoji: "☀",
    desc: "A warm sun-etched tablet. One half of the Eclipse Sigil.",
  },
  glyph_moon: {
    label: "MOON GLYPH",
    file: "/items/glyph_moon.png",
    emoji: "☾",
    desc: "A cool moon-carved tablet. One half of the Eclipse Sigil.",
  },
  sigil: {
    label: "ECLIPSE SIGIL",
    file: "/items/sigil.png",
    emoji: "◎",
    desc: "Sun and Moon bound as one. Opens the Eclipse Gate and shapes endings.",
  },
  writ: {
    label: "WRIT",
    file: "/items/writ.png",
    emoji: "✦",
    desc: "An official writ from the guard. Grants leeway during curfew and inspections.",
  },
};

// --- Audio config ---
const SOUND_FILES = {
  // music / ambience
  bg: "/audio/background/bg.mp3",
  combat: "/audio/background/combat.mp3",
  night: "/audio/background/night.mp3",
  rain: "/audio/background/rain.wav",
  wind: "/audio/music/wind.mp3",

  // sfx
  fail: "/audio/sfx/fail.flac",
  collect: "/audio/sfx/collect.wav",
  damage: "/audio/sfx/damaged.mp3",
  thunder: "/audio/sfx/thunder.wav",
  click: "/audio/sfx/click.ogg",

  // result jingles
  victory: "/audio/background/victory.wav",
  defeated: "/audio/background/defeated.wav",

  // npc / creature cues
  wolf: "/audio/npc/wolf.wav",
  spider: "/audio/npc/spider.mp3",
  golem: "/audio/npc/golem.wav",
  witch: "/audio/npc/witch.wav",
  spirit: "/audio/npc/spirit.wav",
  innkeeper: "/audio/npc/innkeeper.mp3",
  ranger: "/audio/npc/ranger.mp3",
  beggar: "/audio/npc/beggar.mp3",
  vendor: "/audio/npc/vendor.m4a",
  owl: "/audio/npc/owl.mp3",
  guard: "/audio/npc/guard.wav",
  blacksmith: "/audio/npc/blacksmith.ogg",
};

const SOUND_VOL = {
  // ambience/music
  bg: 0.2,
  combat: 0.7,
  night: 0.18,
  rain: 0.25,
  wind: 0.22,
  thunder: 0.5,

  // sfx
  fail: 1.0,
  collect: 0.2,
  damage: 0.9,
  click: 0.35,

  // result jingles
  victory: 0.95,
  defeated: 1.5,

  // npc / creatures
  wolf: 0.7,
  spider: 0.6,
  golem: 0.6,
  witch: 0.2,
  spirit: 0.45,
  innkeeper: 0.6,
  ranger: 0.6,
  beggar: 0.6,
  vendor: 0.9,
  owl: 0.6,
  guard: 0.6,
  blacksmith: 0.6,
};

const SOUND_GROUP = {
  bg: "music",
  combat: "music",
  night: "music",
  rain: "music",
  wind: "music",

  victory: "sfx",
  defeated: "sfx",
  fail: "sfx",
  collect: "sfx",
  damage: "sfx",
  thunder: "sfx",
  click: "sfx",

  // voice/character lines
  golem: "npc",
  witch: "npc",
  spirit: "npc",
  innkeeper: "npc",
  ranger: "npc",
  beggar: "npc",
  wolf: "npc",
  spider: "npc",
  vendor: "npc",
  owl: "npc",
  guard: "npc",
  blacksmith: "npc",
};

/* ---------- Avatars (pixel SVGs) ---------- */
function Avatar({ who, night = false }) {
  const src = IMAGES[who];
  const Sprite = SPRITES[who];

  return (
    <div className="mt-3 mb-2">
      <div
        className={`avatar-box relative rounded-xl overflow-hidden w-[128px] h-[176px] ${
          night ? "border-indigo-700" : "border-emerald-700"
        } bg-black/60 border`}
        style={{ imageRendering: "pixelated" }}
      >
        {/* image layer */}
        <div className="absolute inset-0 p-1 flex items-center justify-center">
          {src ? (
            <img
              src={src}
              alt={labelFor(who)}
              className="block max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="w-[96px] h-[96px] grid place-items-center">
              {Sprite && <Sprite />}
            </div>
          )}
        </div>

        {/* caption layer (always visible) */}
        <div
          className="
              absolute bottom-0 left-0 right-0
              text-center text-[10px] leading-none pixel uppercase
              text-green-300/90 bg-black/35 backdrop-blur-[1px] py-1
            "
        >
          {labelFor(who)}
        </div>
      </div>
    </div>
  );
}
function labelFor(who) {
  switch (who) {
    case "guard":
      return "Town Guard";
    case "vendor":
      return "Elf Vendor";
    case "ranger":
      return "Forest Ranger";
    case "beggar":
      return "Beggar";
    case "innkeeper":
      return "Innkeeper";
    case "blacksmith":
      return "Blacksmith";
    case "witch":
      return "Hut Witch";
    case "wolf":
      return "Forest Wolf";
    case "owl":
      return "Old Owl";
    case "golem":
      return "Ancient Golem";
    case "vault":
      return "Moon Vault";
    case "spider":
      return "Cave Spider";
    case "spirit":
      return "Forest Spirit";
    case "you":
    default:
      return "Player";
  }
}

function ItemChip({ id, onClick }) {
  const meta = ITEM_ASSETS[id] || { label: id };
  const src = meta.file;

  return (
    <button
      type="button"
      onClick={onClick}
      className="px-2 py-1 rounded-lg border border-green-600 text-[11px] text-green-100/90 pixel bg-black/30 inline-flex items-center gap-2 hover:bg-green-900/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60"
      title={`View ${meta.label}`}
    >
      {src ? (
        <img
          src={src}
          alt={meta.label}
          className="w-4 h-4"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="opacity-75">{meta.emoji || "□"}</span>
      )}
      <span>{meta.label}</span>
    </button>
  );
}

const SPRITES = {
  you: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#001a00" />
      <rect x="6" y="2" width="4" height="3" fill="#88ff88" />
      <rect x="5" y="5" width="6" height="1" fill="#88ff88" />
      <rect x="4" y="6" width="8" height="5" fill="#55cc55" />
      <rect x="3" y="11" width="10" height="1" fill="#88ff88" />
      <rect x="4" y="12" width="3" height="2" fill="#5599ff" />
      <rect x="9" y="12" width="3" height="2" fill="#5599ff" />
    </svg>
  ),
  guard: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#0a0a00" />
      <rect x="5" y="2" width="6" height="3" fill="#ffd7a0" />
      <rect x="4" y="5" width="8" height="1" fill="#554400" />
      <rect x="3" y="6" width="10" height="5" fill="#444422" />
      <rect x="3" y="7" width="10" height="1" fill="#777755" />
      <rect x="4" y="11" width="3" height="2" fill="#333366" />
      <rect x="9" y="11" width="3" height="2" fill="#333366" />
      <rect x="7" y="6" width="2" height="2" fill="#ffd7a0" />
    </svg>
  ),
  vendor: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#00080a" />
      <rect x="4" y="2" width="8" height="4" fill="#223344" />
      <rect x="4" y="6" width="8" height="1" fill="#88ffff" />
      <rect x="3" y="7" width="10" height="5" fill="#112233" />
      <rect x="6" y="8" width="4" height="2" fill="#88ffff" />
      <rect x="4" y="12" width="3" height="2" fill="#224466" />
      <rect x="9" y="12" width="3" height="2" fill="#224466" />
    </svg>
  ),
  ranger: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#071007" />
      <rect x="5" y="2" width="6" height="3" fill="#d4c2a1" />
      <rect x="3" y="5" width="10" height="1" fill="#2d4b2d" />
      <rect x="4" y="6" width="8" height="5" fill="#1f391f" />
      <rect x="4" y="12" width="3" height="2" fill="#365a2b" />
      <rect x="9" y="12" width="3" height="2" fill="#365a2b" />
    </svg>
  ),
  innkeeper: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#0b0301" />
      <rect x="5" y="2" width="6" height="3" fill="#efcfab" />
      <rect x="4" y="6" width="8" height="5" fill="#54321a" />
      <rect x="4" y="12" width="3" height="2" fill="#7a4a2a" />
      <rect x="9" y="12" width="3" height="2" fill="#7a4a2a" />
    </svg>
  ),
  blacksmith: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#060606" />
      <rect x="5" y="2" width="6" height="3" fill="#eecb9a" />
      <rect x="4" y="6" width="8" height="5" fill="#333333" />
      <rect x="7" y="8" width="2" height="2" fill="#999999" />
      <rect x="4" y="12" width="3" height="2" fill="#555555" />
      <rect x="9" y="12" width="3" height="2" fill="#555555" />
    </svg>
  ),
  witch: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#010008" />
      <rect x="5" y="2" width="6" height="3" fill="#cbb0ff" />
      <rect x="4" y="5" width="8" height="1" fill="#552288" />
      <rect x="4" y="6" width="8" height="5" fill="#331144" />
      <rect x="4" y="12" width="3" height="2" fill="#442266" />
      <rect x="9" y="12" width="3" height="2" fill="#442266" />
    </svg>
  ),
  wolf: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#000000" />
      <rect x="5" y="6" width="6" height="4" fill="#888888" />
      <rect x="4" y="5" width="2" height="6" fill="#aaaaaa" />
      <rect x="10" y="5" width="2" height="6" fill="#aaaaaa" />
    </svg>
  ),
  owl: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#02050a" />
      <rect x="5" y="4" width="6" height="4" fill="#ffd28a" />
      <rect x="4" y="8" width="8" height="4" fill="#b58b4a" />
      <rect x="6" y="6" width="1" height="1" fill="#000" />
      <rect x="9" y="6" width="1" height="1" fill="#000" />
    </svg>
  ),
  golem: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#01010a" />
      <rect x="3" y="4" width="10" height="8" fill="#556677" />
      <rect x="5" y="6" width="6" height="4" fill="#8899aa" />
    </svg>
  ),
  vault: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#01010a" />
      <rect x="2" y="2" width="12" height="12" fill="#222255" />
      <rect x="6" y="6" width="4" height="4" fill="#99aaff" />
      <rect x="5" y="5" width="6" height="1" fill="#5566aa" />
      <rect x="5" y="10" width="6" height="1" fill="#5566aa" />
    </svg>
  ),
  spider: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#000000" />
      <rect x="6" y="6" width="4" height="4" fill="#333333" />
      <rect x="4" y="5" width="2" height="2" fill="#555555" />
      <rect x="10" y="5" width="2" height="2" fill="#555555" />
      <rect x="4" y="9" width="2" height="2" fill="#555555" />
      <rect x="10" y="9" width="2" height="2" fill="#555555" />
    </svg>
  ),
  spirit: () => (
    <svg viewBox="0 0 16 16" width="64" height="64" shapeRendering="crispEdges">
      <rect width="16" height="16" fill="#000008" />
      <rect x="5" y="5" width="6" height="6" fill="#66ffee" />
      <rect x="6" y="6" width="4" height="4" fill="#99fff6" />
    </svg>
  ),
};

/* ---------- Story ---------- */
function buildStory() {
  return {
    // Original path
    intro: {
      title: "Awakening",
      emoji: "◇",
      npc: "you",
      rng: true,
      text: "You wake in a mossy ruin with a faint glow in your palm. East, a town flickers; west, a cave yawns.",
      choices: [
        { text: "Head to the town", to: "town_gate" },
        { text: "Enter the cave", to: "cave_entrance", set: { hp: -1 } },
        { text: "Search the ruin", to: "ruin_search" },
      ],
    },

    ruin_search: {
      title: "Ancient Ruin",
      emoji: "⌘",
      npc: "you",
      text: "Broken tablets under ivy. You find a dusty TORCH and a coin tucked in a crack.",
      choices: [
        {
          text: "Take TORCH and coin",
          to: "intro",
          set: { coins: 1, items: { torch: true } },
        },
        {
          text: "Inscribe your name (ominous)",
          to: "marked",
          set: { karma: -1 },
        },
      ],
    },

    marked: {
      title: "Marked",
      emoji: "✖",
      npc: "you",
      text: "Your name etches itself deeper… something is watching.",
      choices: [
        { text: "Go east (town)", to: "town_gate" },
        { text: "Go west (cave)", to: "cave_entrance" },
      ],
    },

    town_gate: {
      title: "Town Gate",
      emoji: "☗",
      npc: "guard",
      text: "A guard eyes you. 'Entry fee is 1 coin.' The market smells like fresh bread.",
      choices: [
        {
          text: "Pay 1 coin and enter",
          to: "market",
          require: { coins: 1 },
          set: { coins: -1, karma: 1 },
        },
        { text: "Try to sneak in", to: "caught", set: { karma: -1, hp: -1 } },
        { text: "Head back", to: "intro" },
      ],
    },

    caught: {
      title: "Caught!",
      emoji: "!",
      npc: "guard",
      text: "The guard grabs you. You lose face and a little blood. He tosses you out.",
      choices: [
        { text: "Return sheepishly", to: "town_gate" },
        { text: "Go west instead", to: "cave_entrance" },
      ],
    },

    market: {
      title: "Market",
      emoji: "♖",
      npc: "vendor",
      rng: true,
      text: "Stalls glitter. A hooded vendor whispers: 'Keys, maps, miracles.'",
      choices: [
        {
          text: "Buy a KEY (1c)",
          to: "market",
          require: { coins: 1 },
          set: { coins: -1, items: { key: true } },
        },
        {
          text: "Share bread with a beggar",
          to: "meet_beggar",
          set: { karma: 1 },
        },
        { text: "Head to the Town Square", to: "town_square" },
        { text: "Go to the Forest Edge", to: "forest_edge" },
        {
          text: "Night market",
          to: "night_market",
          require: { time: "night" },
        },
        {
          text: "Linger in the alleys",
          to: "market_ambush",
          require: { time: "night" },
        },
        { text: "Leave town toward the cave", to: "cave_entrance" },
      ],
    },

    meet_beggar: {
      title: "Shared Bread",
      emoji: "☘",
      npc: "beggar",
      text:
        "You break your loaf and share it. The beggar smiles, eyes bright. " +
        "'Kindness circles back,' they murmur. The air warms; something gentle stirs nearby…",
      choices: [{ text: "Continue", to: "blessing" }],
    },

    blessing: {
      title: "Small Blessing",
      emoji: "✚",
      npc: "spirit",
      text: "Warmth fills your palm. You feel tougher.",
      choices: [{ text: "Continue", to: "market", set: { hp: +1 } }],
    },

    // Town hub with festival/curfew hooks
    town_square: {
      title: "Town Square",
      emoji: "▣",
      npc: "you",
      text: "Buskers play a tune. Anvils ring nearby; lanterns glow at night.",
      choices: [
        { text: "Visit the Blacksmith", to: "blacksmith" },
        { text: "Visit the Inn", to: "inn" },
        { text: "Visit the Shrine", to: "ancient_shrine" },
        {
          text: "Help prepare the Dawn Festival",
          to: "festival_prep",
          require: { time: "day" },
        },
        {
          text: "Sneak during the curfew",
          to: "curfew_patrol",
          require: { time: "night" },
        },
        { text: "Return to the market", to: "market" },
      ],
    },

    blacksmith: {
      title: "Forge",
      emoji: "⚒",
      npc: "blacksmith",
      text: "Sparks dance. 'Steel for coin. Be quick.'",
      choices: [
        {
          text: "Buy a SWORD (2c)",
          to: "blacksmith",
          require: { coins: 2 },
          set: { coins: -2, items: { sword: true } },
        },
        { text: "Back to the square", to: "town_square" },
      ],
    },

    inn: {
      title: "Cricket Inn",
      emoji: "♨",
      npc: "innkeeper",
      text: "A cozy room smells of broth and cedar.",
      choices: [
        // Rest only once per current phase (day or night)
        {
          text: "Rest (+1 HP)",
          to: "inn",
          require: { phaseOnce: "rest" },
          set: { hp: +1 },
        },
        { text: "Return to the square", to: "town_square" },
      ],
    },

    ancient_shrine: {
      title: "Ancient Shrine",
      emoji: "⛬",
      npc: "spirit",
      text: "Wind hushes between stone pillars. Offerings glint. At dawn, the temple sings.",
      choices: [
        {
          text: "Offer 1 coin",
          to: "ancient_shrine",
          require: { coins: 1 },
          set: { coins: -1, karma: +1 },
        },
        {
          text: "Make a dawn vow (requires Feather, 3+ karma, day)",
          to: (s) =>
            s.items?.feather && s.karma >= 3 && s.time === "day"
              ? "harmony_end"
              : "ancient_shrine",
        },
        {
          text: "Lift the SIGIL to the chimes (night)",
          to: (s) =>
            s.time === "night" && s.items?.sigil
              ? "eclipse_gate"
              : "ancient_shrine",
        },
        { text: "Return to the square", to: "town_square" },
      ],
    },

    // Forest line (day/night diverge)
    forest_edge: {
      title: "Forest Edge",
      emoji: "🌲",
      npc: "ranger",
      text: "Pines crowd the path. Day birds chatter; at night, something else does.",
      choices: [
        {
          text: "Forage herbs",
          to: "forest_edge",
          require: { time: "day" },
          set: { items: { herb: true } },
        },
        {
          text: "Wolves prowl",
          to: "wolf_encounter",
          require: { time: "night" },
        },
        { text: "Find the Stone Circle", to: "stone_circle" },
        { text: "Go deeper", to: "deep_forest" },
        { text: "Back to market", to: "market" },
      ],
    },

    wolf_encounter: {
      title: "Eyes in the Brush",
      emoji: "👁",
      npc: "wolf",
      text: "A low growl. Teeth flash in the dark.",
      choices: [
        {
          text: "Drive it off (SWORD)",
          to: "forest_edge",
          require: { items: ["sword"] },
          set: { karma: -1 },
        },
        { text: "Flee (-1 HP)", to: "forest_edge", set: { hp: -1 } },
      ],
    },

    deep_forest: {
      title: "Deep Forest",
      emoji: "☼",
      npc: "ranger",
      rng: true,
      text: "Spider-silk glints. An owl watches. Glow-worms thread the air at night.",
      choices: [
        {
          text: "Follow the owl (karma≥2, day)",
          to: (s) =>
            s.karma >= 2 && s.time === "day" ? "owl_guide" : "deep_forest",
        },
        {
          text: "Seek the witch’s hut",
          to: "witch_hut",
          require: { time: "night" },
        },
        { text: "Back to the edge", to: "forest_edge" },
      ],
    },

    owl_guide: {
      title: "Old Owl",
      emoji: "🦉",
      npc: "owl",
      text: "The owl hoots softly and drops a pale feather into your palm.",
      choices: [
        {
          text: "Accept FEATHER",
          to: "deep_forest",
          set: { items: { feather: true } },
        },
      ],
    },

    witch_hut: {
      title: "Witch’s Hut",
      emoji: "☽",
      npc: "witch",
      text: "Smoke smells of mint and something stranger. 'Brew? Trade?'",
      choices: [
        {
          text: "Brew HEAL POTION (needs herb, +1c)",
          to: "witch_hut",
          require: { items: ["herb"], coins: 1 },
          set: { coins: -1, items: { potion: true } },
        },
        {
          text: "Drink a midnight draught (risky)",
          to: (s) => (s.karma < 0 ? "moon_cursed_end" : "witch_hut"),
          set: { hp: +1 },
        },
        { text: "Back to deep forest", to: "deep_forest" },
      ],
    },

    // Cave originals
    cave_entrance: {
      title: "Cave Mouth",
      emoji: "▣",
      npc: "you",
      text: "A chill drifts out. In the dark, something clicks like chitin. A locked iron door sits deeper in.",
      choices: [
        {
          text: "Light TORCH and go in",
          to: "deep_cave",
          require: { items: ["torch"] },
        },
        { text: "Feel your way in blindly", to: "deep_cave", set: { hp: -1 } },
        { text: "Return to the ruin", to: "intro" },
      ],
    },

    deep_cave: {
      title: "Deep Cave",
      emoji: "🕸",
      npc: "spider",
      rng: true,
      text: "Glittering webs. A skittering shadow circles. The iron door glows with runes.",
      choices: [
        {
          text: "Fight the spider (costs 1 HP)",
          to: "spider_fight",
          require: { hp: 2 },
          set: { hp: -1 },
        },
        { text: "Unlock iron door", to: "vault", require: { items: ["key"] } },
        {
          text: "Press MOON GLYPH to a rune (night)",
          to: (s) =>
            s.time === "night" && s.items?.glyph_moon
              ? "stone_circle"
              : "deep_cave",
        },
        { text: "Retreat to the entrance", to: "cave_entrance" },
      ],
    },

    spider_fight: {
      title: "Spider Fight",
      emoji: "⚔",
      npc: "spider",
      text: "You slash the silk. The spider recoils. A glittering pouch drops.",
      choices: [
        {
          text: "Grab pouch (+2c)",
          to: "deep_cave",
          set: { coins: +2, karma: -1 },
        },
        { text: "Spare the creature", to: "deep_cave", set: { karma: +1 } },
      ],
    },

    vault: {
      title: "Moon Vault",
      emoji: "☾",
      npc: "vault",
      text: "A pedestal holds a pulsing shard. Taking it will change you.",
      choices: [
        {
          text: "Take the shard",
          to: (s) => (s.karma >= 2 ? "good_end" : "power_end"),
          set: { hp: +2 },
        },
        { text: "Leave it be", to: "deep_cave", set: { karma: +1 } },
      ],
    },

    // Night special in town
    night_market: {
      title: "Night Market",
      emoji: "✦",
      npc: "vendor",
      text: "Lanterns sway. Strange wares whisper.",
      choices: [
        {
          text: "Buy MOON RING (2c, +1 karma)",
          to: "night_market",
          require: { coins: 2 },
          set: { coins: -2, karma: +1, items: { ring: true } },
        },
        { text: "Back to market", to: "market" },
      ],
    },

    /* =======================
       TOWN: Festival & Curfew
       ======================= */
    festival_prep: {
      title: "Festival Preparations",
      emoji: "✺",
      npc: "guard",
      text: "Banners rise. A town sergeant barks orders. 'We need hands — and honest ones.'",
      choices: [
        {
          text: "Carry lanterns (+1 karma)",
          to: "town_square",
          set: { karma: +1 },
        },
        {
          text: "Help the guard (gain WRIT)",
          to: "town_square",
          set: { items: { writ: true } },
        },
        {
          text: "Pickpocket in the bustle (+1c, -1 karma)",
          to: "town_square",
          set: { coins: +1, karma: -1 },
        },
      ],
    },

    curfew_patrol: {
      title: "Curfew Patrol",
      emoji: "⚑",
      npc: "guard",
      text: "Bootsteps echo. 'Papers!' a lantern flares in your face.",
      choices: [
        {
          text: "Present WRIT",
          to: (s) => (s.items?.writ ? "watchtower" : "curfew_patrol"),
          require: { time: "night" },
        },
        {
          text: "Bribe (1c)",
          to: "town_square",
          require: { time: "night", coins: 1 },
          set: { coins: -1, karma: -1 },
        },
        {
          text: "Fight your way out (SWORD) (-1 HP)",
          to: (s) => (s.items?.sword ? "town_square" : "curfew_patrol"),
          set: { hp: -1, karma: -1 },
        },
        { text: "Run for it (-1 HP)", to: "town_square", set: { hp: -1 } },
      ],
    },

    watchtower: {
      title: "Watchtower",
      emoji: "☗",
      npc: "guard",
      text: "The sergeant nods at your WRIT. 'Quick look, then off you go.' A chest sits under a faded banner.",
      choices: [
        {
          text: "Climb and scout the valley (learn routes)",
          to: "town_square",
          set: { karma: +1 },
        },
        {
          text: "Open the chest (KEY)",
          to: "watchtower_loot",
          require: { items: ["key"] },
        },
        { text: "Back to the square", to: "town_square" },
      ],
    },

    watchtower_loot: {
      title: "Tower Chest",
      emoji: "☼",
      npc: "guard",
      text: "Inside lies a radiant sun-etched tablet, warm to the touch.",
      choices: [
        {
          text: "Take SUN GLYPH",
          to: "town_square",
          set: { items: { glyph_sun: true } },
        },
      ],
    },

    /* =======================
       FOREST: Circle & Obelisk
       ======================= */
    stone_circle: {
      title: "Stone Circle",
      emoji: "◴",
      npc: "owl",
      text: "Weathered monoliths ring a mossy hollow. The owl watches. At night, the stones hum.",
      choices: [
        {
          text: "Study the runes",
          to: "sun_obelisk",
          require: { time: "day" },
        },
        {
          text: "Listen for the humming",
          to: "moon_well",
          require: { time: "night" },
        },
        {
          text: "Combine SUN & MOON glyphs (craft SIGIL, night)",
          to: (s) =>
            s.time === "night" && s.items?.glyph_sun && s.items?.glyph_moon
              ? "sigil_forge"
              : "stone_circle",
        },
        { text: "Back to the edge", to: "forest_edge" },
      ],
    },

    sun_obelisk: {
      title: "Sun Obelisk",
      emoji: "☀",
      npc: "golem",
      text: "A sandstone pillar gleams. Carved eyes blink slowly in the daylight.",
      choices: [
        {
          text: "Offer FEATHER at dawn (day, +1 karma)",
          to: (s) =>
            s.items?.feather && s.time === "day"
              ? "sun_obelisk_bless"
              : "sun_obelisk",
        },
        {
          text: "Trace the glyphs (take SUN GLYPH)",
          to: "stone_circle",
          set: { items: { glyph_sun: true } },
        },
        { text: "Return to the circle", to: "stone_circle" },
      ],
    },

    sun_obelisk_bless: {
      title: "Dawn’s Acknowledgment",
      emoji: "✧",
      npc: "owl",
      text: "Light pools around the feather, then sinks into the stone. You feel steadier.",
      choices: [
        {
          text: "Return to the circle",
          to: "stone_circle",
          set: { karma: +1 },
        },
      ],
    },

    moon_well: {
      title: "Moon Well",
      emoji: "☾",
      npc: "witch",
      text: "A round well reflects a hole-punch moon. Silver fish ripple the surface.",
      choices: [
        {
          text: "Dive with MOON RING (safe)",
          to: "moon_well_dive",
          require: { time: "night", items: ["ring"] },
        },
        {
          text: "Dive with TORCH (hazard, -1 HP)",
          to: "moon_well_dive",
          require: { time: "night", items: ["torch"] },
          set: { hp: -1 },
        },
        {
          text: "Steep HERB for breath (1c)",
          to: "moon_well",
          require: { time: "night", coins: 1, items: ["herb"] },
          set: { coins: -1, items: { potion: true } },
        },
        {
          text: "Drink potion and dive (night, needs POTION)",
          to: "moon_well_dive",
          require: { time: "night", items: ["potion"] },
        },
        { text: "Return to the circle", to: "stone_circle" },
      ],
    },

    moon_well_dive: {
      title: "Under the Well",
      emoji: "❂",
      npc: "witch",
      text: "Cold as a bell tone. Your fingers brush a smooth tablet in a chiseled niche.",
      choices: [
        {
          text: "Take MOON GLYPH",
          to: "stone_circle",
          set: { items: { glyph_moon: true } },
        },
      ],
    },

    sigil_forge: {
      title: "Forging the Sigil",
      emoji: "◎",
      npc: "owl",
      text: "Sunstone and moonstone kiss. Lines cross until a single circling mark remains.",
      choices: [
        {
          text: "Bind into ECLIPSE SIGIL",
          to: "stone_circle",
          set: { items: { sigil: true } },
        },
      ],
    },

    /* =======================
       MARKET: Night Trouble
       ======================= */
    market_ambush: {
      title: "Alley Ambush",
      emoji: "⚔",
      npc: "vendor",
      text: "The vendor hisses: 'Keep your head down. Cutpurses stalk the lanternlines.'",
      choices: [
        {
          text: "Pay them off (2c)",
          to: "market",
          require: { coins: 2 },
          set: { coins: -2, karma: +1 },
        },
        {
          text: "Draw SWORD",
          to: "market",
          require: { items: ["sword"] },
          set: { karma: -1 },
        },
        { text: "Flee (-1 HP)", to: "market", set: { hp: -1 } },
      ],
    },

    /* =======================
       ECLIPSE FINALE (night)
       ======================= */
    eclipse_gate: {
      title: "Eclipse Gate",
      emoji: "◐",
      npc: "golem",
      text: "With the SIGIL, the air tears like silk. A stone arch spirals with both sun-gold and moon-silver.",
      choices: [
        {
          text: "Balance the powers (karma≥2)",
          to: (s) => (s.karma >= 2 ? "eclipse_keeper_end" : "eclipse_gate"),
        },
        {
          text: "Claim the night (karma<0)",
          to: (s) => (s.karma < 0 ? "shadow_sovereign_end" : "eclipse_gate"),
        },
        {
          text: "Offer protection to the town (needs WRIT or FEATHER)",
          to: (s) =>
            s.items?.writ || s.items?.feather
              ? "dawn_warden_end"
              : "eclipse_gate",
        },
        { text: "Step back (return)", to: "stone_circle" },
      ],
    },

    // Endings
    bad_end: {
      type: "ending",
      title: "Broken Fate",
      emoji: "☠",
      npc: "you",
      text: "Your strength fails in the dark. The tale ends where light cannot reach.",
      choices: [],
    },
    good_end: {
      type: "ending",
      title: "Dawnkeeper",
      emoji: "✷",
      npc: "you",
      text: "You fuse with the shard without losing yourself. At sunrise, the town cheers — you become its quiet guardian.",
      choices: [],
    },
    power_end: {
      type: "ending",
      title: "Moon-Taker",
      emoji: "☽",
      npc: "you",
      text: "Power floods you. Mercy felt optional anyway. The world will remember your silver glare.",
      choices: [],
    },
    moon_cursed_end: {
      type: "ending",
      title: "Moon-Cursed",
      emoji: "☄",
      npc: "witch",
      text: "Night accepts you too eagerly. In the mirror, your eyes are not quite yours.",
      choices: [],
    },
    harmony_end: {
      type: "ending",
      title: "Harmony at Dawn",
      emoji: "☀",
      npc: "owl",
      text: "Feather and vow, heart and light — the temple chimes. You keep the balance between day and night.",
      choices: [],
    },

    eclipse_keeper_end: {
      type: "ending",
      title: "Eclipse Keeper",
      emoji: "✶",
      npc: "you",
      text: "You clasp day and night until they hum as one. Seasons align; harvests steady; owls roost above lanternlight.",
      choices: [],
    },

    shadow_sovereign_end: {
      type: "ending",
      title: "Shadow Sovereign",
      emoji: "◓",
      npc: "you",
      text: "Silver floods your veins. The moon keeps your counsel. Wolves quiet when you pass.",
      choices: [],
    },

    dawn_warden_end: {
      type: "ending",
      title: "Warden of Dawn",
      emoji: "☼",
      npc: "you",
      text: "You spend the SIGIL’s last warmth on the town. The gate seals. Bells ring at sunrise; your name becomes a toast.",
      choices: [],
    },
  };
}

/* ---------- Helpers ---------- */
// Helper used by meetsReq outside the component scope. Mirrors scopeKey() logic.
function _scopeKeyExternal(state, id, scope = "run") {
  const cyc = Math.floor(state.tick / 8); // CYCLE_LEN is 8 in timeOf()
  if (scope === "phase") return `${id}|phase|${state.time}|${cyc}`;
  if (scope === "cycle") return `${id}|cycle|${cyc}`;
  return `${id}|run`;
}

function meetsReq(state, require) {
  if (!require) return true;
  if (typeof require.coins === "number" && state.coins < require.coins)
    return false;
  if (typeof require.hp === "number" && state.hp < require.hp) return false;
  if (typeof require.karma === "number" && state.karma < require.karma)
    return false;
  if (require.items)
    for (const it of require.items) if (!state.items?.[it]) return false;
  if (require.time && state.time !== require.time) return false;

  // Support simple phaseOnce shorthand: { phaseOnce: "rest" }
  if (require.phaseOnce) {
    const key = _scopeKeyExternal(state, require.phaseOnce, "phase");
    const used = state.uses?.[key] ?? 0;
    if (used >= 1) return false;
  }

  // Generic limiter: { limit: { id: "rest", scope: "phase" | "cycle" | "run", max: 1 } }
  if (require.limit) {
    const { id, scope = "run", max = 1 } = require.limit;
    const key = _scopeKeyExternal(state, id, scope);
    const used = state.uses?.[key] ?? 0;
    if (used >= max) return false;
  }
  return true;
}

function resolveGoto(to, state) {
  if (!to) return state.node;
  if (typeof to === "function") return to(state);
  if (typeof to === "string") return to;
  return state.node;
}

function clampNumber(n) {
  if (Number.isNaN(Number(n))) return 0;
  return Math.max(-99, Math.min(99, Number(n)));
}

function renderText(text, state) {
  if (!text) return "";
  return String(text)
    .replaceAll("{HP}", String(state.hp))
    .replaceAll("{COINS}", String(state.coins))
    .replaceAll("{KARMA}", String(state.karma))
    .replaceAll("{TIME}", state.time);
}

function makeSeed() {
  return Math.floor(Math.random() * 1e9).toString(16);
}

function rng(seedStr) {
  // xmur3 string hash → 32-bit seed
  function xmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  // mulberry32 PRNG
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const seed = xmur3(seedStr)();
  return mulberry32(seed);
}

function timeOf(tick) {
  // 0-3 = day, 4-7 = night, then repeat
  return tick % 8 < 4 ? "day" : "night";
}

function StartOverlay({ onStart }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart]);

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* keep original image, no zoom, pinned to RIGHT */}
      <div
        className="absolute inset-0"
        aria-hidden
        style={{
          backgroundImage: "url('/start-screen.png')",
          backgroundRepeat: "no-repeat",
          backgroundSize: "cover",
          // bump up a touch — responsive across sizes
          backgroundPosition: "center calc(50% - 2vmin)",
          backgroundColor: "#000",
          imageRendering: "pixelated",
        }}
      />

      {/* button */}
      <div className="absolute inset-0 grid place-items-center p-6">
        <button
          onClick={onStart}
          className="px-btn px-orange pixel text-3xl"
          style={{ minWidth: 220 }}
          aria-label="Start the game"
        >
          <span className="px-icon">▶</span>
          <span className="px-label">START</span>
          <span aria-hidden className="px-gloss" />
        </button>
      </div>
    </div>
  );
}

function weatherOf(seed, tick, cycleLen = 8) {
  const cyc = Math.floor(tick / cycleLen);
  const r = rng(`${seed}|wx|${cyc}`);
  const roll = r();
  if (roll < 0.5) return "clear";
  if (roll < 0.75) return "rain";
  if (roll < 0.9) return "fog";
  if (roll < 0.98) return "storm";
  return "snow";
}

function weatherIcon(wx) {
  return wx === "clear"
    ? "⛅︎"
    : wx === "rain"
    ? "☔"
    : wx === "fog"
    ? "🌫"
    : wx === "storm"
    ? "⚡"
    : wx === "snow"
    ? "❄"
    : "⛅︎";
}
function labelWeather(wx) {
  return wx[0].toUpperCase() + wx.slice(1);
}
