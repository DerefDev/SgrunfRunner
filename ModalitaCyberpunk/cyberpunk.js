'use strict';

/* ============================================================
   SGRUNF CYBERPUNK RUNNER
   Missione 8 — L'Arcade Segreto di Sgrunf
   Sarnano Comix Quest — Compagnia di Sottomonte
   ============================================================ */


/* ============================================================
   SEZIONE 1 — CONFIGURAZIONE ADMIN
   ============================================================ */

/** Codice ricompensa a 500 punti */
const CODICE_PREMIO_500  = 'PREMIO500';

/** Codice ricompensa a 1000 punti */
const CODICE_PREMIO_1000 = 'BONUS1000';

/** Percorso asset relativo a cyberpunk.html */
const ASSET_PATH = './assets/';
const ASSET_PATH_PNG = './assets/png/';

/**
 * CONFIG centralizzata — tutti i parametri di gioco.
 *
 * NOTA GEOMETRICA:
 *   Canvas interno: 1280 × 720 px (16:9).
 *   CyberpunkBg_5.png viene scalata per riempire l'intera altezza (720 px).
 *   La strada visibile nell'artwork occupa circa l'80–85% dell'altezza
 *   dell'immagine originale. Il piano di corsa (groundY) è impostato a
 *   620 px, corrispondente alla superficie superiore della carreggiata in
 *   BG5 scalata a 720 px. Può essere affinato misurando BG5 con un editor:
 *     groundY = Math.round(bg5_altezza_px_suolo / bg5_altezza_nat * 720)
 */
const CONFIG = {
  soglie: {
    premio1: 500,
    premio2: 1000,
  },
  canvas: {
    larghezza: 1280,   // risoluzione interna 16:9
    altezza:   720,
    /*
     * groundY — coordinata Y del piano di corsa (punto più basso del player).
     * Calcolata in base alla strada visibile in CyberpunkBg_5.png scalata a 720 px.
     */
    groundY: 707,
  },
  player: {
    x:          140,    // posizione X fissa del player
    scala:      0.85,   // scala spritesheet Sgrunf
    v0Salto:   -17,     // velocità verticale iniziale salto (negativo = su)
    gravita:    0.75,   // px/frame² di accelerazione gravitazionale
  },
  ostacoli: {
    scala:      1.50,   // scala ostacoli base
    scalaSmall: 2.60,   // scala extra per OstacoliCyberpunk3 (sprite piccolo)
    /*
     * Il drone vola leggermente sopra la testa del player.
     * calcolaDroneY() calcola il valore dinamicamente dopo il caricamento asset.
     * altezzaDroneFissa è un fallback di sicurezza (px dal suolo).
     */
    altezzaDroneFissa: 130,
  },
  velocita: {
    iniziale:      6.0,
    accelerazione: 1.2e-3,   // incremento velocità per frame
    massima:       20,
  },
  spawn: {
    /*
     * Intervalli in frame tra spawn successivi.
     * Variabili e casuali per rendere il ritmo imprevedibile.
     * L'intervallo minimo si riduce progressivamente con il punteggio
     * per aumentare la frequenza degli ostacoli nel tempo.
     */
    intervalloMinBase:  55,   // intervallo minimo base (all'inizio partita)
    intervalloMinFloor: 25,   // intervallo minimo assoluto (limite inferiore)
    intervalloMax:     140,
    distanzaMinPx:     400,   // distanza minima tra bordo destro ultimo ostacolo e canvas

    /*
     * Probabilità doppio spawn (0–1): attiva solo dopo 200 punti.
     * Prima di 200 punti vengono generati solo ostacoli singoli.
     */
    probDoppio: 0.22,

    /*
     * Probabilità triplo spawn (0–1): attiva solo dopo 750 punti.
     * Un triplo è un doppio a cui si aggiunge un terzo ostacolo terrestre.
     * La verifica di superabilità si applica anche al terzo elemento.
     */
    probTriplo: 0.14,
  },
  animazione: {
    tickCorsa:  8,   // frame di gioco per avanzare un frame di corsa
    tickMorte: 3,    // frame di gioco per avanzare un frame di morte (rapida)
  },
  punteggio: {
    /*
     * Il punteggio aumenta di 1 punto ogni mxPunto millisecondi di gioco.
     * A 250ms/punto: 500pt ≈ 125 secondi, 1000pt ≈ 250 secondi di gioco.
     */
    mxPunto: 250,
  },
};

/** Percorso suoni */
const SOUND_PATH = ASSET_PATH + 'sounds/';

/*
 * AUDIO ARCHITECTURE — due sistemi separati per tipo di suono:
 *
 * 1) HTMLAudioElement — solo per il tema musicale (lungo, loopato).
 *    Adatto a stream audio continui; il costo di play()/pause() è accettabile
 *    perché chiamato di rado (avvio/fine partita).
 *
 * 2) Web Audio API (AudioContext + AudioBuffer) — per suoni brevi (jump, dead).
 *    Motivo: su iOS/Android, HTMLAudioElement.play() tocca il sottosistema audio
 *    sul main thread e causa uno spike di 5–30 ms esattamente nel frame del salto.
 *    Con AudioContext.createBufferSource() + source.start() l'audio viene schedato
 *    fuori dal main thread senza bloccare rAF. È lo stesso approccio di Phaser/Pixi.
 */

/** Tema musicale — HTMLAudioElement (stream lungo, loopato) */
const suoni = {
  theme: new Audio(SOUND_PATH + 'theme.mp3'),
};
suoni.theme.loop    = true;
suoni.theme.volume  = 0.7;
suoni.theme.preload = 'auto';

/**
 * Web Audio API context e buffer cache per SFX brevi.
 * Il context viene creato al primo gesto utente (requisito iOS/Android autoplay policy).
 * I buffer vengono pre-caricati una volta sola e riutilizzati a ogni play.
 */
let _audioCtx = null;
const _sfxBuffers = {};   // { 'jump': AudioBuffer, 'dead': AudioBuffer }

/**
 * Crea (o restituisce) l'AudioContext globale.
 * Su iOS il context deve essere ripreso (resumed) dopo un gesto utente.
 * @returns {AudioContext|null}
 */
function getAudioCtx() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (_) { return null; }
  }
  // iOS sospende il context finché non avviene un gesto utente
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

/**
 * Pre-carica un file audio come AudioBuffer e lo salva in cache.
 * Deve essere chiamata dopo che l'utente ha interagito (altrimenti
 * fetch+decode funziona ma start() è silenzioso su alcuni browser).
 * @param {string} nome  - chiave cache ('jump' | 'dead')
 * @param {string} url   - percorso file audio
 */
async function preloadSfx(nome, url) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const res    = await fetch(url);
    const arr    = await res.arrayBuffer();
    _sfxBuffers[nome] = await ctx.decodeAudioData(arr);
  } catch (_) {}
}

/**
 * Riproduce un SFX pre-caricato via Web Audio API.
 * createBufferSource è leggero (solo puntatori, nessuna allocazione audio).
 * start(0) è non-bloccante: schedato sul thread audio, non sul main thread.
 * @param {string} nome - chiave cache ('jump' | 'dead')
 * @param {number} [volume=1]
 */
function playSfx(nome, volume = 1) {
  const ctx = getAudioCtx();
  if (!ctx || !_sfxBuffers[nome]) return;
  try {
    const src  = ctx.createBufferSource();
    src.buffer = _sfxBuffers[nome];
    if (volume !== 1) {
      const gain       = ctx.createGain();
      gain.gain.value  = volume;
      src.connect(gain);
      gain.connect(ctx.destination);
    } else {
      src.connect(ctx.destination);
    }
    src.start(0);
  } catch (_) {}
}

/**
 * Riproduce un suono HTMLAudioElement in modo sicuro (usato solo per il tema).
 * @param {HTMLAudioElement} audio
 */
