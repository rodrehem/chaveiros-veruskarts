// Interface: liga os controles ao gerador, cuida da cena 3D e do tema.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  criarFonte, montarChaveiro, exportarSTL, nomeDoArquivo, descartarGrupo,
  materiais, TAMANHOS,
} from './chaveiro.js';
import { poligonosDoTexto, caixaDosAneis } from './forma.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const ARQUIVOS_FONTE = {
  firme: 'letra-firme',
  redonda: 'letra-redonda',
  estreita: 'letra-estreita',
  cursiva: 'letra-cursiva',
};

const PADRAO = {
  estilo: 'retangulo',
  fonte: 'firme',
  tamanhoLetra: TAMANHOS.M,
  espaco: 0,
  proporcao: 100,
  borda: 2.5,
  comFuro: true,
  diametroFuro: 5,
  espessura: 3,
  relevo: 1,
};

const estado = { nome: $('#nome').value, ...PADRAO };
const fontes = {};
let grupoAtual = null;
let resultadoAtual = null;
let avisoFixo = '';

// ---------------- tema ----------------
const CORES_TEMA = {
  claro: {
    fundo: 0xeef2f8, grade: 0xccd5e2, gradeEixo: 0xb3bfd0,
    base: 0x2563eb, letra: 0xfff4dd,
  },
  escuro: {
    fundo: 0x0b1119, grade: 0x24304a, gradeEixo: 0x33425f,
    base: 0x4f8cff, letra: 0xffeec8,
  },
};

// Escurece uma cor por um fator — e assim que a lateral da peca ganha um tom
// proprio sem depender de iluminacao.
function escurecer(hex, fator) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(fator);
  return c;
}

function temaAtual() {
  return document.documentElement.getAttribute('data-tema') === 'escuro' ? 'escuro' : 'claro';
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-tema', tema);
  try { localStorage.setItem('chaveiros-tema', tema); } catch (e) {}
  $('.rotulo-tema').textContent = tema === 'escuro' ? 'Claro' : 'Escuro';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', tema === 'escuro' ? '#0f1420' : '#ffffff');
  pintarCena();
}

$('#tema').addEventListener('click', () => {
  aplicarTema(temaAtual() === 'escuro' ? 'claro' : 'escuro');
});

// ---------------- cena 3D ----------------
const tela = $('#tela');
const renderer = new THREE.WebGLRenderer({ canvas: tela, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = false;

const cena = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 4000);
camera.up.set(0, 0, 1);
camera.position.set(0, -110, 78);

// Sem luzes: os materiais sao MeshBasicMaterial (cor plana, nao reagem a luz).

let grade = null;
function construirGrade(tamanho) {
  if (grade) { cena.remove(grade); grade.geometry.dispose(); grade.material.dispose(); }
  const cores = CORES_TEMA[temaAtual()];
  const passo = tamanho <= 60 ? 5 : tamanho <= 160 ? 10 : 20;
  const divisoes = Math.max(8, Math.round(tamanho / passo));
  const lado = divisoes * passo;
  grade = new THREE.GridHelper(lado, divisoes, cores.gradeEixo, cores.grade);
  grade.rotation.x = Math.PI / 2;   // GridHelper nasce no plano XZ; aqui o chão é XY
  grade.position.z = -0.03;
  grade.material.transparent = true;
  grade.material.opacity = temaAtual() === 'escuro' ? 0.5 : 0.65;
  cena.add(grade);
}

function pintarCena() {
  const c = CORES_TEMA[temaAtual()];
  cena.background = new THREE.Color(c.fundo);
  materiais.baseTopo.color.setHex(c.base);
  materiais.baseLado.color.copy(escurecer(c.base, 0.7));
  materiais.letraTopo.color.setHex(c.letra);
  materiais.letraLado.color.copy(escurecer(c.letra, 0.82));
  const tam = resultadoAtual ? Math.max(resultadoAtual.largura, resultadoAtual.altura) : 60;
  construirGrade(Math.max(50, tam * 1.9));
}

const controles = new OrbitControls(camera, tela);
controles.enableDamping = true;
controles.dampingFactor = 0.08;
controles.enablePan = false;
controles.minDistance = 25;
controles.maxDistance = 900;
controles.maxPolarAngle = Math.PI * 0.495;
controles.target.set(0, 0, 2);

const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)');
let girarLigado = !semMovimento.matches;
controles.autoRotate = girarLigado;
controles.autoRotateSpeed = 1.3;

