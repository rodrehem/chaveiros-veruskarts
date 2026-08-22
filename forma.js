// Ferramentas de forma: transforma o texto em polígonos, engorda contornos
// (para a borda do estilo "sombra"), solda letras que se encostam e descobre
// se a peça ficou inteira ou em pedaços soltos.
//
// Tudo funciona sobre uma grade: o desenho vira pontos numa malha fina, a malha
// vira um "mapa de distâncias" e o contorno é extraído de volta. É isso que
// permite engordar o desenho e juntar letras vizinhas sem biblioteca externa.

import * as THREE from 'three';

// ---------- texto -> polígonos ----------

// Altura de referência da fonte (do topo do acento até o pé da cedilha),
// para peças do mesmo tamanho terem a mesma altura, tenha o nome acento ou não.
export function bandaDaFonte(fonte) {
  const g = fonte.data.glyphs;
  const res = fonte.data.resolution;
  let alto = -Infinity, baixo = Infinity;
  for (const ch of 'ÁÂÃÉÍÓÔÕÚÜ') if (g[ch]) alto = Math.max(alto, g[ch].y_max);
  for (const ch of 'çgjpqy') if (g[ch]) baixo = Math.min(baixo, g[ch].y_min);
  if (alto === -Infinity) alto = fonte.data.ascender;
  if (baixo === Infinity) baixo = fonte.data.descender;
  return { alto: alto / res, baixo: baixo / res, altura: (alto - baixo) / res };
}

export function tamanhoMinimoDaFonte(fonte) {
  return fonte.data.tamanho_min_mm || 7;
}

// Gera os polígonos do texto já com espaçamento e largura aplicados.
// Devolve anéis: { contorno: [[x,y]...], furos: [[[x,y]...]] }
export function poligonosDoTexto(fonte, texto, tamanho, espaco = 0, proporcao = 1, curvas = 8) {
  const res = fonte.data.resolution;
  const escala = tamanho / res;
  const aneis = [];
  let cursor = 0;

  for (const ch of Array.from(texto)) {
    const glifo = fonte.data.glyphs[ch];
    if (!glifo) continue;

    if (glifo.o && glifo.o.length > 2) {
      const formas = fonte.generateShapes(ch, tamanho);
      for (const forma of formas) {
        const pts = forma.extractPoints(curvas);
        const mover = (p) => [p.x * proporcao + cursor, p.y];
        const contorno = pts.shape.map(mover);
        const furos = (pts.holes || []).map((h) => h.map(mover));
        if (contorno.length > 2) aneis.push({ contorno, furos });
      }
    }
    cursor += glifo.ha * escala * proporcao + espaco * tamanho;
  }

  return aneis;
}

export function caixaDosAneis(aneis) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const a of aneis) {
    for (const p of a.contorno) {
      if (p[0] < x0) x0 = p[0];
      if (p[0] > x1) x1 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[1] > y1) y1 = p[1];
    }
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0, largura: 0, altura: 0 };
  return { x0, y0, x1, y1, largura: x1 - x0, altura: y1 - y0 };
}

export function moverAneis(aneis, dx, dy) {
  return aneis.map((a) => ({
    contorno: a.contorno.map((p) => [p[0] + dx, p[1] + dy]),
    furos: a.furos.map((h) => h.map((p) => [p[0] + dx, p[1] + dy])),
  }));
}

function area(anel) {
  let s = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    s += (anel[j][0] * anel[i][1]) - (anel[i][0] * anel[j][1]);
  }
  return s / 2;
}

function pontoDentro(x, y, anel) {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const yi = anel[i][1], yj = anel[j][1];
    if ((yi > y) !== (yj > y) &&
        x < (anel[j][0] - anel[i][0]) * (y - yi) / (yj - yi) + anel[i][0]) dentro = !dentro;
  }
  return dentro;
}

