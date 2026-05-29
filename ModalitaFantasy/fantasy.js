'use strict';

/* ============================================================
   SUPABASE — CONFIGURAZIONE
   Sostituire i valori con le credenziali del proprio progetto.
   ============================================================ */
const SUPABASE_URL      = 'https://mzoakzthrslqkdrxhhxl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16b2FrenRocnNscWtkcnhoaHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5NTY1ODAsImV4cCI6MjA5NTUzMjU4MH0.pemFeQrhh4bsR0cER5nCZpbYH4eHZSDp-xE_Y_xTrgo';

/* ============================================================
   DEV MODE — stub locale senza database reale
   -----------------------------------------
   Impostare DEV_MODE = true per testare in locale senza Supabase.
   Il client viene sostituito con dati finti in memoria:
     - utente demo gia' loggato (username: Sgrunf)
     - classifica con 5 voci di test
     - login/registrazione sempre riusciti
     - salvataggio punteggio in memoria (aggiorna DEV_LEADERBOARD)
   Impostare a false prima del deploy in produzione.
   ============================================================ */
const DEV_MODE = false;

/** Classifica fittizia per il test locale */
const DEV_LEADERBOARD = [
  { nome: 'Sgrunf',    score: 1420, user_id: 'dev-001' },
  { nome: 'Gandalf',   score:  980, user_id: 'dev-002' },
  { nome: 'Elrond',    score:  760, user_id: 'dev-003' },
  { nome: 'Gimli',     score:  540, user_id: 'dev-004' },
  { nome: 'Ospite_77', score:  210, user_id: 'dev-005' },
];

/** Sessione fittizia — simula un utente gia' autenticato */
const DEV_FAKE_SESSION = {
  user: {
    id: 'dev-001',
    email: 'sgrunf@sgrunf.game',
    user_metadata: { username: 'Sgrunf' },
  },
};

/**
 * Costruisce il client Supabase finto usato in DEV_MODE.
 * Mantiene un registro utenti in memoria per simulare i veri controlli:
 *   - login fallisce se l'utente non esiste o la password e' sbagliata
 *   - registrazione fallisce se lo username e' gia' in uso (case-insensitive)
 *   - username vuoto o password sotto i 6 caratteri vengono rifiutati
 * Il punteggio salvato aggiorna DEV_LEADERBOARD in memoria.
 *
 * Utente demo pre-caricato:
 *   username: Sgrunf  |  password: demo1234
 */
function buildFakeSupabase() {
  // getSession restituisce null la prima volta: l'overlay auth viene mostrato.
  // Cosi' si testa il flusso reale di login/registrazione dall'inizio.
  let _session = null;

  // Registro utenti: { email -> { username, password, id } }
  // La chiave e' l'email (username@sgrunf.game), ma il controllo duplicati
  // avviene sullo username in lowercase per evitare varianti tipo Sgrunf/SGRUNF.
  const _utenti = {
    'sgrunf@sgrunf.game': { username: 'Sgrunf', password: 'demo1234', id: 'dev-001' },
  };

  let _idCounter = 100;

  /** Controlla se uno username e' gia' usato (case-insensitive) */
  function _usernameEsiste(username) {
    const lower = username.toLowerCase();
    return Object.values(_utenti).some(u => u.username.toLowerCase() === lower);
  }

  const auth = {
    getSession: async () => ({ data: { session: _session }, error: null }),

    signInWithPassword: async ({ email, password }) => {
      const utente = _utenti[email];
      if (!utente) {
        return { data: null, error: { message: 'User not found' } };
      }
      if (utente.password !== password) {
        return { data: null, error: { message: 'Invalid password' } };
      }
      _session = { user: { id: utente.id, email, user_metadata: { username: utente.username } } };
      return { data: { session: _session }, error: null };
    },

    signUp: async ({ email, password, options }) => {
      const username = (options && options.data && options.data.username) || email.replace('@sgrunf.game', '');

      // Username gia' in uso (confronto case-insensitive, come farebbe Supabase con email univoca)
      if (_utenti[email] || _usernameEsiste(username)) {
        return { data: null, error: { message: 'User already registered' } };
      }

      const id = 'dev-' + (++_idCounter);
      _utenti[email] = { username, password, id };
      _session = { user: { id, email, user_metadata: { username } } };
      return { data: { session: _session }, error: null };
    },

    signOut: async () => { _session = null; return { error: null }; },
  };

  const from = (_table) => ({
    select: (_cols) => ({
      order: () => ({
        limit: async () => {
          const rows = [...DEV_LEADERBOARD].sort((a, b) => b.score - a.score).slice(0, 10);
          return { data: rows, error: null };
        },
      }),
      eq: (_col, val) => ({
        maybeSingle: async () => {
          const row = DEV_LEADERBOARD.find(r => r.user_id === val) || null;
          return { data: row, error: null };
        },
      }),
    }),
    upsert: async (row) => {
      const idx = DEV_LEADERBOARD.findIndex(r => r.user_id === row.user_id);
      if (idx >= 0) DEV_LEADERBOARD[idx] = Object.assign({}, DEV_LEADERBOARD[idx], row);
      else DEV_LEADERBOARD.push(row);
      return { data: row, error: null };
    },
  });

  return { auth, from };
}

/* ============================================================
   SGRUNF FANTASY RUNNER
   Missione 8 — L'Arcade Segreto di Sgrunf
   Sarnano Comix Quest — Compagnia di Sottomonte

   ARCHITETTURA GENERALE DEL FILE
   ────────────────────────────────
   Il gioco è un endless runner 2D su HTML5 Canvas.
   Il player corre automaticamente verso destra (la scena scorre a sinistra).
   L'obiettivo è saltare gli ostacoli e schivare i proiettili del boss.

   Flusso principale:
     1. Caricamento asset (immagini, suoni)
     2. Schermata START → input utente → avviaPartita()
     3. Loop di gioco (requestAnimationFrame):
          update() → aggiorna fisica, spawn, collisioni
          draw()   → disegna sfondo, entità, HUD
     4. Collisione → stato DYING → animazione morte → GAMEOVER
     5. GAMEOVER → input utente → resetPartita() → torna al punto 3

   Coordinate canvas: X cresce verso destra, Y cresce verso il basso.
   ============================================================ */


/* ============================================================
   SEZIONE 1 — CONFIGURAZIONE CENTRALIZZATA
   ────────────────────────────────────────
   Tutti i parametri numerici del gioco sono raccolti qui dentro CONFIG.
   Modificare un valore in CONFIG si riflette automaticamente su tutto
   il resto del codice senza toccare la logica. È il pannello di controllo
   del game designer.
   ============================================================ */

/** Percorsi base degli asset, relativi a index.html */
const ASSET_PATH = './assets/';
const ASSET_PATH_PNG = './assets/png/';

/**
 * CONFIG — oggetto singleton con tutti i parametri di bilanciamento.
 *
 * NOTA GEOMETRICA SUL CANVAS:
 *   Risoluzione interna fissa: 1280 × 720 px (16:9).
 *   Il ridimensionamento a schermo intero è gestito solo via CSS (no scaling JS).
 *   groundY = 630 corrisponde alla superficie superiore del manto erboso
 *   in FantasyBg_6.png scalata a 720px di altezza. Se si cambia lo sfondo,
 *   ricalcolare: groundY = round(altezza_suolo_px_nativi / altezza_img_nativa * 720).
 */
const CONFIG = {

  // ── Canvas ────────────────────────────────────────────────────────────────
  canvas: {
    larghezza: 1280,   // larghezza interna del canvas in pixel logici
    altezza: 720,    // altezza interna del canvas in pixel logici
    groundY: 630,    // Y del piano di corsa (piedi del player a terra)
  },

  // ── Player ────────────────────────────────────────────────────────────────
  player: {
    x: 140,    // posizione X fissa del player (la scena scorre, lui no)
    scala: 0.85,   // fattore di scala applicato allo spritesheet Sgrunf
    v0Salto: -17,     // velocità verticale iniziale del salto (negativo = verso l'alto)
    gravita: 0.75,   // accelerazione gravitazionale in px/frame²
  },

  // ── Ostacoli ──────────────────────────────────────────────────────────────
  ostacoli: {
    scala: 1.50,      // fattore di scala applicato allo spritesheet degli ostacoli
  },

  // ── Velocità del terreno ──────────────────────────────────────────────────
  velocita: {
    iniziale: 6.0,     // px/frame all'avvio della partita
    accelerazione: 1.2e-3,  // incremento di velocità ogni frame (il gioco diventa più veloce col tempo)
    massima: 20,      // velocità massima raggiungibile (cap)
  },

  // ── Spawn degli ostacoli ──────────────────────────────────────────────────
  spawn: {
    /*
     * Gli ostacoli compaiono a destra del canvas a intervalli casuali compresi
     * tra intervalloMin (variabile) e intervalloMax frame.
     * L'intervallo minimo si riduce progressivamente con il punteggio,
     * rendendo il gioco più frenetico man mano che si va avanti.
     */
    intervalloMinBase: 55,   // intervallo minimo iniziale (frame) tra due spawn
    intervalloMinFloor: 25,   // intervallo minimo assoluto (non scende sotto questo valore)
    intervalloMax: 140,  // intervallo massimo (frame) tra due spawn

    distanzaMinPx: 400,   // spazio minimo (px) tra il bordo destro dell'ultimo ostacolo e il canvas
    // evita che due ostacoli spawnino troppo vicini

    probDoppio: 0.22,     // probabilità che vengano spawnati 2 ostacoli affiancati (attiva dopo 200 punti)
    probTriplo: 0.14,     // NON USATO in questa versione (rimasto per compatibilità futura)
  },

  // ── Animazione del player ─────────────────────────────────────────────────
  animazione: {
    tickCorsa: 8,   // frame di gioco che devono passare per avanzare un frame dell'animazione di corsa
    tickMorte: 3,   // frame di gioco per avanzare un frame dell'animazione di morte (più rapida)
  },

  // ── Punteggio ─────────────────────────────────────────────────────────────
  punteggio: {
    mxPunto: 250,   // ogni quanti millisecondi si guadagna 1 punto (più basso = più veloce)
  },

  // ── Boss (Ombra Fantasy) ──────────────────────────────────────────────────
  boss: {
    /*
     * SISTEMA DI SPAWN:
     *   Il boss non compare a un punteggio fisso ma con probabilità casuale.
     *   Ogni frame, dopo aver superato la soglia, viene estratto un numero casuale.
     *   Se è inferiore a probSpawnPerFrame, il boss viene triggerato.
     *   Questo rende le apparizioni imprevedibili e variabili.
     *
     * SOGLIE:
     *   - Prima apparizione: il punteggio deve superare punteggioMinSpawn.
     *   - Apparizioni successive: devono essere passati almeno punteggioMinRispawn
     *     punti dall'ultima ritirata del boss.
     */
    punteggioMinSpawn: 200,    // punteggio minimo assoluto per la prima comparsa del boss
    punteggioMinRispawn: 80,     // punti minimi da accumulare dopo ogni ritirata prima del prossimo spawn
    probSpawnPerFrame: 0.001,  // probabilità per frame di triggerare lo spawn (~16 sec di attesa media a 60fps)

    /*
     * MECCANICA DI RITIRATA:
     *   Il boss esegue un numero fisso di attacchi poi si ritira verso destra.
     *   Questo permette al boss di comparire più volte nella stessa partita.
     */
    attacchiPrimaRitirata: 5,      // numero di cicli di attacco prima che il boss entri in stato LEAVING
    velocitaRitirata: 5.0,    // velocità di uscita verso destra durante la ritirata (px/frame)

    /*
     * SCALABILITÀ DELLA DIFFICOLTÀ:
     *   Ad ogni nuova apparizione, gli intervalli tra gli attacchi si riducono
     *   moltiplicandoli per intervalloRiduzione^n (dove n = numero dell'apparizione).
     *   Es: 1ª apparizione → 1000/2500ms; 2ª → 800/2000ms; 3ª → 640/1600ms...
     */
    intervalloRiduzione: 0.80,   // fattore moltiplicativo di riduzione degli intervalli ad ogni apparizione
    attaccoMinMs: 1000,   // intervallo minimo tra attacchi (ms) alla prima apparizione
    attaccoMaxMs: 2500,   // intervallo massimo tra attacchi (ms) alla prima apparizione

    /*
     * POSIZIONAMENTO E MOVIMENTO:
     *   Il boss fluttua a destra del canvas a distanza fissa dal player.
     *   La sua posizione Y oscilla sinusoidalmente (fluttuazione verticale).
     */
    distanzaDalPlayer: 950,    // distanza orizzontale fissa boss-player (px); più alto = boss più lontano
    velocitaIngresso: 4.0,    // velocità con cui il boss entra a schermo scorrendo da destra (px/frame)
    ampiezzeFluttua: 30,     // ampiezza dell'oscillazione verticale sinusoidale (px su e giù)
    velocitaFluttua: 0.04,   // velocità dell'oscillazione (radianti/frame); più alto = oscillazione più rapida
    yFluttua: 550,    // Y centrale attorno a cui il boss oscilla (pixel dall'alto del canvas)

    // Scale sprite — separabili per eventuale animazione "gonfia" durante lo sparo
    scalaFluttua: 1.0,  // scala applicata allo sprite nella fase di fluttuazione
    scalaSpara: 1.0,  // scala applicata allo sprite nella fase di sparo

    // Hitbox
    hitboxMargine: 20,  // margine interno (px) sottratto su tutti i lati per rendere la hitbox più "fair"

    /*
     * ANIMAZIONE DI SPARO:
     *   L'animazione di sparo è più veloce di quella di fluttuazione
     *   per dare un senso di reattività e urgenza.
     *   tickAnimSparo < tickAnim (fluttuazione) = animazione più veloce.
     */
    tickAnimSparo: 3,   // frame di gioco per avanzare un frame nell'animazione di sparo

    /*
     * ATTACCO DOPPIO (dalla 2ª apparizione in poi):
     *   Dopo la prima animazione di sparo, il boss aspetta ritardoSecondoColpoMs
     *   e poi esegue una seconda animazione identica sparando un secondo proiettile.
     *   Questo obbliga il giocatore a fare due salti consecutivi veloci.
     */
    ritardoSecondoColpoMs: 200,  // pausa in ms tra fine 1ª animazione e inizio 2ª (~0.2 secondi)
  },

  // ── Proiettili del boss ───────────────────────────────────────────────────
  proiettile: {
    /*
     * VELOCITÀ DINAMICA:
     *   La velocità del proiettile NON è fissa. Si calcola ogni frame come:
     *     velProiettile = velocitaTerreno + velocitaBase
     *   In questo modo i proiettili diventano più veloci man mano che il terreno
     *   accelera, mantenendo la sfida sempre calibrata alla velocità del gioco.
     *
     *   Il secondo colpo (attacco doppio) ha un moltiplicatore separato per
     *   permettere di calibrarne la velocità indipendentemente dal primo.
     */
    velocitaBase: 6,    // componente fissa della velocità del proiettile (px/frame)
    fattoreVelocitaSecondoColpo: 1,    // moltiplicatore velocità del 2° colpo (1.0 = uguale al 1°, < 1 = più lento)
    scala: 1.2,  // fattore di scala grafica del proiettile rispetto allo spritesheet
    tickAnim: 4,    // frame di gioco per avanzare un frame dell'animazione del proiettile
  },
};

