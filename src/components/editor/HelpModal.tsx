// Ajuda do editor (botão ? / F1): atalhos de teclado e dicas de uso.

import { useUi } from "../../state/ui";

const SHORTCUTS: [string, string][] = [
  ["Espaço", "reproduzir / pausar"],
  ["S", "dividir o clipe selecionado no cursor"],
  ["Delete", "remover o clipe selecionado"],
  ["Shift+Delete", "remover e fechar o buraco (ripple)"],
  ["Ctrl+C / Ctrl+V", "copiar / colar no cursor"],
  ["Ctrl+D", "duplicar o clipe"],
  ["Ctrl+Z / Ctrl+Shift+Z", "desfazer / refazer"],
  ["← / → (Shift = 1 s)", "mover o cursor"],
  ["Home / End", "início / fim do projeto"],
  ["Ctrl+roda do mouse", "zoom na timeline"],
  ["Esc", "desmarcar / fechar"],
  ["? ou F1", "esta ajuda"],
];

const TIPS: string[] = [
  "Vídeo com som entra como um par vinculado (🔗): mover um move o outro. Use “Desvincular” pra cortar, dividir ou apagar um trecho só do áudio ou só do vídeo.",
  "As camadas V2+ ficam por cima do V1 — perfeitas pra picture-in-picture, marca-d'água e títulos. Arraste a camada direto no preview pra posicionar; a alça laranja redimensiona.",
  "Dá pra soltar arquivos direto na trilha e no tempo certos (a música na A2 aos 0:30, por exemplo). Sem mirar, os padrões ajudam: imagem vira camada por cima no cursor; música cai numa faixa livre em cima do som do vídeo.",
  "Nos cabeçalhos das trilhas: 👁 oculta a camada de vídeo; M silencia a faixa; S (solo) deixa só as faixas em solo tocando. Tudo vale pro preview E pra exportação.",
  "🧲 liga/desliga o snap (os clipes grudam nas bordas vizinhas e no cursor). ⤢ ajusta o zoom pro projeto inteiro.",
  "＋ Texto põe um título por cima do vídeo — edite conteúdo, cor, tamanho e fundo no painel da direita.",
  "Velocidade, fades, opacidade, rotação e espelhar ficam no painel da direita com o clipe selecionado.",
  "O projeto se salva sozinho como rascunho (volta ao abrir o app). 💾 salva num arquivo .json pra guardar ou levar; 📂 abre.",
  "A exportação junta tudo num MP4 (H.264/AAC) — escolha a qualidade no painel do projeto (sem clipe selecionado).",
];

export default function HelpModal() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Ajuda do editor</h2>
          <button className="icon-btn" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
        <div className="help-cols">
          <div>
            <div className="track-title">Atalhos</div>
            <table className="help-keys">
              <tbody>
                {SHORTCUTS.map(([k, desc]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <div className="track-title">Dicas</div>
            <ul className="help-tips">
              {TIPS.map((t) => (
                <li key={t.slice(0, 24)}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
