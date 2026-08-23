// Física da bancada: pegar o chaveiro com o mouse, balançar, soltar e ver a
// correntinha dobrar até o batente e cair no chão.
//
// Não é um motor de física genérico — é a física DESTA peça. A dobradiça da
// correntinha só gira num plano (o pino é o eixo, deitado em Y), então a
// simulação é 2D no plano XZ, exatamente o plano em que a junta de verdade se
// move: cada bloco é um corpo rígido com posição (x, z) e um ângulo, os pinos
// viram juntas de revolução com os MESMOS limites de giro da peça (medidos
// girando o contorno, como no gerador), e o chão da grade é o chão da física.
// O que a simulação mostra é o que a peça impressa faz.
//
// O método é o de posição (estilo PBD): integra por Verlet e projeta as
// restrições algumas vezes por passo. Em 2D, com meia dúzia de corpos, isso é
// estável e barato — e não precisa de biblioteca nenhuma, o que importa num
// aplicativo que funciona sem internet.

const GRAVIDADE = 6500;      // mm/s² — um pouco menos que o real, para dar tempo de ver
const PASSO = 1 / 240;       // passo fixo da física
const ITERACOES = 10;        // projeções de restrição por passo
const AMORTECER = 0.998;     // arrasto do ar
const ATRITO = 0.55;         // atrito com o chão

