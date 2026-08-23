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
    comFuro, raioFuro, paredeFuro, furoNaDireita, furoRecuo, furoX, furoY, largurasPersonalizadas,
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
  const avisosFuro = [];
  if (comFuro) {
    const alvo = raioFuro + paredeFuro;
    // posição de partida: a ponta escolhida, com o recuo…
    const p = furoNaDireita
      ? { x: larguraPlaca - alvo - furoRecuo, y: alturaPlaca / 2 }
      : { x: alvo + furoRecuo, y: alturaPlaca / 2 };
    // …mais o deslocamento livre pedido (X e Y a partir desse ponto)
    p.x += furoX;
    p.y += furoY;
    // se ficou perto demais da borda, caminha de volta para o centro da placa
    // até a parede pedida caber
    const centro = { x: larguraPlaca / 2, y: alturaPlaca / 2 };
    const cabe = (q) => dentroDoPoligono(q, poly) && distanciaAoContorno(q, poly) >= alvo - 0.02;
    let moveu = false;
    for (let k = 0; k < 400 && !cabe(p); k++) {
      const dx = centro.x - p.x, dy = centro.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      p.x += (dx / d) * 0.15;
      p.y += (dy / d) * 0.15;
      moveu = true;
    }
    if (!cabe(p)) {
      avisosFuro.push('O furo da argola não coube com essa parede. Ficou sem furo — diminua o furo ou a borda em volta dele.');
    } else {
      if (moveu && (Math.abs(furoX) > 0.01 || Math.abs(furoY) > 0.01)) {
        avisosFuro.push('Empurrei o furo da argola para dentro, para manter a borda em volta dele.');
      }
      furo = { x: p.x, y: p.y, raio: raioFuro };
      const caminho = new THREE.Path();
      caminho.absarc(furo.x, furo.y, raioFuro, 0, Math.PI * 2, true);
      forma.holes.push(caminho);
    }
  }

  const dxTexto = inicioTexto - caixa.x0;
  const dyTexto = (alturaPlaca - op.alturaBanda) / 2 - op.bandaBaixo;
  const aneisMovidos = moverAneis(aneisTexto, dxTexto, dyTexto);

  // furo embaixo do texto: a letra em relevo taparia a entrada dele
  if (furo) {
    let tapado = false;
    for (const anel of aneisMovidos) {
      if (anel.contorno.some((q) => Math.hypot(q[0] - furo.x, q[1] - furo.y) < raioFuro + 0.6)) {
        tapado = true; break;
      }
    }
    if (tapado) avisosFuro.push('O furo da argola ficou embaixo do texto. O texto vai tapar o furo por cima — mova o furo com os ajustes.');
  }

  return {
    formasBase: [forma],
    aneisTexto: aneisMovidos,
    largura: larguraPlaca,
    altura: alturaPlaca,
    furo,
    avisosFuro,
    pedacos: 1,
    textoEmRelevo: true,
    curvasBase: 24,
  };
}

