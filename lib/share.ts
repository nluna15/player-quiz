export type ShareEntry = { correct: boolean };

const SHARE_URL = "where-you-from.com";
const X_CHAR_LIMIT = 280;

export function shareEntrySymbol(entry: ShareEntry): string {
  return entry.correct ? "⚽" : "🧤";
}

export function buildShareGrid(entries: ShareEntry[]): string {
  return entries.map(shareEntrySymbol).join(" · ");
}

export function buildShareText(opts: {
  puzzleNumber: number;
  correctCount: number;
  totalPlayers: number;
  score: number;
  entries: ShareEntry[];
  platform?: "default" | "x";
}): string {
  const {
    puzzleNumber,
    correctCount,
    totalPlayers,
    score,
    entries,
    platform = "default",
  } = opts;

  const grid = buildShareGrid(entries);

  const defaultLines = [
    `I got ${correctCount}/${totalPlayers} · ${score} pts in Where You From? #${puzzleNumber} 🌎`,
    grid,
    `Can you guess each player's country and go ${totalPlayers}/${totalPlayers}?`,
    SHARE_URL,
  ];

  const xTightLines = [
    `I got ${correctCount}/${totalPlayers} · ${score} pts — Where You From? #${puzzleNumber} 🌎`,
    grid,
    `Guess each player's country. Go ${totalPlayers}/${totalPlayers}?`,
    SHARE_URL,
  ];

  if (platform === "x") {
    const defaultText = defaultLines.join("\n");
    if (defaultText.length > X_CHAR_LIMIT) {
      return xTightLines.join("\n");
    }
    return defaultText;
  }

  return defaultLines.join("\n");
}
