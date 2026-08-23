// Interface: liga os controles ao gerador, cuida da cena 3D e do tema.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { criarSimulacao } from './fisica.js';
import {
  criarFonte, montarChaveiro, exportarSTL, nomeDoArquivo, descartarGrupo,
  materiais, TAMANHOS,
} from './chaveiro.js';
import { poligonosDoTexto, caixaDosAneis } from './forma.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// Catálogo de fontes (site/fontes/fontes.json). Só o catálogo e a fonte em uso
// são carregados na abertura; as outras chegam quando escolhidas. Todas juntas
// passam de 2,5 MB, e ninguém precisa de tudo isso para escrever um nome.
let catalogo = { categorias: [], fontes: [] };
const carregando = new Map();

const PADRAO = {
  estilo: 'retangulo',
  fonte: 'firme',
  tamanhoLetra: TAMANHOS.M,
  espaco: 0,
  proporcao: 100,
  borda: 2.5,
  traco: 0,
  folga: 0.45,
  folgaV: 0.25,
  giro: 30,
  tamanhoBloco: 15,
  espessuraBloco: 8.25,
  arredondamento: 60,
  furoBloco: 1,
  furoX: 0,
  furoY: 0,
  furoDiamCorrente: 3.5,
  escalaLetra: 80,
  argolaExterna: true,
  comFuro: true,
  diametroFuro: 5,
  paredeFuro: 3,
  furoRecuo: 0,
  furoNaDireita: false,
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
  if (girarLigado && !fisicaLigada) controles.autoRotate = true;
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

let relogio = performance.now();
renderer.setAnimationLoop(() => {
  const agora = performance.now();
  const dt = Math.min((agora - relogio) / 1000, 0.05);
  relogio = agora;
  if (simulacao) simulacao.passo(dt);
  controles.update();
  renderer.render(cena, camera);
});

// ---------------- física: testar o chaveiro ----------------
// O botão ✋ liga a bancada de teste: a peça vira corpos rígidos, a correntinha
// dobra até o batente de verdade e dá para arrastar com o mouse. Desligar
// remonta a peça no lugar.
let simulacao = null;
let fisicaLigada = false;

function ligarFisica(liga) {
  const b = $('#testar');
  if (liga && (!resultadoAtual || !resultadoAtual.temTexto)) liga = false;
  fisicaLigada = liga;
  b.classList.toggle('ativo', liga);
  b.setAttribute('aria-pressed', liga ? 'true' : 'false');
  if (liga) {
    simulacao = criarSimulacao({ THREE, resultado: resultadoAtual });
    controles.autoRotate = false;
    $('#dica').textContent = 'Arraste o chaveiro para balançar · clique no ✋ para parar';
    $('#dica').classList.remove('some');
  } else {
    simulacao = null;
    pegando = false;
    controles.enabled = true;
    if (girarLigado) controles.autoRotate = true;
    $('#dica').textContent = 'Arraste para girar · role para aproximar';
    reconstruir();          // remonta a peça arrumada
  }
}
$('#testar').addEventListener('click', () => ligarFisica(!fisicaLigada));

const planoPega = new THREE.Plane();
const raioPega = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pegando = false;

function pontoDoMouse(e) {
  const r = tela.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raioPega.setFromCamera(ndc, camera);
  const alvo = new THREE.Vector3();
  return raioPega.ray.intersectPlane(planoPega, alvo) ? alvo : null;
}

tela.addEventListener('pointerdown', (e) => {
  if (!simulacao || !grupoAtual) return;
  const r = tela.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raioPega.setFromCamera(ndc, camera);
  const acertos = raioPega.intersectObject(grupoAtual, true);
  if (!acertos.length) return;             // clicou fora da peça: deixa orbitar
  const h = acertos[0].point;
  // o arrasto acontece num plano paralelo ao chão da junta, na profundidade do clique
  planoPega.set(new THREE.Vector3(0, 1, 0), -h.y);
  simulacao.agarrar({ x: h.x, z: h.z });
  pegando = true;
  controles.enabled = false;
  try { tela.setPointerCapture(e.pointerId); } catch (_) { /* toque sintético não tem ponteiro ativo */ }
});
tela.addEventListener('pointermove', (e) => {
  if (!pegando || !simulacao) return;
  const p = pontoDoMouse(e);
  if (p) simulacao.arrastar({ x: p.x, z: p.z });
});
for (const ev of ['pointerup', 'pointercancel']) {
  tela.addEventListener(ev, () => {
    if (!pegando) return;
    pegando = false;
    if (simulacao) simulacao.soltar();
    controles.enabled = true;
  });
}

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
      espessuraTraco: estado.traco / 10,
      espessuraBase: estado.espessura,
      alturaLetra: estado.relevo,
      comFuro: estado.comFuro,
      diametroFuro: estado.diametroFuro,
      paredeFuro: estado.paredeFuro,
      furoRecuo: estado.furoRecuo,
      furoNaDireita: estado.furoNaDireita,
      borda: estado.borda,
      folgaArticulacao: estado.folga,
      folgaVertical: estado.folgaV,
      giroArticulacao: estado.giro,
      tamanhoBloco: estado.tamanhoBloco,
      espessuraBloco: estado.espessuraBloco,
      arredondamento: estado.arredondamento,
      furoBloco: estado.furoBloco,
      furoX: estado.furoX,
      furoY: estado.furoY,
      furoDiametro: estado.furoDiamCorrente,
      escalaLetra: estado.escalaLetra,
      argolaExterna: estado.argolaExterna,
    });

    if (grupoAtual) { cena.remove(grupoAtual); descartarGrupo(grupoAtual); }
    grupoAtual = r.grupo;
    resultadoAtual = r;
    cena.add(grupoAtual);
    // se a bancada de teste estiver ligada, a peça nova ja nasce com fisica
    simulacao = (fisicaLigada && r.temTexto) ? criarSimulacao({ THREE, resultado: r }) : (fisicaLigada ? null : simulacao);

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
      if (estado.estilo === 'articulado') {
        // na correntinha o que importa é o comprimento montado, para conferir
        // antes de imprimir
        $('#medidas').textContent =
          `Comprimento total: ${r.largura.toFixed(1).replace('.', ',')} mm  ·  ` +
          `${r.blocos} bloquinhos de ${n(r.altura)} × ${r.alturaTotal.toFixed(1).replace('.', ',')} mm`;
      } else {
        $('#medidas').textContent =
          `${n(r.largura)} × ${n(r.altura)} × ${r.alturaTotal.toFixed(1).replace('.', ',')} mm`;
      }
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
  mostrarLetraAtual();
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
grupoBotoes('.grade-opcoes[aria-labelledby="rot-tamanho"]', 'tamanho', (v) => {
  estado.tamanhoLetra = TAMANHOS[v];
  $('#op-tamanho').value = estado.tamanhoLetra;
  $('#val-tamanho').textContent = `${estado.tamanhoLetra} mm`;
});