function playSound(audio) {
  try {
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (_) {}
}


/* ============================================================
   SEZIONE 2 — DATI SPRITESHEET
   ============================================================ */

/** Frame dello spritesheet di Sgrunf */
const SGRUNF_RAW_JSON = {
  "frames": {
    "SgrunfCyberPunk_Statico":  { "frame": { "x": 0,    "y": 0, "w": 106, "h": 124 } },
    "SgrunfCyberPunk_Corsa1":   { "frame": { "x": 106,  "y": 0, "w": 86,  "h": 122 } },
    "SgrunfCyberPunk_Corsa2":   { "frame": { "x": 192,  "y": 0, "w": 88,  "h": 120 } },
    "SgrunfCyberPunk_Corsa3":   { "frame": { "x": 280,  "y": 0, "w": 88,  "h": 124 } },
    "SgrunfCyberPunk_Corsa4":   { "frame": { "x": 368,  "y": 0, "w": 92,  "h": 122 } },
    "SgrunfCyberPunk_Corsa5":   { "frame": { "x": 460,  "y": 0, "w": 92,  "h": 122 } },
    "SgrunfCyberPunk_Corsa6":   { "frame": { "x": 552,  "y": 0, "w": 86,  "h": 122 } },
    "SgrunfCyberPunk_Salto1":   { "frame": { "x": 638,  "y": 0, "w": 110, "h": 122 } },
    "SgrunfCyberPunk_Salto2":   { "frame": { "x": 748,  "y": 0, "w": 116, "h": 114 } },
    "SgrunfCyberPunk_Salto3":   { "frame": { "x": 864,  "y": 0, "w": 88,  "h": 114 } },
    "SgrunfCyberpunkMorte1":    { "frame": { "x": 952,  "y": 0, "w": 112, "h": 110 } },
    "SgrunfCyberpunkMorte2":    { "frame": { "x": 1064, "y": 0, "w": 116, "h": 112 } },
    "SgrunfCyberpunkMorte3":    { "frame": { "x": 1180, "y": 0, "w": 108, "h": 100 } }
  }
};

/** Frame dello spritesheet degli ostacoli */
const OSTACOLI_RAW_JSON = {
  "frames": {
    "OstacoliCyberpunk1": { "frame": { "x": 0,   "y": 0, "w": 62, "h": 39 } },
    "OstacoliCyberpunk2": { "frame": { "x": 62,  "y": 0, "w": 45, "h": 50 } },
    "OstacoliCyberpunk3": { "frame": { "x": 107, "y": 0, "w": 32, "h": 19 } },
    "OstacoliCyberpunk4": { "frame": { "x": 139, "y": 0, "w": 48, "h": 48 } },
    "Drone":              { "frame": { "x": 187, "y": 0, "w": 54, "h": 47 } }
  }
};

/** Appiattisce i JSON di Texture Packer: { nomeFrame: { x, y, w, h } } */
function flattenFrames(rawJson) {
  const out  = {};
  const keys = Object.keys(rawJson.frames);
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = rawJson.frames[keys[i]].frame;
  }
  return out;
}

const SGRUNF_FRAMES   = flattenFrames(SGRUNF_RAW_JSON);
const OSTACOLI_FRAMES = flattenFrames(OSTACOLI_RAW_JSON);

/* Sequenze frame per ogni stato animativo */
const FRAMES_CORSA = [
  'SgrunfCyberPunk_Corsa1', 'SgrunfCyberPunk_Corsa2',
  'SgrunfCyberPunk_Corsa3', 'SgrunfCyberPunk_Corsa4',
  'SgrunfCyberPunk_Corsa5', 'SgrunfCyberPunk_Corsa6',
];
const FRAMES_SALTO = ['SgrunfCyberPunk_Salto1', 'SgrunfCyberPunk_Salto2', 'SgrunfCyberPunk_Salto3'];
const FRAMES_MORTE = ['SgrunfCyberpunkMorte1',  'SgrunfCyberpunkMorte2',  'SgrunfCyberpunkMorte3'];

/* Tipi di ostacoli terrestri */
const TIPI_TERRESTRI = ['OstacoliCyberpunk1', 'OstacoliCyberpunk2', 'OstacoliCyberpunk3', 'OstacoliCyberpunk4'];

/** Configurazione per tipo di ostacolo */
const OSTACOLO_CFG = {
  OstacoliCyberpunk1: { aereo: false, scala: CONFIG.ostacoli.scala },
  OstacoliCyberpunk2: { aereo: false, scala: CONFIG.ostacoli.scala },
  OstacoliCyberpunk3: { aereo: false, scala: CONFIG.ostacoli.scalaSmall },
  OstacoliCyberpunk4: { aereo: false, scala: CONFIG.ostacoli.scala },
  Drone:              { aereo: true,  scala: CONFIG.ostacoli.scala },
};


/* ============================================================
   SEZIONE 3 — SETUP CANVAS (16:9 rigido, responsive via CSS)
   Il canvas ha dimensioni interne fisse 1280×720.
   Il ridimensionamento per adattarsi allo schermo è gestito solo
   tramite CSS, senza toccare le coordinate interne.
   ============================================================ */

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d', { alpha: false });

const CW = CONFIG.canvas.larghezza;  // 1280 px logici
const CH = CONFIG.canvas.altezza;    // 720 px logici
const GY = CONFIG.canvas.groundY;    // piano di corsa sulla strada BG5

canvas.width  = CW;
canvas.height = CH;

/**
 * Calcola la coordinata Y fissa del drone in modo che il suo bordo
 * inferiore sia almeno 12 px sopra la testa del player nel frame
 * di corsa più alto.
 *
 * Formula:
 *   altMaxPlayer = max(frame.h) * scala_player
 *   droneYfondo  = GY - altMaxPlayer - 12
 *   droneY       = droneYfondo - droneH
 *
 * Viene chiamata una sola volta dopo il caricamento degli asset.
 */
function calcolaDroneY(droneH) {
  // PLAYER_ALT_MAX_PX è pre-calcolato nel callback caricaAsset
  const droneYfondo = GY - PLAYER_ALT_MAX_PX - 12;
  return droneYfondo - droneH;
}

/** Coordinata Y fissa del drone (impostata dopo caricamento asset) */
let DRONE_Y_FISSO = null;

/**
 * Pre-calcolato una volta sola dopo il caricamento asset.
 * Altezza massima del player considerando tutti i frame di corsa.
 * Evita di rieseguire reduce() a ogni chiamata di getTestaMaxY().
 */
let PLAYER_ALT_MAX_PX = 0;


/* ============================================================
   SEZIONE 4 — CARICAMENTO ASSET
   ============================================================ */

const imgs = {};

const isTouch = window.matchMedia("(pointer: coarse)").matches || ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

const ASSET_MAP = {
    bg1:      ASSET_PATH_PNG + 'CyberpunkBg_1.png',
    bg2:      ASSET_PATH_PNG + 'CyberpunkBg_2.png',
    bg3:      ASSET_PATH_PNG + 'CyberpunkBg_3.png',
    bg4:      ASSET_PATH_PNG + 'CyberpunkBg_4.png',
    bg5:      ASSET_PATH_PNG + 'CyberpunkBg_5.png',
    sgrunf:   ASSET_PATH_PNG + 'SgrunfCyberpunk_Spritesheet.png',
    ostacoli: ASSET_PATH_PNG + 'OstacoliCyberpunk_Spritesheet.png',
  };

let assetsCaricati = 0;
const TOTALE_ASSET = Object.keys(ASSET_MAP).length;

function caricaAsset(callback) {
  const keys = Object.keys(ASSET_MAP);
  for (let i = 0; i < keys.length; i++) {
    const chiave = keys[i];
    const src    = ASSET_MAP[chiave];
    const img    = new Image();
    img.onload = img.onerror = () => {
      assetsCaricati++;
      if (assetsCaricati === TOTALE_ASSET) callback();
    };
    img.src       = src;
    imgs[chiave]  = img;
  }
}


/* ============================================================
   SEZIONE 5 — PARALLAX LAYER
   Gestisce lo scorrimento infinito di un singolo strato di sfondo.
   Il loop è garantito matematicamente: la tile viene ripetuta
   fino a coprire l'intera larghezza del canvas + una tile extra.
   ============================================================ */

class ParallaxLayer {
  /**
   * @param {HTMLImageElement} img
   * @param {number}  speedFactor  - moltiplicatore velocità scroll
   */
  constructor(img, speedFactor) {
    this.img         = img;
    this.speedFactor = speedFactor;
    this.offset      = 0;
    this._drawW      = 0;  // pre-calcolato al primo draw
  }

  update(velocitaBase, dt) {
    this.offset += velocitaBase * this.speedFactor * (dt / 16.667);
  }