/** Percorso cartella suoni */
const SOUND_PATH = ASSET_PATH + 'sounds/';

/* ============================================================
   SUPABASE — CLIENT, SESSIONE E CLASSIFICA
   ============================================================ */

/** Istanza del client Supabase (inizializzata in initSupabase()) */
let supabase = null;

/** Sessione Supabase corrente (null = ospite o non autenticato) */
let sessioneCorrente = null;

/**
 * Dati classifica: array di { pos, nome, score, user_id } o null se non caricati.
 * Condiviso tra START e GAMEOVER.
 */
let classificaDati = null;
let classificaStato = 'idle'; // 'idle' | 'loading' | 'ok' | 'error'

/**
 * Inizializza il client Supabase usando la libreria caricata via CDN (ESM).
 * Viene chiamata prima di caricaAsset() nel bootstrap.
 */
async function initSupabase() {
  if (DEV_MODE) {
    supabase = buildFakeSupabase();
    console.info('[DEV] Supabase stub attivo — nessuna chiamata reale al database.');
    return;
  }
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm');
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) {
    console.warn('[Supabase] impossibile inizializzare:', e);
  }
}

/**
 * Carica la top-10 dalla tabella leaderboard_fantasy.
 * Aggiorna classificaDati e classificaStato in modo asincrono.
 */
async function caricaClassifica() {
  if (!supabase) { classificaStato = 'error'; return; }
  classificaStato = 'loading';
  try {
    const { data, error } = await supabase
      .from('leaderboard_fantasy')
      .select('nome, score, user_id')
      .order('score', { ascending: false })
      .limit(10);
    if (error) throw error;
    classificaDati = (data || []).map((r, i) => ({ pos: i + 1, ...r }));
    classificaStato = 'ok';
  } catch (e) {
    console.warn('[Supabase] caricaClassifica:', e);
    classificaStato = 'error';
  }
}

/**
 * Salva il punteggio se supera il record precedente (upsert by user_id).
 * Silenzioso: errori solo in console.
 * @param {number} score - Math.floor(punteggio)
 */
async function salvaPunteggio(score) {
  if (!supabase || !sessioneCorrente) return;
  try {
    // Recupera record attuale
    const { data: existing } = await supabase
      .from('leaderboard_fantasy')
      .select('score')
      .eq('user_id', sessioneCorrente.user.id)
      .maybeSingle();
    if (existing && existing.score >= score) return; // nessun miglioramento
    await supabase.from('leaderboard_fantasy').upsert({
      user_id: sessioneCorrente.user.id,
      nome:    sessioneCorrente.user.user_metadata.username,
      score,
      data:    Date.now(),
    }, { onConflict: 'user_id' });
  } catch (e) {
    console.warn('[Supabase] salvaPunteggio:', e);
  }
}

/**
 * Carica il record personale dal database per l'utente corrente.
 * Aggiorna recordPersonale se il valore in DB è superiore a quello in memoria.
 * Silenzioso: errori solo in console.
 */
async function caricaRecordPersonale() {
  if (!supabase || !sessioneCorrente) return;
  try {
    const { data, error } = await supabase
      .from('leaderboard_fantasy')
      .select('score')
      .eq('user_id', sessioneCorrente.user.id)
      .maybeSingle();
    if (error) throw error;
    if (data && data.score > recordPersonale) {
      recordPersonale = data.score;
    }
  } catch (e) {
    console.warn('[Supabase] caricaRecordPersonale:', e);
  }
}

/**
 * Disegna la classifica sul canvas nell'area indicata.
 * @param {number} x        - X centro colonna posizione
 * @param {number} yInizio  - Y prima riga
 * @param {number} rigaH    - altezza di ogni riga in px
 */
function disegnaClassifica(x, yInizio, rigaH) {
  const coloriPodio = ['#ffd700', '#c0c0c0', '#cd7f32'];

  if (classificaStato === 'loading') {
    testoFantasy('Caricamento classifica...', x, yInizio, '#b89a5a', 16, 'center', 4);
    return;
  }
  if (classificaStato === 'error' || !classificaDati) {
    testoFantasy('Classifica non disponibile', x, yInizio, '#886650', 16, 'center', 4);
    return;
  }
  if (classificaDati.length === 0) {
    testoFantasy('Nessun punteggio registrato', x, yInizio, '#886650', 16, 'center', 4);
    return;
  }

  testoFantasy('✦ CLASSIFICA ✦', x, yInizio, '#ffd700', 18, 'center', 10);

  const mioId = sessioneCorrente ? sessioneCorrente.user.id : null;

  classificaDati.forEach((r, i) => {
    const y  = yInizio + rigaH + i * rigaH;
    const isMio = r.user_id === mioId;
    const col = i < 3 ? coloriPodio[i] : (isMio ? '#a0e0ff' : '#c8b880');

    // Sfondo riga giocatore corrente
    if (isMio) {
      ctx.save();
      ctx.fillStyle = 'rgba(80,160,255,0.12)';
      ctx.fillRect(x - 280, y - rigaH + 4, 560, rigaH);
      ctx.restore();
    }

    const nome  = (r.nome || 'Anonimo').substring(0, 14);
    const score = String(r.score).padStart(5, '0');
    testoFantasy(`${r.pos}.`, x - 270, y, col, 15, 'left', isMio ? 8 : 3);
    testoFantasy(nome,        x - 240, y, col, 15, 'left', isMio ? 8 : 3);
    testoFantasy(score,       x + 260, y, col, 15, 'right', isMio ? 8 : 3);
  });
}

/* ============================================================
   OVERLAY AUTH (HTML puro sopra il canvas)
   ============================================================ */

/**
 * Crea e mostra l'overlay HTML di autenticazione.
 * L'overlay viene rimosso quando l'utente sceglie un'azione.
 * @param {Function} onStart - callback chiamata quando si può avviare START
 */
