export type ShareEntry = { correct: boolean };

const SHARE_URL = "where-you-from.com";

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
  const { puzzleNumber, correctCount, totalPlayers, score, entries } = opts;

  const grid = buildShareGrid(entries);

  const defaultLines = [
    `I got ${correctCount}/${totalPlayers} · ${score} pts in Where You From? #${puzzleNumber} 🌎`,
    grid,
    `Can you guess each player's country and go ${totalPlayers}/${totalPlayers}?`,
    SHARE_URL,
  ];

  return defaultLines.join("\n");
}
