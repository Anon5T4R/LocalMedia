/** Modelo da timeline do editor — tipos e operações PURAS (unit-testadas).
 *
 *  Conceitos:
 *  - Trilhas de vídeo (V1 embaixo, V2+ por cima = camadas) recebem clipes de
 *    vídeo e imagem; trilhas de áudio (A1, A2, …) recebem clipes de áudio.
 *  - Um vídeo com som entra como DOIS clipes vinculados (linkId igual): o
 *    vídeo numa trilha V e o áudio numa trilha A. Vinculados se movem juntos,
 *    mas dá pra desvincular e aparar/dividir/apagar só um deles — é assim que
 *    se recorta um trecho só do áudio ou só do vídeo.
 *  - Clipes da mesma trilha nunca se sobrepõem (mover/aparar respeita os
 *    vizinhos). */

export type ClipKind = "video" | "image" | "audio" | "text";

/** De onde o clipe veio (subconjunto do MediaInfo que o editor precisa). */
export interface SourceRef {
  path: string;
  name: string;
  durationMs: number; // 0 pra imagem (fonte "infinita")
  width: number;
  height: number; // 0 pra áudio puro
}

export interface Clip {
  id: string;
  kind: ClipKind;
  src: SourceRef;
  /** Índice da trilha dentro do grupo (vídeo OU áudio, conforme o kind). */
  track: number;
  /** Onde o clipe entra na timeline. */
  startMs: number;
  /** Trim na fonte (imagem: 0..duração escolhida). */
  inMs: number;
  outMs: number;
  /** Áudio: volume (0–2) e mudo. */
  gain: number;
  muted: boolean;
  /** Vídeo/imagem: tela cheia (contain) ou posição livre no quadro. */
  fit: "cheia" | "custom";
  /** Frações do canvas (só no fit custom): canto superior-esquerdo e largura. */
  x: number;
  y: number;
  w: number;
  /** Clipes com o mesmo linkId (≠ "") se movem juntos. */
  linkId: string;
  /** Velocidade de reprodução (0.25–4; 1 = normal). Vídeo e áudio; a duração
   *  na timeline é (outMs - inMs) / speed. */
  speed: number;
  /** Fades nas bordas do clipe, em ms da timeline (0 = sem fade). */
  fadeInMs: number;
  fadeOutMs: number;
  /** Vídeo/imagem: opacidade da camada (0.1–1). */
  opacity: number;
  /** Vídeo/imagem: rotação fixa e espelhar na horizontal. */
  rotation: 0 | 90 | 180 | 270;
  flipH: boolean;
  /** Título (kind "text"): conteúdo, tamanho (fração da altura do projeto),
   *  cor #rrggbb e fundo semitransparente. Posição reaproveita x/y. */
  text: string;
  textSize: number;
  textColor: string;
  textBox: boolean;
}

/** Valores default dos campos novos (útil pra criar clipes e pra migrar
 *  projetos salvos por versões antigas). */
export const CLIP_DEFAULTS = {
  speed: 1,
  fadeInMs: 0,
  fadeOutMs: 0,
  opacity: 1,
  rotation: 0 as const,
  flipH: false,
  text: "",
  textSize: 0.08,
  textColor: "#ffffff",
  textBox: false,
};

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
}

/** Duração mínima de um clipe (evita clipe de largura zero). */
export const MIN_CLIP_MS = 100;

export function clipDurMs(c: Clip): number {
  return Math.round((c.outMs - c.inMs) / c.speed);
}

/** Fonte "infinita" (imagem/título): o trim só muda a duração exibida. */
export function isFreeSource(kind: ClipKind): boolean {
  return kind === "image" || kind === "text";
}

export function clipEndMs(c: Clip): number {
  return c.startMs + clipDurMs(c);
}

/** Clipes de trilha de vídeo (vídeo/imagem/título) vs. trilha de áudio. */
export function isVideoKind(kind: ClipKind): boolean {
  return kind === "video" || kind === "image" || kind === "text";
}

/** Fim do projeto = fim do último clipe. */
export function projectDurMs(clips: Clip[]): number {
  return clips.reduce((acc, c) => Math.max(acc, clipEndMs(c)), 0);
}

/** Clipes de uma trilha, em ordem de entrada na timeline. */
export function trackClips(clips: Clip[], kind: "video" | "audio", track: number): Clip[] {
  return clips
    .filter((c) => (kind === "video" ? isVideoKind(c.kind) : c.kind === "audio") && c.track === track)
    .sort((a, b) => a.startMs - b.startMs);
}

/** Intervalo permitido pro startMs de um clipe, limitado pelos vizinhos da
 *  trilha (o clipe atual sempre cabe no próprio intervalo). */
export function freeRange(clips: Clip[], clip: Clip): [number, number] {
  const group = isVideoKind(clip.kind) ? "video" : "audio";
  const siblings = trackClips(clips, group, clip.track).filter((c) => c.id !== clip.id);
  const dur = clipDurMs(clip);
  let lo = 0;
  let hi = Number.MAX_SAFE_INTEGER;
  for (const s of siblings) {
    if (clipEndMs(s) <= clip.startMs) lo = Math.max(lo, clipEndMs(s));
    else if (s.startMs >= clipEndMs(clip)) hi = Math.min(hi, s.startMs - dur);
  }
  return [lo, hi];
}

/** Move um clipe (e o vinculado, se houver) pra perto de desiredStartMs,
 *  respeitando os vizinhos de AMBAS as trilhas. Retorna o novo array. */