  draw() {
    const img = this.img;
    if (!img.complete || !img.naturalWidth) return;

    if (!this._drawW) {
      this._drawW = img.naturalWidth * (CH / img.naturalHeight);
    }

    const drawW = this._drawW;

    // Offset intero: evita sub-pixel rendering
    const scrollX = (this.offset % drawW) | 0;

    let startX = -scrollX;
    if (startX > 0) startX -= drawW;
    for (let x = startX; x < CW; x += drawW) {
      ctx.drawImage(img, x, 0, drawW, CH);
    }
  }
}


/*
 * CACHE DIMENSIONI SPRITE PRE-CALCOLATE (solo numeri, nessuna allocazione GPU)
 * Popolata durante il loading in precalcolaDimensioni().
 */
const SGRUNF_DIM   = {};  // { nomFrame: { dw, dh } }
const OSTACOLI_DIM = {};  // { tipo:     { dw, dh } }
const OSTACOLI_HB  = {};  // { tipo:     { w, h } }  — hitbox con margine sottratto

/**
 * Pre-calcola tutte le dimensioni scalate di sprite e hitbox.
 * Solo aritmetica intera: nessuna allocazione canvas/GPU, nessun blocco del main thread.
 */
function precalcolaDimensioni() {
  const sc = CONFIG.player.scala;
  const tuttiFrameSgrunf = Object.keys(SGRUNF_FRAMES);
  for (let i = 0; i < tuttiFrameSgrunf.length; i++) {
    const nome = tuttiFrameSgrunf[i];
    const fd   = SGRUNF_FRAMES[nome];
    SGRUNF_DIM[nome] = { dw: Math.round(fd.w * sc), dh: Math.round(fd.h * sc) };
  }

  const tipiOstacoli = Object.keys(OSTACOLI_FRAMES);
  const m = 8;
  for (let i = 0; i < tipiOstacoli.length; i++) {
    const tipo = tipiOstacoli[i];
    const fd   = OSTACOLI_FRAMES[tipo];
    const sc2  = OSTACOLO_CFG[tipo].scala;
    const dw   = Math.round(fd.w * sc2);
    const dh   = Math.round(fd.h * sc2);
    OSTACOLI_DIM[tipo] = { dw, dh };
    OSTACOLI_HB[tipo]  = { w: dw - m * 2, h: dh - m * 2 };
  }
}





/* ============================================================
   SEZIONE 5B — PRE-RENDER SPRITE SU OFFSCREEN CANVAS
   Pre-renderizza ogni frame sprite su canvas separati in fase di
   loading così il draw loop usa solo drawImage(offscreen) che è
   una singola operazione GPU senza slice dell'atlas spritesheet.
   ============================================================ */

/*
 * Cache dei canvas pre-renderizzati.
 * Struttura: { nomeFrame: OffscreenCanvas|HTMLCanvasElement }
 */
const SGRUNF_CACHE   = {};
const OSTACOLI_CACHE = {};

/**
 * Crea un canvas (OffscreenCanvas se disponibile) con le dimensioni
 * dello sprite scalato e vi disegna il frame ritagliato dall'atlas.
 */
function _creaFrameCanvas(atlasImg, frame, dw, dh) {
  const oc = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(dw, dh)
    : (() => { const c = document.createElement('canvas'); c.width = dw; c.height = dh; return c; })();
  const octx = oc.getContext('2d', { alpha: true });
  octx.drawImage(atlasImg, frame.x, frame.y, frame.w, frame.h, 0, 0, dw, dh);
  return oc;
}

/**
 * Pre-renderizza tutti i frame Sgrunf e Obstacle su canvas dedicati.
 * Chiamato una volta sola dopo il caricamento delle immagini.
 * Dopo questa chiamata draw() usa solo i canvas pre-renderizzati.
 */
function prebuildSprites() {
  // precalcolaDimensioni popola SGRUNF_DIM e OSTACOLI_DIM (idempotente se già chiamata)
  if (Object.keys(SGRUNF_DIM).length === 0) precalcolaDimensioni();

  // Sgrunf
  const tuttiFrameSgrunf = Object.keys(SGRUNF_FRAMES);
  for (let i = 0; i < tuttiFrameSgrunf.length; i++) {
    const nome = tuttiFrameSgrunf[i];
    const fd   = SGRUNF_FRAMES[nome];
    const dim  = SGRUNF_DIM[nome];
    SGRUNF_CACHE[nome] = _creaFrameCanvas(imgs.sgrunf, fd, dim.dw, dim.dh);
  }

  // Ostacoli
  const tipiOstacoli = Object.keys(OSTACOLI_FRAMES);
  for (let i = 0; i < tipiOstacoli.length; i++) {
    const tipo = tipiOstacoli[i];
    const fd   = OSTACOLI_FRAMES[tipo];
    const dim  = OSTACOLI_DIM[tipo];
    OSTACOLI_CACHE[tipo] = _creaFrameCanvas(imgs.ostacoli, fd, dim.dw, dim.dh);
  }
}

/**
 * Scalda il font engine pre-disegnando (e scartando) testi fuori schermo.
 * Evita il jank del primo fillText in-game su browser con lazy font loading.
 */
function prewarmFont() {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = 0;
  ctx.font = "bold 26px 'Courier New', Courier, monospace";
  ctx.fillText('0', -100, -100);
  ctx.font = "bold 22px 'Courier New', Courier, monospace";
  ctx.fillText('0', -100, -100);
  ctx.globalAlpha = prev;
}


/*
 * Soglie di animazione pre-calcolate in millisecondi.
 * Evita di moltiplicare CONFIG.animazione.tick* × 16.667 a ogni frame.
 */
const SOGLIA_CORSA_MS = CONFIG.animazione.tickCorsa * 16.667;
const SOGLIA_MORTE_MS = CONFIG.animazione.tickMorte * 16.667;

const STATO_ANIM = { RUN: 'run', JUMP: 'jump', DEATH: 'death', IDLE: 'idle' };

class Player {
  constructor() {
    this.reset();
  }

  reset() {
    const sc  = CONFIG.player.scala;
    const ref = SGRUNF_FRAMES['SgrunfCyberPunk_Statico'];

    this.w = Math.round(ref.w * sc);
    this.h = Math.round(ref.h * sc);

    // Dimensioni hitbox pre-calcolate (costanti per tutta la vita del player)
    const mx = 14, my = 14;
    this._hbW  = this.w - mx * 2;
    this._hbH  = this.h - my * 2;
    this._hbMY = my;

    this.x        = CONFIG.player.x;
    this.y        = GY;
    this.vy       = 0;
    this.aTerra   = true;

    this.stato     = STATO_ANIM.RUN;
    this.frameIdx  = 0;
    this.frameTick = 0;

    // True quando l'animazione di morte ha completato tutti i frame
    this.morteFine = false;

    // Oggetto hitbox pre-allocato: evita allocazioni GC a ogni frame
    if (!this._hitbox) this._hitbox = { x: 0, y: 0, w: 0, h: 0 };
  }

  /** Attiva il salto (solo se a terra e non in stato morte) */
  salta() {
  if (!this.aTerra || this.stato === STATO_ANIM.DEATH) return;
  
  /*
   * Web Audio API: playSfx è non-bloccante sul main thread.
   * A differenza di HTMLAudioElement.play(), non causa spike sul thread audio.
   */
  playSfx('jump', 0.7);

  this.vy       = CONFIG.player.v0Salto;
  this.aTerra   = false;
  this.stato    = STATO_ANIM.JUMP;
  this.frameIdx = 0;
  }

  /** Attiva l'animazione di morte e blocca la fisica verticale brusca */
  muori() {
  if (this.stato === STATO_ANIM.DEATH) return;

  suoni.theme.pause();
  playSfx('dead', 1.0);

  this.stato     = STATO_ANIM.DEATH;
  this.frameIdx  = 0;
  this.frameTick = 0;
  this.morteFine = false;
  if (this.aTerra) this.vy = -5;
  }

