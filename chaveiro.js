// Núcleo do gerador: monta a peça 3D do chaveiro e exporta o arquivo de impressão.
// Tudo em milímetros. A peça fica apoiada em Z=0 e centrada em XY.

import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import {
  bandaDaFonte, tamanhoMinimoDaFonte, poligonosDoTexto, caixaDosAneis, moverAneis,
  aneisParaShapes, criarGrade, pintarAneis, pintarDisco, campoDistancia,
  binarioDoCampo, contarPedacos, contornar, simplificar, ligarPedacos, suavizar, reamostrar, limparAneis, engrossarAneis,
} from './forma.js';

// ---------- Regras de impressão (fixas) ----------
export const MARGEM = 3;        // texto até a borda, nos estilos com placa
export const PAREDE_FURO = 3;   // padrão do material ao redor do furo
const AFUNDAR = 0.2;            // quanto as letras entram na placa (o fatiador une)
const FOLGA_FURO_TEXTO = 2;     // texto x anel do furo, nos estilos com placa
const AVISO_TAMANHO = 180;      // acima disso avisamos que ficou grande

export const ESTILOS = ['retangulo', 'arredondado', 'sombra', 'letras', 'articulado'];
export const TAMANHOS = { P: 11, M: 15, G: 20 }; // altura da letra, em mm

const carregadorFonte = new FontLoader();
const exportador = new STLExporter();

// Visualizacao flat: sem luz, sem sombra, sem brilho. O ExtrudeGeometry separa
// a malha em dois grupos (tampas e laterais), entao basta dar uma cor plana para
// cada um — a lateral um pouco mais escura — e a profundidade continua legivel
// sem nenhum calculo de iluminacao.
export const materiais = {
  baseTopo: new THREE.MeshBasicMaterial({ color: 0x2563eb }),
  baseLado: new THREE.MeshBasicMaterial({ color: 0x1c4fd1 }),
  letraTopo: new THREE.MeshBasicMaterial({ color: 0xfff7e6 }),
  letraLado: new THREE.MeshBasicMaterial({ color: 0xe3d5b6 }),
};

export function criarFonte(json) {
  return carregadorFonte.parse(json);
}

export function filtrarNome(fonte, nome) {
  const limpo = String(nome).replace(/\s+/g, ' ').trim();
  const aceitos = [];
  let removeu = false;
  for (const ch of Array.from(limpo)) {
    if (fonte.data.glyphs[ch]) aceitos.push(ch);
    else removeu = true;
  }
  return { nome: aceitos.join('').replace(/\s+/g, ' ').trim(), removeu };
}

// ---------- polígonos auxiliares ----------
function dentroDoPoligono(p, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

function distanciaAoContorno(p, poly) {
  let min = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const abx = b.x - a.x, aby = b.y - a.y;
    const len2 = abx * abx + aby * aby;
    let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = p.x - (a.x + t * abx), dy = p.y - (a.y + t * aby);
    const d = Math.hypot(dx, dy);
    if (d < min) min = d;
  }
  return min;
}

function formaRetangular(largura, altura, raio) {
  const s = new THREE.Shape();
  const r = Math.max(0.01, Math.min(raio, altura / 2 - 0.01, largura / 2 - 0.01));
  s.moveTo(r, 0);
  s.lineTo(largura - r, 0);
  s.absarc(largura - r, r, r, -Math.PI / 2, 0);
  s.lineTo(largura, altura - r);
  s.absarc(largura - r, altura - r, r, 0, Math.PI / 2);
  s.lineTo(r, altura);
  s.absarc(r, altura - r, r, Math.PI / 2, Math.PI);
  s.lineTo(0, r);
  s.absarc(r, r, r, Math.PI, Math.PI * 1.5);
  return s;
}