// ---------- anéis -> THREE.Shape ----------
export function aneisParaShapes(aneis) {
  const shapes = [];
  for (const a of aneis) {
    if (a.contorno.length < 3) continue;
    const externo = area(a.contorno) < 0 ? [...a.contorno].reverse() : a.contorno;
    const forma = new THREE.Shape();
    forma.setFromPoints(externo.map((p) => new THREE.Vector2(p[0], p[1])));
    for (const h of a.furos) {
      if (h.length < 3) continue;
      const interno = area(h) > 0 ? [...h].reverse() : h;
      const caminho = new THREE.Path();
      caminho.setFromPoints(interno.map((p) => new THREE.Vector2(p[0], p[1])));
      forma.holes.push(caminho);
    }
    shapes.push(forma);
  }
  return shapes;
}

// ---------- grade ----------

// Pinta os anéis numa grade booleana (regra par-ímpar, então os furos das
// letras saem sozinhos).
function pintar(aneis, grade) {
  const { larg, alt, celula, x0, y0 } = grade;
  const dentro = new Uint8Array(larg * alt);
  const arestas = [];
  for (const a of aneis) {
    for (const anel of [a.contorno, ...a.furos]) {
      for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
        arestas.push([anel[j][0], anel[j][1], anel[i][0], anel[i][1]]);
      }
    }
  }
  const cruzes = [];
  for (let ly = 0; ly < alt; ly++) {
    const y = y0 + (ly + 0.5) * celula;
    cruzes.length = 0;
    for (let k = 0; k < arestas.length; k++) {
      const [ax, ay, bx, by] = arestas[k];
      if ((ay > y) !== (by > y)) cruzes.push(ax + (y - ay) / (by - ay) * (bx - ax));
    }
    if (!cruzes.length) continue;
    cruzes.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cruzes.length; k += 2) {
      let i0 = Math.ceil((cruzes[k] - x0) / celula - 0.5);
      let i1 = Math.floor((cruzes[k + 1] - x0) / celula - 0.5);
      if (i0 < 0) i0 = 0;
      if (i1 >= larg) i1 = larg - 1;
      const base = ly * larg;
      for (let i = i0; i <= i1; i++) dentro[base + i] = 1;
    }
  }
  return dentro;
}

export function criarGrade(caixa, folga, celula) {
  const x0 = caixa.x0 - folga, y0 = caixa.y0 - folga;
  const larg = Math.max(4, Math.ceil((caixa.largura + folga * 2) / celula) + 2);
  const alt = Math.max(4, Math.ceil((caixa.altura + folga * 2) / celula) + 2);
  return { x0, y0, larg, alt, celula };
}

export function pintarAneis(aneis, grade) {
  return pintar(aneis, grade);
}

export function pintarDisco(mapa, grade, cx, cy, raio, valor = 1) {
  const { larg, alt, celula, x0, y0 } = grade;
  const i0 = Math.max(0, Math.floor((cx - raio - x0) / celula));
  const i1 = Math.min(larg - 1, Math.ceil((cx + raio - x0) / celula));
  const j0 = Math.max(0, Math.floor((cy - raio - y0) / celula));
  const j1 = Math.min(alt - 1, Math.ceil((cy + raio - y0) / celula));
  const r2 = raio * raio;
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * celula;
    for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * celula;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r2) mapa[j * larg + i] = valor;
    }
  }
  return mapa;
}

// ---------- distância ----------
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

function edt2d(binario, larg, alt, alvo) {
  const INF = 1e12;
  const f = new Float64Array(Math.max(larg, alt));
  const d = new Float64Array(Math.max(larg, alt));
  const v = new Int32Array(Math.max(larg, alt) + 1);
  const z = new Float64Array(Math.max(larg, alt) + 2);
  const saida = new Float64Array(larg * alt);

  for (let i = 0; i < larg * alt; i++) saida[i] = binario[i] === alvo ? 0 : INF;

  for (let i = 0; i < larg; i++) {
    for (let j = 0; j < alt; j++) f[j] = saida[j * larg + i];
    edt1d(f, alt, d, v, z);
    for (let j = 0; j < alt; j++) saida[j * larg + i] = d[j];
  }
  for (let j = 0; j < alt; j++) {
    const base = j * larg;
    for (let i = 0; i < larg; i++) f[i] = saida[base + i];
    edt1d(f, larg, d, v, z);
    for (let i = 0; i < larg; i++) saida[base + i] = d[i];
  }
  return saida;
}