  update(dt) {
    /*
     * FISICA DELTA-TIME:
     * dt è in millisecondi (capped a 50ms per evitare "tunneling" su tab in background).
     * Il fattore di scala normalizza la fisica a 60fps di riferimento (16.667ms).
     * Questo garantisce salti identici sia a 30fps che a 60fps su mobile.
     */
    const dtScale = dt / 16.667;
    const g = CONFIG.player.gravita;

    // Fisica verticale (attiva anche durante la morte per far "cadere" il corpo)
    if (!this.aTerra) {
      this.vy += g * dtScale;
      this.y  += this.vy * dtScale;
      if (this.y >= GY) {
        this.y      = GY;
        this.vy     = 0;
        this.aTerra = true;
        if (this.stato !== STATO_ANIM.DEATH) {
          this.stato     = STATO_ANIM.RUN;
          this.frameIdx  = 0;
          this.frameTick = 0;
        }
      }
    }

    /*
     * ANIMAZIONE DELTA-TIME:
     * frameTick accumula ms; si avanza al prossimo frame solo quando si
     * raggiunge la soglia in ms (tickCorsa * 16.667 = stesso ritmo di prima a 60fps).
     */
    this.frameTick += dt;

    switch (this.stato) {

      case STATO_ANIM.RUN: {
        if (this.frameTick >= SOGLIA_CORSA_MS) {
          this.frameTick -= SOGLIA_CORSA_MS;
          this.frameIdx  = (this.frameIdx + 1) % FRAMES_CORSA.length;
        }
        break;
      }

      case STATO_ANIM.JUMP:
        if      (this.vy < -2.5) this.frameIdx = 0;
        else if (this.vy <  2.5) this.frameIdx = 1;
        else                     this.frameIdx = 2;
        break;

      case STATO_ANIM.DEATH: {
        if (this.frameTick >= SOGLIA_MORTE_MS) {
          this.frameTick -= SOGLIA_MORTE_MS;
          if (this.frameIdx < FRAMES_MORTE.length - 1) {
            this.frameIdx++;
          } else {
            this.morteFine = true;
          }
        }
        break;
      }

      case STATO_ANIM.IDLE:
        break;
    }
  }

  draw() {
    let nomeFrame;
    switch (this.stato) {
      case STATO_ANIM.RUN:   nomeFrame = FRAMES_CORSA[this.frameIdx]; break;
      case STATO_ANIM.JUMP:  nomeFrame = FRAMES_SALTO[this.frameIdx]; break;
      case STATO_ANIM.DEATH: nomeFrame = FRAMES_MORTE[this.frameIdx]; break;
      default:               nomeFrame = 'SgrunfCyberPunk_Statico';
    }

    // Usa il canvas pre-renderizzato (singola draw call GPU, nessun crop atlas)
    const cached = SGRUNF_CACHE[nomeFrame];
    if (cached) {
      const dim = SGRUNF_DIM[nomeFrame];
      ctx.drawImage(cached, (this.x - dim.dw / 2) | 0, (this.y - dim.dh) | 0);
      return;
    }
    // Fallback: atlante diretto (non dovrebbe mai accadere dopo prebuildSprites)
    if (!imgs.sgrunf || !imgs.sgrunf.complete) return;
    const fd  = SGRUNF_FRAMES[nomeFrame];
    const dim = SGRUNF_DIM[nomeFrame];
    const dw  = dim ? dim.dw : Math.round(fd.w * CONFIG.player.scala);
    const dh  = dim ? dim.dh : Math.round(fd.h * CONFIG.player.scala);
    ctx.drawImage(imgs.sgrunf, fd.x, fd.y, fd.w, fd.h, (this.x - dw / 2) | 0, (this.y - dh) | 0, dw, dh);
  }

  /**
   * Hitbox ridotta con margine interno per collisioni "fair".
   * Usa dimensioni pre-calcolate in reset() e oggetto pre-allocato.
   * @returns {{ x, y, w, h }}
   */
  getHitbox() {
    this._hitbox.x = this.x - this._hbW / 2;
    this._hitbox.y = this.y - this.h + this._hbMY;
    this._hitbox.w = this._hbW;
    this._hitbox.h = this._hbH;
    return this._hitbox;
  }

  /**
   * Restituisce la Y del punto più alto della testa del player
   * considerando l'altezza massima tra tutti i frame di corsa.
   */
  getTestaMaxY() {
    return GY - PLAYER_ALT_MAX_PX;
  }

  /**
   * Calcola la massima distanza orizzontale coperta da un salto standard.
   * Usata per la verifica preventiva degli ostacoli doppi e tripli.
   *
   * Con fisica delta-time, la velocità verticale scala come px/frame@60fps.
   * tVolo rimane in "frame equivalenti a 60fps", la conversione in px è:
   *   distanza = velocita_gioco * tVolo
   * (velocita è già in px/frame@60fps, coerente con il dtScale del player)
   *
   * @param {number} velAttuale - velocità corrente degli ostacoli
   * @returns {number} distanza orizzontale massima in pixel
   */
  static calcolaDistanzaSaltoMax(velAttuale) {
    const tVolo = (2 * Math.abs(CONFIG.player.v0Salto)) / CONFIG.player.gravita;
    return velAttuale * tVolo;
  }
}


/* ============================================================
   SEZIONE 7 — OBSTACLE
   Rappresenta un singolo ostacolo (terrestre o aereo/drone).
   ============================================================ */

class Obstacle {
  /**
   * @param {string} tipo      - chiave frame in OSTACOLI_FRAMES
   * @param {number} [offsetX] - offset X aggiuntivo (usato per 2° e 3° ostacolo della coppia/tripletta)
   */
  constructor(tipo, offsetX = 0) {
    this.tipo = tipo;
    this._hitbox = { x: 0, y: 0, w: 0, h: 0 };
    this.reset(tipo, offsetX);
  }

  /**
   * Reinizializza l'ostacolo per il riutilizzo dal pool.
   * Usa le dimensioni già note dallo sprite pre-renderizzato.
   */
  reset(tipo, offsetX = 0) {
    this.tipo = tipo;
    const cfg = OSTACOLO_CFG[tipo];
    const dim = OSTACOLI_DIM[tipo];

    if (dim) {
      this.w = dim.dw;
      this.h = dim.dh;
    } else {
      const fd = OSTACOLI_FRAMES[tipo];
      this.w = Math.round(fd.w * cfg.scala);
      this.h = Math.round(fd.h * cfg.scala);
    }

    this.x = CW + 80 + offsetX;
    this.y = cfg.aereo
      ? (DRONE_Y_FISSO !== null ? DRONE_Y_FISSO : GY - this.h - CONFIG.ostacoli.altezzaDroneFissa)
      : GY - this.h;
  }

  /** Sposta l'ostacolo verso sinistra alla velocità di gioco */
  update(vel) {
    this.x -= vel;
  }

  draw() {
    // Usa canvas pre-renderizzato se disponibile
    const cached = OSTACOLI_CACHE[this.tipo];
    if (cached) {
      ctx.drawImage(cached, this.x | 0, this.y | 0);
      return;
    }
    // Fallback atlante
    if (!imgs.ostacoli || !imgs.ostacoli.complete) return;
    const fd  = OSTACOLI_FRAMES[this.tipo];
    ctx.drawImage(imgs.ostacoli, fd.x, fd.y, fd.w, fd.h, this.x | 0, this.y | 0, this.w, this.h);
  }

  /** Hitbox con margine interno — usa dimensioni pre-calcolate in OSTACOLI_HB */
  getHitbox() {
    const m  = 8;
    const hb = OSTACOLI_HB[this.tipo];
    if (hb) {
      this._hitbox.x = this.x + m;
      this._hitbox.y = this.y + m;
      this._hitbox.w = hb.w;
      this._hitbox.h = hb.h;
    } else {
      this._hitbox.x = this.x + m;
      this._hitbox.y = this.y + m;
      this._hitbox.w = this.w - m * 2;
      this._hitbox.h = this.h - m * 2;
    }
    return this._hitbox;
  }

  /** True se l'ostacolo è uscito dal canvas a sinistra */
  fuoriSchermo() {
    return this.x + this.w < -20;
  }
}


/* ============================================================
   SEZIONE 8 — STATO GLOBALE DI GIOCO
   ============================================================ */

/*
 * Stati possibili:
 *   LOADING   → caricamento asset
 *   START     → schermata titolo (attesa primo input)
 *   PLAYING   → partita in corso
 *   DYING     → animazione morte (gioco bloccato, solo animazione player)
 *   GAMEOVER  → schermata punteggio finale
 */
let statoGioco = 'LOADING';

