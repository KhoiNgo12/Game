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

  const story = useMemo(() => buildStory(), []);
  const node = story[state.node];
  const available = (node?.choices || []).filter((c) =>
    meetsReq(state, c.require)
  );
  const isEnding = node?.type === "ending" || state.hp <= 0;
  const PATH_MAX = 60; // how many steps to keep in memory
  const SAVE_HISTORY_MAX = 30; // how many *lite* steps to persist
  const CYCLE_LEN = 8; // your day+night length (from timeOf)

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
    if (hard) {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {}
    }
    setState((s) =>
      hard
        ? { ...initialState, seed: makeSeed() } // brand-new run
        : { ...initialState, seed: s.seed } // replay same seed
    );
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

      // Apply stat/item deltas
      if (choice.set) {
        for (const [k, v] of Object.entries(choice.set)) {
          if (k === "items") next.items = { ...next.items, ...v };
          else next[k] = clampNumber((next[k] ?? 0) + Number(v));
        }
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
      const currentNode = story[s.node];
      if (currentNode?.rng) {
        const r = rng(`${next.seed}:${next.tick}`); // different draw each step
        if (r() < 0.35) next.coins += 1;
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

      // Decide destination first (so we can inspect it)
      const dest = resolveGoto(choice.to, next);

      // --- FX: omen pop-up if this choice can influence endings
      const ENDING_KEYS = new Set([
        "feather",
        "glyph_sun",
        "glyph_moon",
        "sigil",
        "writ",
      ]);
      let affectsEnding = false;
      if (choice.set?.karma) affectsEnding = true;
      if (choice.set?.items) {
        for (const k of Object.keys(choice.set.items)) {
          if (ENDING_KEYS.has(k)) {
            affectsEnding = true;
            break;
          }
        }
      }
      const destDef = story[dest];
      if (destDef?.type === "ending" || dest === "eclipse_gate")
        affectsEnding = true;
      if (affectsEnding) {
        next.fx = { ...(next.fx || {}), omen: (next.fx?.omen || 0) + 1 };
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

  const night = state.time === "night";

  return (
    <div className="min-h-screen bg-black text-green-300 flex items-center justify-center p-4">
      <div className="grid gap-3 w-full max-w-6xl md:grid-cols-[300px,1fr]">
        {/* Sidebar */}
        <aside className="p-3 rounded-2xl border border-green-700 shadow-xl backdrop-blur-sm crt">
          <h1 className="text-2xl font-bold tracking-widest pixel">
            8-BIT QUEST
          </h1>
          <p className="text-xs text-green-400/80 mt-1">Every choice matters.</p>

          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <Stat label="HP" value={state.hp} icon="❤" bad={state.hp <= 2} />
            <Stat label="COIN" value={state.coins} icon="◎" />
            <Stat label="KARMA" value={state.karma} icon="✚" />
            <Stat
              label={night ? "NIGHT" : "DAY"}
              value=""
              icon={night ? "☾" : "☀"}
            />
          </div>

          <div className="mt-3">
            <h2 className="text-sm font-bold text-green-400/90">Inventory</h2>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {Object.keys(state.items).length === 0 && <Badge>empty</Badge>}
              {Object.entries(state.items).map(([k, v]) =>
                v ? <Badge key={k}>{k}</Badge> : null
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2 flex-wrap">
            <Btn onClick={backOne} disabled={state.history.length === 0}>
              ◀ Back
            </Btn>
            <Btn onClick={() => restart(false)}>↻ Restart</Btn>
            <Btn onClick={() => advanceTime(1)} title="Advance time one step">
              Wait {night ? "☀" : "☾"}
            </Btn>
          </div>

          <p className="mt-2 text-[10px] text-green-400/70">
            Auto-saves locally. Seed: {state.seed} • Time: {state.time} (t
            {state.tick})
          </p>
        </aside>

        {/* Main */}
        <main
          className={`p-4 rounded-2xl border border-green-700 shadow-2xl relative overflow-hidden crt
            ${
              night
                ? "bg-[linear-gradient(180deg,#02040a_0%,#05131b_100%)]"
                : "bg-[linear-gradient(180deg,#03140e_0%,#062116_100%)]"
            }`}
        >
          <Scanlines />
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
              <div className="fx-omen pixel">“The Obelisk marks your path.”</div>
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
            <NodeTitle node={node} hp={state.hp} time={state.time} />
            <Avatar who={node?.npc || "you"} />

            <p className="mt-2 leading-relaxed text-green-100/90 whitespace-pre-wrap">
              {renderText(node?.text, state)}
            </p>

            <div className="mt-4 grid gap-2">
              {!isEnding &&
                available.map((c, i) => (
                  <ChoiceButton
                    key={i}
                    choice={c}
                    onChoose={() => takeChoice(c)}
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
                    <Btn onClick={() => restart(false)}>Play Again</Btn>
                    <Btn onClick={() => restart(true)}>New Run (new stats)</Btn>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 text-[11px] text-green-400/70">
              Path: {summarizePath(state.history, state.node, 18)}
            </div>
          </div>
        </main>
      </div>

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
      `}</style>
    </div>
  );
}

/* ---------- UI bits ---------- */
function NodeTitle({ node, hp, time }) {
  if (hp <= 0)
    return (
      <h2 className="pixel text-2xl font-black text-red-300">☠ You Died</h2>
    );
  const timeTag = time === "night" ? "☾ Night" : "☀ Day";
  return (
    <h2 className="pixel text-2xl font-black">
      {node?.emoji || "▣"} {node?.title || "Unknown"}{" "}
      <span className="text-green-400/70 text-base">• {timeTag}</span>
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

function Stat({ label, value, icon, bad = false }) {
  return (
    <div
      className={`rounded-xl border px-2 py-1 ${
        bad ? "border-red-500 text-red-300" : "border-green-600"
      }`}
    >
      <div className="text-[10px] tracking-widest text-green-400/70">
        {label}
      </div>
      <div className="text-lg font-black pixel flex items-center justify-center gap-1">
        <span>{icon}</span>
        <span>{value}</span>
      </div>
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
  // guard: "/avatar/Guard.png", etc. (optional)
};

/* ---------- Avatars (pixel SVGs) ---------- */
function Avatar({ who }) {
  const src = IMAGES[who];
  const Sprite = SPRITES[who]; // fallback

  return (
    <div className="mt-3 mb-2">
      {/* compact portrait frame with bottom caption OVERLAY */}
      <div
        className="
            relative rounded-xl border border-green-700 bg-black/60 overflow-hidden
            w-[128px] h-[176px]
          "
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
      text:
        "You wake in a mossy ruin with a faint glow in your palm. East, a town flickers; west, a cave yawns.",
      choices: [
        { text: "Head to the town", to: "town_gate", set: { karma: 1 } },
        { text: "Enter the cave", to: "cave_entrance", set: { hp: -1 } },
        { text: "Search the ruin", to: "ruin_search" },
      ],
    },

    ruin_search: {
      title: "Ancient Ruin",
      emoji: "⌘",
      npc: "you",
      text:
        "Broken tablets under ivy. You find a dusty TORCH and a coin tucked in a crack.",
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
      text:
        "A guard eyes you. 'Entry fee is 1 coin.' The market smells like fresh bread.",
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
      text:
        "The guard grabs you. You lose face and a little blood. He tosses you out.",
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
          to: "blessing",
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
      ],
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
      text:
        "Buskers play a tune. Anvils ring nearby; lanterns glow at night.",
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
      text:
        "Wind hushes between stone pillars. Offerings glint. At dawn, the temple sings.",
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
      text:
        "Pines crowd the path. Day birds chatter; at night, something else does.",
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
      text:
        "Spider-silk glints. An owl watches. Glow-worms thread the air at night.",
      choices: [
        {
          text: "Follow the owl (karma≥2, day)",
          to: (s) =>
            s.karma >= 2 && s.time === "day" ? "owl_guide" : "deep_forest",
        },
        {
          text: "Seek the witch’s hut (night)",
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
      text:
        "A chill drifts out. In the dark, something clicks like chitin. A locked iron door sits deeper in.",
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
      text:
        "Glittering webs. A skittering shadow circles. The iron door glows with runes.",
      choices: [
        {
          text: "Fight the spider",
          to: (s) => (s.hp >= 2 ? "spider_fight" : "bad_end"),
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
      text:
        "You slash the silk. The spider recoils. A glittering pouch drops.",
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
      text:
        "Banners rise. A town sergeant barks orders. 'We need hands — and honest ones.'",
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
      text:
        "The sergeant nods at your WRIT. 'Quick look, then off you go.' A chest sits under a faded banner.",
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
      text:
        "Inside lies a radiant sun-etched tablet, warm to the touch.",
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
      text:
        "Weathered monoliths ring a mossy hollow. The owl watches. At night, the stones hum.",
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
      text:
        "A sandstone pillar gleams. Carved eyes blink slowly in the daylight.",
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
      text:
        "Light pools around the feather, then sinks into the stone. You feel steadier.",
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
      text:
        "A round well reflects a hole-punch moon. Silver fish ripple the surface.",
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
      text:
        "Cold as a bell tone. Your fingers brush a smooth tablet in a chiseled niche.",
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
      text:
        "Sunstone and moonstone kiss. Lines cross until a single circling mark remains.",
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
      text:
        "The vendor hisses: 'Keep your head down. Cutpurses stalk the lanternlines.'",
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
      text:
        "With the SIGIL, the air tears like silk. A stone arch spirals with both sun-gold and moon-silver.",
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
      text:
        "You fuse with the shard without losing yourself. At sunrise, the town cheers — you become its quiet guardian.",
      choices: [],
    },
    power_end: {
      type: "ending",
      title: "Moon-Taker",
      emoji: "☽",
      npc: "you",
      text:
        "Power floods you. Mercy felt optional anyway. The world will remember your silver glare.",
      choices: [],
    },
    moon_cursed_end: {
      type: "ending",
      title: "Moon-Cursed",
      emoji: "☄",
      npc: "witch",
      text:
        "Night accepts you too eagerly. In the mirror, your eyes are not quite yours.",
      choices: [],
    },
    harmony_end: {
      type: "ending",
      title: "Harmony at Dawn",
      emoji: "☀",
      npc: "owl",
      text:
        "Feather and vow, heart and light — the temple chimes. You keep the balance between day and night.",
      choices: [],
    },

    eclipse_keeper_end: {
      type: "ending",
      title: "Eclipse Keeper",
      emoji: "✶",
      npc: "you",
      text:
        "You clasp day and night until they hum as one. Seasons align; harvests steady; owls roost above lanternlight.",
      choices: [],
    },

    shadow_sovereign_end: {
      type: "ending",
      title: "Shadow Sovereign",
      emoji: "◓",
      npc: "you",
      text:
        "Silver floods your veins. The moon keeps your counsel. Wolves quiet when you pass.",
      choices: [],
    },

    dawn_warden_end: {
      type: "ending",
      title: "Warden of Dawn",
      emoji: "☼",
      npc: "you",
      text:
        "You spend the SIGIL’s last warmth on the town. The gate seals. Bells ring at sunrise; your name becomes a toast.",
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
  let h = 2166136261 ^ [...seedStr].reduce((a, c) => a + c.charCodeAt(0), 0);
  return function () {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function timeOf(tick) {
  // 0-3 = day, 4-7 = night, then repeat
  return tick % 8 < 4 ? "day" : "night";
}
