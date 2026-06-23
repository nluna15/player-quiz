import DailyQuiz from "./components/DailyQuiz";
import { getCountries, getDailyPlayers, getTodayDateString } from "@/lib/quiz";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string }>;
}) {
  const { seed } = await searchParams;
  const dateStr = getTodayDateString();
  // A `?seed=` param lets you load extra random quizzes for testing; without it
  // you get the deterministic daily set.
  const quizSeed = seed ?? dateStr;
  const players = getDailyPlayers(quizSeed);
  const countries = getCountries();

  return (
    <DailyQuiz
      key={quizSeed}
      players={players}
      countries={countries}
      dateStr={dateStr}
      seed={quizSeed}
    />
  );
}
