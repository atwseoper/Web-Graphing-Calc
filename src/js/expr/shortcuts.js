// Typing shortcuts for symbols that are hard to type on a computer keyboard:
// "theta" -> θ, "pi" -> π, "<=" -> ≤, ">=" -> ≥, replaced as soon as they are typed.
// A word is only replaced when it isn't the end of a longer word ("spin" stays).

const RULES = [
  [/(?<!\p{L})theta$/iu, 'θ'],
  [/(?<!\p{L})pi$/iu, 'π'],
  [/<=$/, '≤'],
  [/>=$/, '≥'],
];

// text: everything before the caret. Returns { start, replacement } or null.
export function symbolShortcut(text) {
  for (const [re, replacement] of RULES) {
    const m = re.exec(text);
    if (m) return { start: m.index, replacement };
  }
  return null;
}
