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
export const PAREDE_FURO = 3;   // material mínimo ao redor do furo
const AFUNDAR = 0.2;            // quanto as letras entram na placa (o fatiador une)
const FOLGA_FURO_TEXTO = 2;     // texto x anel do furo, nos estilos com placa
const AVISO_TAMANHO = 180;      // acima disso avisamos que ficou grande

export const ESTILOS = ['retangulo', 'arredondado', 'sombra', 'letras'];
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
    comFuro, raioFuro, largurasPersonalizadas,
  } = op;

  const alturaPlaca = op.alturaBanda + MARGEM * 2;
  const raioCanto = estilo === 'arredondado' ? alturaPlaca / 2 : Math.min(2.5, alturaPlaca * 0.14);

  // espaço reservado à esquerda para o furo da argola
  const zonaFuro = comFuro ? PAREDE_FURO + raioFuro * 2 + FOLGA_FURO_TEXTO : 0;
  // nas pontas arredondadas o texto tem de se afastar da curva
  let folgaCurva = 0;
  if (estilo === 'arredondado') {
    const rc = alturaPlaca / 2;
    const meia = op.alturaBanda / 2;
    folgaCurva = Math.max(0, rc - Math.sqrt(Math.max(0, rc * rc - meia * meia))) * 0.85;
  }

  const inicioTexto = Math.max(MARGEM + folgaCurva, zonaFuro + MARGEM * 0.5);
  const larguraPlaca = Math.max(
    inicioTexto + caixa.largura + MARGEM + folgaCurva,
    alturaPlaca * 1.25,
    largurasPersonalizadas || 0,
  );

  const forma = formaRetangular(larguraPlaca, alturaPlaca, raioCanto);
  const poly = forma.getPoints(20);

  let furo = null;
  if (comFuro) {
    const alvo = raioFuro + PAREDE_FURO;
    const p = { x: Math.max(alvo, PAREDE_FURO + raioFuro), y: alturaPlaca / 2 };
    // empurra para dentro se a borda arredondada apertar
    for (let k = 0; k < 200 && distanciaAoContorno(p, poly) < alvo - 0.02; k++) p.x += 0.15;
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
    aneisTexto, caixa, estilo, comFuro, raioFuro, borda, tamanho,
  } = op;

  const ehSombra = estilo === 'sombra';
  const raioAnel = raioFuro + PAREDE_FURO;
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
    let melhorI = grade.larg, melhorJ = -1;
    for (let j = 0; j < grade.alt; j++) {
      for (let i = 0; i < grade.larg; i++) {
        if (mapa[j * grade.larg + i]) {
          if (i < melhorI) { melhorI = i; melhorJ = j; }
          break;
        }
      }
    }
    if (melhorJ >= 0) {
      const bordaX = grade.x0 + (melhorI + 0.5) * grade.celula;
      const bordaY = grade.y0 + (melhorJ + 0.5) * grade.celula;
      // No estilo sombra a argola encosta na borda grossa e pode entrar mais.
      // No só-letras ela apenas encosta na primeira letra, senão parece outra letra.
      const entrada = ehSombra ? 0.5 : 0.76;
      const cx = bordaX - raioAnel * entrada;
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
export function montarChaveiro(opcoes) {
  const {
    nome = '', estilo = 'retangulo', fonte,
    tamanhoLetra = TAMANHOS.M,
    espaco = 0, proporcao = 1,
    espessuraBase = 3, alturaLetra = 1,
    comFuro = true, diametroFuro = 5,
    borda = 2.5,
    espessuraTraco = 0,
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
    comFuro, raioFuro, borda, tamanho,
    alturaBanda, bandaBaixo: banda.baixo * tamanho,
  };

  const r = (estilo === 'sombra' || estilo === 'letras')
    ? montarNaGrade(comum)
    : montarComPlaca(comum);

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