let punteggio       = 0;
let recordPersonale = 0;
let velocita        = CONFIG.velocita.iniziale;
let frameContatore  = 0;
let spawnTimer      = 0;
let spawnInterval   = CONFIG.spawn.intervalloMinBase;

let player   = null;
let ostacoli = [];
let layers   = [];

let premio1  = false;
let premio2  = false;

let accumulatoreMs  = 0;

let ultimoTS = 0;


/* ============================================================
   SEZIONE 8B — OBJECT POOL OSTACOLI
   Riutilizza istanze Obstacle invece di allocarne di nuove ogni spawn.
   Riduce la pressione sul GC mobile (Safari/iOS).
   ============================================================ */

const obstaclePool = [];

/**
 * Ottiene un Obstacle dal pool (se disponibile) o ne crea uno nuovo.
 * reset() reinizializza posizione e dimensioni senza allocare memoria.
 */
function getObstacle(tipo, offsetX = 0) {
  if (obstaclePool.length > 0) {
    const ob = obstaclePool.pop();
    ob.reset(tipo, offsetX);
    return ob;
  }
  return new Obstacle(tipo, offsetX);
}

/**
 * Restituisce un Obstacle al pool invece di eliminarlo.
 * Chiamato quando l'ostacolo esce dallo schermo.
 */
function releaseObstacle(ob) {
  obstaclePool.push(ob);
}



let inputAttivo = false; 

/*
 * Flag: i SFX Web Audio sono stati pre-caricati al primo gesto utente.
 * Il preload avviene una volta sola — i buffer restano in memoria per tutta
 * la sessione di gioco (< 100KB totali, nessun problema di memoria).
 */
let _sfxPreloaded = false;

function gestisciInput() {
  /*
   * Al primo gesto utente: pre-carica i SFX via Web Audio API.
   * Deve accadere dentro un event handler per sbloccare l'AudioContext su iOS.
   * È asincrono (fetch + decode) ma non blocca: i suoni saranno pronti
   * entro il primo secondo di gioco, ben prima che servano.
   */
  if (!_sfxPreloaded) {
    _sfxPreloaded = true;
    preloadSfx('jump', SOUND_PATH + 'jump.mp3');
    preloadSfx('dead', SOUND_PATH + 'dead.mp3');
    // Sblocca l'AudioContext anche se i fetch sono ancora in corso
    getAudioCtx();
  }

  if (suoni.theme.paused && (statoGioco === 'PLAYING' || statoGioco === 'START')) {
    const p = suoni.theme.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  switch (statoGioco) {
    case 'START':    avviaPartita(); break;
    case 'PLAYING':  player.salta(); break; // Salto immediato al tocco/pressione
    case 'GAMEOVER': resetPartita(); break;
  }
}

// TASTIERA
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!inputAttivo) { // Evita il trigger ripetuto del sistema operativo
      inputAttivo = true;
      gestisciInput();
    }
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    inputAttivo = false;
  }
});

// TOUCH (Mobile)
// Il throttle evita che touchstart sparino eventi ridondanti a <16ms di distanza
// (alcuni browser mobile generano burst di touchstart su pressioni rapide).
let _ultimoTouch = 0;
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const ora = performance.now();
  if (ora - _ultimoTouch < 16) return;
  _ultimoTouch = ora;
  inputAttivo = true;
  gestisciInput();
}, { passive: false });

canvas.addEventListener('touchend', () => {
  inputAttivo = false;
}, { passive: true });

// MOUSE
canvas.addEventListener('mousedown', (e) => {
  e.preventDefault();
  inputAttivo = true;
  gestisciInput();
});

canvas.addEventListener('mouseup', () => {
  inputAttivo = false;
});

// PREVENZIONE GESTURE DI SISTEMA
// Su mobile blocca il menu contestuale long-press.
// Su desktop, quando si apre il menu contestuale il browser non invia mouseup:
// azzeriamo inputAttivo per evitare l'auto-jump fantasma alla chiusura del menu.
canvas.addEventListener('contextmenu', e => {
  if (isTouch) {
    e.preventDefault();
  } else {
    inputAttivo = false;
  }
});

// Blocca lo scroll e il pinch-to-zoom durante il gioco su mobile
document.body.addEventListener('touchmove', e => {
  if (statoGioco === 'PLAYING' || statoGioco === 'DYING') {
    e.preventDefault();
  }
}, { passive: false });

/*
 * Quando la scheda torna in foreground dopo essere stata nascosta,
 * il timestamp rAF fa un salto enorme (anche 5+ secondi).
 * Azzeriamo ultimoTS per evitare uno spike di fisica/velocità al rientro.
 */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    // Tab tornata visibile: ripristina il loop e resetta il timestamp
    // per evitare uno spike di fisica dovuto al tempo trascorso nascosta.
    ultimoTS = 0;
    // Reimposta il buffer dt a 60fps per evitare media distorta al rientro
    _dtBuffer.fill(16.667);
    _dtSum = 16.667 * 8;
    if (!_rafHandle) {
      _rafHandle = requestAnimationFrame(gameLoop);
    }
  } else {
    // Tab nascosta: ferma il loop per non sprecare CPU/batteria su mobile.
    if (_rafHandle) {
      cancelAnimationFrame(_rafHandle);
      _rafHandle = 0;
    }
    if (!suoni.theme.paused) suoni.theme.pause();
    inputAttivo = false;
  }
});


/* ============================================================
   SEZIONE 10 — INIZIALIZZAZIONE PARALLAX
   5 layer con velocità decrescenti dall'orizzonte alla strada.
   ============================================================ */

function inizializzaParallax() {
  const fattori = [0.04, 0.14, 0.28, 1.0, 1.0];
  layers = [];
  for (let i = 0; i < fattori.length; i++) {
    layers.push(new ParallaxLayer(imgs['bg' + (i + 1)], fattori[i]));
  }
}


/* ============================================================
   SEZIONE 11 — AVVIO / RESET PARTITA
   ============================================================ */