// ---------- estilos com placa (retângulo e arredondado) ----------
function montarComPlaca(op) {
  const {
    aneisTexto, caixa, estilo, espessuraBase, alturaLetra,
    comFuro, raioFuro, paredeFuro, furoNaDireita, furoRecuo, largurasPersonalizadas,
  } = op;

  const alturaPlaca = op.alturaBanda + MARGEM * 2;
  const raioCanto = estilo === 'arredondado' ? alturaPlaca / 2 : Math.min(2.5, alturaPlaca * 0.14);

  // espaço reservado à esquerda para o furo da argola
  const zonaFuro = comFuro ? paredeFuro + raioFuro * 2 + FOLGA_FURO_TEXTO + furoRecuo : 0;
  // nas pontas arredondadas o texto tem de se afastar da curva
  let folgaCurva = 0;
  if (estilo === 'arredondado') {
    const rc = alturaPlaca / 2;
    const meia = op.alturaBanda / 2;
    folgaCurva = Math.max(0, rc - Math.sqrt(Math.max(0, rc * rc - meia * meia))) * 0.85;
  }

  const zonaEsq = furoNaDireita ? 0 : zonaFuro;
  const zonaDir = furoNaDireita ? zonaFuro : 0;
  const inicioTexto = Math.max(MARGEM + folgaCurva, zonaEsq + MARGEM * 0.5);
  const larguraPlaca = Math.max(
    inicioTexto + caixa.largura + MARGEM + folgaCurva + zonaDir,
    alturaPlaca * 1.25,
    largurasPersonalizadas || 0,
  );

  const forma = formaRetangular(larguraPlaca, alturaPlaca, raioCanto);
  const poly = forma.getPoints(20);

  let furo = null;
  if (comFuro) {
    const alvo = raioFuro + paredeFuro;
    // o furo pode ficar na ponta esquerda ou na direita, e recuar para dentro
    const p = furoNaDireita
      ? { x: larguraPlaca - alvo - furoRecuo, y: alturaPlaca / 2 }
      : { x: alvo + furoRecuo, y: alturaPlaca / 2 };
    const passo = furoNaDireita ? -0.15 : 0.15;
    for (let k = 0; k < 300 && distanciaAoContorno(p, poly) < alvo - 0.02; k++) p.x += passo;
    furo = { x: p.x, y: p.y, raio: raioFuro };
    const caminho = new THREE.Path();
    caminho.absarc(furo.x, furo.y, raioFuro, 0, Math.PI * 2, true);
    forma.holes.push(caminho);
  }

  const dxTexto = inicioTexto - caixa.x0;
  const dyTexto = (alturaPlaca - op.alturaBanda) / 2 - op.bandaBaixo;

  return {
    formasBase: [forma],
    aneisTexto: moverAneis(aneisTexto, dxTexto, dyTexto),
    largura: larguraPlaca,
    altura: alturaPlaca,
    furo,
    pedacos: 1,
    textoEmRelevo: true,
    curvasBase: 24,
  };
}