function atualizarBotaoGirar() {
  const b = $('#girar');
  b.classList.toggle('ativo', girarLigado);
  b.setAttribute('aria-pressed', girarLigado ? 'true' : 'false');
}
$('#girar').addEventListener('click', () => {
  girarLigado = !girarLigado;
  controles.autoRotate = girarLigado;
  atualizarBotaoGirar();
});
atualizarBotaoGirar();

controles.addEventListener('start', () => {
  controles.autoRotate = false;
  $('#dica').classList.add('some');
});
controles.addEventListener('end', () => {
  if (girarLigado) controles.autoRotate = true;
});

function enquadrar(suave = false) {
  if (!resultadoAtual) return;
  const maior = Math.max(resultadoAtual.largura, resultadoAtual.altura, 20);
  const distancia = Math.max(55, maior * 1.85);
  const direcao = camera.position.clone().sub(controles.target).normalize();
  if (!suave) {
    camera.position.copy(controles.target).addScaledVector(direcao, distancia);
  } else {
    const alvo = controles.target.clone().addScaledVector(direcao, distancia);
    camera.position.lerp(alvo, 0.35);
  }
}
$('#centralizar').addEventListener('click', () => {
  controles.target.set(0, 0, 2);
  camera.position.set(0, -110, 78).normalize().multiplyScalar(
    Math.max(55, Math.max(resultadoAtual?.largura || 40, resultadoAtual?.altura || 40) * 1.85)
  );
  $('#dica').classList.remove('some');
});