// Distância com sinal, em milímetros: negativa dentro do desenho.
export function campoDistancia(binario, grade) {
  const { larg, alt, celula } = grade;
  const fora = edt2d(binario, larg, alt, 1);
  const dentro = edt2d(binario, larg, alt, 0);
  const sdf = new Float32Array(larg * alt);
  for (let i = 0; i < larg * alt; i++) {
    sdf[i] = binario[i]
      ? -Math.sqrt(dentro[i]) * celula
      : Math.sqrt(fora[i]) * celula;
  }
  return sdf;
}

export function binarioDoCampo(sdf, nivel) {
  const b = new Uint8Array(sdf.length);
  for (let i = 0; i < sdf.length; i++) b[i] = sdf[i] <= nivel ? 1 : 0;
  return b;
}

// Engorda o desenho (mm) — usado na borda do estilo "sombra".
export function engordar(binario, grade, quanto) {
  if (quanto <= 0) return binario;
  return binarioDoCampo(campoDistancia(binario, grade), quanto);
}

// Solda: engorda e depois volta ao tamanho. Junta letras que quase se encostam
// sem mudar visivelmente a forma delas.
export function soldar(binario, grade, raio) {
  if (raio <= 0) return binario;
  const gordo = binarioDoCampo(campoDistancia(binario, grade), raio);
  const magro = binarioDoCampo(campoDistancia(gordo, grade), -raio);
  return magro;
}

// Quantos pedaços soltos existem (1 = peça inteira).
export function contarPedacos(binario, grade) {
  const { larg, alt } = grade;
  const visto = new Uint8Array(larg * alt);
  const fila = new Int32Array(larg * alt);
  let pedacos = 0;
  for (let s = 0; s < larg * alt; s++) {
    if (!binario[s] || visto[s]) continue;
    pedacos++;
    let ini = 0, fim = 0;
    fila[fim++] = s; visto[s] = 1;
    while (ini < fim) {
      const p = fila[ini++];
      const px = p % larg, py = (p / larg) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = px + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = py + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= larg || ny >= alt) continue;
        const q = ny * larg + nx;
        if (binario[q] && !visto[q]) { visto[q] = 1; fila[fim++] = q; }
      }
    }
  }
  return pedacos;
}