// ---------- estilos desenhados na grade (sombra e só letras) ----------
function montarNaGrade(op) {
  const {
    aneisTexto, caixa, estilo, comFuro, raioFuro, paredeFuro, furoNaDireita, borda, tamanho,
  } = op;

  const ehSombra = estilo === 'sombra';
  const raioAnel = raioFuro + paredeFuro;
  const bordaTeto = ehSombra ? borda + 4 : 0;
  const larguraPonte = Math.max(1.4, tamanho * 0.075);

  const folga = bordaTeto + (comFuro ? raioAnel * 2.4 : 0) + 3;
  const maior = Math.max(caixa.largura, caixa.altura) + folga * 2;
  // No estilo sombra o contorno sai a 2,5 mm do traco, onde a ondulacao da grade
  // pesa pouco. No so-letras o contorno E o traco, o caso mais exigente, entao a
  // grade ali precisa ser mais fina.
  const piso = ehSombra ? 0.11 : 0.085;
  const celula = Math.min(0.34, Math.max(piso, maior / 1300));
  const grade = criarGrade(caixa, folga, celula);

  const mapaTexto = pintarAneis(aneisTexto, grade);
  const sdfTexto = campoDistancia(mapaTexto, grade);

  // Estilo sombra: engorda o contorno. Se o desenho ficar em pedaços (por
  // exemplo o espaço entre dois nomes), engorda um pouco mais até fechar.
  let mapa, bordaUsada = 0;
  if (ehSombra) {
    bordaUsada = borda;
    mapa = binarioDoCampo(sdfTexto, bordaUsada);
    while (bordaUsada < bordaTeto && contarPedacos(mapa, grade) > 1) {
      bordaUsada = Math.min(bordaTeto, bordaUsada + 0.4);
      mapa = binarioDoCampo(sdfTexto, bordaUsada);
    }
  } else {
    // So letras: o desenho e o proprio traco, sem engordar nada.
    //
    // Aqui havia uma soldadura (engordar e voltar) para juntar letras que quase
    // se encostam. Ela foi removida: engordar 0,45 mm fecha qualquer vao menor
    // que 0,9 mm, e o miolo do "a" da fonte estreita tem 1,14 mm no tamanho
    // medio e menos de 0,9 mm no pequeno — ou seja, a solda tapava o buraco da
    // letra. As pontes abaixo dao conta de unir a peca sem esse efeito colateral.
    mapa = mapaTexto;
  }

  // Pontes finas: grudam til, pingo do "i", cedilha e letras vizinhas.
  const ligado = ligarPedacos(mapa, grade, larguraPonte);
  mapa = ligado.mapa;

  // Argola: encosta um disco no ponto de tinta mais à esquerda, garantindo
  // que ele fique grudado na peça de verdade (e não só perto dela).
  let furo = null;
  if (comFuro) {
    // ponto de tinta mais à esquerda (ou à direita, se a argola for daquele lado)
    let melhorI = furoNaDireita ? -1 : grade.larg, melhorJ = -1;
    for (let j = 0; j < grade.alt; j++) {
      if (furoNaDireita) {
        for (let i = grade.larg - 1; i >= 0; i--) {
          if (mapa[j * grade.larg + i]) {
            if (i > melhorI) { melhorI = i; melhorJ = j; }
            break;
          }
        }
      } else {
        for (let i = 0; i < grade.larg; i++) {
          if (mapa[j * grade.larg + i]) {
            if (i < melhorI) { melhorI = i; melhorJ = j; }
            break;
          }
        }
      }
    }
    if (melhorJ >= 0) {
      const bordaX = grade.x0 + (melhorI + 0.5) * grade.celula;
      const bordaY = grade.y0 + (melhorJ + 0.5) * grade.celula;
      // No estilo sombra a argola encosta na borda grossa e pode entrar mais.
      // No só-letras ela apenas encosta na primeira letra, senão parece outra letra.
      const entrada = ehSombra ? 0.5 : 0.76;
      const cx = bordaX + (furoNaDireita ? raioAnel * entrada : -raioAnel * entrada);
      pintarDisco(mapa, grade, cx, bordaY, raioAnel, 1);
      pintarDisco(mapa, grade, cx, bordaY, raioFuro, 0);
      furo = { x: cx, y: bordaY, raio: raioFuro };
    }
  }

  const pedacos = contarPedacos(mapa, grade);
  const sdf = campoDistancia(mapa, grade);
  let aneis = contornar(sdf, grade, 0);
  // tira o serrilhado da grade e deixa as faces laterais uniformes
  aneis = suavizar(aneis, 12);
  aneis = reamostrar(aneis, Math.min(0.7, Math.max(0.28, maior / 420)));
  aneis = suavizar(aneis, 4);
  // Descarta furinhos sem sentido fisico: o encontro de uma ponte com a letra
  // as vezes deixa um furo de decimo de milimetro. O criterio e o bico da
  // impressora: um furo de 0,4 mm de diametro tem 0,126 mm2, e abaixo disso nao
  // ha o que imprimir. O menor miolo de letra legitimo (o "e" da fonte estreita
  // no tamanho minimo dela) tem 0,29 mm2, com folga de duas vezes para cima.
  aneis = limparAneis(aneis, Math.max(0.008, celula * 0.06), 0.126);

  const caixaPeca = caixaDosAneis(aneis);
  const formasBase = aneisParaShapes(aneis);

  return {
    formasBase,
    aneisTexto,
    largura: caixaPeca.largura,
    altura: caixaPeca.altura,
    deslocamento: { x: -caixaPeca.x0, y: -caixaPeca.y0 },
    furo,
    pedacos,
    pontes: ligado.pontes,
    bordaUsada,
    textoEmRelevo: ehSombra,
    curvasBase: 1,
  };
}

