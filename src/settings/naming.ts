export function downloadNameExample(pattern: string): string {
  const author = "Ursula K. Le Guin";
  const title = "The Left Hand of Darkness";
  const year = "1969";
  const stem = pattern.replace(
    /\{(author|title|year)\}/g,
    (_match, token: string) =>
      token === "author" ? author : token === "title" ? title : year,
  );
  const cleaned = stem
    .replace("()", "")
    .replace("[]", "")
    .replace("{}", "")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned || "Untitled"}.epub`;
}