// ---------- estilos desenhados na grade (sombra e só letras) ----------
function montarNaGrade(op) {
  const {
    aneisTexto, caixa, estilo, comFuro, raioFuro, paredeFuro, furoNaDireita, furoX, furoY, borda, tamanho,
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

  // Argola: um anel encostado por FORA da silhueta, deslizando por ela.
  //
  // A regra dura é que o FURO nunca entra na tinta — em letra cursiva o método
  // antigo (direção a partir do centro da peça) errava a normal em qualquer
  // reentrância e o anel afundava no traço. Agora:
  //   1. os candidatos são os pontos da BORDA da tinta, do mais perto ao mais
  //      longe do lugar pedido;
  //   2. a direção de saída é a normal local de verdade, lida do gradiente do
  //      campo de distância;
  //   3. o anel morde a peça só o suficiente para soldar, e o candidato é
  //      DESCARTADO se sobrar tinta dentro do furo ou coladinha nele.
  // O primeiro candidato limpo ganha. Furo dentro da peça não existe mais.
  let furo = null;
  const avisosFuro = [];
  if (comFuro) {
    const { larg, alt, celula, x0, y0 } = grade;
    const sdfPeca = campoDistancia(mapa, grade);
    const alvoX = (Math.abs(furoX) > 0.01 || Math.abs(furoY) > 0.01)
      ? caixa.x0 + caixa.largura / 2 + furoX
      : (furoNaDireita ? caixa.x0 + caixa.largura + 60 : caixa.x0 - 60);
    const alvoY = (Math.abs(furoX) > 0.01 || Math.abs(furoY) > 0.01)
      ? caixa.y0 + caixa.altura / 2 + furoY
      : caixa.y0 + caixa.altura / 2;

    // pontos de borda (tinta com vizinho vazio), do mais perto do alvo em diante
    const borda = [];
    for (let j = 1; j < alt - 1; j += 2) {
      for (let i = 1; i < larg - 1; i += 2) {
        const k = j * larg + i;
        if (!mapa[k]) continue;
        if (mapa[k - 1] && mapa[k + 1] && mapa[k - larg] && mapa[k + larg]) continue;
        const wx = x0 + (i + 0.5) * celula;
        const wy = y0 + (j + 0.5) * celula;
        borda.push([Math.hypot(wx - alvoX, wy - alvoY), wx, wy, i, j]);
      }
    }
    borda.sort((a, b) => a[0] - b[0]);

    const mordidaAnel = Math.min(raioAnel * 0.5, raioAnel - raioFuro - 0.5);
    const temTintaPerto = (cx, cy, r) => {
      const i0 = Math.max(0, Math.floor((cx - r - x0) / celula));
      const i1 = Math.min(larg - 1, Math.ceil((cx + r - x0) / celula));
      const j0 = Math.max(0, Math.floor((cy - r - y0) / celula));
      const j1 = Math.min(alt - 1, Math.ceil((cy + r - y0) / celula));
      const r2 = r * r;
      for (let j = j0; j <= j1; j++) {
        const wy = y0 + (j + 0.5) * celula;
        for (let i = i0; i <= i1; i++) {
          if (!mapa[j * larg + i]) continue;
          const wx = x0 + (i + 0.5) * celula;
          if ((wx - cx) * (wx - cx) + (wy - cy) * (wy - cy) <= r2) return true;
        }
      }
      return false;
    };
    const lerSdf = (i, j) => sdfPeca[Math.max(0, Math.min(alt - 1, j)) * larg + Math.max(0, Math.min(larg - 1, i))];

    let escolhido = null;
    const olhar = Math.min(borda.length, 6000);
    for (let n = 0; n < olhar && !escolhido; n++) {
      const [, wx, wy, i, j] = borda[n];
      // normal local para fora, pelo gradiente do campo de distância
      let gx = lerSdf(i + 2, j) - lerSdf(i - 2, j);
      let gy = lerSdf(i, j + 2) - lerSdf(i, j - 2);
      const g = Math.hypot(gx, gy);
      if (g < 1e-6) continue;
      gx /= g; gy /= g;
      const cx = wx + gx * (raioAnel - mordidaAnel);
      const cy = wy + gy * (raioAnel - mordidaAnel);
      // o furo tem de sair limpo: nada de tinta dentro dele nem raspando
      if (temTintaPerto(cx, cy, raioFuro + 0.35)) continue;
      escolhido = { cx, cy, dist: borda[n][0] };
    }

    if (escolhido) {
      pintarDisco(mapa, grade, escolhido.cx, escolhido.cy, raioAnel, 1);
      pintarDisco(mapa, grade, escolhido.cx, escolhido.cy, raioFuro, 0);
      furo = { x: escolhido.cx, y: escolhido.cy, raio: raioFuro };
      if ((Math.abs(furoX) > 0.01 || Math.abs(furoY) > 0.01) && escolhido.dist > raioAnel * 3) {
        avisosFuro.push('Encostei a argola no ponto limpo da peça mais perto de onde você pediu.');
      }
    } else if (borda.length) {
      avisosFuro.push('Não achei lugar para a argola sem furar as letras. Ficou sem furo — diminua o furo da argola.');
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
    avisosFuro,
    textoEmRelevo: ehSombra,
    curvasBase: 1,
  };
}

// ---------- correntinha articulada ----------
//
// Tudo aqui escala a partir do TAMANHO DO BLOCO (o lado da face da letra, em
// mm): letra, pino, braços, paredes. Só duas coisas são absolutas e nunca
// escalam: as FOLGAS (que dependem do bico da impressora, não da peça) e o furo
// da argola.
//
// A peça imprime deitada, letra para cima, sem suporte nenhum: o eixo do pino
// fica BAIXO (z = raio do braço), então braço e pescoço apoiam a barriga
// inteira na mesa e as pontas redondas sobem da mesa em tangente, sem degrau.
// O pino é a única coisa no ar: cada ponta dele atravessa o furo em balanço de
// ~2 mm — o mesmo das correntinhas impressas de fábrica, curto demais para cair.

const ESCALA_REF = 15;          // as proporções abaixo valem para bloco de 15 mm
const MARGEM_BLOCO = 2.0;       // letra até a borda do bloco (escala)
const PAREDE_FURO_PINO = 1.3;   // material entre o furo e a beirada do braço (escala)
const RECUO_BRACO = 2.0;        // o quanto o braço entra no corpo do bloco (escala)
const RECUO_PESCOCO = 1.6;      // o quanto o pescoço entra no corpo do bloco (escala)
const PAREDE_ACIMA = 1.6;       // material acima da dobradiça (escala)
const DIAMETRO_PINO = 2.4;      // pino padrão (escala)
const LARGURA_PESCOCO = 3.6;    // pescoço padrão (escala)
const ESPESSURA_BRACO = 1.8;    // cada braço do garfo (escala)
const CHANFRO_BASE = 0.4;       // chanfro 45° na aresta inferior (absoluto)
const PAREDE_FURO_ARGOLA = 1.5; // parede mínima em volta do furo da argola (absoluto)

// Em que ângulo dois blocos vizinhos se tocam, girando um em torno do pino.
//
// O contorno usado é o de LADO (plano XZ), e de lado o bloco é um retângulo de
// cantos vivos: o arredondamento das bordas acontece em planta (extrusão em Z),
// não neste plano. Medir com canto arredondado aqui prometia um giro que a peça
// real, de canto reto, não entrega. Só o chanfro da base entra no contorno.
//
// O eixo fica BAIXO (zEixo, não no meio da espessura), então dobrar para um
// lado encosta antes de dobrar para o outro; o batente que vale é o PIOR dos
// dois sentidos, porque o giro prometido é "para cada lado".
function batenteMedido(comp, alt, dp, zEixo, passoGrau = 0.25) {
  const base = [
    [0, CHANFRO_BASE - zEixo], [CHANFRO_BASE, -zEixo],
    [comp - CHANFRO_BASE, -zEixo], [comp, CHANFRO_BASE - zEixo],
    [comp, alt - zEixo], [0, alt - zEixo],
  ];
  const esquerda = base.map((p) => [p[0] - comp - dp, p[1]]);
  const direita = base.map((p) => [p[0] + dp, p[1]]);
  const dentro = (p, poly) => {
    let d = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) &&
          p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) d = !d;
    }
    return d;
  };
  const toca = (g) => {
    const a = (g * Math.PI) / 180;
    const c = Math.cos(a), sn = Math.sin(a);
    const movido = direita.map((p) => [p[0] * c - p[1] * sn, p[0] * sn + p[1] * c]);
    return movido.some((p) => dentro(p, esquerda)) || esquerda.some((p) => dentro(p, movido));
  };
  for (let g = passoGrau; g <= 90; g += passoGrau) {
    if (toca(g) || toca(-g)) return g;
  }
  return 90;
}