// ---------- contorno (marching squares no campo de distância) ----------
//
// Cada ponto do contorno cai sempre sobre uma aresta da grade. Em vez de ligar
// os pedaços comparando coordenadas (que erra por arredondamento), cada aresta
// tem um número próprio e a ligação é feita por esse número — exata.
//
// Orientação: o lado de dentro fica sempre à ESQUERDA do sentido do traço,
// então os contornos externos saem no sentido anti-horário e os furos no horário.
export function contornar(sdf, grade, nivel = 0) {
  const { larg, alt, celula, x0, y0 } = grade;

  const idH = (i, j) => (j * larg + i) * 2;       // aresta horizontal (i,j)-(i+1,j)
  const idV = (i, j) => (j * larg + i) * 2 + 1;   // aresta vertical  (i,j)-(i,j+1)

  const pontos = new Map();
  function ponto(id) {
    let p = pontos.get(id);
    if (p) return p;
    const vertical = id % 2 === 1;
    const cel = (id - (vertical ? 1 : 0)) / 2;
    const i = cel % larg, j = (cel / larg) | 0;
    const va = sdf[j * larg + i];
    if (vertical) {
      const vb = sdf[(j + 1) * larg + i];
      const t = (nivel - va) / ((vb - va) || 1e-9);
      p = [x0 + (i + 0.5) * celula, y0 + (j + 0.5 + t) * celula];
    } else {
      const vb = sdf[j * larg + i + 1];
      const t = (nivel - va) / ((vb - va) || 1e-9);
      p = [x0 + (i + 0.5 + t) * celula, y0 + (j + 0.5) * celula];
    }
    pontos.set(id, p);
    return p;
  }

  const de = [], para = [];
  const empurrar = (a, b) => { de.push(a); para.push(b); };

  for (let j = 0; j < alt - 1; j++) {
    for (let i = 0; i < larg - 1; i++) {
      const p00 = j * larg + i, p10 = p00 + 1, p01 = p00 + larg, p11 = p01 + 1;
      const v00 = sdf[p00], v10 = sdf[p10], v11 = sdf[p11], v01 = sdf[p01];
      let caso = 0;
      if (v00 < nivel) caso |= 1;  // baixo-esquerda
      if (v10 < nivel) caso |= 2;  // baixo-direita
      if (v11 < nivel) caso |= 4;  // cima-direita
      if (v01 < nivel) caso |= 8;  // cima-esquerda
      if (caso === 0 || caso === 15) continue;

      const B = idH(i, j), T = idH(i, j + 1), L = idV(i, j), R = idV(i + 1, j);

      switch (caso) {
        case 1:  empurrar(B, L); break;
        case 2:  empurrar(R, B); break;
        case 3:  empurrar(R, L); break;
        case 4:  empurrar(T, R); break;
        case 6:  empurrar(T, B); break;
        case 7:  empurrar(T, L); break;
        case 8:  empurrar(L, T); break;
        case 9:  empurrar(B, T); break;
        case 11: empurrar(R, T); break;
        case 12: empurrar(L, R); break;
        case 13: empurrar(B, R); break;
        case 14: empurrar(L, B); break;
        case 5: {
          const centro = (v00 + v10 + v11 + v01) / 4;
          if (centro < nivel) { empurrar(B, R); empurrar(T, L); }
          else { empurrar(B, L); empurrar(T, R); }
          break;
        }
        case 10: {
          const centro = (v00 + v10 + v11 + v01) / 4;
          if (centro < nivel) { empurrar(L, B); empurrar(R, T); }
          else { empurrar(R, B); empurrar(L, T); }
          break;
        }
      }
    }
  }

  // liga os pedaços em laços fechados usando o número da aresta
  const inicioEm = new Map();
  for (let k = 0; k < de.length; k++) {
    const lista = inicioEm.get(de[k]);
    if (lista) lista.push(k); else inicioEm.set(de[k], [k]);
  }

  const usado = new Uint8Array(de.length);
  const lacos = [];
  for (let k = 0; k < de.length; k++) {
    if (usado[k]) continue;
    const laco = [ponto(de[k])];
    let atual = k;
    usado[k] = 1;
    for (let passo = 0; passo <= de.length; passo++) {
      const fim = para[atual];
      laco.push(ponto(fim));
      const cands = inicioEm.get(fim);
      let proximo = -1;
      if (cands) for (const c of cands) if (!usado[c]) { proximo = c; break; }
      if (proximo === -1) break;
      usado[proximo] = 1;
      atual = proximo;
    }
    if (laco.length > 3) lacos.push(laco);
  }

  // separa contornos externos (anti-horário) de furos (horário)
  const externos = [], internos = [];
  for (const l of lacos) (area(l) > 0 ? externos : internos).push(l);

  const aneis = externos.map((c) => ({ contorno: c, furos: [] }));
  for (const furo of internos) {
    const p = furo[0];
    let melhor = -1, menorArea = Infinity;
    for (let k = 0; k < aneis.length; k++) {
      const a = Math.abs(area(aneis[k].contorno));
      if (a < menorArea && pontoDentro(p[0], p[1], aneis[k].contorno)) { menorArea = a; melhor = k; }
    }
    if (melhor >= 0) aneis[melhor].furos.push(furo);
  }
  return aneis;
}