function avviaPartita() {
  statoGioco      = 'PLAYING';
  punteggio       = 0;
  accumulatoreMs  = 0;
  velocita        = CONFIG.velocita.iniziale;
  frameContatore  = 0;
  spawnTimer      = -120;  // ritardo iniziale prima del primo ostacolo
  spawnInterval   = CONFIG.spawn.intervalloMinBase;
  // Restituisce al pool gli ostacoli ancora in scena prima del reset
  for (let i = 0; i < ostacoli.length; i++) obstaclePool.push(ostacoli[i]);
  ostacoli        = [];
  premio1         = false;
  premio2         = false;
  // Riutilizza l'istanza Player esistente invece di allocarne una nuova
  if (player) {
    player.reset();
  } else {
    player = new Player();
  }
  /*
   * Azzera inputAttivo: l'input che ha premuto Start/GameOver non deve
   * propagarsi come salto immediato al primo frame di partita.
   */
  inputAttivo     = false;

  // Riavvia il tema musicale dall'inizio
  suoni.theme.currentTime = 0;
  const p = suoni.theme.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function resetPartita() {
  avviaPartita();
}


/* ============================================================
   SEZIONE 12 — SPAWN OSTACOLI
   Intervalli variabili con frequenza crescente nel tempo.
   Ostacoli doppi disponibili dopo 200 punti.
   Ostacoli tripli disponibili dopo 750 punti.
   ============================================================ */

/**
 * Seleziona un tipo di ostacolo con probabilità pesate.
 * Distribuzione: ~20% per tipo terrestre, ~20% drone.
 */
function tipoOstacoloCasuale() {
  const r = Math.random();
  if (r < 0.22) return 'OstacoliCyberpunk1';
  if (r < 0.44) return 'OstacoliCyberpunk2';
  if (r < 0.60) return 'OstacoliCyberpunk3';
  if (r < 0.80) return 'OstacoliCyberpunk4';
  return 'Drone';
}

/**
 * Calcola l'intervallo minimo di spawn corrente in base al punteggio.
 * Più alto è il punteggio, più l'intervallo si abbassa (maggiore frequenza).
 * La riduzione è graduale e rispetta un limite inferiore assoluto.
 */
function intervalloMinCorrente() {
  const riduzione = Math.floor(punteggio / 50);  // -1 frame ogni 50 punti
  return Math.max(
    CONFIG.spawn.intervalloMinFloor,
    CONFIG.spawn.intervalloMinBase - riduzione
  );
}

/**
 * Verifica che ci sia sufficiente spazio tra l'ultimo ostacolo
 * e il bordo destro del canvas per spawnarne uno nuovo.
 */
function spazioDisponibile() {
  if (ostacoli.length === 0) return true;
  const ultimo = ostacoli[ostacoli.length - 1];
  return (CW - ultimo.x) > CONFIG.spawn.distanzaMinPx;
}

/**
 * Calcola la larghezza totale di rendering di un tipo di ostacolo.
 * Usa la cache OSTACOLI_DIM pre-calcolata; fallback aritmetico se assente.
 * @param {string} tipo - chiave tipo ostacolo
 * @returns {number} larghezza in pixel logici
 */
function larghezzaOstacolo(tipo) {
  const dim = OSTACOLI_DIM[tipo];
  if (dim) return dim.dw;
  const fd = OSTACOLI_FRAMES[tipo];
  return Math.round(fd.w * OSTACOLO_CFG[tipo].scala);
}

/**
 * Spawn di un gruppo di ostacoli: singolo, doppio o triplo.
 *
 * Regole di attivazione:
 *   - Singolo: sempre disponibile
 *   - Doppio:  disponibile solo dopo 200 punti (CONFIG.spawn.probDoppio)
 *   - Triplo:  disponibile solo dopo 750 punti (CONFIG.spawn.probTriplo),
 *              solo se il doppio è già stato tentato con successo
 *
 * Verifica di superabilità (critica per fair play):
 *   La larghezza combinata di tutti gli ostacoli del gruppo deve essere
 *   strettamente inferiore alla distanza orizzontale coperta dal player
 *   durante un salto standard alla velocità corrente.
 *   Se la verifica fallisce, si degrada a un gruppo più piccolo o singolo.
 *
 * Il drone è sempre singolo e non partecipa a gruppi.
 */
function tentaSpawn() {
  spawnTimer++;

  if (spawnTimer < spawnInterval || !spazioDisponibile()) return;

  // Ricalcola l'intervallo minimo corrente (cresce la frequenza col punteggio)
  const intMin = intervalloMinCorrente();
  spawnTimer    = 0;
  spawnInterval = Math.floor(
    intMin + Math.random() * (CONFIG.spawn.intervalloMax - intMin)
  );

  const tipo = tipoOstacoloCasuale();

  // Il drone è sempre singolo
  if (tipo === 'Drone') {
    ostacoli.push(getObstacle('Drone'));
    return;
  }

  const distSalto = Player.calcolaDistanzaSaltoMax(velocita);
  const gap       = 18;  // gap visivo tra ostacoli contigui in pixel

  // Tenta triplo (solo dopo 750 punti)
  const tentaTriplo = punteggio >= 750 && Math.random() < CONFIG.spawn.probTriplo;

  if (tentaTriplo) {
    const tipo2 = TIPI_TERRESTRI[Math.floor(Math.random() * TIPI_TERRESTRI.length)];
    const tipo3 = TIPI_TERRESTRI[Math.floor(Math.random() * TIPI_TERRESTRI.length)];

    const w1 = larghezzaOstacolo(tipo);
    const w2 = larghezzaOstacolo(tipo2);
    const w3 = larghezzaOstacolo(tipo3);
    const wTot = w1 + gap + w2 + gap + w3;

    if (wTot < distSalto * 0.85) {
      // Tripletta superabile: spawn tutti e tre
      ostacoli.push(getObstacle(tipo));
      ostacoli.push(getObstacle(tipo2, w1 + gap));
      ostacoli.push(getObstacle(tipo3, w1 + gap + w2 + gap));
      return;
    }
    // Se la tripletta non è superabile, cade nel tentativo doppio sotto
  }

  // Tenta doppio (solo dopo 200 punti)
  const tentaDoppio = punteggio >= 200 && Math.random() < CONFIG.spawn.probDoppio;

  if (tentaDoppio) {
    const tipo2 = TIPI_TERRESTRI[Math.floor(Math.random() * TIPI_TERRESTRI.length)];

    const w1   = larghezzaOstacolo(tipo);
    const w2   = larghezzaOstacolo(tipo2);
    const wTot = w1 + gap + w2;

    if (wTot < distSalto * 0.85) {
      // Coppia superabile: spawn entrambi
      ostacoli.push(getObstacle(tipo));
      ostacoli.push(getObstacle(tipo2, w1 + gap));
      return;
    }
    // Se la coppia non è superabile, cade nel singolo sotto
  }

  // Spawn singolo standard
  ostacoli.push(getObstacle(tipo));
}


/* ============================================================
   SEZIONE 13 — COLLISIONI (AABB)
   ============================================================ */

/** Ritorna true se i due rettangoli si sovrappongono */
function aabbOverlap(a, b) {
  return (
    a.x       < b.x + b.w &&
    a.x + a.w > b.x       &&
    a.y       < b.y + b.h &&
    a.y + a.h > b.y
  );
}


/* ============================================================
   SEZIONE 14 — DISEGNO UI / OVERLAY
   ============================================================ */

/**
 * Testo con effetto bagliore neon (doppio passaggio).
 * Usa reset manuale delle proprietà invece di save/restore per ridurre
 * l'overhead del 2D context (save/restore è costoso su mobile GPU).
 * Evita riassegnazioni ridondanti di ctx.font confrontando con la cache.
 */
let _ultimoFont     = '';
let _ultimaDim      = 0;   // confronto numerico prima di costruire la stringa
function testoNeon(testo, x, y, colore, dimensione, align = 'left', blur = 12) {
  /*
   * Ottimizzazione allocazioni hot-path:
   * Confronta prima la dimensione numerica (int, confronto O(1) senza allocazione).
   * Costruisce la stringa fontStr solo se la dimensione è cambiata — evita
   * la creazione di una stringa temporanea ad ogni chiamata nel draw loop.
   */
  if (dimensione !== _ultimaDim) {
    _ultimaDim  = dimensione;
    _ultimoFont = `bold ${dimensione}px 'Courier New', Courier, monospace`;
    ctx.font    = _ultimoFont;
  }
  ctx.textAlign    = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle    = colore;
  if (!isTouch) {
    ctx.shadowColor = colore;
    ctx.shadowBlur  = blur;
  }
  ctx.globalAlpha = 1;
  ctx.fillText(testo, x, y);
  if (!isTouch) {
    ctx.shadowBlur  = blur * 2.5;
    ctx.globalAlpha = 0.3;
    ctx.fillText(testo, x, y);
    // Reset shadow e alpha per non sporcare le draw call successive
    ctx.shadowBlur  = 0;
    ctx.shadowColor = 'transparent';
    ctx.globalAlpha = 1;
  }
}

/** Overlay scanlines CRT sottili per atmosfera cyberpunk */
// Pre-renderizzate su OffscreenCanvas: un solo drawImage per frame
// invece di 180 fillRect individuali (180 draw calls → 1).
const _scanlinesCanvas = (typeof OffscreenCanvas !== 'undefined')
  ? new OffscreenCanvas(CW, CH)
  : (() => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; })();

(function _prebuildScanlines() {
  const sctx = _scanlinesCanvas.getContext('2d', { alpha: true });
  sctx.clearRect(0, 0, CW, CH);
  sctx.fillStyle = 'rgba(0,0,0,0.03)';
  for (let y = 0; y < CH; y += 4) {
    sctx.fillRect(0, y, CW, 1);
  }
})();

function disegnaScanlines() {
  ctx.drawImage(_scanlinesCanvas, 0, 0);
}

/** HUD: punteggio, record personale, badge premi */
// Cache stringhe HUD: ricalcola solo quando i valori cambiano
let _hudPunteggioPrecedente = -1;
let _hudRecordPrecedente    = -1;
let _hudStrPunti  = '';
let _hudStrRecord = '';

