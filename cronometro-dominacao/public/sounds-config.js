/*
  EFEITOS SONOROS DO CRONÔMETRO DE DOMINAÇÃO
  ------------------------------------------
  Este é o arquivo para mudar os sons. Salve, publique de novo e recarregue as telas.

  Cada evento pode ter até três coisas, todas opcionais:
    tones          sequência de bipes: [frequência em Hz, duração em segundos, atraso em segundos]
    file           arquivo de áudio da pasta public/sounds (ex.: "sounds/captura.mp3")
    say / sayWithPlayer   frase falada pela voz do aparelho. Pode usar:
                     {ponto}    nome do ponto         {equipe}   nome da equipe
                     {jogador}  nome digitado no celular do ponto
                   sayWithPlayer só é usada quando o jogador digitou o nome; senão vale "say".

  Para apagar um efeito, troque o valor por null (ou apague a linha).
  Para não falar nada, deixe say: null.
*/
window.SOUNDS_CONFIG = {
  volume: 0.8,                       // 0 (mudo) a 1 (máximo)

  // Em quais telas os sons tocam. Ex.: coloque false em "placar" se a tela só serve para olhar.
  playOn: { admin: true, terminal: true, placar: true },

  // Voz que fala as frases. Usa a voz instalada no aparelho.
  speech: { enabled: true, lang: "pt-BR", rate: 1, pitch: 1 },

  events: {
    // Um ponto foi dominado
    capture: {
      wave: "square",
      tones: [[660, 0.12, 0], [880, 0.12, 0.13], [1175, 0.22, 0.26]],
      file: null,
      say: "{ponto} dominado pela equipe {equipe}",
      sayWithPlayer: "{ponto} dominado por {jogador}, da equipe {equipe}",
      sayDelayMs: 600,
    },

    // Partida começou (primeira vez)
    start: {
      wave: "square",
      tones: [[660, 0.15, 0], [880, 0.25, 0.2]],
      file: null,
      say: "Partida iniciada",
    },

    // Partida voltou depois de uma pausa
    resume: { wave: "square", tones: [[660, 0.15, 0]], file: null, say: "Partida retomada" },

    // Partida pausada
    pause: { wave: "square", tones: [[440, 0.2, 0]], file: null, say: "Partida pausada" },

    // Falta 1 minuto
    oneMinute: {
      wave: "square",
      tones: [[740, 0.15, 0], [740, 0.15, 0.25]],
      file: null,
      say: "Falta um minuto",
    },

    // Fim da partida
    end: {
      wave: "square",
      tones: [[520, 0.4, 0], [520, 0.4, 0.5], [780, 0.7, 1.0]],
      file: null,
      say: "Partida encerrada",
      sayDelayMs: 1800,
    },

    // Partida zerada (sem som por padrão)
    reset: null,
  },
};
