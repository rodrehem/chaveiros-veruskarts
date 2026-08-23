// Guarda uma cópia de tudo no aparelho: depois da primeira visita,
// o site abre e funciona mesmo sem internet.
//
// AO ALTERAR QUALQUER ARQUIVO DE site/, TROQUE O NÚMERO DA VERSÃO ABAIXO.
// Sem isso, quem já abriu o site continua vendo a versão antiga.

const VERSAO = 'chaveiros-v15';

// Sem estes arquivos o aplicativo não funciona: se algum falhar, a instalação
// do cache falha e tentamos de novo na próxima visita.
//
// Das 26 fontes só a padrão entra aqui. As outras somam mais de 2,5 MB e seriam
// um download inútil para quem vai usar uma só — elas são buscadas quando
// escolhidas e o próprio fetch abaixo guarda cada uma no cache, então a partir
// da segunda vez funcionam offline igual.
const ESSENCIAIS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './chaveiro.js',
  './forma.js',
  './fontes/fontes.json',
  './fontes/letra-firme.typeface.json',
  './vendor/three.module.min.js',
  './vendor/three.core.min.js',
  './vendor/addons/loaders/FontLoader.js',
  './vendor/addons/exporters/STLExporter.js',
  './vendor/addons/controls/OrbitControls.js',
];

// Bons de ter (ícones, manifest). Se um faltar, o aplicativo continua abrindo
// offline — só o ícone da tela inicial fica sem graça.
const EXTRAS = [
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './icone-180.png',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSAO);
    // extras primeiro, tolerando falhas individuais
    await Promise.all(EXTRAS.map((url) => cache.add(url).catch(() => {})));
    // essenciais em bloco: se falhar, o service worker não instala e tenta depois
    await cache.addAll(ESSENCIAIS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== VERSAO).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request;
  if (pedido.method !== 'GET') return;
  if (new URL(pedido.url).origin !== location.origin) return;

  evento.respondWith((async () => {
    const guardado = await caches.match(pedido, { ignoreSearch: true });
    if (guardado) return guardado;
    try {
      const resposta = await fetch(pedido);
      if (resposta.ok) {
        const cache = await caches.open(VERSAO);
        cache.put(pedido, resposta.clone());
      }
      return resposta;
    } catch (erro) {
      // Sem internet e sem cópia guardada: se ela estava tentando abrir o site,
      // mostramos a página inicial guardada em vez de um erro do navegador.
      if (pedido.mode === 'navigate') {
        const inicial = await caches.match('./index.html');
        if (inicial) return inicial;
      }
      return new Response('', { status: 504, statusText: 'sem conexao' });
    }
  })());
});