// Simplifica o contorno (Douglas-Peucker) para não gerar triângulos demais.
// Laços fechados são cortados em dois arcos antes, senão o primeiro e o último
// ponto coincidem, a corda vira um ponto e o algoritmo descarta o laço inteiro.
export function simplificar(aneis, tolerancia) {
  function dpAberto(pts, tol) {
    if (pts.length < 3) return pts;
    const manter = new Uint8Array(pts.length);
    manter[0] = 1; manter[pts.length - 1] = 1;
    const pilha = [[0, pts.length - 1]];
    while (pilha.length) {
      const [i0, i1] = pilha.pop();
      if (i1 <= i0 + 1) continue;
      const [ax, ay] = pts[i0], [bx, by] = pts[i1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      let pior = -1, idx = -1;
      for (let i = i0 + 1; i < i1; i++) {
        const d = len > 1e-9
          ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len
          : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
        if (d > pior) { pior = d; idx = i; }
      }
      if (pior > tol && idx > 0) {
        manter[idx] = 1;
        pilha.push([i0, idx], [idx, i1]);
      }
    }
    const saida = [];
    for (let i = 0; i < pts.length; i++) if (manter[i]) saida.push(pts[i]);
    return saida;
  }

  function dpFechado(pts, tol) {
    if (pts.length < 5) return pts;
    // tira o ponto repetido do fim, se houver
    let p = pts;
    const a = p[0], z = p[p.length - 1];
    if (Math.hypot(a[0] - z[0], a[1] - z[1]) < 1e-7) p = p.slice(0, -1);
    if (p.length < 5) return pts;
    // corta no ponto mais distante do primeiro: dois arcos abertos
    let idx = 1, maior = -1;
    for (let i = 1; i < p.length; i++) {
      const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
      if (d > maior) { maior = d; idx = i; }
    }
    const arco1 = dpAberto(p.slice(0, idx + 1), tol);
    const arco2 = dpAberto(p.slice(idx), tol);
    const junto = arco1.concat(arco2.slice(1));
    if (junto.length < 4) return p;
    junto.push([junto[0][0], junto[0][1]]);
    return junto;
  }

  const saida = [];
  for (const a of aneis) {
    const contorno = dpFechado(a.contorno, tolerancia);
    if (contorno.length < 4) continue;
    const furos = [];
    for (const h of a.furos) {
      const f = dpFechado(h, tolerancia);
      if (f.length >= 4) furos.push(f);
    }
    saida.push({ contorno, furos });
  }
  return saida;
}

// ---------- ligar pedaços soltos ----------

export function pintarCapsula(mapa, grade, ax, ay, bx, by, raio, valor = 1) {
  const { larg, alt, celula, x0, y0 } = grade;
  const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - raio - x0) / celula));
  const i1 = Math.min(larg - 1, Math.ceil((Math.max(ax, bx) + raio - x0) / celula));
  const j0 = Math.max(0, Math.floor((Math.min(ay, by) - raio - y0) / celula));
  const j1 = Math.min(alt - 1, Math.ceil((Math.max(ay, by) + raio - y0) / celula));
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const r2 = raio * raio;
  for (let j = j0; j <= j1; j++) {
    const y = y0 + (j + 0.5) * celula;
    for (let i = i0; i <= i1; i++) {
      const x = x0 + (i + 0.5) * celula;
      let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const px = ax + t * dx - x, py = ay + t * dy - y;
      if (px * px + py * py <= r2) mapa[j * larg + i] = valor;
    }
  }
  return mapa;
}

// Rotula cada pedaço solto com um número; devolve também as células de borda
// de cada pedaço (é por elas que medimos a distância entre pedaços).
export function rotularPedacos(binario, grade) {
  const { larg, alt } = grade;
  const rotulos = new Int32Array(larg * alt).fill(-1);
  const fila = new Int32Array(larg * alt);
  const bordas = [];
  let quantos = 0;

  for (let s = 0; s < larg * alt; s++) {
    if (!binario[s] || rotulos[s] >= 0) continue;
    const r = quantos++;
    const borda = [];
    let ini = 0, fim = 0;
    fila[fim++] = s; rotulos[s] = r;
    while (ini < fim) {
      const p = fila[ini++];
      const px = p % larg, py = (p / larg) | 0;
      let ehBorda = false;
      for (let k = 0; k < 4; k++) {
        const nx = px + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = py + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= larg || ny >= alt) { ehBorda = true; continue; }
        const q = ny * larg + nx;
        if (!binario[q]) { ehBorda = true; continue; }
        if (rotulos[q] < 0) { rotulos[q] = r; fila[fim++] = q; }
      }
      if (ehBorda) borda.push(p);
    }
    bordas.push(borda);
  }
  return { rotulos, quantos, bordas };
}