// ---------- montagem completa ----------
// ---------- estilo articulado: dobradiça de nós sobrepostos ----------
//
// É a dobradiça de pulseira de relógio: no encontro de dois blocos a espessura é
// dividida ao meio. O bloco da esquerda fica só com a METADE DE BAIXO e avança
// como uma lingueta que termina em disco; o da direita fica só com a METADE DE
// CIMA e avança do mesmo jeito, por cima da outra. Somadas, as duas metades
// recompõem a espessura inteira — de lado não há degrau. Um pino atravessa as
// duas de cima a baixo, com o eixo perpendicular à face da letra.
//
// O que NÃO é: um recorte de quebra-cabeça, com as duas peças inteiras se
// encaixando lado a lado no mesmo plano. Aquilo não gira.
//
// Cada bloco é montado com três sólidos:
//
//   1. o cubo, com um ALÍVIO em arco em cada ponta (é o rebaixo circular que
//      recebe o disco do vizinho);
//   2. o nó de baixo, saindo pela direita, que preenche o alívio direito na
//      metade de baixo;
//   3. o nó de cima, saindo pela esquerda, que preenche o alívio esquerdo na
//      metade de cima.
//
// Sobra o alívio direito na metade de cima (onde entra o nó de cima do vizinho)
// e o esquerdo na metade de baixo (onde entra o nó de baixo do outro vizinho).

const MARGEM_BLOCO = 2.0;      // letra até a borda do cubo
const PAREDE_PINO = 1.4;       // material entre o furo do pino e a beirada do disco
const FOLGA_ALIVIO = 0.3;      // sobra entre o disco que gira e o alívio
const RECUO_NO = 2.2;          // o quanto o nó entra no corpo do cubo

// Face lateral com o alívio em arco no meio, para o disco do vizinho girar ali.
// O arco tem de morder PARA DENTRO do bloco: passa pelo ponto do círculo mais
// próximo do corpo, nunca pelo lado de fora (foi assim que a junta virou uma aba
// de quebra-cabeça na primeira tentativa).
function faceComAlivio(f, x, yFim, xPino, rAlivio, paraCima) {
  const dp = Math.abs(xPino - x);
  const ya = rAlivio > dp ? Math.sqrt(rAlivio * rAlivio - dp * dp) : 0;
  if (ya <= 0) { f.lineTo(x, yFim); return; }
  const lado = xPino > x ? -dp : dp;   // posição da face em relação ao pino
  if (paraCima) {
    f.lineTo(x, -ya);
    f.absarc(xPino, 0, rAlivio, Math.atan2(-ya, lado), Math.atan2(ya, lado), true);
    f.lineTo(x, yFim);
  } else {
    f.lineTo(x, ya);
    f.absarc(xPino, 0, rAlivio, Math.atan2(ya, lado), Math.atan2(-ya, lado), true);
    f.lineTo(x, yFim);
  }
}

// O cubo visto de cima, com o alívio nas pontas que têm vizinho.
function perfilCubo(op) {
  const { W, rc, dp, rAlivio, temEsq, temDir } = op;
  const meia = W / 2;
  const f = new THREE.Shape();

  f.moveTo(rc, -meia);
  f.lineTo(W - rc, -meia);
  f.absarc(W - rc, -meia + rc, rc, -Math.PI / 2, 0, false);
  if (temDir) faceComAlivio(f, W, meia - rc, W + dp, rAlivio, true);
  else f.lineTo(W, meia - rc);
  f.absarc(W - rc, meia - rc, rc, 0, Math.PI / 2, false);
  f.lineTo(rc, meia);
  f.absarc(rc, meia - rc, rc, Math.PI / 2, Math.PI, false);
  if (temEsq) faceComAlivio(f, 0, -meia + rc, -dp, rAlivio, false);
  else f.lineTo(0, -meia + rc);
  f.absarc(rc, -meia + rc, rc, Math.PI, Math.PI * 1.5, false);
  return f;
}