function acharVao(comp, alt, zEixo, giroGraus) {
  let lo = 0.05, hi = alt * Math.tan((giroGraus * Math.PI) / 360) + 0.8;
  for (let i = 0; i < 26; i++) {
    const meio = (lo + hi) / 2;
    if (batenteMedido(comp, alt, meio, zEixo) < giroGraus) lo = meio; else hi = meio;
  }
  return hi;
}

// Corpo do bloco em planta. Na face esquerda, as duas MORDIDAS por onde entram
// os braços do vizinho. Na face direita, a BOCA central por onde entra o
// pescoço do vizinho — sem ela o pescoço ficava ENTERRADO no corpo e a corrente
// saía da impressora fundida num bloco só.
function perfilCorpo(op) {
  const {
    W, rc, mordidaFundo, mordidaDe, mordidaAte, comMordida,
    bocaFundo, bocaMeia, bocaAsa, asaFundo, comBoca,
  } = op;
  const meia = W / 2;
  const r = Math.min(rc, W / 2 - 0.01);
  const f = new THREE.Shape();
  f.moveTo(r, -meia);
  f.lineTo(W - r, -meia);
  f.absarc(W - r, -meia + r, r, -Math.PI / 2, 0, false);
  if (comBoca && bocaFundo > 0.01) {
    // A boca é um recorte em degrau: fundo no meio (por onde entra o pescoço) e
    // duas ASAS rasas na faixa dos braços. As asas existem porque o pino é mais
    // gordo que o vão: a ponta dele invade a face do vizinho, e sem esse alívio
    // o corpo fecharia o final do furo do braço — foi exatamente onde a peça
    // impressa saiu soldada.
    if (asaFundo > 0.01) {
      f.lineTo(W, -bocaAsa);
      f.lineTo(W - asaFundo, -bocaAsa);
      f.lineTo(W - asaFundo, -bocaMeia);
    } else {
      f.lineTo(W, -bocaMeia);
    }
    f.lineTo(W - bocaFundo, -bocaMeia);
    f.lineTo(W - bocaFundo, bocaMeia);
    if (asaFundo > 0.01) {
      f.lineTo(W - asaFundo, bocaMeia);
      f.lineTo(W - asaFundo, bocaAsa);
      f.lineTo(W, bocaAsa);
    } else {
      f.lineTo(W, bocaMeia);
    }
  }
  f.lineTo(W, meia - r);
  f.absarc(W - r, meia - r, r, 0, Math.PI / 2, false);
  f.lineTo(r, meia);
  f.absarc(r, meia - r, r, Math.PI / 2, Math.PI, false);
  if (comMordida && mordidaFundo > 0.01) {
    f.lineTo(0, mordidaAte);
    f.lineTo(mordidaFundo, mordidaAte);
    f.lineTo(mordidaFundo, mordidaDe);
    f.lineTo(0, mordidaDe);
    f.lineTo(0, -mordidaDe);
    f.lineTo(mordidaFundo, -mordidaDe);
    f.lineTo(mordidaFundo, -mordidaAte);
    f.lineTo(0, -mordidaAte);
  }
  f.lineTo(0, -meia + r);
  f.absarc(r, -meia + r, r, Math.PI, Math.PI * 1.5, false);
  return f;
}

// Perfil visto DE LADO (plano XZ) de uma peça que termina em semicírculo com o
// centro no eixo do pino. Serve para o braço do encaixe e para o pescoço.
//
// xDegrau: até onde o fundo fica ERGUIDO 0,03 mm. O trecho de raiz fica
// enterrado no corpo do bloco, e se o fundo dele ficasse no mesmo plano z=0 do
// fundo do bloco, as duas faces coincidentes brigariam na tela e no STL. O
// degrau acaba 0,02 mm depois da face do bloco, já no vão, onde 0,03 mm no ar
// não significam nada.
function perfilDeLado(xRaiz, xPino, raio, rFuro, xDegrau) {
  // atenção ao espelho: o rotateX(-90°) manda o y do perfil para -z do mundo,
  // então a borda +raio do perfil é o FUNDO da peça no mundo
  const paraDireita = xPino > xRaiz;
  const f = new THREE.Shape();
  f.moveTo(xRaiz, -raio);
  f.lineTo(xPino, -raio);
  f.absarc(xPino, 0, raio, -Math.PI / 2, Math.PI / 2, !paraDireita);
  if (xDegrau !== undefined) {
    f.lineTo(xDegrau, raio);
    f.lineTo(xDegrau, raio - 0.03);
    f.lineTo(xRaiz, raio - 0.03);
  } else {
    f.lineTo(xRaiz, raio);
  }
  f.lineTo(xRaiz, -raio);
  if (rFuro > 0) {
    const h = new THREE.Path();
    h.absarc(xPino, 0, rFuro, 0, Math.PI * 2, true);
    f.holes.push(h);
  }
  return f;
}

// Extruda um perfil desenhado no plano XZ ao longo de Y.
function extrudarEmY(forma, y0, espessura, z, curvas) {
  const g = new THREE.ExtrudeGeometry([forma], {
    depth: espessura, bevelEnabled: false, curveSegments: curvas,
  });
  // rotateX(-90°) manda (x,y,z) para (x,z,-y): a extrusão passa a crescer em +Y
  // e o perfil fica de pé no plano XZ.
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, z);
  return g;
}