// Liga os pedaços soltos com pontes finas no ponto mais próximo entre eles.
// É isso que gruda o til, o pingo do "i" e a cedilha no resto da peça, e o que
// junta letras vizinhas no estilo só-letras.
//
// Em vez de comparar cada pedaço com o corpo principal ponto a ponto (o que
// para um nome longo em só-letras chega a trinta pedaços e fica pesado), mede
// UMA vez a distância de tudo até o corpo principal e usa esse mapa para achar
// onde cada pedaço encosta. Assim todas as pontes saem de uma passada só.
export function ligarPedacos(binario, grade, larguraPonte) {
  const { larg, alt, celula, x0, y0 } = grade;
  const raio = Math.max(larguraPonte / 2, celula);
  const emX = (p) => x0 + ((p % larg) + 0.5) * celula;
  const emY = (p) => y0 + (((p / larg) | 0) + 0.5) * celula;

  let mapa = binario;
  let pontes = 0;

  for (let volta = 0; volta < 6; volta++) {
    const { rotulos, quantos, bordas } = rotularPedacos(mapa, grade);
    if (quantos <= 1) break;

    // o maior pedaço é o corpo principal
    let principal = 0;
    for (let k = 1; k < bordas.length; k++) {
      if (bordas[k].length > bordas[principal].length) principal = k;
    }

    // distância de cada célula até o corpo principal
    const soPrincipal = new Uint8Array(mapa.length);
    for (let i = 0; i < mapa.length; i++) if (rotulos[i] === principal) soPrincipal[i] = 1;
    const dist = campoDistancia(soPrincipal, grade);

    if (mapa === binario) mapa = Uint8Array.from(binario);

    for (let k = 0; k < bordas.length; k++) {
      if (k === principal || !bordas[k].length) continue;

      // o ponto do pedaço que está mais perto do corpo principal
      let alvo = -1, menor = Infinity;
      for (const p of bordas[k]) {
        if (dist[p] < menor) { menor = dist[p]; alvo = p; }
      }
      if (alvo < 0) continue;

      const ax = emX(alvo), ay = emY(alvo);

      // e a célula do corpo principal mais próxima dele, procurada só na
      // vizinhança que a distância já indicou
      const alcance = Math.ceil(menor / celula) + 3;
      const i0 = Math.max(0, (alvo % larg) - alcance);
      const i1 = Math.min(larg - 1, (alvo % larg) + alcance);
      const j0 = Math.max(0, ((alvo / larg) | 0) - alcance);
      const j1 = Math.min(alt - 1, ((alvo / larg) | 0) + alcance);
      let bx = ax, by = ay, melhorD = Infinity;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const q = j * larg + i;
          if (!soPrincipal[q]) continue;
          const qx = x0 + (i + 0.5) * celula, qy = y0 + (j + 0.5) * celula;
          const d = (qx - ax) * (qx - ax) + (qy - ay) * (qy - ay);
          if (d < melhorD) { melhorD = d; bx = qx; by = qy; }
        }
      }
      if (melhorD === Infinity) continue;

      pintarCapsula(mapa, grade, ax, ay, bx, by, raio, 1);
      pontes++;
    }
  }

  return { mapa, pontes };
}

// ---------- suavizar contornos ----------
//
// O contorno sai da grade em degraus (o "serrilhado"). Aqui ele é suavizado
// pelo método de Taubin: uma passada puxa os pontos para a média dos vizinhos
// (alisa, mas encolhe) e a passada seguinte empurra de volta com sinal trocado
// (devolve o tamanho). Alternando as duas, a peça fica lisa e do mesmo tamanho.
export function suavizar(aneis, passos = 10, lambda = 0.5, mu = -0.53) {
  function suavizarAnel(pts) {
    if (pts.length < 6) return pts;

    // trabalha sem o ponto repetido do fim
    let p = pts;
    const a = p[0], z = p[p.length - 1];
    if (Math.hypot(a[0] - z[0], a[1] - z[1]) < 1e-7) p = p.slice(0, -1);
    const n = p.length;
    if (n < 6) return pts;

    let atual = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) { atual[i * 2] = p[i][0]; atual[i * 2 + 1] = p[i][1]; }
    let proximo = new Float64Array(n * 2);

    for (let passo = 0; passo < passos; passo++) {
      const fator = passo % 2 === 0 ? lambda : mu;
      for (let i = 0; i < n; i++) {
        const ant = ((i - 1) + n) % n, dep = (i + 1) % n;
        const mediaX = (atual[ant * 2] + atual[dep * 2]) / 2;
        const mediaY = (atual[ant * 2 + 1] + atual[dep * 2 + 1]) / 2;
        proximo[i * 2] = atual[i * 2] + fator * (mediaX - atual[i * 2]);
        proximo[i * 2 + 1] = atual[i * 2 + 1] + fator * (mediaY - atual[i * 2 + 1]);
      }
      const troca = atual; atual = proximo; proximo = troca;
    }

    const saida = new Array(n + 1);
    for (let i = 0; i < n; i++) saida[i] = [atual[i * 2], atual[i * 2 + 1]];
    saida[n] = [atual[0], atual[1]];
    return saida;
  }

  return aneis.map((anel) => ({
    contorno: suavizarAnel(anel.contorno),
    furos: anel.furos.map(suavizarAnel),
  }));
}