// Em que ângulo dois blocos vizinhos se tocam, girando em torno do pino.
// Mesmo contorno do gerador: retângulo de cantos vivos com o chanfro da base.
function batente(W, H, dp, zEixo, sinal) {
  const C = 0.4;
  const base = [
    [0, C - zEixo], [C, -zEixo], [W - C, -zEixo],
    [W, C - zEixo], [W, H - zEixo], [0, H - zEixo],
  ];
  const esq = base.map((p) => [p[0] - W - dp, p[1]]);
  const dir = base.map((p) => [p[0] + dp, p[1]]);
  const dentro = (p, poly) => {
    let d = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) &&
          p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) d = !d;
    }
    return d;
  };
  for (let g = 0.5; g <= 90; g += 0.5) {
    const t = (sinal * g * Math.PI) / 180;
    const c = Math.cos(t), s = Math.sin(t);
    const mv = dir.map((p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
    if (mv.some((p) => dentro(p, esq)) || esq.some((p) => dentro(p, mv))) {
      return ((g - 0.5) * Math.PI) / 180;
    }
  }
  return Math.PI / 2;
}

export function criarSimulacao({ THREE, resultado }) {
  const grupo = resultado.grupo;
  const corpos = [];
  const juntas = [];
  const pivos = [];

  // ---- separa a peça em corpos ----
  if (resultado.articulacao) {
    const a = resultado.articulacao;
    const n = resultado.blocos;
    const L = n * a.W + (n - 1) * a.vao;
    for (let i = 0; i < n; i++) {
      const cx = -L / 2 + i * a.passo + a.W / 2;
      corpos.push(novoCorpo(cx, a.H / 2, a.W, a.H));
    }
    for (let i = 0; i + 1 < n; i++) {
      // o pino fica no meio do vão, na altura do eixo
      juntas.push({
        a: i, b: i + 1,
        la: { x: a.W / 2 + a.dp, z: a.zEixo - a.H / 2 },
        lb: { x: -a.W / 2 - a.dp, z: a.zEixo - a.H / 2 },
        limCima: Math.max(0.02, batente(a.W, a.H, a.dp, a.zEixo, 1) - 0.01),
        limBaixo: Math.max(0.02, batente(a.W, a.H, a.dp, a.zEixo, -1) - 0.01),
      });
    }
  } else {
    // peça inteiriça: um corpo só, do tamanho da caixa dela
    corpos.push(novoCorpo(0, resultado.alturaTotal / 2, resultado.largura, resultado.alturaTotal));
  }

  function novoCorpo(x, z, w, h) {
    const m = Math.max(0.1, w * h);
    return {
      x, z, a: 0, px: x, pz: z, pa: 0,
      x0: x, z0: z,
      w, h,
      invM: 1 / m,
      invI: 12 / (m * (w * w + h * h)),
      noChao: false,
    };
  }

  // ---- pendura cada malha no seu corpo ----
  // As malhas têm a geometria em coordenadas do mundo. Cada corpo ganha um
  // pivô no seu centro; a malha entra no pivô deslocada de volta, e daí em
  // diante mexer o pivô mexe o bloco inteiro.
  const doCorpo = (m) => {
    if (corpos.length === 1) return 0;
    if (m.userData && m.userData.bloco !== undefined) return m.userData.bloco;
    // sem etiqueta: decide pela posição da caixa
    m.geometry.computeBoundingBox();
    const cx = (m.geometry.boundingBox.min.x + m.geometry.boundingBox.max.x) / 2;
    let melhor = 0, dist = Infinity;
    for (let i = 0; i < corpos.length; i++) {
      const d = Math.abs(corpos[i].x0 - cx);
      if (d < dist) { dist = d; melhor = i; }
    }
    return melhor;
  };
  const malhas = [];
  grupo.traverse((o) => { if (o.isMesh) malhas.push(o); });
  for (let i = 0; i < corpos.length; i++) {
    const p = new THREE.Group();
    p.position.set(corpos[i].x0, 0, corpos[i].z0);
    grupo.add(p);
    pivos.push(p);
  }
  for (const m of malhas) {
    const i = doCorpo(m);
    pivos[i].add(m);
    m.position.set(-corpos[i].x0, 0, -corpos[i].z0);
  }

  // ---- restrições ----
  const rot = (c, l) => {
    const co = Math.cos(c.a), se = Math.sin(c.a);
    return { x: co * l.x - se * l.z, z: se * l.x + co * l.z };
  };
  const aplicar = (c, r, ix, iz) => {
    c.x += ix * c.invM;
    c.z += iz * c.invM;
    c.a += c.invI * (r.x * iz - r.z * ix);
  };
  const pesoEm = (c, r, nx, nz) => {
    const cr = r.x * nz - r.z * nx;
    return c.invM + c.invI * cr * cr;
  };

  let pega = null;  // { corpo, local:{x,z}, alvoX, alvoZ }

  function projetar() {
    // juntas de pino
    for (const j of juntas) {
      const A = corpos[j.a], B = corpos[j.b];
      const ra = rot(A, j.la), rb = rot(B, j.lb);
      let dx = (B.x + rb.x) - (A.x + ra.x);
      let dz = (B.z + rb.z) - (A.z + ra.z);
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) {
        const nx = dx / dist, nz = dz / dist;
        const w = pesoEm(A, ra, nx, nz) + pesoEm(B, rb, nx, nz);
        const lam = dist / w;
        aplicar(A, ra, nx * lam, nz * lam);
        aplicar(B, rb, -nx * lam, -nz * lam);
      }
      // batente: o giro relativo fica dentro do que a peça real permite
      let rel = B.a - A.a;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      let erro = 0;
      if (rel > j.limCima) erro = rel - j.limCima;
      else if (rel < -j.limBaixo) erro = rel + j.limBaixo;
      if (erro) {
        const soma = A.invI + B.invI;
        A.a += erro * 0.85 * (A.invI / soma);
        B.a -= erro * 0.85 * (B.invI / soma);
      }
    }
    // pega do mouse: puxa o ponto agarrado na direção do alvo
    if (pega) {
      const C = pega.corpo;
      const r = rot(C, pega.local);
      const dx = pega.alvoX - (C.x + r.x);
      const dz = pega.alvoZ - (C.z + r.z);
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-6) {
        const nx = dx / dist, nz = dz / dist;
        const w = pesoEm(C, r, nx, nz);
        const lam = (dist * 0.35) / w;   // macio de propósito: parece um dedo, não uma morsa
        aplicar(C, r, nx * lam, nz * lam);
      }
    }
    // chão
    for (const c of corpos) {
      c.noChao = false;
      const co = Math.cos(c.a), se = Math.sin(c.a);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = sx * c.w / 2, lz = sz * c.h / 2;
          const rx = co * lx - se * lz, rz = se * lx + co * lz;
          const pz = c.z + rz;
          if (pz < 0) {
            const r = { x: rx, z: rz };
            const w = pesoEm(c, r, 0, 1);
            const lam = -pz / w;
            aplicar(c, r, 0, lam);
            c.noChao = true;
            // atrito: desfaz o deslize do ponto de contato, até o limite
            // proporcional ao quanto o chão empurrou (Coulomb, versão posicional)
            const antesX = c.px + Math.cos(c.pa) * lx - Math.sin(c.pa) * lz;
            const desliza = (c.x + rx) - antesX;
            const wT = pesoEm(c, r, 1, 0);
            const maxT = ATRITO * lam;
            const lamT = Math.max(-maxT, Math.min(maxT, desliza / wT));
            aplicar(c, r, -lamT, 0);
          }
        }
      }
    }
  }

  function passoFixo() {
    for (const c of corpos) {
      const vx = (c.x - c.px) * AMORTECER;
      const vz = (c.z - c.pz) * AMORTECER;
      const va = (c.a - c.pa) * (c.noChao ? 0.96 : AMORTECER);
      c.px = c.x; c.pz = c.z; c.pa = c.a;
      c.x += vx;
      c.z += vz - GRAVIDADE * PASSO * PASSO;
      c.a += va;
    }
    for (let i = 0; i < ITERACOES; i++) projetar();
  }

  let acumulado = 0;
  function passo(dt) {
    acumulado = Math.min(acumulado + dt, 1 / 20);
    while (acumulado >= PASSO) {
      passoFixo();
      acumulado -= PASSO;
    }
    for (let i = 0; i < corpos.length; i++) {
      const c = corpos[i];
      pivos[i].position.set(c.x, 0, c.z);
      pivos[i].rotation.y = -c.a;
    }
  }

  // ponto do mundo -> corpo mais próximo + ponto local
  function agarrar(ponto) {
    let melhor = -1, dist = Infinity;
    for (let i = 0; i < corpos.length; i++) {
      const d = Math.hypot(corpos[i].x - ponto.x, corpos[i].z - ponto.z);
      if (d < dist) { dist = d; melhor = i; }
    }
    if (melhor < 0) return false;
    const c = corpos[melhor];
    const co = Math.cos(-c.a), se = Math.sin(-c.a);
    const dx = ponto.x - c.x, dz = ponto.z - c.z;
    pega = {
      corpo: c,
      local: {
        x: Math.max(-c.w / 2, Math.min(c.w / 2, co * dx - se * dz)),
        z: Math.max(-c.h / 2, Math.min(c.h / 2, se * dx + co * dz)),
      },
      alvoX: ponto.x, alvoZ: ponto.z,
    };
    return true;
  }
  function arrastar(ponto) {
    if (!pega) return;
    pega.alvoX = ponto.x;
    pega.alvoZ = ponto.z;
  }
  function soltar() {
    pega = null;
    // um fiapo de ruído ao soltar: sem ele, uma corrente pendurada bem na
    // vertical cai em pé e fica equilibrada na ponta — equilíbrio que só
    // existe numa simulação 2D perfeitamente simétrica, nunca na mão
    for (const c of corpos) c.pa += (Math.random() - 0.5) * 0.004;
  }

  function sacudir() {
    for (const c of corpos) { c.pz = c.z - 1.2; c.pa = c.a + (Math.random() - 0.5) * 0.06; }
  }

  return { passo, agarrar, arrastar, soltar, sacudir, corpos, juntas };
}