// Chanfro de 45° na aresta inferior do bloco, contra pé de elefante.
//
// O bevel do ExtrudeGeometry desloca cada vértice sem olhar os vizinhos e se
// autocruza nos cantos côncavos das mordidas, deixando a malha furada. Então o
// chanfro é construído à mão: o anel de baixo é o contorno deslocado para
// DENTRO do material, o de cima é o contorno original a 0,4 mm de altura, e as
// duas tampas fecham o sólido. O corpo começa 0,02 mm antes do topo do chanfro
// de propósito: paredes exatamente coincidentes viram arestas contadas quatro
// vezes no STL.
function deslocarAnel(pontos, d) {
  const n = pontos.length;
  const saida = [];
  for (let i = 0; i < n; i++) {
    const a = pontos[(i - 1 + n) % n], p = pontos[i], b = pontos[(i + 1) % n];
    const d1x = p.x - a.x, d1y = p.y - a.y, c1 = Math.hypot(d1x, d1y) || 1;
    const d2x = b.x - p.x, d2y = b.y - p.y, c2 = Math.hypot(d2x, d2y) || 1;
    // normal à esquerda de cada aresta; o material fica à esquerda do percurso
    const l1x = -d1y / c1, l1y = d1x / c1;
    const l2x = -d2y / c2, l2y = d2x / c2;
    let mx = l1x + l2x, my = l1y + l2y;
    const cm = Math.hypot(mx, my);
    if (cm < 0.01) { mx = l2x; my = l2y; } else { mx /= cm; my /= cm; }
    const meioCos = Math.max(0.4, Math.sqrt(Math.max(0, (1 + (l1x * l2x + l1y * l2y)) / 2)));
    const s = Math.min(d / meioCos, d * 2.5);
    saida.push(new THREE.Vector2(p.x + mx * s, p.y + my * s));
  }
  return saida;
}

function chanfroDaBase(forma, curvas) {
  const ex = forma.extractPoints(curvas);
  const limpar = (l) => {
    const p = [];
    for (const v of l) {
      if (!p.length || p[p.length - 1].distanceTo(v) > 0.02) p.push(v);
    }
    while (p.length > 1 && p[0].distanceTo(p[p.length - 1]) < 0.02) p.pop();
    return p;
  };
  const contorno = limpar(ex.shape);
  const furos = ex.holes.map(limpar);
  const baixoC = deslocarAnel(contorno, CHANFRO_BASE);
  const baixoF = furos.map((f) => deslocarAnel(f, CHANFRO_BASE));

  const pos = [];
  const tri = (p1, p2, p3) => { pos.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]); };
  const parede = (base, topo) => {
    const n = base.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const b0 = [base[i].x, base[i].y, 0], b1 = [base[j].x, base[j].y, 0];
      const t0 = [topo[i].x, topo[i].y, CHANFRO_BASE], t1 = [topo[j].x, topo[j].y, CHANFRO_BASE];
      tri(b0, b1, t1); tri(b0, t1, t0);
    }
  };
  parede(baixoC, contorno);
  for (let k = 0; k < furos.length; k++) parede(baixoF[k], furos[k]);

  // As duas tampas usam a MESMA triangulação, feita sobre o contorno original:
  // o anel de baixo é só o de cima deslocado, então cada aresta da tampa de
  // baixo bate exatamente com as arestas das paredes — casamento garantido por
  // construção, sem depender do triangulador tratar pontos quase iguais.
  const ts = THREE.ShapeUtils.triangulateShape(contorno, furos);
  const cima = contorno.concat(...furos);
  const baixo = baixoC.concat(...baixoF);
  for (const t of ts) {
    tri([baixo[t[2]].x, baixo[t[2]].y, 0], [baixo[t[1]].x, baixo[t[1]].y, 0], [baixo[t[0]].x, baixo[t[0]].y, 0]);
    tri([cima[t[0]].x, cima[t[0]].y, CHANFRO_BASE], [cima[t[1]].x, cima[t[1]].y, CHANFRO_BASE], [cima[t[2]].x, cima[t[2]].y, CHANFRO_BASE]);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.addGroup(0, pos.length / 3, 1);
  return g;
}

function marcar(geo, papel, bloco) {
  geo.userData.marca = { papel, bloco };
  return geo;
}

// Box e Cylinder vêm com um grupo de material por face; nossos meshes só têm
// dois materiais (tampa e lado). Reduz tudo a um grupo só, na cor do lado.
function umMaterial(geo) {
  geo.clearGroups();
  geo.addGroup(0, geo.index ? geo.index.count : Infinity, 1);
  return geo;
}

// Acha um lugar válido para o furo da argola dentro do bloco: parede mínima de
// 1,5 mm até a borda e até qualquer parte da junta. Se o ponto pedido não
// serve, procura o ponto válido mais perto dele, em anéis; devolve null se o
// furo simplesmente não cabe.
function acomodarFuro(pedido, raio, contorno, zonas) {
  const cabe = (p) => {
    if (distanciaAoContorno(p, contorno) < raio + PAREDE_FURO_ARGOLA - 0.01) return false;
    if (!dentroDoPoligono(p, contorno)) return false;
    for (const z of zonas) {
      const dx = Math.max(z.x0 - p.x, 0, p.x - z.x1);
      const dy = Math.max(z.y0 - p.y, 0, p.y - z.y1);
      if (Math.hypot(dx, dy) < raio + PAREDE_FURO_ARGOLA - 0.01) return false;
    }
    return true;
  };
  if (cabe(pedido)) return { ...pedido, moveu: false };
  for (let anel = 0.5; anel <= 30; anel += 0.5) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const p = { x: pedido.x + anel * Math.cos(a), y: pedido.y + anel * Math.sin(a) };
      if (cabe(p)) return { ...p, moveu: true };
    }
  }
  return null;
}