function mostraOverlayAuth(onStart) {
  // Rimuovi overlay precedente se esiste
  const old = document.getElementById('auth-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.id = 'auth-overlay';

  overlay.innerHTML = `
    <div class="auth-box">
      <h1 class="auth-title">SGRUNF<br><span>Fantasy Runner</span></h1>

      <!-- Schermata selezione -->
      <div id="auth-scelta">
        <button class="auth-btn auth-btn-primary" id="btn-vai-login">⚔ Accedi</button>
        <button class="auth-btn auth-btn-secondary" id="btn-vai-registra">✦ Registrati</button>
        <button class="auth-btn auth-btn-ghost" id="btn-ospite">Entra come Ospite</button>
      </div>

      <!-- Form Login -->
      <div id="auth-login" class="auth-form" style="display:none">
        <h2 class="auth-form-title">Accedi</h2>
        <input type="text" id="login-user" class="auth-input" placeholder="Nome utente" autocomplete="username" />
        <input type="password" id="login-pass" class="auth-input" placeholder="Password" autocomplete="current-password" />
        <div class="auth-msg" id="login-msg"></div>
        <button class="auth-btn auth-btn-primary" id="btn-login">Entra</button>
        <button class="auth-btn auth-btn-ghost" id="btn-back-login">← Indietro</button>
      </div>

      <!-- Form Registrazione -->
      <div id="auth-registra" class="auth-form" style="display:none">
        <h2 class="auth-form-title">Registrati</h2>
        <input type="text" id="reg-user" class="auth-input" placeholder="Nome utente" autocomplete="username" />
        <input type="password" id="reg-pass" class="auth-input" placeholder="Password" autocomplete="new-password" />
        <div class="auth-msg" id="reg-msg"></div>
        <button class="auth-btn auth-btn-primary" id="btn-registra">Crea account</button>
        <button class="auth-btn auth-btn-ghost" id="btn-back-reg">← Indietro</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  function mostraScelta()    { document.getElementById('auth-scelta').style.display   = ''; document.getElementById('auth-login').style.display    = 'none'; document.getElementById('auth-registra').style.display = 'none'; }
  function mostraLogin()     { document.getElementById('auth-scelta').style.display   = 'none'; document.getElementById('auth-login').style.display    = ''; document.getElementById('auth-registra').style.display = 'none'; }
  function mostraRegistra()  { document.getElementById('auth-scelta').style.display   = 'none'; document.getElementById('auth-login').style.display    = 'none'; document.getElementById('auth-registra').style.display = ''; }

  function setMsg(id, testo, ok = false) {
    const el = document.getElementById(id);
    el.textContent = testo;
    el.style.color = ok ? '#7fffb0' : '#ff7070';
  }

  // Navigazione
  document.getElementById('btn-vai-login').addEventListener('click', mostraLogin);
  document.getElementById('btn-vai-registra').addEventListener('click', mostraRegistra);
  document.getElementById('btn-back-login').addEventListener('click', mostraScelta);
  document.getElementById('btn-back-reg').addEventListener('click', mostraScelta);

  // Ospite
  document.getElementById('btn-ospite').addEventListener('click', () => {
    overlay.remove();
    onStart();
  });

  // Login
  document.getElementById('btn-login').addEventListener('click', async () => {
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    // Validazione lato client
    if (!username || !password) { setMsg('login-msg', 'Compila tutti i campi.'); return; }
    if (username.length < 3)    { setMsg('login-msg', 'Nome utente troppo corto.'); return; }

    setMsg('login-msg', 'Accesso in corso...', true);
    const email = `${username}@sgrunf.game`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      const msg = error.message.toLowerCase();
      // "user not found" — dallo stub DEV e da Supabase reale (invalid login credentials)
      if (msg.includes('user not found') || msg.includes('invalid login') || msg.includes('no user') || msg.includes('not found')) {
        setMsg('login-msg', 'Utente non trovato.');
      } else if (msg.includes('invalid password') || msg.includes('wrong password') || msg.includes('credentials')) {
        setMsg('login-msg', 'Password errata.');
      } else {
        setMsg('login-msg', 'Errore: ' + error.message);
      }
      return;
    }
    sessioneCorrente = data.session;
    overlay.remove();
    onStart();
  });

  // Registrazione
  document.getElementById('btn-registra').addEventListener('click', async () => {
    const username = document.getElementById('reg-user').value.trim();
    const password = document.getElementById('reg-pass').value;

    // Validazione lato client
    if (!username || !password)  { setMsg('reg-msg', 'Compila tutti i campi.'); return; }
    if (username.length < 3)     { setMsg('reg-msg', 'Nome utente minimo 3 caratteri.'); return; }
    if (username.length > 20)    { setMsg('reg-msg', 'Nome utente massimo 20 caratteri.'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setMsg('reg-msg', 'Solo lettere, numeri e _ nel nome.'); return; }
    if (password.length < 6)     { setMsg('reg-msg', 'Password minimo 6 caratteri.'); return; }

    setMsg('reg-msg', 'Registrazione in corso...', true);
    const email = `${username}@sgrunf.game`;
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already exists') || error.status === 422) {
        setMsg('reg-msg', 'Nome già in uso.');
      } else {
        setMsg('reg-msg', 'Errore: ' + error.message);
      }
      return;
    }
    // Sign-in automatico post-registrazione
    const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
    if (!loginErr) sessioneCorrente = loginData.session;
    else if (data.session) sessioneCorrente = data.session;
    overlay.remove();
    onStart();
  });

  // Enter su input
  ['login-user','login-pass'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login').click(); });
  });
  ['reg-user','reg-pass'].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-registra').click(); });
  });
}

/**
 * Crea e mostra il bottone Esci (Logout) sovrapposto al canvas.
 * Viene rimosso al logout o quando si avvia una nuova partita.
 */
function mostraBottoneLogout() {
  rimuoviBottoneLogout();
  if (!sessioneCorrente) return; // ospite: nessun bottone

  const btn = document.createElement('button');
  btn.id = 'btn-logout-overlay';
  btn.textContent = 'Esci';
  btn.addEventListener('click', async () => {
    rimuoviBottoneLogout();
    if (supabase) await supabase.auth.signOut();
    sessioneCorrente = null;
    classificaDati = null;
    classificaStato = 'idle';
    recordPersonale = 0;
    // Mostra di nuovo l'overlay auth e torna a START dopo
    mostraOverlayAuth(() => {
      caricaClassifica();
      caricaRecordPersonale();
      statoGioco = 'START';
    });
  });
  document.body.appendChild(btn);
}

function rimuoviBottoneLogout() {
  const b = document.getElementById('btn-logout-overlay');
  if (b) b.remove();
}



/*
 * AUDIO ARCHITECTURE — due sistemi separati per tipo di suono:
 *
 * 1) HTMLAudioElement — solo per i temi musicali (lunghi, loopati).
 *    Adatto a stream audio continui; il costo di play()/pause() è accettabile
 *    perché chiamato di rado (avvio/fine partita).
 *
 * 2) Web Audio API (AudioContext + AudioBuffer) — per suoni brevi (jump, dead,
 *    fireball). Motivo: su iOS/Android, HTMLAudioElement.play() tocca il
 *    sottosistema audio sul main thread e causa uno spike di 5–30 ms esattamente
 *    nel frame del salto. Con AudioContext.createBufferSource() + source.start()
 *    l'audio viene schedato fuori dal main thread senza bloccare rAF.
 */

/** Temi musicali — HTMLAudioElement (stream lunghi, loopati) */
const suoni = {
  theme:    new Audio(SOUND_PATH + 'theme.mp3'),
  bossTheme: new Audio(SOUND_PATH + 'bossTheme.mp3'),
};

suoni.theme.loop    = true;
suoni.theme.volume  = 0.4;
suoni.theme.preload = 'auto';
suoni.bossTheme.loop    = true;
suoni.bossTheme.volume  = 0.5;
suoni.bossTheme.preload = 'auto';

/**
 * Web Audio API context e buffer cache per SFX brevi.
 * Il context viene creato al primo gesto utente (requisito iOS/Android autoplay policy).
 * I buffer vengono pre-caricati una volta sola e riutilizzati a ogni play.
 */
let _audioCtx = null;
const _sfxBuffers = {};   // { 'jump': AudioBuffer, 'dead': AudioBuffer, ... }

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
 * @param {string} nome  - chiave cache ('jump' | 'dead' | 'fireballBlack' | 'fireballBlue')
 * @param {string} url   - percorso file audio
 */
async function preloadSfx(nome, url) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    _sfxBuffers[nome] = await ctx.decodeAudioData(arr);
  } catch (_) {}
}

/**
 * Riproduce un SFX pre-caricato via Web Audio API.
 * start(0) è non-bloccante: schedato sul thread audio, non sul main thread.
 * @param {string} nome   - chiave cache
 * @param {number} [volume=1]
 */
function playSfx(nome, volume = 1) {
  const ctx = getAudioCtx();
  if (!ctx || !_sfxBuffers[nome]) return;
  try {
    const src  = ctx.createBufferSource();
    src.buffer = _sfxBuffers[nome];
    if (volume !== 1) {
      const gain      = ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(ctx.destination);
    } else {
      src.connect(ctx.destination);
    }
    src.start(0);
  } catch (_) {}
}

/*
 * Flag: i SFX Web Audio sono stati pre-caricati al primo gesto utente.
 * Il preload avviene una volta sola — i buffer restano in memoria per tutta
 * la sessione di gioco.
 */
let _sfxPreloaded = false;


/* ============================================================
   SEZIONE 2 — DATI SPRITESHEET (coordinate frame)
   ────────────────────────────────────────────────
   Uno spritesheet è una singola immagine PNG che contiene
   tutti i frame di un'animazione affiancati in orizzontale.
   Per disegnare un frame specifico si usa ctx.drawImage() con
   8 parametri: sorgente (sx, sy, sw, sh) e destinazione (dx, dy, dw, dh).

   I dati qui sotto definiscono le coordinate di ogni frame
   all'interno del rispettivo spritesheet. Seguono il formato
   Texture Packer: { "nomeFrame": { "frame": { x, y, w, h } } }.
   La funzione flattenFrames() li converte in un formato più
   diretto: { "nomeFrame": { x, y, w, h } }.
   ============================================================ */

/** Spritesheet del player Sgrunf — stati: statico, corsa (6), salto (3), morte (3) */
const SGRUNF_RAW_JSON = {
  "frames": {
    "SgrunfFantasy_Statico": { "frame": { "x": 0, "y": 0, "w": 84, "h": 122 } },
    "SgrunfFantasy_Corsa1": { "frame": { "x": 84, "y": 0, "w": 74, "h": 124 } },
    "SgrunfFantasy_Corsa2": { "frame": { "x": 158, "y": 0, "w": 82, "h": 122 } },
    "SgrunfFantasy_Corsa3": { "frame": { "x": 240, "y": 0, "w": 74, "h": 122 } },
    "SgrunfFantasy_Corsa4": { "frame": { "x": 314, "y": 0, "w": 80, "h": 124 } },
    "SgrunfFantasy_Corsa5": { "frame": { "x": 394, "y": 0, "w": 80, "h": 124 } },
    "SgrunfFantasy_Corsa6": { "frame": { "x": 474, "y": 0, "w": 74, "h": 124 } },
    "SgrunfFantasy_Salto1": { "frame": { "x": 548, "y": 0, "w": 78, "h": 120 } },
    "SgrunfFantasy_Salto2": { "frame": { "x": 627, "y": 0, "w": 83, "h": 118 } },
    "SgrunfFantasy_Salto3": { "frame": { "x": 710, "y": 0, "w": 80, "h": 116 } },
    "SgrunfFantasy_Morte1": { "frame": { "x": 790, "y": 0, "w": 94, "h": 120 } },
    "SgrunfFantasy_Morte2": { "frame": { "x": 884, "y": 0, "w": 106, "h": 118 } },
    "SgrunfFantasy_Morte3": { "frame": { "x": 990, "y": 0, "w": 90, "h": 98 } }
  }
};

/** Spritesheet degli ostacoli forestali — 3 tipi di piante/cespugli */
const OSTACOLI_RAW_JSON = {
  "frames": {
    "OstacoloFantasy1": { "frame": { "x": 0, "y": 0, "w": 89, "h": 58 } },
    "OstacoloFantasy2": { "frame": { "x": 89, "y": 0, "w": 33, "h": 56 } },
    "OstacoloFantasy3": { "frame": { "x": 122, "y": 0, "w": 57, "h": 93 } }
  }
};

/**
 * Spritesheet del boss (Ombra Fantasy) — animazione di FLUTTUAZIONE.
 * 7 frame orizzontali che rappresentano il boss che volteggia nell'aria.
 */
const BOSS_FLUTTUA_RAW_JSON = {
  "frames": {
    "OmbraFantasyFluttua_1": { "frame": { "x": 0, "y": 0, "w": 78, "h": 118 } },
    "OmbraFantasyFluttua_2": { "frame": { "x": 78, "y": 0, "w": 82, "h": 118 } },
    "OmbraFantasyFluttua_3": { "frame": { "x": 160, "y": 0, "w": 90, "h": 124 } },
    "OmbraFantasyFluttua_4": { "frame": { "x": 250, "y": 0, "w": 98, "h": 124 } },
    "OmbraFantasyFluttua_5": { "frame": { "x": 348, "y": 0, "w": 98, "h": 120 } },
    "OmbraFantasyFluttua_6": { "frame": { "x": 446, "y": 0, "w": 108, "h": 118 } },
    "OmbraFantasyFluttua_7": { "frame": { "x": 554, "y": 0, "w": 82, "h": 120 } }
  }
};

/**
 * Spritesheet del boss (Ombra Fantasy) — animazione di SPARO.
 * 9 frame orizzontali che rappresentano il boss nell'atto di lanciare un proiettile.
 * Il proiettile viene effettivamente spawnato al frame 7 di questa animazione.
 */
const BOSS_SPARA_RAW_JSON = {
  "frames": {
    "OmbraFantasySpara_1": { "frame": { "x": 0, "y": 0, "w": 96, "h": 118 } },
    "OmbraFantasySpara_2": { "frame": { "x": 96, "y": 0, "w": 84, "h": 116 } },
    "OmbraFantasySpara_3": { "frame": { "x": 180, "y": 0, "w": 88, "h": 118 } },
    "OmbraFantasySpara_4": { "frame": { "x": 268, "y": 0, "w": 88, "h": 120 } },
    "OmbraFantasySpara_5": { "frame": { "x": 356, "y": 0, "w": 90, "h": 120 } },
    "OmbraFantasySpara_6": { "frame": { "x": 446, "y": 0, "w": 90, "h": 118 } },
    "OmbraFantasySpara_7": { "frame": { "x": 536, "y": 0, "w": 90, "h": 116 } },
    "OmbraFantasySpara_8": { "frame": { "x": 626, "y": 0, "w": 86, "h": 116 } },
    "OmbraFantasySpara_9": { "frame": { "x": 712, "y": 0, "w": 96, "h": 118 } }
  }
};

/**
 * Spritesheet palla di fuoco NERA — 6 frame di animazione in loop.
 * I frame crescono leggermente di altezza per simulare la scia infuocata.
 */
const FIREBALL_BLACK_RAW_JSON = {
  "frames": {
    "FireBallBlack_1": { "frame": { "x": 0, "y": 0, "w": 70, "h": 32 } },
    "FireBallBlack_2": { "frame": { "x": 70, "y": 0, "w": 71, "h": 38 } },
    "FireBallBlack_3": { "frame": { "x": 141, "y": 0, "w": 73, "h": 44 } },
    "FireBallBlack_4": { "frame": { "x": 214, "y": 0, "w": 72, "h": 48 } },
    "FireBallBlack_5": { "frame": { "x": 286, "y": 0, "w": 73, "h": 52 } },
    "FireBallBlack_6": { "frame": { "x": 359, "y": 0, "w": 68, "h": 52 } }
  }
};

/**
 * Spritesheet palla di fuoco BLU — 6 frame, stessa struttura della nera.
 * Differisce solo visivamente (colore) e nel suono riprodotto al lancio.
 */
const FIREBALL_BLUE_RAW_JSON = {
  "frames": {
    "FireBallBlue_1": { "frame": { "x": 0, "y": 0, "w": 70, "h": 32 } },
    "FireBallBlue_2": { "frame": { "x": 70, "y": 0, "w": 71, "h": 38 } },
    "FireBallBlue_3": { "frame": { "x": 141, "y": 0, "w": 73, "h": 44 } },
    "FireBallBlue_4": { "frame": { "x": 214, "y": 0, "w": 72, "h": 48 } },
    "FireBallBlue_5": { "frame": { "x": 286, "y": 0, "w": 73, "h": 52 } },
    "FireBallBlue_6": { "frame": { "x": 359, "y": 0, "w": 68, "h": 52 } }
  }
};

/**
 * Converte il formato Texture Packer in un dizionario piatto.
 * Input:  { frames: { "nome": { frame: { x, y, w, h } } } }
 * Output: { "nome": { x, y, w, h } }
 * Questo semplifica l'accesso ai dati frame nel codice di disegno.
 */
function flattenFrames(rawJson) {
  const out = {};
  for (const [name, val] of Object.entries(rawJson.frames)) {
    out[name] = val.frame;
  }
  return out;
}

// Dizionari frame appiattiti, pronti per l'uso in drawImage()
const SGRUNF_FRAMES = flattenFrames(SGRUNF_RAW_JSON);
const OSTACOLI_FRAMES = flattenFrames(OSTACOLI_RAW_JSON);

const BOSS_FLUTTUA_FRAMES = flattenFrames(BOSS_FLUTTUA_RAW_JSON);
const BOSS_SPARA_FRAMES = flattenFrames(BOSS_SPARA_RAW_JSON);
const FIREBALL_BLACK_FRAMES = flattenFrames(FIREBALL_BLACK_RAW_JSON);
const FIREBALL_BLUE_FRAMES = flattenFrames(FIREBALL_BLUE_RAW_JSON);

/*
 * Sequenze ordinate di frame per ogni animazione.
 * Il codice itera su questi array per avanzare l'animazione frame per frame.
 */

// Boss: 7 frame fluttuazione in loop
const FRAMES_BOSS_FLUTTUA = [
  'OmbraFantasyFluttua_1', 'OmbraFantasyFluttua_2', 'OmbraFantasyFluttua_3',
  'OmbraFantasyFluttua_4', 'OmbraFantasyFluttua_5', 'OmbraFantasyFluttua_6',
  'OmbraFantasyFluttua_7',
];
// Boss: 9 frame sparo (non in loop — si ferma all'ultimo e poi torna a FLOATING)
const FRAMES_BOSS_SPARA = [
  'OmbraFantasySpara_1', 'OmbraFantasySpara_2', 'OmbraFantasySpara_3',
  'OmbraFantasySpara_4', 'OmbraFantasySpara_5', 'OmbraFantasySpara_6',
  'OmbraFantasySpara_7', 'OmbraFantasySpara_8', 'OmbraFantasySpara_9',
];

// Proiettili: 6 frame in loop
const FRAMES_FIREBALL_BLACK = [
  'FireBallBlack_1', 'FireBallBlack_2', 'FireBallBlack_3',
  'FireBallBlack_4', 'FireBallBlack_5', 'FireBallBlack_6',
];
const FRAMES_FIREBALL_BLUE = [
  'FireBallBlue_1', 'FireBallBlue_2', 'FireBallBlue_3',
  'FireBallBlue_4', 'FireBallBlue_5', 'FireBallBlue_6',
];

// Player: sequenze per ogni stato animativo
const FRAMES_CORSA = [
  'SgrunfFantasy_Corsa1', 'SgrunfFantasy_Corsa2',
  'SgrunfFantasy_Corsa3', 'SgrunfFantasy_Corsa4',
  'SgrunfFantasy_Corsa5', 'SgrunfFantasy_Corsa6',
];
const FRAMES_SALTO = ['SgrunfFantasy_Salto1', 'SgrunfFantasy_Salto2', 'SgrunfFantasy_Salto3'];
const FRAMES_MORTE = ['SgrunfFantasy_Morte1', 'SgrunfFantasy_Morte2', 'SgrunfFantasy_Morte3'];

// Tutti i tipi di ostacoli terrestri disponibili (nessun ostacolo aereo)
const TIPI_TERRESTRI = ['OstacoloFantasy1', 'OstacoloFantasy2', 'OstacoloFantasy3'];

/** Configurazione per tipo di ostacolo — tutti condividono la stessa scala */
const OSTACOLO_CFG = {
  OstacoloFantasy1: { scala: CONFIG.ostacoli.scala },
  OstacoloFantasy2: { scala: CONFIG.ostacoli.scala },
  OstacoloFantasy3: { scala: CONFIG.ostacoli.scala },
};


/* ============================================================
   SEZIONE 3 — SETUP CANVAS
   ────────────────────────
   Il canvas ha dimensioni interne FISSE (1280×720).
   L'adattamento a schermi di dimensioni diverse è gestito
   interamente via CSS (es. width: 100%; height: auto).
   In questo modo la logica di gioco lavora sempre con le
   stesse coordinate, indipendentemente dalla risoluzione del device.
   ============================================================ */

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d', { alpha: false });

// Costanti globali per larghezza, altezza e piano di corsa del canvas
const CW = CONFIG.canvas.larghezza;   // 1280 px
const CH = CONFIG.canvas.altezza;     // 720 px
const GY = CONFIG.canvas.groundY;     // 630 px — piano di corsa

canvas.width = CW;
canvas.height = CH;


/* ============================================================
   SEZIONE 4 — CARICAMENTO ASSET
   ────────────────────────────
   Il gioco rileva se il dispositivo è touch (mobile) o pointer
   (desktop) e carica due set di asset distinti:
   - Desktop: PNG ad alta risoluzione
   - Mobile:  WebP a risoluzione ridotta (caricamento più veloce)

   Tutte le immagini vengono caricate in parallelo. Quando
   l'ultima termina, viene chiamata la callback per avviare il gioco.
   ============================================================ */

// Contenitore delle immagini caricate (popolato da caricaAsset)
const imgs = {};

// Rilevamento automatico dispositivo touch vs pointer
const isTouch = window.matchMedia("(pointer: coarse)").matches
  || ('ontouchstart' in window)
  || (navigator.maxTouchPoints > 0);

const ASSET_MAP = {
  bg1: ASSET_PATH_PNG + 'FantasyBg_1.png',
  bg2: ASSET_PATH_PNG + 'FantasyBg_2.png',
  bg3: ASSET_PATH_PNG + 'FantasyBg_3.png',
  bg4: ASSET_PATH_PNG + 'FantasyBg_4.png',
  bg5: ASSET_PATH_PNG + 'FantasyBg_5.png',
  bg6: ASSET_PATH_PNG + 'FantasyBg_6.png',
  sgrunf: ASSET_PATH_PNG + 'SgrunfFantasy_Spritesheet.png',
  ostacoli: ASSET_PATH_PNG + 'OstacoliFantasy_Spritesheet.png',
  bossFluttua: ASSET_PATH_PNG + 'OmbraFantasyFluttua_Spritesheet.png',
  bossSpara: ASSET_PATH_PNG + 'OmbraFantasySpara_Spritesheet.png',
  projectileBlack: ASSET_PATH_PNG + 'FireBallBlack.png',
  projectileBlue: ASSET_PATH_PNG + 'FireBallBlue.png',
};

let assetsCaricati = 0;
const TOTALE_ASSET = Object.keys(ASSET_MAP).length;

/**
 * Avvia il caricamento parallelo di tutte le immagini.
 * Sia onload che onerror incrementano il contatore per non bloccarsi
 * su asset mancanti. Quando tutti sono pronti chiama callback().
 * @param {Function} callback - funzione da eseguire al termine del caricamento
 */
function caricaAsset(callback) {
  for (const [chiave, src] of Object.entries(ASSET_MAP)) {
    const img = new Image();
    img.onload = img.onerror = () => {
      assetsCaricati++;
      if (assetsCaricati === TOTALE_ASSET) callback();
    };
    img.src = src;
    imgs[chiave] = img;
  }
}


/* ============================================================
   SEZIONE 5 — PARALLAX LAYER (sfondo scorrevole a strati)
   ──────────────────────────────────────────────────────────
   L'effetto parallax simula la profondità: gli strati lontani
   (cielo, montagne) scorrono più lentamente di quelli vicini
   (cespugli, terreno). Ci sono 6 layer sovrapposti con velocità
   crescente dall'orizzonte al piano di corsa.

   Ogni layer scorre in loop infinito: quando la tile esce a
   sinistra, viene ridisegnata a destra senza discontinuità.
   La matematica del loop usa il modulo (%) della posizione di scroll.
   ============================================================ */

class ParallaxLayer {
  /**
   * @param {HTMLImageElement} img         - immagine da scorrere (uno dei bg1-bg6)
   * @param {number}           speedFactor - quanto veloce scorre rispetto agli ostacoli
   *                                         (0 = fermo, 1 = stessa velocità degli ostacoli)
   */
  constructor(img, speedFactor) {
    this.img = img;
    this.speedFactor = speedFactor;
    this.offset = 0;  // pixel di scroll accumulati dall'inizio della partita
  }

  /**
   * Aggiorna la posizione di scroll del layer.
   * @param {number} velocitaBase - velocità corrente degli ostacoli (px/frame@60fps)
   * @param {number} [dt=16.667]  - delta time in ms per scaling frame-rate indipendente
   */
  update(velocitaBase, dt = 16.667) {
    this.offset += velocitaBase * this.speedFactor * (dt / 16.667);
  }

  /**
   * Disegna il layer in loop infinito.
   * La tile viene scalata proporzionalmente per riempire l'intera altezza del canvas (720px),
   * poi replicata orizzontalmente usando il modulo per garantire il loop senza giunture visibili.
   */
  draw() {
    const img = this.img;
    if (!img.complete || !img.naturalWidth) return;

    const nw = img.naturalWidth;
    const nh = img.naturalHeight;

    const scalaH = CH / nh;
    const drawW  = nw * scalaH;

    // Offset intero: evita sub-pixel rendering
    const scrollX = (this.offset % drawW) | 0;
    let startX = -scrollX;
    if (startX > 0) startX -= drawW;

    for (let x = startX; x < CW; x += drawW) {
      ctx.drawImage(img, x, 0, drawW, CH);
    }
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
 * Pre-renderizza tutti i frame sprite e li salva nelle cache.
 * Chiamata una sola volta dopo il caricamento degli asset.
 */
function prebuildSprites() {
  const sc = CONFIG.player.scala;

  // Frames player (tutti: corsa, salto, morte, statico)
  const tuttiFrameSgrunf = Object.keys(SGRUNF_FRAMES);
  for (let i = 0; i < tuttiFrameSgrunf.length; i++) {
    const nome = tuttiFrameSgrunf[i];
    const fd   = SGRUNF_FRAMES[nome];
    const dw   = Math.round(fd.w * sc);
    const dh   = Math.round(fd.h * sc);
    SGRUNF_CACHE[nome] = _creaFrameCanvas(imgs.sgrunf, fd, dw, dh);
  }

  // Frames ostacoli
  const tipiOstacoli = Object.keys(OSTACOLI_FRAMES);
  for (let i = 0; i < tipiOstacoli.length; i++) {
    const tipo = tipiOstacoli[i];
    const fd   = OSTACOLI_FRAMES[tipo];
    const sc2  = OSTACOLO_CFG[tipo].scala;
    const dw   = Math.round(fd.w * sc2);
    const dh   = Math.round(fd.h * sc2);
    OSTACOLI_CACHE[tipo] = _creaFrameCanvas(imgs.ostacoli, fd, dw, dh);
  }
}

/**
 * Scalda il font engine per evitare jank al primo fillText in-game.
 * Il primo fillText su un font non ancora usato può causare un ritardo
 * di 5–15ms sul main thread mentre il browser carica il font rasterizzato.
 */
function prewarmFont() {
  ctx.save();
  ctx.globalAlpha = 0;
  ctx.font = "bold 26px 'Georgia', 'Palatino Linotype', Palatino, serif";
  ctx.fillText('0', -100, -100);
  ctx.restore();
}


   /**────────────────────────────
   Il player è sempre fisso alla stessa X (CONFIG.player.x).
   Il senso di movimento viene dalla scena che scorre a sinistra.

   STATI ANIMATIVI:
     RUN   → corsa normale a terra (loop di 6 frame)
     JUMP  → in volo dopo un salto (3 frame selezionati dalla velocità verticale)
     DEATH → animazione di morte (3 frame, non in loop)
     IDLE  → frame statico (usato nella schermata START)

   FISICA DEL SALTO:
     Il salto applica una velocità verticale negativa (v0Salto) che decresce
     ogni frame per la gravità. Quando Y ritorna a groundY il player è di nuovo a terra.
     Il player ha un solo salto per volta (non doppio salto).

   HITBOX:
     La hitbox è più piccola dello sprite per rendere le collisioni "fair" —
     il giocatore non muore per un proiettile che sfiora visivamente il bordo.
   ============================================================ */

/** Costante per i nomi degli stati animativi del player */
const STATO_ANIM = { RUN: 'run', JUMP: 'jump', DEATH: 'death', IDLE: 'idle' };

class Player {
  constructor() {
    this.reset();
  }

  /** Riporta il player allo stato iniziale (usato da avviaPartita) */
  reset() {
    const sc = CONFIG.player.scala;
    const ref = SGRUNF_FRAMES['SgrunfFantasy_Statico'];

    // Dimensioni dello sprite scalate
    this.w = Math.round(ref.w * sc);
    this.h = Math.round(ref.h * sc);

    this.x = CONFIG.player.x;  // X fissa per tutta la partita
    this.y = GY;               // Y = piano di corsa (piedi del player)
    this.vy = 0;                // velocità verticale corrente
    this.aTerra = true;             // true se il player è sul piano di corsa

    this.stato = STATO_ANIM.RUN;
    this.frameIdx = 0;   // indice del frame corrente nell'array di animazione
    this.frameTick = 0;   // contatore frame di gioco (per rallentare l'animazione)

    // Flag impostato a true quando l'animazione di morte ha completato tutti i frame
    this.morteFine = false;
  }

  /**
   * Esegue un salto.
   * Ignorato se il player è già in volo o in stato di morte.
   */
  salta() {
    if (!this.aTerra || this.stato === STATO_ANIM.DEATH) return;

    /*
     * Web Audio API: playSfx è non-bloccante sul main thread.
     * A differenza di HTMLAudioElement.play(), non causa spike sul thread audio.
     */
    playSfx('jump', 0.7);

    this.vy     = CONFIG.player.v0Salto;
    this.aTerra = false;
    this.stato  = STATO_ANIM.JUMP;
    this.frameIdx = 0;
  }

  /**
   * Attiva l'animazione di morte e riproduce il suono.
   * Se il player era a terra applica un leggero impulso verso l'alto
   * per un effetto visivo di "sobbalzo" alla morte.
   */
  muori() {
    if (this.stato === STATO_ANIM.DEATH) return;  // già in morte, non ripetere

    suoni.theme.pause();
    suoni.bossTheme.pause();
    playSfx('dead', 1.0);

    this.stato    = STATO_ANIM.DEATH;
    this.frameIdx  = 0;
    this.frameTick = 0;
    this.morteFine = false;
    if (this.aTerra) this.vy = -5;
  }

  /**
   * Aggiorna la fisica e l'animazione del player.
   * Chiamato ogni frame dal game loop sia durante PLAYING che durante DYING.
   * @param {number} [dt=16.667] - delta time in ms per scaling frame-rate indipendente
   */
  update(dt = 16.667) {
    /*
     * FISICA DELTA-TIME:
     * Il fattore di scala normalizza la fisica a 60fps di riferimento (16.667ms).
     * Questo garantisce salti identici sia a 30fps che a 60fps su mobile.
     */
    const dtScale = dt / 16.667;
    const g = CONFIG.player.gravita;

    // ── Fisica verticale (attiva anche durante la morte per la traiettoria del corpo) ──
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

    // ── Avanzamento animazione (delta-time) ────────────────────────────────────
    // frameTick accumula ms; si avanza al prossimo frame solo quando si raggiunge
    // la soglia in ms (tick * 16.667 = stesso ritmo di prima a 60fps).
    this.frameTick += dt;

    switch (this.stato) {

      case STATO_ANIM.RUN: {
        const sogliaCorsa = CONFIG.animazione.tickCorsa * 16.667;
        if (this.frameTick >= sogliaCorsa) {
          this.frameTick -= sogliaCorsa;
          this.frameIdx = (this.frameIdx + 1) % FRAMES_CORSA.length;
        }
        break;
      }

      case STATO_ANIM.JUMP:
        if      (this.vy < -2.5) this.frameIdx = 0;
        else if (this.vy <  2.5) this.frameIdx = 1;
        else                     this.frameIdx = 2;
        break;

      case STATO_ANIM.DEATH: {
        const sogliaMorte = CONFIG.animazione.tickMorte * 16.667;
        if (this.frameTick >= sogliaMorte) {
          this.frameTick -= sogliaMorte;
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

  /** Disegna il player sul canvas nel frame di animazione corrente */
  draw() {
    let nomeFrame;
    switch (this.stato) {
      case STATO_ANIM.RUN:   nomeFrame = FRAMES_CORSA[this.frameIdx]; break;
      case STATO_ANIM.JUMP:  nomeFrame = FRAMES_SALTO[this.frameIdx]; break;
      case STATO_ANIM.DEATH: nomeFrame = FRAMES_MORTE[this.frameIdx]; break;
      default:               nomeFrame = 'SgrunfFantasy_Statico';
    }

    // Usa il canvas pre-renderizzato (singola draw call GPU, nessun crop atlas)
    const cached = SGRUNF_CACHE[nomeFrame];
    if (cached) {
      const fd = SGRUNF_FRAMES[nomeFrame];
      const sc = CONFIG.player.scala;
      const dw = Math.round(fd.w * sc);
      const dh = Math.round(fd.h * sc);
      ctx.drawImage(cached, (this.x - dw / 2) | 0, (this.y - dh) | 0);
      return;
    }

    // Fallback: atlante diretto (non dovrebbe mai accadere dopo prebuildSprites)
    const fd = SGRUNF_FRAMES[nomeFrame];
    if (!fd) return;
    if (imgs.sgrunf && imgs.sgrunf.complete) {
      const sc = CONFIG.player.scala;
      const dw = Math.round(fd.w * sc);
      const dh = Math.round(fd.h * sc);
      ctx.drawImage(imgs.sgrunf, fd.x, fd.y, fd.w, fd.h, (this.x - dw / 2) | 0, (this.y - dh) | 0, dw, dh);
    }
  }

  /**
   * Restituisce la hitbox del player — un rettangolo più piccolo dello sprite.
   * Il margine interno (mx, my) rende le collisioni percettivamente "fair":
   * il proiettile deve sovrapporre il corpo visibile, non solo sfiorare il bordo.
   * @returns {{ x, y, w, h }}
   */
  getHitbox() {
    const mx = 20, my = 20;
    // usa il frame corrente per altezza reale disegnata
    let nomeFrame;
    switch (this.stato) {
      case STATO_ANIM.RUN: nomeFrame = FRAMES_CORSA[this.frameIdx]; break;
      case STATO_ANIM.JUMP: nomeFrame = FRAMES_SALTO[this.frameIdx]; break;
      case STATO_ANIM.DEATH: nomeFrame = FRAMES_MORTE[this.frameIdx]; break;
      default: nomeFrame = 'SgrunfFantasy_Statico';
    } const fd = SGRUNF_FRAMES[nomeFrame] || SGRUNF_FRAMES['SgrunfFantasy_Statico'];
    const sc = CONFIG.player.scala;
    const spriteW = Math.round(fd.w * sc);
    const spriteH = Math.round(fd.h * sc);
    const w = spriteW - mx;
    const h = spriteH - my;
    return {
      x: this.x - w / 2,
      y: this.y - spriteH + my, // usa spriteH per ancorare correttamente la hitbox
      w,
      h,
    };
  }

  /**
   * Restituisce la Y del punto più alto della testa del player
   * considerando il frame più alto tra tutti i frame di corsa.
   * Usato per il debug della hitbox (non per le collisioni).
   */
  getTestaMaxY() {
    const altMaxFrame = FRAMES_CORSA.reduce((acc, nome) => {
      const fd = SGRUNF_FRAMES[nome];
      return fd ? Math.max(acc, fd.h) : acc;
    }, 0);
    return GY - Math.round(altMaxFrame * CONFIG.player.scala);
  }

  /**
   * Calcola la massima distanza orizzontale coperta da un salto completo.
   * Usata dalla logica di spawn per verificare che una coppia di ostacoli
   * sia fisicamente superabile con un singolo salto.
   *
   * Formula cinematica del moto parabolico:
   *   t_volo = 2 * |v0| / gravita   (durata totale del salto in frame)
   *   distanza = velocitaGioco * t_volo
   *
   * @param {number} velAttuale - velocità corrente degli ostacoli (px/frame)
   * @returns {number} distanza orizzontale massima coperta dal salto (px)
   */
  static calcolaDistanzaSaltoMax(velAttuale) {
    const tVolo = (2 * Math.abs(CONFIG.player.v0Salto)) / CONFIG.player.gravita;
    return velAttuale * tVolo;
  }
}


/* ============================================================
   SEZIONE 7 — OBSTACLE (ostacoli terrestri)
   ──────────────────────────────────────────
   Gli ostacoli sono piante e cespugli che scorrono da destra
   verso sinistra alla stessa velocità del terreno.
   Tutti sono terrestri (base ancorata a groundY).
   Esistono 3 tipi, diversi per forma e altezza.

   Lo spawn avviene fuori schermo a destra (x > CW) e l'ostacolo
   viene rimosso dall'array quando esce completamente a sinistra.
   ============================================================ */

class Obstacle {
  /**
   * @param {string} tipo      - chiave del tipo ('OstacoloFantasy1/2/3')
   * @param {number} [offsetX] - spostamento X extra per posizionare il 2° ostacolo di una coppia
   */
  constructor(tipo, offsetX = 0) {
    this.tipo = tipo;
    const cfg = OSTACOLO_CFG[tipo];
    const fd = OSTACOLI_FRAMES[tipo];
    const sc = cfg.scala;

    // Coordinate del frame nello spritesheet (per drawImage sorgente)
    this.sx = fd.x;
    this.sy = fd.y;
    this.sw = fd.w;
    this.sh = fd.h;

    // Dimensioni dell'ostacolo nel canvas (scalate)
    this.w = Math.round(fd.w * sc);
    this.h = Math.round(fd.h * sc);

    // Posizione iniziale fuori dal canvas a destra (con offset per coppie)
    this.x = CW + 80 + offsetX;
    // La base dell'ostacolo si appoggia rigidamente sul piano di corsa
    this.y = GY - this.h;
  }

  /**
   * Sposta l'ostacolo verso sinistra.
   * @param {number} vel - velocità corrente del gioco (px/frame)
   */
  update(vel) {
    this.x -= vel;
  }

  /**
   * Reinizializza l'ostacolo per il riutilizzo dal pool.
   * @param {string} tipo    - chiave del tipo ostacolo
   * @param {number} offsetX - offset X per coppie
   */
  resetPool(tipo, offsetX = 0) {
    this.tipo = tipo;
    const cfg = OSTACOLO_CFG[tipo];
    const fd  = OSTACOLI_FRAMES[tipo];
    const sc  = cfg.scala;
    this.sx = fd.x;
    this.sy = fd.y;
    this.sw = fd.w;
    this.sh = fd.h;
    this.w  = Math.round(fd.w * sc);
    this.h  = Math.round(fd.h * sc);
    this.x  = CW + 80 + offsetX;
    this.y  = GY - this.h;
  }

  /** Disegna l'ostacolo dalla sua posizione corrente */
  draw() {
    // Usa canvas pre-renderizzato se disponibile
    const cached = OSTACOLI_CACHE[this.tipo];
    if (cached) {
      ctx.drawImage(cached, this.x | 0, this.y | 0);
      return;
    }
    // Fallback atlante
    if (imgs.ostacoli && imgs.ostacoli.complete) {
      ctx.drawImage(imgs.ostacoli, this.sx, this.sy, this.sw, this.sh, this.x, this.y, this.w, this.h);
    } else {
      ctx.fillStyle = '#5a8a2a';
      ctx.fillRect(this.x, this.y, this.w, this.h);
    }
  }

  /**
   * Hitbox con margine interno per collisioni più fair.
   * @returns {{ x, y, w, h }}
   */
  getHitbox() {
    const m = 8;
    return {
      x: this.x + m,
      y: this.y + m,
      w: this.w - m * 2,
      h: this.h - m * 2,
    };
  }

  /** True se l'ostacolo ha superato il bordo sinistro del canvas */
  fuoriSchermo() {
    return this.x + this.w < -20;
  }
}


/* ============================================================
   SEZIONE 8B — OBJECT POOL OSTACOLI
   Riutilizza istanze Obstacle invece di allocarne di nuove ogni spawn.
   Riduce la pressione sul GC mobile (Safari/iOS).
   ============================================================ */

const obstaclePool = [];

/**
 * Ottiene un Obstacle dal pool (se disponibile) o ne crea uno nuovo.
 * resetPool() reinizializza posizione e dimensioni senza allocare memoria.
 */
function getObstacle(tipo, offsetX = 0) {
  if (obstaclePool.length > 0) {
    const ob = obstaclePool.pop();
    ob.resetPool(tipo, offsetX);
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


/* ============================================================
   SEZIONE 7b — PROJECTILE (proiettili del boss)
   ──────────────────────────────────────────────
   Il boss lancia proiettili che viaggiano orizzontalmente
   da destra verso sinistra. Due varianti visive:
   FireBallBlack (nera) e FireBallBlue (blu).


   VELOCITÀ DINAMICA:
     La velocità non è fissa, ma si calcola ogni frame in base
     alla velocità corrente del terreno + la componente propria.
     Questo mantiene i proiettili sempre "sfidanti" anche quando
     il gioco accelera. Il secondo colpo può avere un moltiplicatore
     separato per essere calibrato indipendentemente.


   POSIZIONE DI LANCIO (FIX HITBOX):
     Il proiettile viene lanciato alla Y del boss (durante
     la sua oscillazione sinusoidale), questo rispetta il
     movimento naturale del boss e rende il colpo
     coerente con la sua posizione visiva sullo schermo.
   ============================================================ */


class Projectile {
  /**
   * @param {string} tipo              - 'FireBallBlack' o 'FireBallBlue'
   * @param {number} x                 - posizione X di lancio (bordo sinistro del boss)
   * @param {number} y                 - posizione Y di lancio (Y del boss, non player)
   * @param {number} appearanceIndex   - indice 0-based dell'apparizione boss (per velocità dinamica)
   * @param {number} fattoreVelocita   - moltiplicatore velocità (1.0 = normale, < 1 = più lento)
   */
  constructor(tipo, x, y, appearanceIndex = 0, fattoreVelocita = 1.0) {
    this.tipo = tipo;
    this.appearanceIndex = appearanceIndex;
    this.fattoreVelocita = fattoreVelocita;

    const sc = CONFIG.proiettile.scala;

    // Seleziona sequenza frame e immagine corrette in base al tipo
    if (tipo === 'FireBallBlack') {
      this.frames = FRAMES_FIREBALL_BLACK;
      this.frameData = FIREBALL_BLACK_FRAMES;
      this.imgKey = 'projectileBlack';
    } else {
      this.frames = FRAMES_FIREBALL_BLUE;
      this.frameData = FIREBALL_BLUE_FRAMES;
      this.imgKey = 'projectileBlue';
    }

    // Dimensioni scalate dal primo frame
    const fd0 = this.frameData[this.frames[0]];
    this.w = Math.round(fd0.w * sc);
    this.h = Math.round(fd0.h * sc);

    // Posiziona il proiettile centrato verticalmente sulla Y del boss
    this.x = x - this.w / 2;
    this.y = y - this.h / 2;

    this.frameIdx = 0;
    this.frameTick = 0;
  }

  /**
   * Aggiorna posizione e animazione del proiettile.
   *
   * FORMULA VELOCITÀ DINAMICA:
   *   velProiettile = (velocitaTerreno + velocitaBase) × fattoreVelocita
   *
   *   - velocitaTerreno: aumenta col tempo (gioco sempre più veloce)
   *   - velocitaBase: componente fissa propria del proiettile
   *   - fattoreVelocita: moltiplicatore per calibrare il 2° colpo
   */
  update() {
    const velDinamica = (velocita + CONFIG.proiettile.velocitaBase) * this.fattoreVelocita;
    this.x -= velDinamica;

    // Animazione ciclica in loop
    this.frameTick++;
    if (this.frameTick >= CONFIG.proiettile.tickAnim) {
      this.frameTick = 0;
      this.frameIdx = (this.frameIdx + 1) % this.frames.length;
    }
  }

  /** Disegna il proiettile nel frame di animazione corrente */
  draw() {
    const nomeFr = this.frames[this.frameIdx];
    const fd = this.frameData[nomeFr];
    if (!fd) return;

    const sc = CONFIG.proiettile.scala;
    const dw = Math.round(fd.w * sc);
    const dh = Math.round(fd.h * sc);
    const img = imgs[this.imgKey];

    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, fd.x, fd.y, fd.w, fd.h, this.x, this.y, dw, dh);
    } else {
      // Fallback colorato se l'immagine non è pronta
      ctx.fillStyle = this.tipo === 'FireBallBlack' ? '#3a2255' : '#0055ff';
      ctx.fillRect(this.x, this.y, dw, dh);
    }
  }

  /**
   * Hitbox ridotta per collisioni fair (le fiamme decorative ai bordi non uccidono).
   * @returns {{ x, y, w, h }}
   */
  getHitbox() {
    const nomeFr = this.frames[this.frameIdx];
    const fd = this.frameData[nomeFr] || this.frameData[this.frames];
    const sc = CONFIG.proiettile.scala;
    const w = Math.round(fd.w * sc);
    const h = Math.round(fd.h * sc);
    const m = 8;
    return {
      x: this.x + m,
      y: this.y + m,
      w: w - m * 2,
      h: h - m * 2,
    };
  }

  /** True se il proiettile è uscito completamente a sinistra dello schermo */
  fuoriSchermo() {
    return this.x + this.w < -40;
  }
}


/* ============================================================
   SEZIONE 7c — BOSS (Ombra Fantasy)
   ───────────────────────────────────
   STATI DEL BOSS (macchina a stati finiti):
     ENTERING  → il boss entra da destra scorrendo verso la sua posizione
     FLOATING  → il boss è in posizione, fluttua verticalmente e conta il timer d'attacco
     SHOOTING  → il boss esegue l'animazione di sparo (1 o 2 volte per i colpi doppi)
     LEAVING   → il boss si ritira verso destra dopo aver eseguito tutti gli attacchi

   SISTEMA DI APPARIZIONI MULTIPLE:
     Il boss può comparire più volte nella stessa partita.
     Ogni apparizione riceve un indice (0, 1, 2...) che scala la difficoltà:
       - Intervalli di attacco più brevi
       - Dalla 2ª apparizione: attacco doppio (due animazioni di sparo consecutive)

   ATTACCO DOPPIO:
     Dalla 2ª apparizione, ogni ciclo di attacco esegue DUE animazioni di sparo.
     Tra la prima e la seconda c'è una pausa configurabile (ritardoSecondoColpoMs).
     Il primo colpo è normale; il secondo è di tipo alternato (nero/blu) e può
     avere una velocità differente (fattoreVelocitaSecondoColpo).
   ============================================================ */

/** Enumerazione degli stati della macchina a stati del boss */
const STATO_BOSS = {
  ENTERING: 'entering',  // sta entrando a schermo da destra
  FLOATING: 'floating',  // in posizione, fluttua e aspetta il timer d'attacco
  SHOOTING: 'shooting',  // sta eseguendo l'animazione di sparo
  LEAVING: 'leaving',   // si ritira verso destra per uscire dallo schermo
};

class Boss {
  /**
   * @param {number} appearanceIndex - indice 0-based di questa apparizione.
   *   0 = prima volta, 1 = seconda, ecc.
   *   Determina: intervalli d'attacco, presenza del colpo doppio.
   */
  constructor(appearanceIndex) {
    this.appearanceIndex = appearanceIndex;

    // ── Posizione iniziale: completamente fuori schermo a destra ──────────────
    this.x = CW + 200;

    // Dimensioni sprite (per riferimento nelle hitbox e nel centraggio)
    const fd0 = BOSS_FLUTTUA_FRAMES['OmbraFantasyFluttua_1'];
    this.w = Math.round(fd0.w * CONFIG.boss.scalaFluttua);
    this.h = Math.round(fd0.h * CONFIG.boss.scalaFluttua);

    // Y iniziale = Y base di fluttuazione
    this.y = CONFIG.boss.yFluttua;

    // ── Stato e animazione ────────────────────────────────────────────────────
    this.stato = STATO_BOSS.ENTERING;
    this.frameIdx = 0;   // indice frame corrente nell'array di animazione
    this.frameTick = 0;   // contatore frame di gioco (per rallentare l'animazione)

    // Fase dell'oscillazione sinusoidale per la fluttuazione verticale
    this.sinFase = 0;

    // ── Intervalli di attacco scalati per questa apparizione ──────────────────
    // Ad ogni nuova comparsa gli intervalli si riducono del fattore intervalloRiduzione
    const factor = Math.pow(CONFIG.boss.intervalloRiduzione, appearanceIndex);
    this._minMs = CONFIG.boss.attaccoMinMs * factor;
    this._maxMs = CONFIG.boss.attaccoMaxMs * factor;

    // Timer che conta i frame trascorsi dall'ultimo attacco
    this.attaccoTimer = 0;
    this.attaccoIntervallo = this._nuovoIntervallo();  // intervallo casuale iniziale

    // Conta gli attacchi completati: quando raggiunge attacchiPrimaRitirata → LEAVING
    this.attacchiEseguiti = 0;

    // Tipo di proiettile del prossimo lancio (alterna nero/blu ad ogni attacco)
    this._prossimoTipo = Math.random() < 0.5 ? 'FireBallBlack' : 'FireBallBlue';

    /*
     * _sparoIndice traccia quale colpo è in corso nell'attuale ciclo di sparo:
     *   0 = nessuna animazione di sparo attiva
     *   1 = prima animazione (primo colpo)
     *   2 = seconda animazione (secondo colpo — attivo dalla 2ª apparizione)
     */
    this._sparoIndice = 0;

    /*
     * Countdown in frame per la pausa tra prima e seconda animazione di sparo.
     * Viene impostato al termine della prima animazione e decrementato ogni frame.
     * Quando arriva a 0 scatta la seconda animazione.
     */
    this._pausaSecondoColpo = 0;

    /*
     * Flag letto dal game loop dopo ogni boss.update().
     * Quando true il game loop distrugge il boss (boss = null) e ripristina la musica.
     */
    this.deveUscire = false;
  }

  /**
   * Genera un nuovo intervallo casuale (in frame) per il prossimo attacco.
   * Usa i valori scalati per questa apparizione, non quelli globali in CONFIG.
   * @returns {number} numero di frame da attendere prima del prossimo attacco
   */

  _nuovoIntervallo() {
    // Converte millisecondi in frame (assumendo 60fps)
    const min = this._minMs / (1000 / 60);
    const max = this._maxMs / (1000 / 60);
    return Math.floor(min + Math.random() * (max - min));
  }

  /**
   * Aggiorna la logica del boss ogni frame.
   * Gestisce il movimento, la fluttuazione, il timer d'attacco e la macchina a stati.
   */

  update() {

    // Posizione X obiettivo: sempre a distanza fissa dal player
    const targetX = player.x + CONFIG.boss.distanzaDalPlayer;
    const tickAnim = 6;                           // frame per avanzare un frame di fluttuazione
    const tickAnimSparo = CONFIG.boss.tickAnimSparo;   // frame per avanzare un frame di sparo (più veloce)

    // ── Gestione movimento in base allo stato ─────────────────────────────────

    if (this.stato === STATO_BOSS.ENTERING) {
      // Scorre da destra verso la posizione di combattimento
      if (this.x > targetX) {
        this.x -= CONFIG.boss.velocitaIngresso;
        if (this.x <= targetX) {
          this.x = targetX;
          this.stato = STATO_BOSS.FLOATING;  // arrivato → inizia a fluttuare
        }
      } else {
        this.x = targetX;
        this.stato = STATO_BOSS.FLOATING;
      }

    } else if (this.stato === STATO_BOSS.FLOATING) {
      // Ancora la X al player (il boss non si sposta autonomamente)
      this.x = targetX;

    } else if (this.stato === STATO_BOSS.SHOOTING) {
      // Anche durante lo sparo rimane ancorato al player
      this.x = targetX;

    } else if (this.stato === STATO_BOSS.LEAVING) {
      // Ritirata: scorre verso destra finché esce completamente
      this.x += CONFIG.boss.velocitaRitirata;
      if (this.x > CW + 250) {
        // Fuori schermo: segnala al game loop di eliminarlo
        this.deveUscire = true;
        return;
      }
    }

    // ── Oscillazione verticale sinusoidale ────────────────────────────────────
    // Attiva in tutti gli stati tranne LEAVING (che è già fuori gioco)
    if (this.stato !== STATO_BOSS.LEAVING) {
      this.sinFase += CONFIG.boss.velocitaFluttua;
      this.y = CONFIG.boss.yFluttua + Math.sin(this.sinFase) * CONFIG.boss.ampiezzeFluttua;
    }

    // ── Avanzamento animazione e logica di stato ──────────────────────────────
    this.frameTick++;

    if (this.stato === STATO_BOSS.FLOATING ||
      this.stato === STATO_BOSS.ENTERING ||
      this.stato === STATO_BOSS.LEAVING) {

      // Animazione di fluttuazione (in loop)
      if (this.frameTick >= tickAnim) {
        this.frameTick = 0;
        this.frameIdx = (this.frameIdx + 1) % FRAMES_BOSS_FLUTTUA.length;
      }

      // Timer attacco — si conta solo mentre il boss è in posizione (FLOATING)
      if (this.stato === STATO_BOSS.FLOATING) {
        this.attaccoTimer++;
        if (this.attaccoTimer >= this.attaccoIntervallo) {
          this._iniziaAttacco();  // scatta: passa a SHOOTING
        }
      }

    } else if (this.stato === STATO_BOSS.SHOOTING) {

      /*
       * GESTIONE ANIMAZIONE DI SPARO:
       *
       * La sequenza è:
       *   1. Prima animazione di sparo (9 frame): al frame 7 → lancia il 1° proiettile
       *   2. Se è dalla 2ª apparizione: pausa di ritardoSecondoColpoMs
       *   3. Seconda animazione di sparo (9 frame): al frame 7 → lancia il 2° proiettile
       *   4. Fine: conta l'attacco e torna a FLOATING (o LEAVING se attacchi esauriti)
       */

      // ── Pausa tra primo e secondo colpo ──────────────────────────────────────
      if (this._pausaSecondoColpo > 0) {
        this._pausaSecondoColpo--;
        if (this._pausaSecondoColpo === 0) {
          // Pausa finita: ricomincia l'animazione per il secondo colpo
          this.frameIdx = 0;
          this.frameTick = 0;
          this._sparoIndice = 2;
        }
        return;  // durante la pausa l'animazione è ferma (boss mantiene l'ultimo frame)
      }

      // ── Avanzamento animazione di sparo (più veloce della fluttuazione) ─────
      if (this.frameTick >= tickAnimSparo) {
        this.frameTick = 0;
        this.frameIdx++;

        // Al frame 7 viene effettivamente lanciato il proiettile
        if (this.frameIdx === 7) {
          this._lancia();
        }

        // Fine dell'animazione di sparo corrente
        if (this.frameIdx >= FRAMES_BOSS_SPARA.length) {

          if (this._sparoIndice === 1 && this.appearanceIndex >= 1 && this.stato === STATO_BOSS.SHOOTING) {
            // Prima animazione finita + siamo dalla 2ª apparizione → attiva la pausa
            const framesRitardo = Math.round(CONFIG.boss.ritardoSecondoColpoMs / (1000 / 60));
            this._pausaSecondoColpo = framesRitardo;

          } else {
            // Sequenza completata (colpo singolo o secondo colpo terminato)
            // Alterna il tipo di proiettile per il prossimo ciclo
            this._prossimoTipo = this._prossimoTipo === 'FireBallBlack' ? 'FireBallBlue' : 'FireBallBlack';
            this._sparoIndice = 0;
            this.attacchiEseguiti++;

            if (this.attacchiEseguiti >= CONFIG.boss.attacchiPrimaRitirata) {
              // Attacchi esauriti → si ritira
              this.stato = STATO_BOSS.LEAVING;
              this.frameIdx = 0;
              this.frameTick = 0;
            } else {
              // Torna a fluttuare e aspetta il prossimo attacco
              this.frameIdx = 0;
              this.stato = STATO_BOSS.FLOATING;
              this.attaccoTimer = 0;
              this.attaccoIntervallo = this._nuovoIntervallo();
            }
          }
        }
      }
    }
  }

  /**
   * Attiva il ciclo di sparo: imposta lo stato SHOOTING e prepara il primo colpo.
   * Chiamato dal timer attacco quando scade in stato FLOATING.
   */

  _iniziaAttacco() {
    this.stato = STATO_BOSS.SHOOTING;
    this.frameIdx = 0;
    this.frameTick = 0;
    this._sparoIndice = 1;  // inizia dalla prima animazione
  }

  /**
   * Istanzia il proiettile nel canvas e riproduce l'effetto sonoro.
   *
   * POSIZIONE DI LANCIO Y:
   *   Il proiettile viene lanciato alla Y del boss (durante la sua oscillazione
   *   sinusoidale). Questo rispetta il movimento naturale del boss
   *   e rende il colpo coerente con la sua posizione visiva sullo schermo.
   *
   * @param {string} tipo           - 'FireBallBlack' | 'FireBallBlue'
   * @param {number} fattoreVelocita - moltiplicatore velocità (1.0 = normale)
   */

  _lanciaProiettile(tipo, fattoreVelocita = 1.0) {
    const lx = this.x - 20;  // bordo sinistro del boss (punto di partenza del proiettile)

    // Usa la Y del boss come punto di lancio, così il proiettile parte
    // dall'altezza effettiva del boss durante la sua oscillazione sinusoidale.
    const ly = this.y;

    proiettili.push(new Projectile(tipo, lx, ly, this.appearanceIndex, fattoreVelocita));

    // Suono diverso per ciascun tipo di proiettile — Web Audio API non-bloccante
    if (tipo === 'FireBallBlack') {
      playSfx('fireballBlack', 0.9);
    } else {
      playSfx('fireballBlue', 0.9);
    }
  }

  /**
   * Determina quale proiettile lanciare in base all'indice di sparo corrente
   * e chiama _lanciaProiettile con i parametri corretti.
   *
   *   _sparoIndice === 1 → primo colpo, tipo corrente, velocità normale
   *   _sparoIndice === 2 → secondo colpo, tipo alternato, velocità scalata
   */
  _lancia() {
    const tipo = this._sparoIndice === 1
      ? this._prossimoTipo
      : (this._prossimoTipo === 'FireBallBlack' ? 'FireBallBlue' : 'FireBallBlack');

    const fattore = this._sparoIndice === 2
      ? CONFIG.proiettile.fattoreVelocitaSecondoColpo
      : 1.0;

    this._lanciaProiettile(tipo, fattore);
  }

  /** Disegna il boss nel frame corrente, scegliendo lo spritesheet in base allo stato */
  draw() {
    let nomeFr, fd, img;

    if (this.stato === STATO_BOSS.SHOOTING) {
      // Animazione di sparo
      nomeFr = FRAMES_BOSS_SPARA[Math.min(this.frameIdx, FRAMES_BOSS_SPARA.length - 1)];
      fd = BOSS_SPARA_FRAMES[nomeFr];
      img = imgs.bossSpara;
    } else {
      // Animazione di fluttuazione (anche durante ENTERING e LEAVING)
      nomeFr = FRAMES_BOSS_FLUTTUA[Math.min(this.frameIdx, FRAMES_BOSS_FLUTTUA.length - 1)];
      fd = BOSS_FLUTTUA_FRAMES[nomeFr];
      img = imgs.bossFluttua;
    }

    if (!fd) return;

    const sc = CONFIG.boss.scalaFluttua;
    const dw = Math.round(fd.w * sc);
    const dh = Math.round(fd.h * sc);
    // Lo sprite è centrato orizzontalmente e verticalmente su (this.x, this.y)
    const dx = this.x - dw / 2;
    const dy = this.y - dh / 2;

    if (img && img.complete && img.naturalWidth) {
      ctx.drawImage(img, fd.x, fd.y, fd.w, fd.h, dx, dy, dw, dh);
    } else {
      // Fallback: sagoma viola con testo "BOSS"
      ctx.fillStyle = 'rgba(60, 0, 80, 0.85)';
      ctx.fillRect(dx, dy, dw, dh);
      ctx.fillStyle = '#cc88ff';
      ctx.font = 'bold 18px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('BOSS', dx + dw / 2, dy + dh / 2);
      ctx.textAlign = 'left';
    }
  }

  /**
   * Hitbox del boss ridotta con margine interno.
   * @returns {{ x, y, w, h }}
   */
  getHitbox() {
    const m = CONFIG.boss.hitboxMargine;
    const sc = CONFIG.boss.scalaFluttua;
    const fd = BOSS_FLUTTUA_FRAMES['OmbraFantasyFluttua_1'];
    const dw = Math.round(fd.w * sc);
    const dh = Math.round(fd.h * sc);
    return {
      x: this.x - dw / 2 + m,
      y: this.y - dh / 2 + m,
      w: dw - m * 2,
      h: dh - m * 2,
    };
  }
}


/* ============================================================
   SEZIONE 8 — STATO GLOBALE DI GIOCO
   ─────────────────────────────────
   Variabili che persistono per tutta la sessione di gioco
   e vengono resettate a ogni nuova partita.

   CICLO DI VITA:
     LOADING  → asset in caricamento (schermata barra progresso)
     START    → titolo animato, attesa primo input
     PLAYING  → partita in corso
     DYING    → player morto, animazione morte, ostacoli fermi
     GAMEOVER → schermata punteggio finale, attesa input per ricominciare
   ============================================================ */

let statoGioco = 'LOADING';  // stato corrente della macchina a stati del gioco

let punteggio = 0;      // punteggio della partita corrente
let recordPersonale = 0;      // miglior punteggio della sessione (non persistito tra sessioni)
let velocita = CONFIG.velocita.iniziale;  // velocità corrente del terreno (px/frame)
let frameContatore = 0;      // frame totali dall'avvio (non resettato tra partite)
let spawnTimer = 0;      // frame trascorsi dall'ultimo spawn di ostacoli
let spawnInterval = CONFIG.spawn.intervalloMinBase;  // intervallo corrente tra spawn

let player = null;   // istanza Player corrente
let ostacoli = [];     // array degli ostacoli attivi a schermo
let layers = [];     // array dei ParallaxLayer (sfondo)

// ── Variabili boss ────────────────────────────────────────────────────────────
let boss = null;   // istanza Boss attiva (null = boss non a schermo)
let proiettili = [];     // array dei proiettili attivi a schermo
let bossAppearanceCount = 0;      // quante volte il boss è comparso in questa partita
let bossInArrivo = false;  // true: spawn triggerato, boss non ancora entrato
let punteggioUltimaRitirata = 0; // punteggio al momento dell'ultima ritirata del boss
// (usato per calcolare la soglia del prossimo spawn)

// Accumulatore per il calcolo del punteggio basato sul tempo reale
let accumulatoreMs = 0;
let ultimoTS = 0;  // timestamp dell'ultimo frame (per calcolare il delta time)

/*
 * inputAttivo — true mentre il tasto/touch è tenuto premuto.
 * Usato per il salto continuo (auto-jump): se l'input rimane attivo
 * e il player tocca terra, salta automaticamente al frame successivo.
 * Questo consente il "salto continuo" tenendo premuto Space/ArrowUp o il touch.
 */
let inputAttivo = false;


/* ============================================================
   SEZIONE 9 — GESTIONE INPUT (tastiera, touch, mouse)
   ─────────────────────────────────────────────────────
   Un singolo handler gestisciInput() centralizza tutta la logica
   di risposta agli input. L'azione eseguita dipende dallo stato
   corrente del gioco. La stessa funzione avvia anche la musica
   (i browser richiedono un gesto utente per sbloccare l'audio).
   ============================================================ */

/**
 * Risponde all'input dell'utente (tocco, click, spazio, freccia su).
 * Comportamento in base allo stato corrente:
 *   START    → avvia la partita
 *   PLAYING  → fa saltare il player (salto immediato; il salto continuo
 *              è gestito dal flag inputAttivo nel game loop)
 *   GAMEOVER → resetta e ricomincia
 *   DYING    → ignorato (aspetta il completamento dell'animazione di morte)
 */
function gestisciInput() {
  /*
   * Al primo gesto utente: pre-carica i SFX via Web Audio API.
   * Deve accadere dentro un event handler per sbloccare l'AudioContext su iOS.
   * È asincrono (fetch + decode) ma non blocca: i suoni saranno pronti
   * entro il primo secondo di gioco, ben prima che servano.
   */
  if (!_sfxPreloaded) {
    _sfxPreloaded = true;
    preloadSfx('jump',         SOUND_PATH + 'jump.mp3');
    preloadSfx('dead',         SOUND_PATH + 'dead.mp3');
    preloadSfx('fireballBlack', SOUND_PATH + 'FireballBlack.mp3');
    preloadSfx('fireballBlue',  SOUND_PATH + 'FireballBlue.mp3');
    // Sblocca l'AudioContext anche se i fetch sono ancora in corso
    getAudioCtx();
  }

  // Sblocca la musica al primo input (policy browser: l'audio richiede un gesto utente)
  if (boss) {
    if (suoni.bossTheme.paused && statoGioco === 'PLAYING') {
      suoni.bossTheme.play().catch(() => {});
    }
  } else {
    if (suoni.theme.paused && (statoGioco === 'PLAYING' || statoGioco === 'START')) {
      suoni.theme.play().catch(() => {});
    }
  }

  switch (statoGioco) {
    case 'START':    avviaPartita(); break;
    case 'PLAYING':  player.salta(); break;  // salto immediato al tocco/pressione
    case 'GAMEOVER': resetPartita(); break;
    // DYING e LOADING: nessuna azione
  }
}

// TASTIERA
document.addEventListener('keydown', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!inputAttivo) {   // evita il trigger ripetuto del sistema operativo
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
    suoni.theme.pause();
    suoni.bossTheme.pause();
    inputAttivo = false;
  }
});


/* ============================================================
   SEZIONE 10 — INIZIALIZZAZIONE PARALLAX
   ─────────────────────────────────────
   Crea i 6 layer di sfondo con velocità decrescente dall'orizzonte
   al piano di corsa. I fattori di velocità simulano la profondità:
   più uno strato è lontano, più scorre lentamente.
   ============================================================ */

/**
 * Crea i 6 ParallaxLayer usando le immagini bg1-bg6.
 * I fattori moltiplicano la velocità corrente del gioco:
 *   0.03 → cielo (quasi fermo)
 *   0.10 → montagne lontane
 *   0.22 → alberi sullo sfondo
 *   0.50 → alberi a media distanza
 *   0.85 → cespugli vicini
 *   1.00 → terreno (stessa velocità degli ostacoli)
 */
function inizializzaParallax() {
  const fattori = [0.03, 0.10, 0.22, 0.50, 0.85, 1.0];
  layers = fattori.map((f, i) => new ParallaxLayer(imgs[`bg${i + 1}`], f));
}


/* ============================================================
   SEZIONE 11 — AVVIO E RESET PARTITA
   ────────────────────────────────────
   avviaPartita() inizializza tutte le variabili di stato per
   una nuova partita e avvia la musica.
   resetPartita() è un alias di avviaPartita() usato dal GAMEOVER.
   ============================================================ */

/** Inizializza e avvia una nuova partita */
function avviaPartita() {
  statoGioco = 'PLAYING';
  rimuoviBottoneLogout();

  // Reset punteggio e fisica
  punteggio = 0;
  accumulatoreMs = 0;
  velocita = CONFIG.velocita.iniziale;
  frameContatore = 0;

  // Il timer spawn inizia negativo per dare al player qualche istante
  // prima del primo ostacolo (ritardo di 120 frame ≈ 2 secondi a 60fps)
  spawnTimer = -120;
  spawnInterval = CONFIG.spawn.intervalloMinBase;

  // Pulisce tutti gli oggetti di gioco precedenti
  // Restituisce al pool gli ostacoli ancora in scena prima del reset
  for (let i = 0; i < ostacoli.length; i++) obstaclePool.push(ostacoli[i]);
  ostacoli = [];
  proiettili = [];
  boss = null;

  // Reset contatori boss (si azzerano solo a ogni nuova partita)
  bossAppearanceCount = 0;
  bossInArrivo = false;
  punteggioUltimaRitirata = 0;

  // Crea il player nella posizione iniziale
  player = new Player();

  /*
   * Azzera inputAttivo: l'input che ha premuto Start/GameOver non deve
   * propagarsi come salto immediato al primo frame di partita.
   */
  inputAttivo = false;

  // Switch audio: ferma la boss theme, riparte la traccia principale
  suoni.bossTheme.pause();
  suoni.bossTheme.currentTime = 0;
  suoni.theme.currentTime = 0;
  suoni.theme.play().catch(() => { });
}

/** Alias di avviaPartita — chiamato dalla schermata GAMEOVER */
function resetPartita() {
  avviaPartita();
}


/* ============================================================
   SEZIONE 12 — SPAWN DEGLI OSTACOLI E DEL BOSS
   ─────────────────────────────────────────────
   La funzione tentaSpawn() viene chiamata ogni frame durante PLAYING.
   Si occupa di due compiti distinti:
     1. Triggerare lo spawn del boss con probabilità casuale
     2. Spawnare ostacoli terrestri (singoli o in coppia)

   PRIORITÀ:
     Se il boss è a schermo o in arrivo, gli ostacoli non vengono
     spawnati (il boss è già una sfida sufficiente).

   SPAWN OSTACOLI:
     L'intervallo tra spawn è casuale ma si riduce con il punteggio
     (maggiore difficoltà nel tempo). Le coppie di ostacoli vengono
     verificate cinematicamente: vengono spawnate solo se il player
     riesce fisicamente a saltarle alla velocità corrente.
   ============================================================ */

/**
 * Seleziona casualmente uno dei 3 tipi di ostacoli forestali.
 * La distribuzione è uniforme (≈33% ciascuno).
 */
function tipoOstacoloCasuale() {
  const r = Math.random();
  if (r < 0.34) return 'OstacoloFantasy1';
  if (r < 0.67) return 'OstacoloFantasy2';
  return 'OstacoloFantasy3';
}

/**
 * Calcola l'intervallo minimo di spawn corrente in base al punteggio.
 * Ogni 50 punti l'intervallo minimo si riduce di 1 frame, ma non
 * scende mai sotto intervalloMinFloor (per evitare spawn impossibili).
 * @returns {number} intervallo minimo corrente in frame
 */
function intervalloMinCorrente() {
  const riduzione = Math.floor(punteggio / 50);
  return Math.max(
    CONFIG.spawn.intervalloMinFloor,
    CONFIG.spawn.intervalloMinBase - riduzione
  );
}

/**
 * Controlla se c'è abbastanza spazio per spawnare un nuovo ostacolo.
 * Evita che due ostacoli appaiano troppo vicini e rendano il gioco impossibile.
 * @returns {boolean} true se lo spazio è sufficiente
 */
function spazioDisponibile() {
  if (ostacoli.length === 0) return true;
  const ultimo = ostacoli[ostacoli.length - 1];
  return (CW - ultimo.x) > CONFIG.spawn.distanzaMinPx;
}

/**
 * Calcola la larghezza di rendering di un tipo di ostacolo (sprite scalato).
 * @param {string} tipo - chiave del tipo ostacolo
 * @returns {number} larghezza in pixel
 */
function larghezzaOstacolo(tipo) {
  const fd = OSTACOLI_FRAMES[tipo];
  const sc = OSTACOLO_CFG[tipo].scala;
  return Math.round(fd.w * sc);
}

/**
 * Funzione principale di spawn — chiamata ogni frame durante PLAYING.
 *
 * Ordine delle operazioni:
 *   1. Controlla se triggerare lo spawn del boss (probabilistico)
 *   2. Se il boss è a schermo o in arrivo, non spawna ostacoli
 *   3. Altrimenti spawna ostacoli terrestri secondo gli intervalli configurati
 */
function tentaSpawn() {
  spawnTimer++;

  // ── 1. Trigger probabilistico del boss ────────────────────────────────────
  /*
   * Calcola la soglia di punteggio necessaria per questa apparizione:
   *   - Prima volta: soglia assoluta (punteggioMinSpawn)
   *   - Volte successive: punteggio dell'ultima ritirata + incremento minimo (punteggioMinRispawn)
   * Ogni frame, se la soglia è superata, si estrae un numero casuale.
   * Se inferiore a probSpawnPerFrame → boss triggerato.
   */
  const sogliaBoss = bossAppearanceCount === 0
    ? CONFIG.boss.punteggioMinSpawn
    : punteggioUltimaRitirata + CONFIG.boss.punteggioMinRispawn;

  if (!boss && !bossInArrivo && punteggio >= sogliaBoss) {
    if (Math.random() < CONFIG.boss.probSpawnPerFrame) {
      bossInArrivo = true;  // boss triggerato, aspetta schermo libero
    }
  }

  // ── 2. Blocco spawn ostacoli se il boss è coinvolto ───────────────────────
  if (boss) return;  // boss a schermo: nessun ostacolo

  if (bossInArrivo) {
    // Boss triggerato: aspetta che lo schermo sia completamente libero
    if (ostacoli.length === 0 && spazioDisponibile()) {
      // Schermo libero: fai entrare il boss
      boss = new Boss(bossAppearanceCount);
      bossAppearanceCount++;
      bossInArrivo = false;

      // Switch audio: boss theme sostituisce la traccia principale
      suoni.theme.pause();
      suoni.bossTheme.currentTime = 0;
      suoni.bossTheme.play().catch(() => { });
    }
    return;  // blocca lo spawn ostacoli mentre si aspetta o il boss entra
  }

  // ── 3. Spawn ostacoli terrestri ───────────────────────────────────────────
  if (spawnTimer < spawnInterval || !spazioDisponibile()) return;

  // Calcola il nuovo intervallo casuale per il prossimo spawn
  const intMin = intervalloMinCorrente();
  spawnTimer = 0;
  spawnInterval = Math.floor(
    intMin + Math.random() * (CONFIG.spawn.intervalloMax - intMin)
  );

  const tipo = tipoOstacoloCasuale();
  const distSalto = Player.calcolaDistanzaSaltoMax(velocita);
  const gap = 18;  // gap visivo in pixel tra i due ostacoli di una coppia

  // Tenta spawn doppio (solo dopo 200 punti, con probabilità probDoppio)
  const tentaDoppio = punteggio >= 200 && Math.random() < CONFIG.spawn.probDoppio;

  if (tentaDoppio) {
    const tipo2 = TIPI_TERRESTRI[Math.floor(Math.random() * TIPI_TERRESTRI.length)];
    const w1 = larghezzaOstacolo(tipo);
    const w2 = larghezzaOstacolo(tipo2);
    const wTot = w1 + gap + w2;

    if (wTot < distSalto * 0.85) {
      ostacoli.push(getObstacle(tipo));
      ostacoli.push(getObstacle(tipo2, w1 + gap));
      return;
    }
  }

  // Spawn singolo standard
  ostacoli.push(getObstacle(tipo));
}


/* ============================================================
   SEZIONE 13 — RILEVAMENTO COLLISIONI (AABB)
   ────────────────────────────────────────────
   AABB = Axis-Aligned Bounding Box: il metodo più semplice
   per rilevare collisioni tra rettangoli. Due rettangoli si
   sovrappongono se e solo se non c'è separazione su nessun asse.
   Ogni entità espone un metodo getHitbox() che restituisce
   il rettangolo { x, y, w, h } usato per i controlli.
   ============================================================ */

/**
 * Controlla se due rettangoli si sovrappongono.
 * @param {{ x, y, w, h }} a - primo rettangolo (hitbox)
 * @param {{ x, y, w, h }} b - secondo rettangolo (hitbox)
 * @returns {boolean} true se i rettangoli si intersecano
 */
function aabbOverlap(a, b) {
  return (
    a.x < b.x + b.w &&   // bordo sinistro di a è prima del bordo destro di b
    a.x + a.w > b.x &&   // bordo destro di a è dopo il bordo sinistro di b
    a.y < b.y + b.h &&   // bordo superiore di a è prima del bordo inferiore di b
    a.y + a.h > b.y            // bordo inferiore di a è dopo il bordo superiore di b
  );
}


/* ============================================================
   SEZIONE 14 — DISEGNO UI E OVERLAY  (stile fantasy)
   ──────────────────────────────────────────────────
   Tutte le schermate (titolo, HUD, game over, loading) usano
   uno stile visivo coerente: toni ambra/oro/pergamena, font serif,
   bagliore caldo. Nessun effetto CRT/scanlines.
   ============================================================ */

/**
 * Disegna testo con un bagliore dorato fantasy.
 * Il doppio passaggio (primo normale, secondo semitrasparente con blur maggiore)
 * crea un effetto alone morbido e caldo.
 *
 * @param {string} testo     - testo da disegnare
 * @param {number} x, y      - posizione (in px)
 * @param {string} colore    - colore CSS (es. '#ffd700')
 * @param {number} dimensione - dimensione font in px
 * @param {string} [align]   - allineamento testo ('left', 'center', 'right')
 * @param {number} [blur]    - intensità del bagliore (px)
 */
function testoFantasy(testo, x, y, colore, dimensione, align = 'left', blur = 8) {
  ctx.save();
  ctx.font = `bold ${dimensione}px 'Georgia', 'Palatino Linotype', Palatino, serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = colore;
  ctx.shadowBlur = blur;
  ctx.fillStyle = colore;
  ctx.fillText(testo, x, y);
  // Secondo passaggio: alone più morbido e semitrasparente
  ctx.shadowBlur = blur * 2;
  ctx.globalAlpha = 0.25;
  ctx.fillText(testo, x, y);
  ctx.restore();
}

/**
 * Disegna l'HUD (Heads-Up Display) durante la partita:
 * punteggio corrente in alto a sinistra, record personale al centro.
 */
function disegnaHUD() {
  const pStr = String(Math.floor(punteggio)).padStart(5, '0');
  testoFantasy(`PUNTI: ${pStr}`, 20, 46, '#ffd700', 26, 'left', 14);

  if (recordPersonale > 0) {
    const rStr = String(Math.floor(recordPersonale)).padStart(5, '0');
    testoFantasy(`RECORD: ${rStr}`, CW / 2, 46, '#c8a847', 22, 'center', 8);
  }
}

/** Disegna la schermata di avvio (titolo + istruzioni + classifica) */
function disegnaStartScreen() {
  // Overlay semitrasparente scuro per far risaltare il testo
  ctx.fillStyle = 'rgba(10,5,0,0.60)';
  ctx.fillRect(0, 0, CW, CH);

  // Titolo — spostato in alto per lasciare spazio alla classifica
  testoFantasy('SGRUNF', CW / 2, 130, '#ffd700', 72, 'center', 36);
  testoFantasy('FANTASY RUNNER', CW / 2, 190, '#f4e4a6', 36, 'center', 20);
  testoFantasy('TOCCA  o  SPAZIO  per iniziare', CW / 2, 250, '#e8d8a0', 22, 'center', 8);
  testoFantasy('SALTO: tocco / barra spaziatrice', CW / 2, 282, '#b89a5a', 18, 'center', 5);

  if (recordPersonale > 0) {
    testoFantasy(
      `MIGLIOR PUNTEGGIO: ${Math.floor(recordPersonale)}`,
      CW / 2, 316, '#ffd700', 16, 'center', 8
    );
  }

  // Classifica nella metà inferiore
  disegnaClassifica(CW / 2, 370, 28);

  // Nome utente in alto a destra se autenticato
  if (sessioneCorrente) {
    const nome = sessioneCorrente.user.user_metadata.username || '';
    testoFantasy(`👤 ${nome}`, CW - 20, 46, '#a0e0ff', 18, 'right', 6);
  }

  // Avviso di rotazione per dispositivi in verticale
  const aspect = window.innerWidth / window.innerHeight;
  if (aspect < 1.2) {
    testoFantasy(
      '⟳ Ruota in orizzontale per un\'esperienza migliore',
      CW / 2, CH - 34, '#886600', 16, 'center', 5
    );
  }

  // Crediti autori
  testoFantasy('by Lorenzo Federici & Giovanni Fabrizi', CW / 2, CH - 18, '#b68e36', 14, 'center', 3);
}

/** Disegna la schermata Game Over con punteggio finale, record e classifica */
function disegnaGameOver() {
  ctx.fillStyle = 'rgba(10,5,0,0.76)';
  ctx.fillRect(0, 0, CW, CH);

  testoFantasy('GAME OVER', CW / 2, 120, '#cc2200', 62, 'center', 36);
  testoFantasy(`PUNTEGGIO: ${Math.floor(punteggio)}`, CW / 2, 190, '#f4e4a6', 30, 'center', 16);

  if (punteggio >= recordPersonale && punteggio > 0) {
    testoFantasy('✦ NUOVO RECORD! ✦', CW / 2, 230, '#ffd700', 22, 'center', 18);
  }

  testoFantasy('TOCCA  o  SPAZIO  per riprovare', CW / 2, 270, '#e8d8a0', 20, 'center', 10);

  // Classifica
  disegnaClassifica(CW / 2, 320, 28);

  // Nome utente in alto a destra
  if (sessioneCorrente) {
    const nome = sessioneCorrente.user.user_metadata.username || '';
    testoFantasy(`👤 ${nome}`, CW - 20, 46, '#a0e0ff', 18, 'right', 6);
  }

  // Crediti autori
  testoFantasy('by Lorenzo Federici & Giovanni Fabrizi', CW / 2, CH - 18, '#b68e36', 14, 'center', 3);
}

/** Disegna la schermata di caricamento con barra di progresso */
function disegnaLoading() {
  ctx.fillStyle = '#0a0800';
  ctx.fillRect(0, 0, CW, CH);

  const progress = assetsCaricati / TOTALE_ASSET;  // 0.0 → 1.0

  // Sfondo barra (grigio scuro)
  ctx.fillStyle = '#2a1a00';
  ctx.fillRect(CW / 2 - 200, CH / 2 + 20, 400, 12);

  // Riempimento barra proporzionale al progresso (oro)
  ctx.fillStyle = '#ffd700';
  ctx.fillRect(CW / 2 - 200, CH / 2 + 20, 400 * progress, 12);

  testoFantasy('CARICAMENTO...', CW / 2, CH / 2 - 5, '#ffd700', 30, 'center', 20);
}


/* ============================================================
   SEZIONE 15 — GAME LOOP (update + draw)
   ────────────────────────────────────────
   Il game loop è il cuore del gioco. requestAnimationFrame()
   lo chiama ~60 volte al secondo (dipende dal refresh rate del monitor).

   update(timestamp):
     Aggiorna tutta la logica di gioco: fisica, animazioni, spawn,
     collisioni, boss. Usa il delta time (dt) per mantenersi stabile
     anche se un frame impiega più del solito (max dt clamped a 50ms).

   draw():
     Disegna ogni frame da zero: sfondo → ostacoli → proiettili → boss
     → player → HUD → overlay. L'ordine determina la profondità visiva
     (chi viene disegnato dopo appare davanti).
   ============================================================ */

/*
 * SMOOTH DELTA-TIME — ring buffer a 8 campioni.
 * La media mobile smussa gli spike singoli di frame (18–22ms invece di 16.67ms)
 * che causano variazioni visibili nella traiettoria del salto, specialmente su mobile.
 * Complessità O(1): nessun loop, solo aritmetica su scalari.
 */
const _dtBuffer = new Float32Array(8);   // ring buffer pre-allocato (nessuna GC)
let   _dtHead   = 0;                     // indice testa del ring buffer
let   _dtSum    = 16.667 * 8;           // somma corrente (inizializzata a 60fps)

// Pre-riempie il buffer con 16.667 per avere una media sensata al primo frame
_dtBuffer.fill(16.667);

/**
 * Inserisce un nuovo campione dt nel ring buffer e restituisce la media mobile.
 * @param {number} rawDt - delta time grezzo in ms (già cappato a 50ms)
 * @returns {number} dt smoothed
 */
function smoothDt(rawDt) {
  _dtSum -= _dtBuffer[_dtHead];
  _dtBuffer[_dtHead] = rawDt;
  _dtSum += rawDt;
  _dtHead = (_dtHead + 1) & 7;   // modulo 8 via bitmask
  return _dtSum * 0.125;          // media = somma / 8
}

/**
 * Aggiorna la logica di gioco per il frame corrente.
 * @param {number} timestamp - timestamp in ms fornito da requestAnimationFrame
 */
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

  // ── Accelerazione del terreno ──────────────────────────────────────────────
  if (statoGioco === 'PLAYING') {
    velocita = Math.min(
      CONFIG.velocita.massima,
      velocita + CONFIG.velocita.accelerazione * (dt / 16.667)
    );
  }

  // ── Scorrimento parallax ───────────────────────────────────────────────────
  // Anche nella schermata START lo sfondo scorre lentamente (effetto decorativo)
  // GAMEOVER: velParallax rimane 0 → sfondo fermo durante la schermata punteggio
  let velParallax = 0;
  if (statoGioco === 'START') velParallax = CONFIG.velocita.iniziale * 0.4;
  else if (statoGioco === 'PLAYING') velParallax = velocita;

  if (statoGioco !== 'GAMEOVER') {
    for (let i = 0; i < layers.length; i++) layers[i].update(velParallax, dt);
  }

  // ── Logica PLAYING ─────────────────────────────────────────────────────────
  if (statoGioco === 'PLAYING') {

    /*
     * Salto continuo (auto-jump): se l'input è mantenuto premuto e il player
     * è a terra, salta automaticamente al prossimo frame utile.
     * Questo consente il "salto continuo" tenendo premuto Space/ArrowUp o il touch.
     */
    if (inputAttivo && player.aTerra) {
      player.salta();
    }

    // Punteggio: +1 ogni CONFIG.punteggio.mxPunto millisecondi reali
    accumulatoreMs += dt;
    while (accumulatoreMs >= CONFIG.punteggio.mxPunto) {
      punteggio++;
      accumulatoreMs -= CONFIG.punteggio.mxPunto;
    }

    tentaSpawn();
    player.update(dt);

    // ── Aggiornamento ostacoli + rilevamento collisioni ───────────────────────
    for (let i = ostacoli.length - 1; i >= 0; i--) {
      const ob = ostacoli[i];
      ob.update(velocita * (dt / 16.667));

      if (ob.fuoriSchermo()) {
        releaseObstacle(ob);
        /*
         * Swap-and-pop O(1): sovrascrive l'elemento rimosso con l'ultimo
         * e accorcia l'array di 1. Più veloce di splice() O(n).
         * Sicuro perché iteriamo all'indietro.
         */
        ostacoli[i] = ostacoli[ostacoli.length - 1];
        ostacoli.length--;
        continue;
      }

      if (aabbOverlap(player.getHitbox(), ob.getHitbox())) {
        player.muori();
        statoGioco = 'DYING';
        break;
      }
    }

    // ── Aggiornamento boss + rilevamento ritirata ─────────────────────────────
    if (boss) {
      boss.update();

      if (boss && boss.deveUscire) {
        punteggioUltimaRitirata = punteggio;
        suoni.bossTheme.pause();
        suoni.bossTheme.currentTime = 0;
        suoni.theme.play().catch(() => {});
        boss = null;
      }
    }

    // ── Aggiornamento proiettili + collisioni ─────────────────────────────────
    if (statoGioco === 'PLAYING') {
      for (let i = proiettili.length - 1; i >= 0; i--) {
        const pr = proiettili[i];
        pr.update();

        if (pr.fuoriSchermo()) {
          proiettili.splice(i, 1);
          continue;
        }

        if (aabbOverlap(player.getHitbox(), pr.getHitbox())) {
          player.muori();
          statoGioco = 'DYING';
          break;
        }
      }
    }
  }

  // ── Logica DYING ───────────────────────────────────────────────────────────
  if (statoGioco === 'DYING') {
    player.update(dt);

    if (player.morteFine) {
      mostraBottoneLogout();
      statoGioco = 'GAMEOVER';
      // Salva prima, poi ricarica classifica e record — così il punteggio
      // appena fatto è già nel database quando vengono letti.
      (async () => {
        await salvaPunteggio(Math.floor(punteggio));
        await caricaRecordPersonale();
        await caricaClassifica();
      })();
    }
  }
}

