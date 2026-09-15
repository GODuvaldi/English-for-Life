/* ═══════════════════════════════════════════════════════════════
   Best'n'Last — Service Worker (PWA)
   ═══════════════════════════════════════════════════════════════
   ESTRATÉGIA DE CACHE:
   - NETWORK-FIRST para o HTML (navegações) → o aluno SEMPRE recebe a
     versão mais nova ao abrir o site (v1.43.1: antes era cache-first
     e a versão antiga aparecia até o 2º acesso). Fallback: cache
     offline após 4s de rede lenta/ausente.
   - Cache-first para os demais assets do shell (manifest, ícones,
     fontes do Google, SDKs versionados do Firebase) → carregamento
     instantâneo + funciona offline.
   - Network-first para Firebase/dados dinâmicos → nunca cacheia.

   IMPORTANTE: o Firebase (Auth + Firestore) exige conexão. O modo
   offline deste SW serve para:
   (a) o app ABRIR instantaneamente mesmo sem internet,
   (b) o aluno conseguir NAVEGAR e LER o conteúdo de exercícios
       (bancos são JS embutido no HTML), MESMO sem internet.
   Ele NÃO vai conseguir SALVAR progresso nem LOGAR offline — isso
   exige IndexedDB + Firestore offline persistence (fase futura).
   ═══════════════════════════════════════════════════════════════ */

var CACHE_VERSION = 'bnl-v1.44';
var NAV_TIMEOUT_MS = 4000;
var SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
];

/* URLs que NUNCA devem ir pro cache (Firebase / dados dinâmicos) */
var NEVER_CACHE_PATTERNS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  '.netlify/functions/'
];

/* ─── INSTALL: pré-cacheia o shell do app ─── */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache) {
      /* addAll falha inteiro se UM recurso não carregar; usamos cache.add individual
         para que falhas isoladas (ex.: fonte offline) não quebrem o install. */
      return Promise.all(
        SHELL_ASSETS.map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('[SW] Falha ao pré-cachear (não crítico):', url, err.message);
          });
        })
      );
    }).then(function() {
      /* Pula a espera — ativa o SW imediatamente na primeira visita */
      return self.skipWaiting();
    })
  );
});

/* ─── ACTIVATE: limpa caches antigos ─── */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          /* Deleta qualquer cache que não seja a versão atual */
          return key !== CACHE_VERSION;
        }).map(function(key) {
          return caches.delete(key);
        })
      );
    }).then(function() {
      /* Toma controle de todas as abas abertas imediatamente */
      return self.clients.claim();
    })
  );
});

/* ─── FETCH: estratégia por tipo de requisição ─── */
self.addEventListener('fetch', function(event) {
  var req = event.request;

  /* Apenas GET; ignore POST/PUT etc (Firebase usa POST, mas não interceptamos) */
  if (req.method !== 'GET') return;

  var url = req.url;

  /* Se é Firebase/dados dinâmicos → network-first (não cachear) */
  if (NEVER_CACHE_PATTERNS.some(function(pattern) { return url.indexOf(pattern) !== -1; })) {
    event.respondWith(
      fetch(req).catch(function() {
        /* Se offline, tenta cache como fallback (pode haver dado stale) */
        return caches.match(req);
      })
    );
    return;
  }

  /* v1.43.1 — NAVEGAÇÃO (o HTML do app): NETWORK-FIRST.
     O aluno sempre abre a versão mais nova; se a rede falhar ou demorar
     mais de 4s (rede lenta), cai para o cache (offline continua ok).
     Quando a rede responde, o cache é atualizado para a próxima. */
  var isNavigation = req.mode === 'navigate';
  var path = '';
  try { path = new URL(url).pathname; } catch (e) { path = ''; }
  if (isNavigation || path === '/index.html' || path === '/' || path === './') {
    var networkRace = fetch(req).then(function(resp) {
      if (resp && resp.status === 200 && (resp.type === 'basic' || resp.type === 'cors' || resp.type === 'default')) {
        var respClone = resp.clone();
        caches.open(CACHE_VERSION).then(function(cache) { cache.put(req, respClone); });
      }
      return resp;
    }).catch(function() { return null; });
    var timerRace = new Promise(function(resolve) {
      setTimeout(function() { resolve('TIMEOUT'); }, NAV_TIMEOUT_MS);
    });
    event.respondWith(
      Promise.race([networkRace, timerRace]).then(function(result) {
        if (result && result !== 'TIMEOUT') return result;
        return caches.match(req).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  /* Se é um recurso do shell (HTML/CSS/JS/fontes/ícones) → cache-first */
  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) {
        /* Tem no cache: serve do cache E atualiza em background (stale-while-revalidate) */
        fetch(req).then(function(resp) {
          if (resp && resp.status === 200) {
            caches.open(CACHE_VERSION).then(function(cache) {
              cache.put(req, resp.clone());
            });
          }
        }).catch(function() { /* offline, sem problema */ });
        return cached;
      }
      /* Não tem no cache: busca na rede e cacheia */
      return fetch(req).then(function(resp) {
        /* Só cacheia respostas válidas (status 200) do mesmo tipo (basic/cors) */
        if (!resp || resp.status !== 200 || (resp.type !== 'basic' && resp.type !== 'cors')) {
          return resp;
        }
        var respClone = resp.clone();
        caches.open(CACHE_VERSION).then(function(cache) {
          cache.put(req, respClone);
        });
        return resp;
      }).catch(function() {
        /* Offline e sem cache: retorna página de fallback para navegação */
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ─── MESSAGE: permite forçar update do SW da página ─── */
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