function montarArticulado(op) {
  const {
    fonte, nomeUsado, espaco, proporcao, curvasLetra, alturaLetra, minimoFonte,
    tamanhoBloco, espessuraBloco, folgaRadial, folgaVertical, giroGraus, arredondamentoPct,
    escalaLetra, comFuro, argolaExterna, furoBloco, furoX, furoY, raioFuroArgola,
  } = op;

  const letras = Array.from(nomeUsado).filter((c) => c !== ' ');
  if (!letras.length) return null;
  const avisos = [];

  // ---- letra derivada do bloco ----
  // O bloco manda: a letra ocupa a fração pedida dele (Tamanho da letra).
  //
  // A fração é medida contra a TINTA de verdade do nome, não contra a banda
  // tipográfica: a banda reserva espaço para ascendente e descendente mesmo
  // quando o nome é todo em maiúsculas, e era isso que deixava as letras
  // miúdas no bloco. Um nome sem descendente agora usa esse espaço.
  //
  // Se a letra pedida ficar abaixo do mínimo imprimível da fonte, a letra fica
  // no mínimo e o BLOCO cresce — melhor bloco maior que traço que não sai.
  const REF = 10;
  const medidas = letras.map((ch) =>
    caixaDosAneis(poligonosDoTexto(fonte, ch, REF, espaco, proporcao, curvasLetra)));
  let tintaY0 = Infinity, tintaY1 = -Infinity, kLargura = 0;
  for (const c of medidas) {
    tintaY0 = Math.min(tintaY0, c.y0);
    tintaY1 = Math.max(tintaY1, c.y0 + c.altura);
    kLargura = Math.max(kLargura, c.largura / REF);
  }
  const kMax = Math.max((tintaY1 - tintaY0) / REF, kLargura);
  const fracao = Math.min(0.95, Math.max(0.4, escalaLetra));
  let tamanho = (tamanhoBloco * fracao) / kMax;
  let W = tamanhoBloco;
  if (tamanho < minimoFonte) {
    tamanho = minimoFonte;
    W = (kMax * tamanho) / fracao;
    avisos.push('Com esta letra o bloco não fica menor que ' + W.toFixed(1).replace('.', ',') +
      ' mm, senão o traço não sai na impressão.');
  }
  const e = W / ESCALA_REF;                          // fator de escala de tudo

  // ---- dobradiça ----
  // As folgas são absolutas: 0,4 mm é o diâmetro do bico — qualquer vão
  // horizontal menor que isso a impressora solda. A vertical pode ser menor
  // porque camada não gruda em camada através de um vão de ar.
  const espessuraPedida = espessuraBloco || W * 0.55;
  const paredeAcima = PAREDE_ACIMA * e;
  const paredeFuroPino = PAREDE_FURO_PINO * e;
  const rBracoCabe = (espessuraPedida - paredeAcima) / 2;
  const rPino = Math.max(0.7, Math.min((DIAMETRO_PINO * e) / 2, rBracoCabe - folgaRadial - paredeFuroPino));
  const rFuro = rPino + folgaRadial;                 // o furo é maior que o pino
  const rBraco = rFuro + paredeFuroPino;
  // pescoço com o MESMO raio do braço: a ponta em disco apoia inteira na mesa
  const rPescoco = rBraco;
  const zEixo = rBraco;                              // eixo baixo: tudo assenta no chão

  const alturaMinima = rBraco * 2 + paredeAcima;
  const H = Math.max(alturaMinima, espessuraPedida);
  const tetoJunta = rBraco * 2 + folgaVertical;      // teto da mordida e da boca

  const larguraPescoco = LARGURA_PESCOCO * e;
  const espBraco = ESPESSURA_BRACO * e;
  const yPescoco = larguraPescoco / 2;
  const yBracoDe = yPescoco + folgaRadial;
  const yBracoAte = yBracoDe + espBraco;
  // atravessa os dois braços, parando 0,03 mm antes de cada face externa: rente
  // de verdade, mas sem a tampa do pino no MESMO plano da face do braço
  const compPino = yBracoAte * 2 - 0.06;
  const mordidaYDe = yBracoDe - folgaRadial - 0.03;
  const mordidaYAte = yBracoAte + folgaRadial;
  // a asa passa do braço pela folga inteira: a ponta do pino é rente à face
  // externa do braço, e a parede da asa não pode chegar a menos de um bico dela
  const bocaAsa = yBracoAte + folgaRadial;

  // o arco do canto não pode invadir a faixa das mordidas nem das asas, senão
  // o contorno do corpo se cruza sozinho e a malha sai furada
  const rc = Math.max(0, Math.min(
    Math.min(W, H) / 2 * arredondamentoPct,
    W / 2 - Math.max(mordidaYAte, bocaAsa) - 0.05,
  ));

  // vão entre blocos: medido girando o contorno de verdade nos DOIS sentidos
  const dp = Math.max(0.2, acharVao(W, H, zEixo, giroGraus));
  const vao = dp * 2;
  // o braço e o pescoço passam da face do vizinho; entram pela mordida e pela boca
  const mordida = Math.max(0, rBraco - dp + folgaRadial);
  const boca = Math.max(0, rPescoco - dp + folgaRadial);
  // os +0,03 tiram as paredes destes recortes dos planos exatos das tampas do
  // braço e do pescoço — faces coincidentes brigam na tela e no STL
  const bocaMeia = yPescoco + folgaRadial + 0.03;
  // asas da boca: alívio raso na faixa dos braços, para a ponta do pino — que
  // invade a face quando o pino é mais gordo que o vão — não encostar no corpo
  const asaFundo = Math.max(0, rPino + folgaRadial - dp);

  // Letra grande demais para o canto arredondado transbordaria da face e
  // sairia impressa no ar. Encolhe só o necessário para os cantos da caixa da
  // letra caberem dentro do retângulo arredondado, com 0,5 mm de sobra.
  if (rc > 0.5) {
    const dentroDoCanto = (t) => {
      const mx = (kLargura * t) / 2 + 0.5;
      const my = ((tintaY1 - tintaY0) / REF) * t / 2 + 0.5;
      const fx = Math.max(0, mx - (W / 2 - rc));
      const fy = Math.max(0, my - (W / 2 - rc));
      return Math.hypot(fx, fy) <= rc;
    };
    let cortes = 0;
    while (!dentroDoCanto(tamanho) && cortes < 25) { tamanho *= 0.98; cortes++; }
  }
  // centro vertical da tinta do nome, comum a todos os blocos, para as letras
  // ficarem alinhadas entre si
  const meioTinta = ((tintaY0 + tintaY1) / 2) * (tamanho / REF);
  const porLetra = letras.map((ch) =>
    poligonosDoTexto(fonte, ch, tamanho, espaco, proporcao, curvasLetra));

  // ---- argola externa ----
  // Um anel redondo de verdade, encostado por FORA do bloco escolhido. Os
  // ajustes X e Y dizem de que lado e em que ponto: o lado vem da direção
  // dominante, a posição desliza ao longo daquela face. Lados ocupados pela
  // junta não valem: a face direita tem o garfo (menos no último bloco) e a
  // esquerda tem pescoço e mordidas (menos no primeiro) — nesses casos a
  // argola vai para cima ou para baixo, com aviso.
  let argola = null;
  if (comFuro && argolaExterna) {
    const paredeArg = Math.max(PAREDE_FURO_ARGOLA + 1.4 * e, 2.4 * e);
    const rExt = raioFuroArgola + paredeArg;
    const entradaArg = 1.4 * e;                      // o quanto o anel entra no bloco
    const bloco = Math.min(Math.max(1, Math.round(furoBloco)), letras.length) - 1;

    let face;
    if (Math.abs(furoY) > Math.abs(furoX) && Math.abs(furoY) > 0.01) {
      face = furoY > 0 ? 'cima' : 'baixo';
    } else if (furoX > 0.01) {
      face = 'direita';
    } else {
      face = 'esquerda';
    }
    if (face === 'esquerda' && bloco !== 0) {
      face = furoY >= 0 ? 'cima' : 'baixo';
      avisos.push('Desse lado do bloco fica a junta. Pus a argola na face de ' + face + '.');
    }
    if (face === 'direita' && bloco !== letras.length - 1) {
      face = furoY >= 0 ? 'cima' : 'baixo';
      avisos.push('Desse lado do bloco fica a junta. Pus a argola na face de ' + face + '.');
    }

    // quanto a lente de solda ocupa da face, para o anel não escorregar do canto
    const meiaLente = Math.sqrt(Math.max(0, rExt * rExt - (rExt - entradaArg) * (rExt - entradaArg)));
    const percurso = Math.max(0, W / 2 - meiaLente - 0.6);
    const prender = (v) => Math.max(-percurso, Math.min(percurso, v));
    let cx, cy;
    if (face === 'esquerda') { cx = -rExt + entradaArg; cy = prender(furoY); }
    else if (face === 'direita') { cx = W + rExt - entradaArg; cy = prender(furoY); }
    else if (face === 'cima') { cy = W / 2 + rExt - entradaArg; cx = W / 2 + prender(furoX); }
    else { cy = -W / 2 - rExt + entradaArg; cx = W / 2 + prender(furoX); }

    argola = {
      bloco, face, cx, cy, rExt, rFuro: raioFuroArgola,
      extensao: rExt * 2 - entradaArg,
    };
  }

  const passo = W + vao;
  const grupo = new THREE.Group();
  const base = [];
  const letra = [];

  // ---- furo no corpo do bloco (quando a argola externa está desligada) ----
  const blocoDoFuro = Math.min(Math.max(1, Math.round(furoBloco)), letras.length) - 1;
  let furo = null;
  let furoLocal = null;
  if (comFuro && !argolaExterna) {
    // contorno do bloco em planta (aqui o arredondamento existe de verdade)
    const contorno = [];
    const rP = Math.min(rc, W / 2 - 0.01);
    const canto = (cx, cy, a0, a1) => {
      for (let i = 0; i <= 8; i++) {
        const t = a0 + (a1 - a0) * (i / 8);
        contorno.push({ x: cx + rP * Math.cos(t), y: cy + rP * Math.sin(t) });
      }
    };
    canto(W - rP, -W / 2 + rP, -Math.PI / 2, 0);
    canto(W - rP, W / 2 - rP, 0, Math.PI / 2);
    canto(rP, W / 2 - rP, Math.PI / 2, Math.PI);
    canto(rP, -W / 2 + rP, Math.PI, Math.PI * 1.5);
    const zonas = [];
    if (blocoDoFuro > 0) {                           // este bloco tem pescoço e mordidas
      zonas.push({ x0: -1, x1: mordida, y0: mordidaYDe, y1: mordidaYAte });
      zonas.push({ x0: -1, x1: mordida, y0: -mordidaYAte, y1: -mordidaYDe });
      zonas.push({ x0: -1, x1: RECUO_PESCOCO * e, y0: -yPescoco, y1: yPescoco });
    }
    if (blocoDoFuro < letras.length - 1) {           // este bloco tem braços e boca
      zonas.push({ x0: W - RECUO_BRACO * e, x1: W + 1, y0: yBracoDe, y1: yBracoAte });
      zonas.push({ x0: W - RECUO_BRACO * e, x1: W + 1, y0: -yBracoAte, y1: -yBracoDe });
      zonas.push({ x0: W - boca, x1: W + 1, y0: -bocaMeia, y1: bocaMeia });
    }
    const pedido = { x: W / 2 + furoX, y: furoY };
    const lugar = acomodarFuro(pedido, raioFuroArgola, contorno, zonas);
    if (!lugar) {
      avisos.push('O furo da argola não coube neste bloco com 1,5 mm de parede. Ficou sem furo — diminua o furo ou escolha outro bloco.');
    } else {
      if (lugar.moveu) {
        avisos.push('Empurrei o furo da argola para manter 1,5 mm de parede até a borda e até a junta.');
      }
      furoLocal = { x: lugar.x, y: lugar.y };
      // avisa se o furo ficou embaixo da letra (a letra taparia a entrada)
      const cx = caixaDosAneis(porLetra[blocoDoFuro]);
      const dxL = (W - cx.largura) / 2 - cx.x0;
      const dyL = -meioTinta;
      for (const anel of porLetra[blocoDoFuro]) {
        const dentro = anel.contorno.some((p) =>
          Math.hypot(p[0] + dxL - lugar.x, p[1] + dyL - lugar.y) < raioFuroArgola + 0.6);
        if (dentro) {
          avisos.push('O furo da argola ficou embaixo da letra. A letra vai tapar o furo por cima — mova o furo com os ajustes.');
          break;
        }
      }
    }
  }

  for (let i = 0; i < letras.length; i++) {
    const x0 = i * passo;
    const temPino = i > 0;                           // pino sai pela esquerda
    const temEncaixe = i < letras.length - 1;        // garfo fica na direita
    const partes = [];

    const perfil = perfilCorpo({
      W, rc,
      mordidaFundo: mordida, mordidaDe: mordidaYDe, mordidaAte: mordidaYAte, comMordida: temPino,
      bocaFundo: boca, bocaMeia, bocaAsa, asaFundo, comBoca: temEncaixe,
    });
    if (furoLocal && i === blocoDoFuro) {
      const caminho = new THREE.Path();
      caminho.absarc(furoLocal.x, furoLocal.y, raioFuroArgola, 0, Math.PI * 2, true);
      perfil.holes.push(caminho);
      furo = { x: x0 + furoLocal.x, y: furoLocal.y, raio: raioFuroArgola };
    }

    // corpo em duas peças: o chanfro da base e o corpo em si, começando 0,02 mm
    // antes do fim do chanfro para as paredes não coincidirem
    partes.push(marcar(chanfroDaBase(perfil, 20), 'chanfro', i));
    const corpo = new THREE.ExtrudeGeometry([perfil], {
      depth: H - (CHANFRO_BASE - 0.02), bevelEnabled: false, curveSegments: 20,
    });
    corpo.translate(0, 0, CHANFRO_BASE - 0.02);
    partes.push(marcar(corpo, 'corpo', i));

    // argola externa: anel redondo colado no bloco escolhido, com o mesmo
    // chanfro e quase a mesma espessura. Ela sobe 0,02 mm e para 0,03 mm antes
    // do topo de propósito: onde o anel entra no bloco, fundo com fundo e topo
    // com topo no MESMO plano brigariam na tela e no STL — planos distintos,
    // e a solda fica por conta das paredes que se atravessam.
    if (argola && i === argola.bloco) {
      const fa = new THREE.Shape();
      fa.absarc(argola.cx, argola.cy, argola.rExt, 0, Math.PI * 2, false);
      const furoA = new THREE.Path();
      furoA.absarc(argola.cx, argola.cy, argola.rFuro, 0, Math.PI * 2, true);
      fa.holes.push(furoA);
      const chA = chanfroDaBase(fa, 32);
      chA.translate(0, 0, 0.02);
      partes.push(marcar(chA, 'argola', i));
      const anel = new THREE.ExtrudeGeometry([fa], {
        depth: H - CHANFRO_BASE - 0.09, bevelEnabled: false, curveSegments: 32,
      });
      anel.translate(0, 0, CHANFRO_BASE + 0.04);
      partes.push(marcar(anel, 'argola', i));
      furo = { x: x0 + argola.cx, y: argola.cy, raio: argola.rFuro };
    }

    // tetos: fecham a mordida e a boca acima da junta, deixando folga vertical
    // sobre o braço e o pescoço do vizinho. Entram 0,3 mm pelo material maciço
    // para o fatiador fundir sem parede coincidente.
    // Nenhuma face do teto pode ficar NO MESMO plano de uma face do corpo:
    // duas faces coincidentes brigam na tela (aquele chuvisco tremido) e criam
    // arestas quádruplas no STL. Por isso o teto passa 0,02 mm do topo e as
    // laterais dele que dariam na cara do bloco entram 0,02 mm — invisível na
    // peça, mas planos distintos.
    const teto = (x0t, x1t, y0t, y1t) => {
      const g = umMaterial(new THREE.BoxGeometry(x1t - x0t, y1t - y0t, H - tetoJunta + 0.02));
      g.translate((x0t + x1t) / 2, (y0t + y1t) / 2, (tetoJunta + H + 0.02) / 2);
      return g;
    };
    if (temPino && mordida > 0.01) {
      partes.push(marcar(teto(0.02, mordida + 0.3, mordidaYDe - 0.3, mordidaYAte + 0.3), 'teto', i));
      partes.push(marcar(teto(0.02, mordida + 0.3, -mordidaYAte - 0.3, -mordidaYDe + 0.3), 'teto', i));
    }
    if (temEncaixe && boca > 0.01) {
      partes.push(marcar(teto(W - boca - 0.3, W - 0.02, -bocaAsa - 0.4, bocaAsa + 0.4), 'teto', i));
    }

    // garfo: dois braços furados, apoiados na mesa (o eixo fica em z = rBraco)
    if (temEncaixe) {
      const pb = perfilDeLado(W - RECUO_BRACO * e, W + dp, rBraco, rFuro, W + 0.02);
      partes.push(marcar(extrudarEmY(pb, yBracoDe, espBraco, zEixo, 26), 'braco', i));
      partes.push(marcar(extrudarEmY(pb.clone(), -yBracoAte, espBraco, zEixo, 26), 'braco', i));
    }

    // pescoço e pino, também apoiados na mesa
    if (temPino) {
      const pp = perfilDeLado(RECUO_PESCOCO * e, -dp, rPescoco, 0, -0.02);
      partes.push(marcar(extrudarEmY(pp, -yPescoco, larguraPescoco, zEixo, 26), 'pescoco', i));
      const p = umMaterial(new THREE.CylinderGeometry(rPino, rPino, compPino, 26));
      p.translate(-dp, 0, zEixo);
      partes.push(marcar(p, 'pino', i));
    }

    for (const g of partes) { g.translate(x0, 0, 0); base.push(g); }

    // letra na face de cima
    const caixa = caixaDosAneis(porLetra[i]);
    const dxL = x0 + (W - caixa.largura) / 2 - caixa.x0;
    const dyL = -meioTinta;
    const formasLetra = aneisParaShapes(limparAneis(moverAneis(porLetra[i], dxL, dyL), 0.004, 0.004));
    if (formasLetra.length) {
      const gl = new THREE.ExtrudeGeometry(formasLetra, {
        depth: alturaLetra + AFUNDAR, bevelEnabled: false, curveSegments: 1,
      });
      gl.translate(0, 0, H - AFUNDAR);
      letra.push(marcar(gl, 'letra', i));
    }
  }

  const xArgola0 = argola ? argola.bloco * passo + argola.cx - argola.rExt : 0;
  const xArgola1 = argola ? argola.bloco * passo + argola.cx + argola.rExt : 0;
  const xMin = Math.min(0, xArgola0);
  const xMax = Math.max((letras.length - 1) * passo + W, xArgola1);
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
    const m = new THREE.Mesh(g, [materiais.letraTopo, materiais.letraLado]);
    m.userData = g.userData.marca || {};   // a física precisa saber de que bloco é
    grupo.add(m);
  }

  return {
    grupo,
    largura,
    altura: W,
    alturaTotal: H + alturaLetra,
    blocos: letras.length,
    avisos,
    tamanhoLetra: tamanho,
    furo: furo ? { x: furo.x + desloca, y: furo.y, raio: furo.raio } : null,
    articulacao: {
      W, H, rc, dp, vao, zEixo, tetoJunta, rPino, rFuro, rBraco, rPescoco,
      larguraPescoco, espBraco, compPino, folgaRadial, folgaVertical, giroGraus,
      passo, mordida, boca, bocaMeia, bocaAsa, asaFundo, alturaMinima, escala: e,
      pinoAlvo: DIAMETRO_PINO * e,
      argola: argola ? { bloco: argola.bloco, face: argola.face, cx: argola.cx, cy: argola.cy,
                         rExt: argola.rExt, rFuro: argola.rFuro, extensao: argola.extensao } : null,
      comprimentoTotal: largura,
    },
  };
}

