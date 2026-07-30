/* ═══════════════════════════════════════════════════════════════
   Best'n'Last — Service Worker (PWA)
   ═══════════════════════════════════════════════════════════════
   ESTRATÉGIA DE CACHE:
   - Cache-first para o "shell" do app (index.html, manifest, ícones,
     fontes do Google) → carregamento instantâneo + funciona offline.
   - Network-first para TUDO o mais (Firebase, dados dinâmicos) →
     sempre busca a versão mais nova; só usa cache se a rede falhar.

   IMPORTANTE: o Firebase (Auth + Firestore) exige conexão. O modo
   offline deste SW serve para:
   (a) o app ABRIR instantaneamente mesmo sem internet,
   (b) o aluno conseguir NAVEGAR e LER o conteúdo de exercícios
       (bancos são JS embutido no HTML), MESMO sem internet.
   Ele NÃO vai conseguir SALVAR progresso nem LOGAR offline — isso
   exige IndexedDB + Firestore offline persistence (fase futura).
   ═══════════════════════════════════════════════════════════════ */

var CACHE_VERSION = 'bnl-v1.13';
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