function disegnaHUD() {
  const p = Math.floor(punteggio);
  if (p !== _hudPunteggioPrecedente) {
    _hudPunteggioPrecedente = p;
    _hudStrPunti = `PUNTI: ${String(p).padStart(5, '0')}`;
  }
  testoNeon(_hudStrPunti, 20, 46, '#00e5ff', 26, 'left', 14);

  if (recordPersonale > 0) {
    const r = Math.floor(recordPersonale);
    if (r !== _hudRecordPrecedente) {
      _hudRecordPrecedente = r;
      _hudStrRecord = `RECORD: ${String(r).padStart(5, '0')}`;
    }
    testoNeon(_hudStrRecord, CW / 2, 46, '#7777ff', 22, 'center', 8);
  }

  let badgeY = 70;
  if (premio1) {
    disegnaBadgePremio('p500',  CODICE_PREMIO_500,  CONFIG.soglie.premio1,  CW - 20, badgeY);
    badgeY += 66;
  }
  if (premio2) {
    disegnaBadgePremio('p1000', CODICE_PREMIO_1000, CONFIG.soglie.premio2, CW - 20, badgeY);
  }
}

/** Badge neon con codice premio nell'angolo superiore destro */
/*
 * CACHE BADGE PREMI — pre-renderizzati su OffscreenCanvas.
 *
 * I badge vengono disegnati ogni frame per tutta la durata del gioco
 * una volta sbloccati. Il contenuto è statico (codice + soglia non cambiano),
 * quindi ridisegnarli a ogni frame è puro spreco: fillRect + strokeRect +
 * 2× testoNeon = ~6 draw call per badge per frame.
 *
 * Soluzione: render-once su OffscreenCanvas al momento del primo sblocco.
 * Da quel momento in poi: 1 sola drawImage per badge per frame.
 */
const _badgeCache = {};  // { 'p500': OffscreenCanvas|HTMLCanvasElement, 'p1000': ... }

function _prebuildBadge(chiave, codice, soglia) {
  const bw = 280, bh = 54;
  const oc = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(bw, bh)
    : (() => { const c = document.createElement('canvas'); c.width = bw; c.height = bh; return c; })();
  const octx = oc.getContext('2d', { alpha: true });

  octx.globalAlpha = 0.88;
  octx.fillStyle   = '#0a001a';
  octx.fillRect(0, 0, bw, bh);
  octx.globalAlpha = 1;
  octx.strokeStyle = '#ff00dd';
  octx.lineWidth   = 2;
  octx.strokeRect(1, 1, bw - 2, bh - 2);

  // Testo soglia
  octx.font        = `bold 14px 'Courier New', Courier, monospace`;
  octx.textAlign   = 'left';
  octx.textBaseline = 'alphabetic';
  octx.fillStyle   = '#ff88ff';
  octx.fillText(`★ ${soglia}pt`, 12, 20);

  // Testo codice
  octx.font      = `bold 24px 'Courier New', Courier, monospace`;
  octx.fillStyle = '#ffffff';
  octx.fillText(codice, 12, 44);

  _badgeCache[chiave] = oc;
}

function disegnaBadgePremio(chiave, codice, soglia, rx, ry) {
  // Pre-renderizza solo la prima volta
  if (!_badgeCache[chiave]) _prebuildBadge(chiave, codice, soglia);

  const bw = 280;
  ctx.drawImage(_badgeCache[chiave], (rx - bw) | 0, ry | 0);
}

/** Schermata di avvio */
function disegnaStartScreen() {
  ctx.fillStyle = 'rgba(0,0,10,0.65)';
  ctx.fillRect(0, 0, CW, CH);

  testoNeon('SGRUNF', CW / 2, CH / 2 - 80, '#00e5ff', 72, 'center', 36);
  testoNeon('RUNNER CYBERPUNK', CW / 2, CH / 2 - 20, '#ff00dd', 36, 'center', 22);

  testoNeon('TOCCA  o  SPAZIO  per iniziare', CW / 2, CH / 2 + 40, '#e0e0ff', 22, 'center', 8);
  testoNeon('SALTO: tocco / barra spaziatrice', CW / 2, CH / 2 + 70, '#8888aa', 18, 'center', 5);

  if (recordPersonale > 0) {
    testoNeon(
      `MIGLIOR PUNTEGGIO: ${Math.floor(recordPersonale)}`,
      CW / 2, CH / 2 + 110, '#ffff44', 18, 'center', 10
    );
  }

  const aspect = window.innerWidth / window.innerHeight;
  if (aspect < 1.2) {
    testoNeon(
      '⟳ Ruota in orizzontale per un\'esperienza migliore',
      CW / 2, CH - 20, '#886600', 16, 'center', 5
    );
  }
}

/** Schermata Game Over */
function disegnaGameOver() {
  ctx.fillStyle = 'rgba(0,0,10,0.76)';
  ctx.fillRect(0, 0, CW, CH);

  testoNeon('GAME OVER', CW / 2, CH / 2 - 90, '#ff1144', 62, 'center', 36);
  testoNeon(`PUNTEGGIO: ${Math.floor(punteggio)}`, CW / 2, CH / 2 - 20, '#ffffff', 30, 'center', 16);

  if (punteggio >= recordPersonale && punteggio > 0) {
    testoNeon('✦ NUOVO RECORD! ✦', CW / 2, CH / 2 + 20, '#ffff44', 22, 'center', 18);
  }

  if (premio2) {
    testoNeon(`★ CODICE BONUS (1000pt): ${CODICE_PREMIO_1000}`, CW / 2, CH / 2 + 58, '#ff88ff', 20, 'center', 12);
    testoNeon(`★ CODICE BASE  (500pt):  ${CODICE_PREMIO_500}`,  CW / 2, CH / 2 + 88, '#ff88ff', 20, 'center', 12);
  } else if (premio1) {
    testoNeon(`★ CODICE BASE (500pt): ${CODICE_PREMIO_500}`, CW / 2, CH / 2 + 58, '#ff88ff', 20, 'center', 12);
    testoNeon('— raggiungi 1000pt per il codice bonus —',    CW / 2, CH / 2 + 88, '#664466', 16, 'center', 5);
  } else {
    testoNeon('— sopravvivi 500pt per sbloccare i codici —', CW / 2, CH / 2 + 64, '#664466', 16, 'center', 5);
  }

  testoNeon('TOCCA  o  SPAZIO  per riprovare', CW / 2, CH / 2 + 130, '#00e5ff', 20, 'center', 10);
}

/** Schermata di caricamento con barra progresso */
function disegnaLoading() {
  ctx.fillStyle = '#00000a';
  ctx.fillRect(0, 0, CW, CH);
  const progress = assetsCaricati / TOTALE_ASSET;
  ctx.fillStyle = '#0d0d2a';
  ctx.fillRect(CW / 2 - 200, CH / 2 + 20, 400, 12);
  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(CW / 2 - 200, CH / 2 + 20, 400 * progress, 12);
  testoNeon('CARICAMENTO...', CW / 2, CH / 2 - 5, '#00e5ff', 30, 'center', 20);
}


/* ============================================================
   SEZIONE 15 — GAME LOOP (update + draw)
   ============================================================ */

/*
 * SMOOTHING DEL DELTA-TIME — media mobile a 8 campioni.
 *
 * Problema: anche a 60fps stabili, singoli frame possono durare 18–22ms
 * invece di 16.67ms (interrupt del kernel, GC, I/O). Passare questo valore
 * direttamente alla fisica causa micro-jitter visibile durante il salto.
 *
 * Soluzione: la stessa adottata da Phaser (10 campioni) e Unity (smoothDeltaTime).
 * Usiamo 8 campioni — un equilibrio tra reattività e stabilità.
 * La latenza è ≈ 8 × 16.67ms ≈ 133ms: impercettibile sulla fisica del salto
 * (traiettoria parabola) ma elimina completamente i micro-spike singoli.
 *
 * NOTA: il cap a 50ms (protezione tab-in-background) viene applicato PRIMA
 * dell'inserimento nel buffer, così i valori anomali non inquinano la media.
 */
const _dtBuffer  = new Float32Array(8);   // ring buffer pre-allocato (nessuna GC)
let   _dtHead    = 0;                     // indice testa del ring buffer
let   _dtSum     = 16.667 * 8;           // somma corrente (inizializzata a 60fps)

// Pre-riempie il buffer con 16.667 per avere una media sensata al primo frame
_dtBuffer.fill(16.667);

/**
 * Inserisce un nuovo campione dt nel ring buffer e restituisce la media mobile.
 * Complessità O(1): nessun loop, solo aritmetica su scalari.
 * @param {number} rawDt - delta time grezzo in ms (già cappato a 50ms)
 * @returns {number} dt smoothed
 */