// Um nó: barra saindo do corpo do cubo e terminando em disco no eixo do pino.
// `paraDireita` diz de que lado sai; `furo` fura o disco (o nó de cima recebe o
// pino que nasce do nó de baixo do vizinho).
function perfilNo(op) {
  const { W, dp, rDisco, rFuro, paraDireita, comFuro } = op;
  const xPino = paraDireita ? W + dp : -dp;
  const xRaiz = paraDireita ? W - RECUO_NO : RECUO_NO;
  const f = new THREE.Shape();
  f.moveTo(xRaiz, -rDisco);
  f.lineTo(xPino, -rDisco);
  f.absarc(xPino, 0, rDisco, -Math.PI / 2, Math.PI / 2, !paraDireita);
  f.lineTo(xRaiz, rDisco);
  f.lineTo(xRaiz, -rDisco);
  if (comFuro) {
    const h = new THREE.Path();
    h.absarc(xPino, 0, rFuro, 0, Math.PI * 2, true);
    f.holes.push(h);
  }
  return f;
}

function orelhaDaArgola(raioFuro, paredeFuro) {
  const rt = raioFuro + paredeFuro;
  const cx = -rt;
  const f = new THREE.Shape();
  f.moveTo(2, -rt);
  f.lineTo(cx, -rt);
  f.absarc(cx, 0, rt, -Math.PI / 2, Math.PI / 2, true);
  f.lineTo(2, rt);
  f.lineTo(2, -rt);
  const furo = new THREE.Path();
  furo.absarc(cx, 0, raioFuro, 0, Math.PI * 2, true);
  f.holes.push(furo);
  return { forma: f, furo: { x: cx, y: 0, raio: raioFuro }, largura: rt * 2 };
}

// Etiqueta a peça, para o teste poder falar de "nó de baixo do bloco 2" em vez
// de adivinhar pelo tamanho da caixa.
function marcar(geo, papel, bloco) {
  geo.userData.marca = { papel, bloco };
  return geo;
}

function extrudar(formas, z0, altura, curvas) {
  const g = new THREE.ExtrudeGeometry(formas, {
    depth: altura, bevelEnabled: false, curveSegments: curvas,
  });
  g.translate(0, 0, z0);
  return g;
}

