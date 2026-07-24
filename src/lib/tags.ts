export function normalizeTagList(tags: string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function tagListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