/**
 * Disegna l'intero frame del gioco.
 * L'ordine di disegno determina la profondità visiva (painter's algorithm):
 *   sfondo → ostacoli → proiettili → boss → player → HUD → overlay
 */
function draw() {
  // Sfondo di fallback
  ctx.fillStyle = '#0a0800';
  ctx.fillRect(0, 0, CW, CH);

  // Strati di sfondo parallax (dal più lontano al più vicino)
  for (let i = 0; i < layers.length; i++) layers[i].draw();

  // Entità di gioco (visibili durante la partita E durante l'animazione di morte)
  if (statoGioco === 'PLAYING' || statoGioco === 'DYING') {
    for (let i = 0; i < ostacoli.length; i++) ostacoli[i].draw();
    for (let i = 0; i < proiettili.length; i++) proiettili[i].draw();
    if (boss) boss.draw();
  }

  // Player (visibile in tutti gli stati tranne LOADING e GAMEOVER)
  if (player && statoGioco !== 'LOADING' && statoGioco !== 'GAMEOVER') {
    player.draw();
  }

  // HUD punteggio (durante la partita e l'animazione di morte)
  if (statoGioco === 'PLAYING' || statoGioco === 'DYING') {
    disegnaHUD();
  }

  // Overlay di stato (schermate di sistema)
  if (statoGioco === 'LOADING') { disegnaLoading(); return; }
  if (statoGioco === 'START')   { disegnaStartScreen(); return; }
  if (statoGioco === 'GAMEOVER') {
    if (player) player.draw();
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
   ─────────────────────────────────
   Sequenza di bootstrap:
     1. Disegna subito una schermata di caricamento minima
     2. Avvia il caricamento parallelo di tutti gli asset
     3. Quando il caricamento è completo: inizializza i layer,
        crea il player nella schermata titolo (IDLE), passa allo stato START
     4. Avvia il game loop con requestAnimationFrame
   ============================================================ */

// Schermata di caricamento immediata (visibile prima che caricaAsset() termini)
ctx.fillStyle = '#0a0800';
ctx.fillRect(0, 0, CW, CH);
testoFantasy('CARICAMENTO...', CW / 2, CH / 2, '#ffd700', 30, 'center', 20);

/**
 * Bootstrap asincrono:
 *   1. Inizializza Supabase
 *   2. Carica gli asset di gioco
 *   3. Controlla se c'è già una sessione attiva
 *   4. Se sì → START; se no → mostra overlay auth
 */
(async () => {
  // Init Supabase (non bloccante: il gioco gira comunque in offline-mode)
  await initSupabase();

  // Avvia il caricamento degli asset; quando finisce, prepara il gioco
  caricaAsset(async () => {
    // Pre-renderizza tutti gli sprite e pre-calcola le hitbox statiche
    prebuildSprites();

    // Scalda il font engine per evitare jank al primo fillText in-game
    prewarmFont();

    const POOL_WARMUP  = 4;
    const tipiWarmup   = ['OstacoloFantasy1', 'OstacoloFantasy2',
                          'OstacoloFantasy3', 'OstacoloFantasy1'];
    for (let i = 0; i < POOL_WARMUP; i++) {
      obstaclePool.push(new Obstacle(tipiWarmup[i]));
    }

    inizializzaParallax();
    player = new Player();
    player.stato = STATO_ANIM.IDLE;

    // Controlla se esiste già una sessione persistita
    let sessioneEsistente = null;
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        sessioneEsistente = data.session || null;
      } catch (_) {}
    }

    function avviaStart() {
      caricaClassifica();
      caricaRecordPersonale();
      statoGioco = 'START';
      mostraBottoneLogout();
    }

    if (sessioneEsistente) {
      // Sessione attiva: salta l'overlay e vai direttamente a START
      sessioneCorrente = sessioneEsistente;
      avviaStart();
    } else {
      // Nessuna sessione: mostra overlay auth
      mostraOverlayAuth(avviaStart);
    }
  });
})();

// Avvia il game loop (gira anche durante il caricamento per mostrare la barra di progresso)
_rafHandle = requestAnimationFrame(ts => {
  ultimoTS = ts;
  gameLoop(ts);
});