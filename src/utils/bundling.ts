export interface Bundle {
  label: string;
  topics: string[];
}

export function buildBundles(topicOrder: string[], maxContentFiles = 18): Bundle[] {
  if (topicOrder.length <= maxContentFiles) {
    return topicOrder.map((topic, i) => ({
      label: `Topic_${String(i + 1).padStart(2, '0')}_${topic}`,
      topics: [topic],
    }));
  }

  const bundles: Bundle[] = [];
  const spilloverStart = maxContentFiles - 1;

  for (let i = 0; i < spilloverStart; i++) {
    bundles.push({
      label: `Topic_${String(i + 1).padStart(2, '0')}_${topicOrder[i]}`,
      topics: [topicOrder[i]],
    });
  }

  const spillover = topicOrder.slice(spilloverStart);
  bundles.push({
    label: `Topic_${String(maxContentFiles).padStart(2, '0')}_${spillover[0]}_en_meer`,
    topics: spillover,
  });

  return bundles;
}