function smoothDt(rawDt) {
  _dtSum -= _dtBuffer[_dtHead];    // sottrae il campione più vecchio dalla somma
  _dtBuffer[_dtHead] = rawDt;      // sovrascrive con il nuovo campione
  _dtSum += rawDt;                 // aggiorna la somma
  _dtHead = (_dtHead + 1) & 7;     // avanza la testa (modulo 8 via bitmask)
  return _dtSum * 0.125;           // media = somma / 8
}


function update(timestamp) {
  // Dopo visibilitychange ultimoTS è 0: inizializza senza produrre dt enorme
  if (ultimoTS === 0) { ultimoTS = timestamp; return; }
  const rawDt = Math.min(timestamp - ultimoTS, 50);
  ultimoTS = timestamp;

  /*
   * Applica smoothing del delta-time per eliminare micro-jitter.
   * La media mobile a 8 campioni smussa gli spike singoli di frame
   * (18–22ms invece di 16.67ms) che causano variazioni visibili nella
   * traiettoria del salto, specialmente su mobile.
   */
  const dt = smoothDt(rawDt);

  if (statoGioco === 'LOADING') return;

  frameContatore++;

  if (statoGioco === 'PLAYING') {
    velocita = Math.min(
      CONFIG.velocita.massima,
      velocita + CONFIG.velocita.accelerazione * (dt / 16.667)
    );
  }

  // Scorrimento parallax (anche nella schermata titolo per effetto animato)
  // Non aggiorniamo il parallax in GAMEOVER: sfondo fermo durante la schermata punteggio.
  let velParallax = 0;

  if (statoGioco === 'START') {
    velParallax = CONFIG.velocita.iniziale * 0.4;
  } else if (statoGioco === 'PLAYING') {
    velParallax = velocita;
  }
  // DYING e GAMEOVER: velParallax rimane 0 → layers.update non accumula offset

  if (statoGioco !== 'GAMEOVER') {
    for (let i = 0; i < layers.length; i++) layers[i].update(velParallax, dt);
  }

  if (statoGioco === 'PLAYING') {
    /*
     * Salto continuo (auto-jump): se l'input è mantenuto premuto e il player
     * è a terra, salta automaticamente al prossimo frame utile.
     * Questo consente il "salto continuo" tenendo premuto Space/ArrowUp o il touch.
     */
    if (inputAttivo && player.aTerra) {
      player.salta();
    }

    /*
     * Punteggio lento: aumenta di 1 ogni CONFIG.punteggio.mxPunto millisecondi.
     * A 250ms/punto i traguardi sono raggiunti gradualmente.
     */
    accumulatoreMs += dt;
    while (accumulatoreMs >= CONFIG.punteggio.mxPunto) {
      punteggio++;
      accumulatoreMs -= CONFIG.punteggio.mxPunto;
    }

    if (!premio1 && punteggio >= CONFIG.soglie.premio1) premio1 = true;
    if (!premio2 && punteggio >= CONFIG.soglie.premio2) premio2 = true;

    tentaSpawn();

    player.update(dt);

    for (let i = ostacoli.length - 1; i >= 0; i--) {
      const ob = ostacoli[i];
      ob.update(velocita * (dt / 16.667));

      if (ob.fuoriSchermo()) {
        releaseObstacle(ob);
        /*
         * Swap-and-pop O(1): sovrascrive l'elemento rimosso con l'ultimo
         * e accorcia l'array di 1. Più veloce di splice() O(n) e non causa
         * spostamento di elementi — sicuro perché stiamo iterando all'indietro
         * e gli ostacoli sono già ordinati per spawning time (ordine visivo
         * non dipende dalla posizione nell'array, dipende da ob.x).
         */
        ostacoli[i] = ostacoli[ostacoli.length - 1];
        ostacoli.length--;
        continue;
      }

      if (aabbOverlap(player.getHitbox(), ob.getHitbox())) {
        /*
         * Alla collisione il gioco entra in stato DYING:
         * gli ostacoli si bloccano (la mappa si ferma), solo il player
         * continua a eseguire la sua animazione di morte.
         * Il passaggio a GAMEOVER avviene solo al completamento dell'animazione.
         */
        player.muori();
        statoGioco = 'DYING';
        break;
      }
    }
  }

  // Stato DYING: la mappa è ferma, solo il player anima la morte
  if (statoGioco === 'DYING') {
    player.update(dt);
    // Gli ostacoli NON si aggiornano: nessun movimento durante la morte

    if (player.morteFine) {
      if (punteggio > recordPersonale) recordPersonale = punteggio;
      statoGioco = 'GAMEOVER';
    }
  }
}

function draw() {
  ctx.fillStyle = '#00000a';
  ctx.fillRect(0, 0, CW, CH);

  for (let i = 0; i < layers.length; i++) layers[i].draw();

  // Ostacoli visibili durante la partita e l'animazione di morte
  if (statoGioco === 'PLAYING' || statoGioco === 'DYING') {
    for (let i = 0; i < ostacoli.length; i++) ostacoli[i].draw();
  }

  if (player && statoGioco !== 'LOADING' && statoGioco !== 'GAMEOVER') {
    player.draw();
  }

  // Scanlines CRT: solo su desktop (isTouch === false) per risparmiare CPU/GPU mobile
  if (!isTouch) {
    disegnaScanlines();
  }

  if (statoGioco === 'PLAYING' || statoGioco === 'DYING') {
    disegnaHUD();
  }

  if (statoGioco === 'LOADING')  { disegnaLoading();    return; }
  if (statoGioco === 'START')    { disegnaStartScreen(); return; }
  if (statoGioco === 'GAMEOVER') {
    if (player) { player.draw(); }
    disegnaHUD();
    disegnaGameOver();
  }
}

/*
 * Handle rAF globale: serve per poter cancellare il loop quando la tab
 * è nascosta, evitando di consumare CPU/batteria su mobile in background.
 */
let _rafHandle = 0;

function gameLoop(timestamp) {
  update(timestamp);
  draw();
  _rafHandle = requestAnimationFrame(gameLoop);
}


/* ============================================================
   SEZIONE 16 — AVVIO APPLICAZIONE
   ============================================================ */

ctx.fillStyle = '#00000a';
ctx.fillRect(0, 0, CW, CH);
testoNeon('CARICAMENTO...', CW / 2, CH / 2, '#00e5ff', 30, 'center', 20);

caricaAsset(() => {
  // Pre-calcolo altezza massima player (usata in getTestaMaxY e calcolaDroneY)
  let altMaxFrame = 0;
  for (let i = 0; i < FRAMES_CORSA.length; i++) {
    const fd = SGRUNF_FRAMES[FRAMES_CORSA[i]];
    if (fd && fd.h > altMaxFrame) altMaxFrame = fd.h;
  }
  PLAYER_ALT_MAX_PX = Math.round(altMaxFrame * CONFIG.player.scala);

  inizializzaParallax();

  const fdDrone  = OSTACOLI_FRAMES['Drone'];
  const droneH   = Math.round(fdDrone.h * OSTACOLO_CFG['Drone'].scala);
  DRONE_Y_FISSO  = calcolaDroneY(droneH);

  // Pre-renderizza tutti gli sprite e pre-calcola le hitbox statiche
  prebuildSprites();

  // Scalda il font engine per evitare jank al primo fillText in-game
  prewarmFont();

  /*
   * Warm-up del pool: pre-alloca 6 istanze Obstacle durante il caricamento,
   * mentre il thread JS è già occupato. Così i primi spawn in partita non
   * causano allocazioni fresche → niente spike GC al primo ostacolo.
   * 6 = massimo ostacoli contemporaneamente realistico (triplette overlap + drone).
   */
  const POOL_WARMUP = 6;
  const tipiWarmup  = ['OstacoliCyberpunk1', 'OstacoliCyberpunk2',
                       'OstacoliCyberpunk3', 'OstacoliCyberpunk4',
                       'Drone',              'OstacoliCyberpunk1'];
  for (let i = 0; i < POOL_WARMUP; i++) {
    obstaclePool.push(new Obstacle(tipiWarmup[i]));
  }

  player         = new Player();
  player.stato   = STATO_ANIM.IDLE;
  statoGioco     = 'START';
});

_rafHandle = requestAnimationFrame(ts => {
  ultimoTS = ts;
  gameLoop(ts);
});