// ---------- montagem completa ----------

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
    // --- só da correntinha ---
    tamanhoBloco = 15,          // lado da face do bloco, em mm; tudo escala dele
    espessuraBloco = 0,         // 0 = proporcional (55% do bloco)
    folgaArticulacao = 0.45,    // folga radial pino/furo e pescoço/braço
    folgaVertical = 0.25,       // folga entre faces sobrepostas na vertical
    giroArticulacao = 30,
    arredondamento = 60,
    furoBloco = 1,              // em qual bloco fica o furo da argola
    furoX = 0,                  // deslocamento a partir do centro do bloco
    furoY = 0,
    furoDiametro = 3.5,
    escalaLetra = 80,           // % do bloco que a letra ocupa
    argolaExterna = true,       // anel redondo na lateral do primeiro bloco
  } = opcoes;

  const avisos = [];
  const { nome: nomeUsado, removeu } = filtrarNome(fonte, nome);
  if (removeu) avisos.push('Alguns símbolos não dão para escrever e foram tirados.');

  const raioFuro = Math.max(1, diametroFuro / 2);
  const minimoFonte = tamanhoMinimoDaFonte(fonte);
  let tamanho = Math.max(tamanhoLetra, minimoFonte);
  if (tamanhoLetra < minimoFonte - 0.05 && estilo !== 'articulado') {
    // na correntinha a letra vem do tamanho do bloco, não deste controle
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
    comFuro, raioFuro, paredeFuro, furoNaDireita, furoRecuo, furoX, furoY, borda, tamanho,
    alturaBanda, bandaBaixo: banda.baixo * tamanho,
  };

  if (estilo === 'articulado') {
    // abaixo do diâmetro do bico a impressora solda as duas partes — não existe
    // folga horizontal menor que 0,4 mm que funcione
    let folgaRadial = folgaArticulacao;
    if (folgaRadial < 0.4) {
      folgaRadial = 0.4;
      avisos.push('A folga do pino não pode ser menor que 0,4 mm (o diâmetro do bico), senão a junta sai soldada. Usei 0,4 mm.');
    }
    const art = montarArticulado({
      fonte, nomeUsado, espaco, proporcao, curvasLetra, alturaLetra, banda, minimoFonte,
      tamanhoBloco, espessuraBloco, folgaRadial,
      folgaVertical: Math.max(0.15, folgaVertical),
      giroGraus: giroArticulacao, arredondamentoPct: arredondamento / 100,
      escalaLetra: escalaLetra / 100,
      comFuro, argolaExterna, furoBloco, furoX, furoY, raioFuroArgola: Math.max(1, furoDiametro / 2),
    });
    if (!art) {
      return {
        grupo, largura: 0, altura: 0, avisos, temTexto: false, nomeUsado,
        pedacos: 0, tamanhoLetra: tamanho,
      };
    }
    avisos.push(...art.avisos);
    // o pino só é motivo de aviso quando a ESPESSURA o espremeu abaixo do que a
    // escala do bloco pedia — pino pequeno em bloco pequeno é só proporção
    if (art.articulacao.rPino * 2 < art.articulacao.pinoAlvo - 0.02) {
      avisos.push('Nesta espessura o pino fica com ' +
        (art.articulacao.rPino * 2).toFixed(1).replace('.', ',') +
        ' mm e pode quebrar. Aumente a espessura do bloco.');
    }
    if (art.largura > AVISO_TAMANHO) {
      avisos.push('Esse chaveiro ficou bem grande. Se puder, use um nome menor ou um bloco menor.');
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
      comprimentoTotal: art.largura,
      tamanhoLetra: art.tamanhoLetra,
      furo: art.furo,
    };
  }

  let r;
  if (estilo === 'sombra' || estilo === 'letras') {
    r = montarNaGrade(comum);
  } else {
    r = montarComPlaca(comum);
  }

  if (r.avisosFuro) avisos.push(...r.avisosFuro);
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
