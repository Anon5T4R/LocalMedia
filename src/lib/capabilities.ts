// Catálogo ÚNICO do que o app faz — a lição do OpenObsidian v1.1.0: feature
// que só se usa sabendo que ela existe, pra quem chega, não existe. Três
// consumidores leem daqui: os botões do card (FileCard), as abas do modal
// (TaskModal) e a ajuda/tela vazia da home. Antes eram listas escritas à mão,
// e elas JÁ tinham divergido (a aba Legendas não tinha botão no card).

import type { MessageKey } from "./i18n";
import type { MediaInfo } from "./types";

/** Operação sobre um arquivo (vira botão no card E aba no modal). */
export interface TaskAction {
  id: string;
  label: MessageKey;
  /** Só faz sentido com stream de vídeo (comprimir, GIF, legendas, logo). */
  needsVideo?: boolean;
  /** Só faz sentido em arquivo SÓ de áudio — cortar silêncio num vídeo
   *  dessincronizaria a imagem (isso é trabalho de timeline, o LocalVideo). */
  audioOnly?: boolean;
}

export const TASK_ACTIONS: TaskAction[] = [
  { id: "converter", label: "action.convert" },
  { id: "comprimir", label: "action.compress", needsVideo: true },
  { id: "cortar", label: "action.cut" },
  { id: "silencio", label: "action.cutSilence", audioOnly: true },
  { id: "gif", label: "action.gif", needsVideo: true },
  { id: "legendas", label: "action.subs", needsVideo: true },
  { id: "logo", label: "action.watermark", needsVideo: true },
  { id: "esconder", label: "action.hideLogo", needsVideo: true },
  { id: "faixas", label: "action.tracks" },
  { id: "ajustes", label: "action.adjust" },
];

/** As ações que valem pra ESTE arquivo — card e modal usam o mesmo filtro. */
export function availableActions(info: MediaInfo): TaskAction[] {
  return TASK_ACTIONS.filter((a) => {
    if (a.needsVideo && !info.video) return false;
    // Cortar silêncio: só arquivo de áudio (sem vídeo pra dessincronizar) e que
    // tenha som pra limpar.
    if (a.audioOnly && (info.video || info.audio.length === 0)) return false;
    // Escolher faixas só faz sentido com mais de uma faixa pra escolher.
    if (a.id === "faixas" && info.audio.length + info.subs.length < 2) return false;
    return true;
  });
}

/** Uma capacidade do app, como aparece na ajuda e na tela vazia. */
export interface Capability {
  id: string;
  icon: string;
  label: MessageKey;
  desc: MessageKey;
  /** Como chegar lá (o conhecimento que ficava escondido). */
  how: MessageKey;
}

export const CAPABILITIES: Capability[] = [
  { id: "converter", icon: "🔄", label: "action.convert", desc: "cap.convert.desc", how: "cap.how.card" },
  { id: "comprimir", icon: "🗜️", label: "action.compress", desc: "cap.compress.desc", how: "cap.how.card" },
  { id: "cortar", icon: "✂️", label: "action.cut", desc: "cap.cut.desc", how: "cap.how.card" },
  { id: "silencio", icon: "🔈", label: "action.cutSilence", desc: "cap.cutSilence.desc", how: "cap.how.audio" },
  { id: "gif", icon: "🎞️", label: "action.gif", desc: "cap.gif.desc", how: "cap.how.card" },
  { id: "legendas", icon: "💬", label: "action.subs", desc: "cap.subs.desc", how: "cap.how.card" },
  { id: "logo", icon: "🖼️", label: "action.watermark", desc: "cap.watermark.desc", how: "cap.how.card" },
  { id: "esconder", icon: "🚫", label: "action.hideLogo", desc: "cap.hideLogo.desc", how: "cap.how.card" },
  { id: "faixas", icon: "🎚️", label: "action.tracks", desc: "cap.tracks.desc", how: "cap.how.tracks" },
  { id: "ajustes", icon: "🔧", label: "action.adjust", desc: "cap.adjust.desc", how: "cap.how.card" },
  { id: "juntar", icon: "🧩", label: "cap.join.label", desc: "cap.join.desc", how: "cap.how.select" },
  { id: "lote", icon: "📦", label: "topbar.batch", desc: "cap.batch.desc", how: "cap.how.select" },
  { id: "editor", icon: "🎬", label: "topbar.editor", desc: "cap.editor.desc", how: "cap.how.tab" },
];