// Redistribui os pontos do contorno em espaçamento uniforme.
// Pontos irregulares deixam as faces laterais com larguras diferentes e a luz
// bate diferente em cada uma, o que aparece como estrias. Com espaçamento
// uniforme as faces ficam iguais e a lateral fica lisa.
export function reamostrar(aneis, passo) {
  function reamostrarAnel(pts) {
    if (pts.length < 5) return pts;
    let p = pts;
    const a = p[0], z = p[p.length - 1];
    if (Math.hypot(a[0] - z[0], a[1] - z[1]) < 1e-7) p = p.slice(0, -1);
    const n = p.length;
    if (n < 5) return pts;

    const comp = new Float64Array(n);
    let total = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      comp[i] = Math.hypot(p[j][0] - p[i][0], p[j][1] - p[i][1]);
      total += comp[i];
    }
    if (total < passo * 4) return pts;

    const quantos = Math.max(8, Math.round(total / passo));
    const salto = total / quantos;

    const saida = new Array(quantos + 1);
    let seg = 0, andado = 0;
    for (let k = 0; k < quantos; k++) {
      const alvo = k * salto;
      while (seg < n - 1 && andado + comp[seg] < alvo) { andado += comp[seg]; seg++; }
      const t = comp[seg] > 1e-12 ? (alvo - andado) / comp[seg] : 0;
      const j = (seg + 1) % n;
      saida[k] = [
        p[seg][0] + (p[j][0] - p[seg][0]) * t,
        p[seg][1] + (p[j][1] - p[seg][1]) * t,
      ];
    }
    saida[quantos] = [saida[0][0], saida[0][1]];
    return saida;
  }

  return aneis.map((anel) => ({
    contorno: reamostrarAnel(anel.contorno),
    furos: anel.furos.map(reamostrarAnel),
  }));
}

// Limpeza final: tira pontos repetidos (que viram triângulos sem área) e
// descarta anéis pequenos demais para virar geometria de verdade.
export function limparAneis(aneis, minimo = 0.01, areaMinima = 0.02) {
  function limpar(pts) {
    if (!pts || pts.length < 4) return null;
    const saida = [];
    for (const p of pts) {
      const ultimo = saida[saida.length - 1];
      if (!ultimo || Math.hypot(p[0] - ultimo[0], p[1] - ultimo[1]) > minimo) saida.push(p);
    }
    // fecha o anel sem repetir o ponto
    while (saida.length > 1 &&
           Math.hypot(saida[0][0] - saida[saida.length - 1][0],
                      saida[0][1] - saida[saida.length - 1][1]) <= minimo) saida.pop();
    if (saida.length < 3) return null;
    let a = 0;
    for (let i = 0, j = saida.length - 1; i < saida.length; j = i++) {
      a += saida[j][0] * saida[i][1] - saida[i][0] * saida[j][1];
    }
    if (Math.abs(a / 2) < areaMinima) return null;
    saida.push([saida[0][0], saida[0][1]]);
    return saida;
  }

  const saida = [];
  for (const anel of aneis) {
    const contorno = limpar(anel.contorno);
    if (!contorno) continue;
    const furos = [];
    for (const h of anel.furos) {
      const f = limpar(h);
      if (f) furos.push(f);
    }
    saida.push({ contorno, furos });
  }
  return saida;
}
