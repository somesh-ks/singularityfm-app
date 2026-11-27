/**
 * The general topics Search offers as tiles (owner, 12 Nov canvas: "general topics only"). `query` is
 * the Podcast Index category the trending route is asked for; the name is what the tile says.
 */
export interface BrowseTopic {
  name: string;
  query: string;
}

export const BROWSE_TOPICS: readonly BrowseTopic[] = [
  { name: "Technology", query: "Technology" },
  { name: "Business", query: "Business" },
  { name: "Science", query: "Science" },
  { name: "Design", query: "Design" },
  { name: "News", query: "News" },
  { name: "Society and culture", query: "Society" },
];

/** A topic's page; without a topic, the page lists the top shows of every topic. */
export function topicHref(topic?: BrowseTopic): string {
  return topic ? `/topic?name=${encodeURIComponent(topic.name)}` : "/topic";
}

/** The topic a page address names, or undefined for the top shows of every topic. */
export function topicNamed(name: string | null): BrowseTopic | undefined {
  return BROWSE_TOPICS.find((topic) => topic.name === name);
}
