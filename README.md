# LocalMedia

**Conversor, cortador e editor de vídeo/áudio 100% offline.** Tudo que você resolveria num
"site de conversão" — converter, comprimir, cortar, extrair áudio, fazer GIF — mais um
**editor de timeline multi-faixa**, rodando na sua máquina com ffmpeg embutido. Nenhum
arquivo sai do seu computador.

Parte da suíte **Local/Taylor** de aplicativos offline-first. Instale pelo
[TaylorHub](https://github.com/Anon5T4R/TaylorHub) ou baixe o instalador na
[última release](https://github.com/Anon5T4R/LocalMedia/releases/latest).

## O que ele faz

- **Converter** com presets prontos: vídeo pra web (MP4/H.264 + faststart), compatível com
  WhatsApp, WebM/VP9, troca de container sem recodificar, só o áudio (MP3/Opus) e
  **áudio pra transcrição** (WAV 16 kHz mono — o formato do
  [LocalScribe](https://github.com/Anon5T4R/LocalScribe)).
- **Comprimir por qualidade** (CRF com slider e estimativa de tamanho).
- **Cortar por trecho** com timeline de miniaturas, preview e campos de tempo precisos.
  Regra de ouro: sem troca de codec o corte usa `-c copy` — **instantâneo e sem perda**.
- **Juntar clipes** do mesmo formato (concat demuxer, sem recodificar).
- **GIF de trecho** em 2 passes (palettegen/paletteuse — cores muito melhores).
- **Faixas**: remover/escolher áudios e legendas de um MKV/MP4 sem recodificar.
- **Ajustes**: redimensionar, rotacionar e **normalizar volume** (loudnorm EBU R128).
- **Lote**: o mesmo preset aplicado em N arquivos de uma vez.
- **Fila com progresso real** (ffmpeg `-progress` estruturado), velocidade e cancelamento.
- Arraste arquivos pra janela; tema claro/escuro; interface em português.

## Editor (timeline multi-faixa)

A aba **Editor** monta um projeto com vídeos, imagens e áudios juntos:

- **Trilhas de vídeo em camadas** (V1 embaixo, V2+ por cima): marca-d'água,
  picture-in-picture e sobreposições, com posição e tamanho livres.
- **Faixas extras de áudio** (A1–A4): música de fundo, narração etc., cada clipe com o
  próprio volume e mudo.
- **Vídeo com som entra como par vinculado** (🔗 V+A): dá pra **desvincular** e cortar,
  dividir ou apagar um trecho **só do áudio ou só do vídeo**.
- **Imagens** (PNG/JPEG/WebP/BMP) viram clipes de duração livre.
- **Títulos** (＋ Texto): texto por cima do vídeo com tamanho, cor, posição e fundo.
- Por clipe: **velocidade** (0.25×–4×, com áudio corrigido), **fade in/out**,
  **opacidade**, **rotação** e **espelhar**.
- Timeline com arrastar, aparar pelas bordas, dividir no cursor (S), duplicar (Ctrl+D),
  snap, zoom (Ctrl+roda), desfazer/refazer, miniaturas nos clipes e preview com
  play/scrub (setas movem o cursor).
- **Projeto salva e abre** (.json) e um rascunho automático segura a timeline se o app
  fechar.
- **Exportar** gera um MP4 (H.264/AAC, qualidade selecionável) pela fila normal, com
  progresso e cancelamento — a composição inteira vira um único `filter_complex` do
  ffmpeg.

## Como usar

1. Instale e abra o app.
2. Arraste arquivos de vídeo/áudio pra janela (ou **+ Abrir mídia**).
3. No card do arquivo, escolha a operação (Converter / Comprimir / Cortar / GIF / Faixas /
   Ajustes), configure e escolha onde salvar.
4. Acompanhe a fila; ao terminar, **Mostrar na pasta**.

> Pra juntar clipes ou converter vários de uma vez, marque os arquivos pelo checkbox da
> miniatura.

## Desenvolvimento

Stack: Tauri 2 + React 19 + Vite + TypeScript (front) e Rust (back). Porta dev **1446**.
Sem IA de propósito — é um utilitário.

```bash
npm install
# runtime local (uma vez): ffmpeg + ffprobe em src-tauri/binaries/ffmpeg
powershell -ExecutionPolicy Bypass -File scripts/fetch-ffmpeg.ps1   # Windows
bash scripts/fetch-ffmpeg.sh                                        # Linux

npm run tauri dev
npm test          # vitest (front); cargo test roda no CI
```

Release: bump de versão em `package.json` + `src-tauri/tauri.conf.json` +
`src-tauri/Cargo.toml`, tag `vX.Y.Z`, push — o GitHub Actions builda (Windows NSIS + Linux
AppImage) e publica.

## Créditos e licença

- [FFmpeg](https://ffmpeg.org) faz o trabalho pesado — embutimos os builds GPL do
  [BtbN](https://github.com/BtbN/FFmpeg-Builds) (Windows) e do
  [John Van Sickle](https://johnvansickle.com/ffmpeg/) (Linux). O FFmpeg é licenciado sob
  GPL/LGPL; o código deste app é [MIT](LICENSE) e o conjunto distribuído respeita a GPL dos
  binários do FFmpeg.