function montarArticulado(op) {
  const {
    fonte, nomeUsado, tamanho, espaco, proporcao, curvasLetra,
    comFuro, raioFuro, paredeFuro, alturaLetra, banda,
    diametroPino, folga, giroGraus,
  } = op;

  const letras = Array.from(nomeUsado).filter((c) => c !== ' ');
  if (!letras.length) return null;

  // ---- tamanho do cubo, a partir da letra ----
  const alturaBanda = banda.altura * tamanho;
  const porLetra = letras.map((ch) =>
    poligonosDoTexto(fonte, ch, tamanho, espaco, proporcao, curvasLetra));
  let larguraMax = 0;
  for (const aneis of porLetra) {
    const c = caixaDosAneis(aneis);
    if (c.largura > larguraMax) larguraMax = c.largura;
  }
  const W = Math.max(alturaBanda, larguraMax) + MARGEM_BLOCO * 2;
  const T = W;                                   // cubo: altura igual ao lado
  const rc = Math.min(1.0, W * 0.06);

  // ---- dobradiça ----
  const rPino = diametroPino / 2;
  const rFuro = rPino + folga;
  const rDisco = rFuro + PAREDE_PINO;
  const rAlivio = rDisco + FOLGA_ALIVIO;
  const giro = (giroGraus * Math.PI) / 180;
  const dp = (W / 2) * Math.tan(giro / 2);       // é isto que fixa o batente
  const zBaixo = (T - folga) / 2;                // topo do nó de baixo
  const zCima = (T + folga) / 2;                 // base do nó de cima

  const passo = W + dp * 2;
  const grupo = new THREE.Group();
  const base = [];
  const letra = [];
  let furo = null;
  let larguraOrelha = 0;

  for (let i = 0; i < letras.length; i++) {
    const x0 = i * passo;
    const temEsq = i > 0;                        // nó de cima, saindo pela esquerda
    const temDir = i < letras.length - 1;        // nó de baixo, saindo pela direita
    const partes = [];

    const formasCubo = [perfilCubo({ W, rc, dp, rAlivio, temEsq, temDir })];
    if (i === 0 && comFuro) {
      const o = orelhaDaArgola(raioFuro, paredeFuro);
      formasCubo.push(o.forma);
      furo = { x: o.furo.x + x0, y: 0, raio: raioFuro };
      larguraOrelha = o.largura;
    }
    partes.push(marcar(extrudar(formasCubo, 0, T, 20), 'cubo', i));

    // nó de baixo (metade inferior) saindo pela direita, e o pino nele
    if (temDir) {
      partes.push(marcar(extrudar([perfilNo({ W, dp, rDisco, rFuro, paraDireita: true, comFuro: false })],
        0, zBaixo, 28), 'noBaixo', i));
      const p = new THREE.CylinderGeometry(rPino, rPino, T, 28);
      p.rotateX(Math.PI / 2);
      p.translate(W + dp, 0, T / 2);
      partes.push(marcar(p, 'pino', i));
    }

    // nó de cima (metade superior) saindo pela esquerda, furado para o pino
    if (temEsq) {
      partes.push(marcar(extrudar([perfilNo({ W, dp, rDisco, rFuro, paraDireita: false, comFuro: true })],
        zCima, T - zCima, 28), 'noCima', i));
    }

    for (const g of partes) { g.translate(x0, 0, 0); base.push(g); }

    // letra na face de cima
    const caixa = caixaDosAneis(porLetra[i]);
    const dxL = x0 + (W - caixa.largura) / 2 - caixa.x0;
    const dyL = -alturaBanda / 2 - banda.baixo * tamanho;
    const formasLetra = aneisParaShapes(limparAneis(moverAneis(porLetra[i], dxL, dyL), 0.004, 0.004));
    if (formasLetra.length) {
      const gl = new THREE.ExtrudeGeometry(formasLetra, {
        depth: alturaLetra + AFUNDAR, bevelEnabled: false, curveSegments: 1,
      });
      gl.translate(0, 0, T - AFUNDAR);
      letra.push(gl);
    }
  }

  const xMin = -larguraOrelha;
  const xMax = (letras.length - 1) * passo + W;
  const largura = xMax - xMin;
  const desloca = -(xMin + xMax) / 2;

  for (const g of base) {
    g.translate(desloca, 0, 0);
    const m = new THREE.Mesh(g, [materiais.baseTopo, materiais.baseLado]);
    m.userData = g.userData.marca || {};
    grupo.add(m);
  }
  for (const g of letra) {
    g.translate(desloca, 0, 0);
    grupo.add(new THREE.Mesh(g, [materiais.letraTopo, materiais.letraLado]));
  }

  return {
    grupo,
    largura,
    altura: W,
    alturaTotal: T + alturaLetra,
    blocos: letras.length,
    furo: furo ? { x: furo.x + desloca, y: furo.y, raio: furo.raio } : null,
    articulacao: {
      W, T, dp, rPino, rFuro, rDisco, rAlivio,
      folga, giroGraus, passo, zBaixo, zCima,
      vaoEntreBlocos: dp * 2,
    },
  };
}