function ajustarTela() {
  const palco = $('#palco');
  const w = palco.clientWidth, h = palco.clientHeight;
  if (w < 2 || h < 2) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(ajustarTela).observe($('#palco'));
window.addEventListener('resize', ajustarTela);

renderer.setAnimationLoop(() => {
  controles.update();
  renderer.render(cena, camera);
});

// ---------------- mensagens ----------------
const elMensagem = $('#mensagem');
let apagarMensagem = null;
function mostrarMensagem(texto, tipo, duracao) {
  clearTimeout(apagarMensagem);
  elMensagem.textContent = texto;
  elMensagem.className = 'mensagem' + (tipo ? ' ' + tipo : '');
  if (duracao) {
    apagarMensagem = setTimeout(() => {
      elMensagem.textContent = avisoFixo;
      elMensagem.className = 'mensagem' + (avisoFixo ? ' aviso' : '');
    }, duracao);
  }
}

// ---------------- montagem ----------------
function reconstruir() {
  const fonte = fontes[estado.fonte];
  if (!fonte) return;

  try {
    const r = montarChaveiro({
      nome: estado.nome,
      estilo: estado.estilo,
      fonte,
      tamanhoLetra: estado.tamanhoLetra,
      espaco: estado.espaco / 100,
      proporcao: estado.proporcao / 100,
      espessuraBase: estado.espessura,
      alturaLetra: estado.relevo,
      comFuro: estado.comFuro,
      diametroFuro: estado.diametroFuro,
      borda: estado.borda,
    });

    if (grupoAtual) { cena.remove(grupoAtual); descartarGrupo(grupoAtual); }
    grupoAtual = r.grupo;
    resultadoAtual = r;
    cena.add(grupoAtual);

    construirGrade(Math.max(50, Math.max(r.largura, r.altura) * 1.9));
    enquadrar();

    const botao = $('#baixar');
    if (!r.temTexto) {
      avisoFixo = estado.nome.trim().length
        ? 'Esses símbolos não dão para escrever no chaveiro. Use letras.'
        : 'Escreva um nome para montar o chaveiro.';
      botao.classList.add('desligado');
      botao.setAttribute('aria-disabled', 'true');
      $('#medidas').textContent = '';
    } else {
      avisoFixo = r.avisos.join(' ');
      botao.classList.remove('desligado');
      botao.removeAttribute('aria-disabled');
      const n = (v) => v.toFixed(0).replace('.', ',');
      $('#medidas').textContent =
        `${n(r.largura)} × ${n(r.altura)} × ${r.alturaTotal.toFixed(1).replace('.', ',')} mm`;
    }
    mostrarMensagem(avisoFixo, avisoFixo ? 'aviso' : '');
  } catch (erro) {
    console.error(erro);
    mostrarMensagem('Algo não deu certo com esse nome. Tente escrever de outro jeito.', 'aviso');
  }
}

let espera = null;
function reconstruirLogo(atraso = 200) {
  clearTimeout(espera);
  espera = setTimeout(reconstruir, atraso);
}

// ---------------- controles ----------------
$('#nome').addEventListener('input', (e) => {
  estado.nome = e.target.value;
  reconstruirLogo();
});

function grupoBotoes(seletor, chaveDado, aoEscolher) {
  const botoes = $$(`${seletor} .cartao`);
  for (const b of botoes) {
    b.addEventListener('click', () => {
      for (const outro of botoes) {
        const ativo = outro === b;
        outro.classList.toggle('ativo', ativo);
        outro.setAttribute('aria-pressed', ativo ? 'true' : 'false');
      }
      aoEscolher(b.dataset[chaveDado]);
      reconstruir();
    });
  }
}

grupoBotoes('.grade-opcoes[aria-labelledby="rot-estilo"]', 'estilo', (v) => {
  estado.estilo = v;
  visibilidadePorEstilo();
});
grupoBotoes('.grade-opcoes[aria-labelledby="rot-fonte"]', 'fonte', (v) => {
  estado.fonte = v;
});
grupoBotoes('.grade-opcoes[aria-labelledby="rot-tamanho"]', 'tamanho', (v) => {
  estado.tamanhoLetra = TAMANHOS[v];
  $('#op-tamanho').value = estado.tamanhoLetra;
  $('#val-tamanho').textContent = `${estado.tamanhoLetra} mm`;
});

function visibilidadePorEstilo() {
  $('#linha-borda').hidden = estado.estilo !== 'sombra';
  // o relevo só existe onde há placa por baixo do texto
  $('#linha-relevo').hidden = estado.estilo === 'letras';
}

function marcarTamanhoPreset() {
  for (const b of $$('.grade-opcoes[aria-labelledby="rot-tamanho"] .cartao')) {
    const ativo = TAMANHOS[b.dataset.tamanho] === estado.tamanhoLetra;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  }
}

function ligarDeslizante(id, saidaId, aoMudar, formatar) {
  const input = $(id), saida = $(saidaId);
  const atualizar = () => {
    const v = parseFloat(input.value);
    saida.textContent = formatar(v);
    aoMudar(v);
  };
  input.addEventListener('input', () => { atualizar(); reconstruirLogo(90); });
  return atualizar;
}

const mm = (v) => `${String(v).replace('.', ',')} mm`;

ligarDeslizante('#op-tamanho', '#val-tamanho', (v) => {
  estado.tamanhoLetra = v;
  marcarTamanhoPreset();
}, mm);
ligarDeslizante('#op-espaco', '#val-espaco', (v) => { estado.espaco = v; },
  (v) => (v > 0 ? `+${v}` : `${v}`));
ligarDeslizante('#op-proporcao', '#val-proporcao', (v) => { estado.proporcao = v; },
  (v) => `${v}%`);
ligarDeslizante('#op-borda', '#val-borda', (v) => { estado.borda = v; }, mm);
ligarDeslizante('#op-diametro', '#val-diametro', (v) => { estado.diametroFuro = v; }, mm);
ligarDeslizante('#op-espessura', '#val-espessura', (v) => { estado.espessura = v; }, mm);
ligarDeslizante('#op-relevo', '#val-relevo', (v) => { estado.relevo = v; }, mm);

$('#op-furo').addEventListener('click', () => {
  estado.comFuro = !estado.comFuro;
  $('#op-furo').setAttribute('aria-checked', estado.comFuro ? 'true' : 'false');
  $('#linha-furo').hidden = !estado.comFuro;
  reconstruir();
});

$('#restaurar').addEventListener('click', () => {
  Object.assign(estado, PADRAO);
  $('#op-tamanho').value = PADRAO.tamanhoLetra; $('#val-tamanho').textContent = mm(PADRAO.tamanhoLetra);
  $('#op-espaco').value = PADRAO.espaco; $('#val-espaco').textContent = '0';
  $('#op-proporcao').value = PADRAO.proporcao; $('#val-proporcao').textContent = '100%';
  $('#op-borda').value = PADRAO.borda; $('#val-borda').textContent = mm(PADRAO.borda);
  $('#op-diametro').value = PADRAO.diametroFuro; $('#val-diametro').textContent = mm(PADRAO.diametroFuro);
  $('#op-espessura').value = PADRAO.espessura; $('#val-espessura').textContent = mm(PADRAO.espessura);
  $('#op-relevo').value = PADRAO.relevo; $('#val-relevo').textContent = mm(PADRAO.relevo);
  $('#op-furo').setAttribute('aria-checked', 'true');
  $('#linha-furo').hidden = false;
  for (const [sel, chave, valor] of [
    ['rot-estilo', 'estilo', PADRAO.estilo],
    ['rot-fonte', 'fonte', PADRAO.fonte],
  ]) {
    for (const b of $$(`.grade-opcoes[aria-labelledby="${sel}"] .cartao`)) {
      const ativo = b.dataset[chave] === valor;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    }
  }
  marcarTamanhoPreset();
  visibilidadePorEstilo();
  reconstruir();
});

// ---------------- baixar ----------------
let baixando = false;
$('#baixar').addEventListener('click', () => {
  if (baixando) return;
  if (!fontes[estado.fonte]) {
    mostrarMensagem('Só um instante, ainda estou preparando as letras.', 'aviso', 5000);
    return;
  }
  if (!resultadoAtual || !resultadoAtual.temTexto) {
    mostrarMensagem('Escreva um nome primeiro.', 'aviso', 6000);
    $('#nome').focus();
    return;
  }
  const dados = grupoAtual ? exportarSTL(grupoAtual) : null;
  if (!dados) {
    mostrarMensagem('Não deu para preparar o arquivo. Tente outro nome.', 'aviso', 8000);
    return;
  }
  baixando = true;
  setTimeout(() => { baixando = false; }, 1200);

  const blob = new Blob([dados], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeDoArquivo(resultadoAtual.nomeUsado);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  mostrarMensagem('Pronto! O arquivo foi salvo na pasta de downloads.', 'sucesso', 9000);
});

// ---------------- amostras das fontes ----------------
// Desenha "Ana" com o contorno real de cada fonte, para o botão mostrar
// exatamente a letra que vai sair na peça.
function desenharAmostras() {
  for (const botao of $$('.cartao.fonte')) {
    const fonte = fontes[botao.dataset.fonte];
    const alvo = botao.querySelector('.amostra');
    if (!fonte || !alvo) continue;
    const aneis = poligonosDoTexto(fonte, 'Ana', 100, 0, 1, 6);
    if (!aneis.length) continue;
    const c = caixaDosAneis(aneis);
    let d = '';
    for (const a of aneis) {
      for (const anel of [a.contorno, ...a.furos]) {
        d += 'M' + anel.map((p) => `${p[0].toFixed(1)} ${(-p[1]).toFixed(1)}`).join('L') + 'Z';
      }
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${c.x0.toFixed(1)} ${(-c.y1).toFixed(1)} ${c.largura.toFixed(1)} ${c.altura.toFixed(1)}`);
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';
    svg.style.maxWidth = '86px';
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    path.setAttribute('fill-rule', 'evenodd');
    svg.appendChild(path);
    alvo.replaceWith(svg);
    svg.classList.add('amostra');
  }
}

// ---------------- início ----------------
async function iniciar() {
  window.__vivo = true;
  const botao = $('#baixar');
  botao.classList.add('desligado');
  botao.setAttribute('aria-disabled', 'true');
  mostrarMensagem('Preparando as letras...', '');
  aplicarTema(temaAtual());
  visibilidadePorEstilo();
  ajustarTela();

  try {
    const pares = await Promise.all(
      Object.entries(ARQUIVOS_FONTE).map(async ([chave, arquivo]) => {
        const r = await fetch(`./fontes/${arquivo}.typeface.json`);
        if (!r.ok) throw new Error(`fonte ${arquivo}: ${r.status}`);
        return [chave, criarFonte(await r.json())];
      })
    );
    for (const [chave, fonte] of pares) fontes[chave] = fonte;
    desenharAmostras();
    reconstruir();
  } catch (erro) {
    console.error(erro);
    avisoFixo = 'Não deu para abrir agora. Confira a internet e tente de novo.';
    mostrarMensagem(avisoFixo, 'aviso');
  }
}

if (new URLSearchParams(location.search).has('debug')) {
  window.__debug = {
    renderer, cena, camera, controles, estado,
    resultado: () => resultadoAtual,
    capturar: () => { controles.update(); renderer.render(cena, camera); return tela.toDataURL('image/png'); },
  };
}

iniciar();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