function linhasDoFuro() {
  const correntinha = estado.estilo === 'articulado';
  const semFuro = !estado.comFuro;
  // nos estilos com placa e contorno: tamanho, borda, recuo e lado
  for (const id of ['#linha-furo', '#linha-parede', '#linha-recuo', '#linha-lado']) {
    $(id).hidden = semFuro || correntinha;
  }
  // a argola externa é só da correntinha
  $('#linha-argola-ext').hidden = semFuro || !correntinha;
  // posição livre (X/Y): em TODOS os estilos; na correntinha só quando a
  // argola externa está desligada (a argola tem lugar fixo, na ponta)
  const livre = correntinha ? !estado.argolaExterna : true;
  for (const id of ['#linha-furo-x', '#linha-furo-y']) {
    $(id).hidden = semFuro || !livre;
  }
  // em qual bloco: só da correntinha com furo no corpo
  $('#linha-furo-bloco').hidden = semFuro || !correntinha || estado.argolaExterna;
  // diâmetro próprio da correntinha (nos outros estilos vale o Tamanho do furo)
  $('#linha-furo-diam').hidden = semFuro || !correntinha;
}

function visibilidadePorEstilo() {
  const soLetras = estado.estilo === 'letras';
  const correntinha = estado.estilo === 'articulado';

  $('#linha-borda').hidden = estado.estilo !== 'sombra';
  $('#linha-folga').hidden = !correntinha;
  $('#linha-folga-v').hidden = !correntinha;
  $('#linha-giro').hidden = !correntinha;
  $('#linha-altura').hidden = !correntinha;
  $('#linha-arred').hidden = !correntinha;
  // na correntinha o tamanho é em milímetros de bloco, não em Pequeno/Médio/Grande:
  // a letra sai do bloco, o bloco não sai da letra
  $('.grade-opcoes[aria-labelledby="rot-tamanho"]').hidden = correntinha;
  $('#op-tamanho').closest('.deslizante').hidden = correntinha;
  $('#linha-bloco').hidden = !correntinha;
  $('#linha-letra-bloco').hidden = !correntinha;
  // o relevo só existe onde há placa por baixo do texto
  $('#linha-relevo').hidden = soLetras;
  // na correntinha cada letra tem seu bloquinho, então espaçar não faz sentido
  $('#op-espaco').closest('.deslizante').hidden = correntinha;
  // no só-letras não existe "base": a espessura é a da peça inteira
  $('#rot-espessura').textContent = soLetras ? 'Espessura da peça' : 'Espessura da base';
  // na correntinha a espessura tem controle próprio (Espessura do bloco)
  $('#op-espessura').closest('.deslizante').hidden = correntinha;
  linhasDoFuro();
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
ligarDeslizante('#op-traco', '#val-traco', (v) => { estado.traco = v; },
  (v) => (v === 0 ? 'normal' : (v > 0 ? '+' : '') + (v / 10).toString().replace('.', ',') + ' mm'));
ligarDeslizante('#op-folga', '#val-folga', (v) => { estado.folga = v; }, mm);
ligarDeslizante('#op-folga-v', '#val-folga-v', (v) => { estado.folgaV = v; }, mm);
ligarDeslizante('#op-giro', '#val-giro', (v) => { estado.giro = v; }, (v) => `${v}°`);
// o tamanho do bloco manda em tudo: mudar o bloco reescala a espessura junto,
// proporcionalmente — as folgas e o furo da argola ficam como estão
ligarDeslizante('#op-bloco', '#val-bloco', (v) => {
  const razao = v / estado.tamanhoBloco;
  estado.tamanhoBloco = v;
  estado.espessuraBloco = Math.round(estado.espessuraBloco * razao * 4) / 4;
  $('#op-altura').value = estado.espessuraBloco;
  $('#val-altura').textContent = mm(estado.espessuraBloco);
}, mm);
ligarDeslizante('#op-altura', '#val-altura', (v) => { estado.espessuraBloco = v; }, mm);
ligarDeslizante('#op-letra-bloco', '#val-letra-bloco', (v) => { estado.escalaLetra = v; }, (v) => `${v}%`);
ligarDeslizante('#op-furo-bloco', '#val-furo-bloco', (v) => { estado.furoBloco = v; }, (v) => `${v}º`);
ligarDeslizante('#op-furo-x', '#val-furo-x', (v) => { estado.furoX = v; }, mm);
ligarDeslizante('#op-furo-y', '#val-furo-y', (v) => { estado.furoY = v; }, mm);
ligarDeslizante('#op-furo-diam', '#val-furo-diam', (v) => { estado.furoDiamCorrente = v; }, mm);
ligarDeslizante('#op-arred', '#val-arred', (v) => { estado.arredondamento = v; }, (v) => `${v}%`);
ligarDeslizante('#op-borda', '#val-borda', (v) => { estado.borda = v; }, mm);
ligarDeslizante('#op-diametro', '#val-diametro', (v) => { estado.diametroFuro = v; }, mm);
ligarDeslizante('#op-parede', '#val-parede', (v) => { estado.paredeFuro = v; }, mm);
ligarDeslizante('#op-recuo', '#val-recuo', (v) => { estado.furoRecuo = v; }, mm);
ligarDeslizante('#op-espessura', '#val-espessura', (v) => { estado.espessura = v; }, mm);
ligarDeslizante('#op-relevo', '#val-relevo', (v) => { estado.relevo = v; }, mm);

$('#op-lado').addEventListener('click', () => {
  estado.furoNaDireita = !estado.furoNaDireita;
  $('#op-lado').setAttribute('aria-checked', estado.furoNaDireita ? 'true' : 'false');
  $('#rot-lado').textContent = estado.furoNaDireita ? 'Furo do lado direito' : 'Furo do lado esquerdo';
  reconstruir();
});

$('#op-furo').addEventListener('click', () => {
  estado.comFuro = !estado.comFuro;
  $('#op-furo').setAttribute('aria-checked', estado.comFuro ? 'true' : 'false');
  linhasDoFuro();
  reconstruir();
});

$('#op-argola-ext').addEventListener('click', () => {
  estado.argolaExterna = !estado.argolaExterna;
  $('#op-argola-ext').setAttribute('aria-checked', estado.argolaExterna ? 'true' : 'false');
  linhasDoFuro();
  reconstruir();
});

$('#restaurar').addEventListener('click', () => {
  Object.assign(estado, PADRAO);
  $('#op-tamanho').value = PADRAO.tamanhoLetra; $('#val-tamanho').textContent = mm(PADRAO.tamanhoLetra);
  $('#op-espaco').value = PADRAO.espaco; $('#val-espaco').textContent = '0';
  $('#op-proporcao').value = PADRAO.proporcao; $('#val-proporcao').textContent = '100%';
  $('#op-traco').value = PADRAO.traco; $('#val-traco').textContent = 'normal';
  $('#op-folga').value = PADRAO.folga; $('#val-folga').textContent = mm(PADRAO.folga);
  $('#op-folga-v').value = PADRAO.folgaV; $('#val-folga-v').textContent = mm(PADRAO.folgaV);
  $('#op-giro').value = PADRAO.giro; $('#val-giro').textContent = `${PADRAO.giro}°`;
  $('#op-bloco').value = PADRAO.tamanhoBloco; $('#val-bloco').textContent = mm(PADRAO.tamanhoBloco);
  $('#op-altura').value = PADRAO.espessuraBloco; $('#val-altura').textContent = mm(PADRAO.espessuraBloco);
  $('#op-arred').value = PADRAO.arredondamento; $('#val-arred').textContent = `${PADRAO.arredondamento}%`;
  $('#op-furo-bloco').value = PADRAO.furoBloco; $('#val-furo-bloco').textContent = `${PADRAO.furoBloco}º`;
  $('#op-furo-x').value = PADRAO.furoX; $('#val-furo-x').textContent = mm(PADRAO.furoX);
  $('#op-furo-y').value = PADRAO.furoY; $('#val-furo-y').textContent = mm(PADRAO.furoY);
  $('#op-furo-diam').value = PADRAO.furoDiamCorrente; $('#val-furo-diam').textContent = mm(PADRAO.furoDiamCorrente);
  $('#op-letra-bloco').value = PADRAO.escalaLetra; $('#val-letra-bloco').textContent = `${PADRAO.escalaLetra}%`;
  $('#op-argola-ext').setAttribute('aria-checked', 'true');
  $('#op-borda').value = PADRAO.borda; $('#val-borda').textContent = mm(PADRAO.borda);
  $('#op-diametro').value = PADRAO.diametroFuro; $('#val-diametro').textContent = mm(PADRAO.diametroFuro);
  $('#op-parede').value = PADRAO.paredeFuro; $('#val-parede').textContent = mm(PADRAO.paredeFuro);
  $('#op-recuo').value = PADRAO.furoRecuo; $('#val-recuo').textContent = mm(PADRAO.furoRecuo);
  $('#op-lado').setAttribute('aria-checked', 'false');
  $('#rot-lado').textContent = 'Furo do lado esquerdo';
  $('#op-espessura').value = PADRAO.espessura; $('#val-espessura').textContent = mm(PADRAO.espessura);
  $('#op-relevo').value = PADRAO.relevo; $('#val-relevo').textContent = mm(PADRAO.relevo);
  $('#op-furo').setAttribute('aria-checked', 'true');
  for (const b of $('.grade-opcoes[aria-labelledby="rot-estilo"] .cartao')) {
    const ativo = b.dataset.estilo === PADRAO.estilo;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  }
  garantirFonte(estado.fonte).then(mostrarLetraAtual).catch(() => {});
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

// ---------------- seletor de letras ----------------

// Desenha um texto com o contorno REAL da fonte. É o que faz cada opção do
// seletor mostrar exatamente a letra que vai sair na peça, sem depender de a
// fonte estar instalada no aparelho.
function svgDoTexto(fonte, texto, altura) {
  const aneis = poligonosDoTexto(fonte, texto, 100, 0, 1, 6);
  if (!aneis.length) return null;
  const c = caixaDosAneis(aneis);
  let d = '';
  for (const a of aneis) {
    for (const anel of [a.contorno, ...a.furos]) {
      d += 'M' + anel.map((p) => `${p[0].toFixed(1)} ${(-p[1]).toFixed(1)}`).join('L') + 'Z';
    }
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${c.x0.toFixed(1)} ${(-c.y1).toFixed(1)} ${c.largura.toFixed(1)} ${c.altura.toFixed(1)}`);
  svg.setAttribute('height', String(altura));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('fill-rule', 'evenodd');
  svg.appendChild(path);
  return svg;
}

// Carrega uma fonte uma única vez, mesmo que peçam a mesma várias vezes seguidas.
function garantirFonte(id) {
  if (fontes[id]) return Promise.resolve(fontes[id]);
  if (carregando.has(id)) return carregando.get(id);
  const item = catalogo.fontes.find((f) => f.id === id);
  if (!item) return Promise.reject(new Error('fonte desconhecida: ' + id));
  const p = fetch('./fontes/' + item.arquivo)
    .then((r) => { if (!r.ok) throw new Error(item.arquivo + ': ' + r.status); return r.json(); })
    .then((json) => { const f = criarFonte(json); fontes[id] = f; carregando.delete(id); return f; })
    .catch((e) => { carregando.delete(id); throw e; });
  carregando.set(id, p);
  return p;
}

function textoDeAmostra() {
  const n = (estado.nome || '').trim();
  return n.length ? n.slice(0, 12) : 'Ana';
}

function mostrarLetraAtual() {
  const item = catalogo.fontes.find((f) => f.id === estado.fonte);
  $('#seletor-nome').textContent = item ? item.rotulo : '';
  const alvo = $('#seletor-amostra');
  alvo.textContent = '';
  const fonte = fontes[estado.fonte];
  if (!fonte) return;
  const svg = svgDoTexto(fonte, textoDeAmostra(), 26);
  if (svg) alvo.appendChild(svg);
}

// ---- janela do seletor ----
const janela = $('#janela-letras');
let montouLista = false;
let ultimoFoco = null;

function abrirLetras() {
  ultimoFoco = document.activeElement;
  janela.hidden = false;
  document.body.classList.add('travado');
  montarLista();
  const atual = janela.querySelector('.letra-cartao.ativo');
  (atual || janela.querySelector('.janela-fechar')).focus();
}

function fecharLetras() {
  janela.hidden = true;
  document.body.classList.remove('travado');
  if (ultimoFoco) ultimoFoco.focus();
}

$('#abrir-letras').addEventListener('click', abrirLetras);
janela.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fecharLetras(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !janela.hidden) fecharLetras();
});

function montarLista() {
  const amostra = textoDeAmostra();
  if (montouLista) { atualizarPrevias(amostra); return; }
  montouLista = true;

  const lista = $('#lista-letras');
  lista.textContent = '';

  for (const cat of catalogo.categorias) {
    const daCat = catalogo.fontes.filter((f) => f.cat === cat.id);
    if (!daCat.length) continue;
    const secao = document.createElement('section');
    secao.className = 'letra-secao';
    const h = document.createElement('h3');
    h.textContent = cat.rotulo;
    secao.appendChild(h);
    const grade = document.createElement('div');
    grade.className = 'letra-grade';
    for (const f of daCat) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'letra-cartao' + (f.id === estado.fonte ? ' ativo' : '');
      b.dataset.fonte = f.id;
      b.setAttribute('aria-pressed', f.id === estado.fonte ? 'true' : 'false');
      const prev = document.createElement('span');
      prev.className = 'letra-previa';
      b.appendChild(prev);
      const rot = document.createElement('span');
      rot.className = 'letra-rotulo';
      rot.textContent = f.rotulo;
      b.appendChild(rot);
      b.addEventListener('click', () => escolherFonte(f.id));
      grade.appendChild(b);
    }
    secao.appendChild(grade);
    lista.appendChild(secao);
  }

  // as prévias vão aparecendo conforme cada fonte chega, sem travar a janela
  const sub = $('#janela-sub');
  const total = catalogo.fontes.length;
  let faltam = total;
  sub.textContent = 'Carregando as letras... 0 de ' + total;
  for (const f of catalogo.fontes) {
    garantirFonte(f.id)
      .then(() => pintarPrevia(f.id, amostra))
      .catch(() => {})
      .then(() => {
        faltam--;
        sub.textContent = faltam > 0
          ? 'Carregando as letras... ' + (total - faltam) + ' de ' + total
          : 'Toque em uma letra para usar';
      });
  }
}

function pintarPrevia(id, amostra) {
  const fonte = fontes[id];
  const cartao = janela.querySelector('.letra-cartao[data-fonte="' + id + '"]');
  if (!fonte || !cartao) return;
  const alvo = cartao.querySelector('.letra-previa');
  alvo.textContent = '';
  const svg = svgDoTexto(fonte, amostra, 34);
  if (svg) alvo.appendChild(svg);
}

function atualizarPrevias(amostra) {
  for (const f of catalogo.fontes) if (fontes[f.id]) pintarPrevia(f.id, amostra);
}

function escolherFonte(id) {
  estado.fonte = id;
  for (const b of janela.querySelectorAll('.letra-cartao')) {
    const ativo = b.dataset.fonte === id;
    b.classList.toggle('ativo', ativo);
    b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
  }
  fecharLetras();
  garantirFonte(id)
    .then(() => { mostrarLetraAtual(); reconstruir(); })
    .catch((e) => {
      console.error(e);
      mostrarMensagem('Não deu para carregar essa letra. Tente outra.', 'aviso', 6000);
    });
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
    const r = await fetch('./fontes/fontes.json');
    if (!r.ok) throw new Error('catálogo: ' + r.status);
    catalogo = await r.json();
    if (!catalogo.fontes.some((f) => f.id === estado.fonte)) {
      estado.fonte = catalogo.fontes[0].id;
    }
    await garantirFonte(estado.fonte);
    mostrarLetraAtual();
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
    fisica: () => ({ ligada: fisicaLigada, sim: simulacao, pegando }),
    capturar: () => { controles.update(); renderer.render(cena, camera); return tela.toDataURL('image/png'); },
  };
}

iniciar();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