export function montarChaveiro(opcoes) {
  const {
    nome = '', estilo = 'retangulo', fonte,
    tamanhoLetra = TAMANHOS.M,
    espaco = 0, proporcao = 1,
    espessuraBase = 3, alturaLetra = 1,
    comFuro = true, diametroFuro = 5,
    paredeFuro = PAREDE_FURO,
    furoNaDireita = false,
    furoRecuo = 0,
    borda = 2.5,
    espessuraTraco = 0,
    folgaArticulacao = 0.2,
    giroArticulacao = 30,
  } = opcoes;

  const avisos = [];
  const { nome: nomeUsado, removeu } = filtrarNome(fonte, nome);
  if (removeu) avisos.push('Alguns símbolos não dão para escrever e foram tirados.');

  const raioFuro = Math.max(1, diametroFuro / 2);
  const minimoFonte = tamanhoMinimoDaFonte(fonte);
  let tamanho = Math.max(tamanhoLetra, minimoFonte);
  if (tamanhoLetra < minimoFonte - 0.05) {
    avisos.push('Esta letra não fica menor que ' + minimoFonte.toString().replace('.', ',') + ' mm, senão o traço não sai na impressão.');
  }

  const banda = bandaDaFonte(fonte);
  // Divisoes por curva do glifo. Com poucas divisoes a curva da letra vira um
  // poligono visivel de perto; escala com o tamanho para o lado de cada faceta
  // ficar sempre bem abaixo de meio milimetro.
  const curvasLetra = Math.max(10, Math.min(24, Math.round(tamanho * 1.15)));
  let aneisTexto0 = poligonosDoTexto(fonte, nomeUsado, tamanho, espaco, proporcao, curvasLetra);

  // Engrossar ou afinar o traco. Afinar tem limite: o traco nunca pode ficar
  // abaixo de 1,2 mm, senao nao imprime. Como o afinamento come dos dois lados,
  // o quanto disponivel e metade da sobra que a fonte tem acima desse minimo.
  let traco = espessuraTraco;
  if (traco < 0) {
    const hasteMM = (fonte.data.haste_em || 0.15) * tamanho;
    const limite = -Math.max(0, (hasteMM - 1.2) / 2);
    if (traco < limite) {
      traco = limite;
      avisos.push('Nesta letra o traço não pode afinar mais sem ficar fino demais para imprimir.');
    }
  }
  if (Math.abs(traco) >= 0.005) aneisTexto0 = engrossarAneis(aneisTexto0, traco);
  const temTexto = aneisTexto0.length > 0;

  const grupo = new THREE.Group();
  if (!temTexto) {
    return {
      grupo, largura: 0, altura: 0, avisos, temTexto: false, nomeUsado,
      pedacos: 0, tamanhoLetra: tamanho,
    };
  }

  const caixa = caixaDosAneis(aneisTexto0);
  const alturaBanda = banda.altura * tamanho;

  const comum = {
    aneisTexto: aneisTexto0, caixa, estilo, espessuraBase, alturaLetra,
    comFuro, raioFuro, paredeFuro, furoNaDireita, furoRecuo, borda, tamanho,
    alturaBanda, bandaBaixo: banda.baixo * tamanho,
  };

  if (estilo === 'articulado') {
    const art = montarArticulado({
      fonte, nomeUsado, tamanho, espaco, proporcao, curvasLetra,
      comFuro, raioFuro, paredeFuro, alturaLetra, banda,
      diametroPino: 2, folga: folgaArticulacao, giroGraus: giroArticulacao,
    });
    if (!art) {
      return {
        grupo, largura: 0, altura: 0, avisos, temTexto: false, nomeUsado,
        pedacos: 0, tamanhoLetra: tamanho,
      };
    }
    if (art.largura > AVISO_TAMANHO) {
      avisos.push('Esse chaveiro ficou bem grande. Se puder, use um nome menor ou uma letra menor.');
    }
    return {
      grupo: art.grupo,
      largura: art.largura,
      altura: art.altura,
      alturaTotal: art.alturaTotal,
      avisos,
      temTexto: true,
      nomeUsado,
      pedacos: 1,
      blocos: art.blocos,
      articulacao: art.articulacao,
      tamanhoLetra: tamanho,
      furo: art.furo,
    };
  }

  let r;
  if (estilo === 'sombra' || estilo === 'letras') {
    r = montarNaGrade(comum);
  } else {
    r = montarComPlaca(comum);
  }

  if (r.pedacos > 1) {
    avisos.push('A peça ainda ficou em pedaços soltos. Diminua o espaço entre as letras.');
  } else if (r.pontes > 0) {
    avisos.push(r.pontes === 1
      ? 'Liguei uma parte solta com uma pontinha, para sair tudo em uma peça só.'
      : 'Liguei ' + r.pontes + ' partes soltas com pontinhas, para sair tudo em uma peça só.');
    // Muitas pontes deixam a peca com cara de remendada. Nesse caso engrossar o
    // traco costuma juntar as letras sozinho, sem ponte nenhuma.
    if (r.pontes >= 5) {
      avisos.push('Ficaram muitas pontinhas. Aumente a Espessura do traço para as letras se juntarem sozinhas.');
    }
  }
  if (r.bordaUsada > borda + 0.01) {
    avisos.push('Aumentei um pouco a borda para a peça não ficar partida.');
  }
  if (r.largura > AVISO_TAMANHO || r.altura > AVISO_TAMANHO) {
    avisos.push('Esse chaveiro ficou bem grande. Se puder, use um nome menor ou uma letra menor.');
  }

  // ---- base ----
  const dx = r.deslocamento ? r.deslocamento.x : 0;
  const dy = r.deslocamento ? r.deslocamento.y : 0;
  const alturaBase = r.textoEmRelevo ? espessuraBase : espessuraBase + alturaLetra;

  const geoBase = new THREE.ExtrudeGeometry(r.formasBase, {
    depth: alturaBase, bevelEnabled: false, curveSegments: r.curvasBase,
  });
  geoBase.translate(dx - r.largura / 2, dy - r.altura / 2, 0);
  grupo.add(new THREE.Mesh(geoBase, [materiais.baseTopo, materiais.baseLado]));

  // ---- texto em relevo (nos estilos que têm placa por baixo) ----
  if (r.textoEmRelevo) {
    // o contorno vindo da fonte pode trazer pontos repetidos, que virariam
    // triangulos sem area na hora de extrudar
    const formasTexto = aneisParaShapes(limparAneis(r.aneisTexto, 0.004, 0.004));
    if (formasTexto.length) {
      const geoTexto = new THREE.ExtrudeGeometry(formasTexto, {
        depth: alturaLetra + AFUNDAR, bevelEnabled: false, curveSegments: 1,
      });
      geoTexto.translate(dx - r.largura / 2, dy - r.altura / 2, espessuraBase - AFUNDAR);
      grupo.add(new THREE.Mesh(geoTexto, [materiais.letraTopo, materiais.letraLado]));
    }
  }

  const alturaTotal = r.textoEmRelevo ? espessuraBase + alturaLetra : alturaBase;
  grupo.userData = { largura: r.largura, altura: r.altura, alturaTotal };

  return {
    grupo,
    largura: r.largura,
    altura: r.altura,
    alturaTotal,
    avisos,
    temTexto: true,
    nomeUsado,
    pedacos: r.pedacos,
    blocos: r.blocos || 0,
    formasBase: r.formasBase,
    tamanhoLetra: tamanho,
    furo: r.furo ? { x: r.furo.x + dx - r.largura / 2, y: r.furo.y + dy - r.altura / 2, raio: r.furo.raio } : null,
  };
}

// ---------- exportação ----------
export function exportarSTL(grupo) {
  let triangulos = 0;
  grupo.updateMatrixWorld(true);
  grupo.traverse((obj) => {
    if (obj.isMesh && obj.geometry && obj.geometry.getAttribute('position')) {
      triangulos += obj.geometry.getAttribute('position').count / 3;
    }
  });
  if (triangulos < 4) return null;
  const dados = exportador.parse(grupo, { binary: true });
  if (!dados || dados.byteLength <= 84) return null;
  return dados;
}

export function nomeDoArquivo(nome) {
  const slug = String(nome)
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `chaveiro-${slug || 'sem-nome'}.stl`;
}

export function descartarGrupo(grupo) {
  grupo.traverse((obj) => { if (obj.isMesh) obj.geometry.dispose(); });
}