export function moveClip(clips: Clip[], id: string, desiredStartMs: number): Clip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const partner = clip.linkId
    ? clips.find((c) => c.id !== id && c.linkId === clip.linkId)
    : undefined;

  // Delta permitido = interseção dos intervalos livres dos dois clipes.
  const [lo, hi] = freeRange(clips, clip);
  let dLo = lo - clip.startMs;
  let dHi = hi - clip.startMs;
  if (partner) {
    const [plo, phi] = freeRange(clips, partner);
    dLo = Math.max(dLo, plo - partner.startMs);
    dHi = Math.min(dHi, phi - partner.startMs);
  }
  const delta = Math.min(dHi, Math.max(dLo, desiredStartMs - clip.startMs));
  if (delta === 0) return clips;
  return clips.map((c) =>
    c.id === clip.id || (partner && c.id === partner.id)
      ? { ...c, startMs: c.startMs + delta }
      : c,
  );
}

/** Apara uma borda do clipe pra posição desejada NA TIMELINE (ms).
 *  Borda "in" move o início (consumindo o trim da fonte); "out" move o fim.
 *  Imagens têm fonte infinita: o trim só muda a duração exibida. */
export function trimClip(
  clips: Clip[],
  id: string,
  edge: "in" | "out",
  desiredMs: number,
): Clip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  const [lo] = freeRange(clips, clip);
  const end = clipEndMs(clip);

  if (edge === "in") {
    let newStart = Math.max(lo, Math.min(desiredMs, end - MIN_CLIP_MS));
    if (!isFreeSource(clip.kind)) {
      // Não dá pra recuar antes do início da fonte (em ms de timeline,
      // o material disponível antes do in é inMs / speed).
      newStart = Math.max(newStart, clip.startMs - clip.inMs / clip.speed);
    }
    const delta = newStart - clip.startMs;
    if (delta === 0) return clips;
    const patch = isFreeSource(clip.kind)
      ? { startMs: newStart, outMs: clip.outMs - delta }
      : { startMs: newStart, inMs: clip.inMs + delta * clip.speed };
    return clips.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  // edge === "out": hi limita o início; o fim máximo é hi + duração… mais
  // simples: o próximo vizinho limita direto o fim.
  const group = isVideoKind(clip.kind) ? "video" : "audio";
  const next = trackClips(clips, group, clip.track)
    .filter((c) => c.id !== id && c.startMs >= end)
    .sort((a, b) => a.startMs - b.startMs)[0];
  let newEnd = Math.max(clip.startMs + MIN_CLIP_MS, desiredMs);
  if (next) newEnd = Math.min(newEnd, next.startMs);
  if (!isFreeSource(clip.kind) && clip.src.durationMs > 0) {
    newEnd = Math.min(
      newEnd,
      clip.startMs + (clip.src.durationMs - clip.inMs) / clip.speed,
    );
  }
  const newOut = clip.inMs + (newEnd - clip.startMs) * clip.speed;
  if (newOut === clip.outMs) return clips;
  return clips.map((c) => (c.id === id ? { ...c, outMs: newOut } : c));
}

/** Muda a velocidade do clipe. Desacelerar alonga a duração na timeline, então
 *  a velocidade é reclamplada pro clipe não engolir o vizinho da direita. */
export function setClipSpeed(clips: Clip[], id: string, desiredSpeed: number): Clip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  let speed = Math.max(0.25, Math.min(4, desiredSpeed));
  const group = isVideoKind(clip.kind) ? "video" : "audio";
  const next = trackClips(clips, group, clip.track)
    .filter((c) => c.id !== id && c.startMs >= clipEndMs(clip))
    .sort((a, b) => a.startMs - b.startMs)[0];
  if (next) {
    const maxDur = next.startMs - clip.startMs;
    speed = Math.max(speed, (clip.outMs - clip.inMs) / maxDur);
  }
  return clips.map((c) => (c.id === id ? { ...c, speed } : c));
}

/** Divide um clipe no instante atMs da timeline (se cair dentro dele).
 *  newId nomeia a metade direita; linkIdRight permite manter o vínculo
 *  consistente quando o par também é dividido. */
export function splitClip(
  clips: Clip[],
  id: string,
  atMs: number,
  newId: string,
  linkIdRight?: string,
): Clip[] {
  const clip = clips.find((c) => c.id === id);
  if (!clip) return clips;
  if (atMs < clip.startMs + MIN_CLIP_MS || atMs > clipEndMs(clip) - MIN_CLIP_MS) return clips;
  const cutIn = clip.inMs + (atMs - clip.startMs) * clip.speed;
  // Cada metade fica só com o fade da própria borda externa.
  const left: Clip = { ...clip, outMs: cutIn, fadeOutMs: 0 };
  const right: Clip = {
    ...clip,
    id: newId,
    startMs: atMs,
    inMs: cutIn,
    fadeInMs: 0,
    linkId: linkIdRight ?? clip.linkId,
  };
  const idx = clips.findIndex((c) => c.id === id);
  const out = clips.slice();
  out.splice(idx, 1, left, right);
  return out;
}

/** Encosta value no alvo mais próximo dentro da tolerância (snap). */
export function snapMs(value: number, targets: number[], tolMs: number): number {
  let best = value;
  let bestDist = tolMs;
  for (const t of targets) {
    const d = Math.abs(t - value);
    if (d < bestDist) {
      best = t;
      bestDist = d;
    }
  }
  return best;
}

/** Bordas de todos os clipes (alvos de snap), menos as do próprio clipe. */
export function snapTargets(clips: Clip[], excludeId: string, playheadMs: number): number[] {
  const out = [0, playheadMs];
  for (const c of clips) {
    if (c.id === excludeId) continue;
    out.push(c.startMs, clipEndMs(c));
  }
  return out;
}
