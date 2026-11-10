// app/components/Markdown.jsx: note text as Markdown, drawn as Mantine components from marked's token tree. Nothing is
// ever written as HTML: a raw HTML tag in the source shows as plain text, an image shows as its alt text, and a link
// is live only for an https address (anything else is plain text). marked only lexes; React escapes what it draws.
import { Anchor, Code, List, Stack, Text } from "@mantine/core";
import { Lexer } from "marked";

export function safeHref(href) {
  try {
    var u = new URL(String(href));
    return u.protocol === "https:" ? u.href : null;
  } catch (e) { return null; }
}

function inline(tokens, key) {
  return (tokens || []).map((t, i) => {
    var k = key + "." + i, kids = t.tokens ? inline(t.tokens, k) : t.text;
    if (t.type === "strong") return <strong key={k}>{kids}</strong>;
    if (t.type === "em") return <em key={k}>{kids}</em>;
    if (t.type === "del") return <s key={k}>{kids}</s>;
    if (t.type === "codespan") return <code key={k}>{t.text}</code>;
    if (t.type === "br") return <br key={k} />;
    if (t.type === "image") return t.text || "";
    if (t.type === "link") {
      var href = safeHref(t.href);
      return href ? <Anchor key={k} href={href} target="_blank" rel="noopener noreferrer">{kids}</Anchor> : <span key={k}>{kids}</span>;
    }
    return <span key={k}>{t.type === "text" && t.tokens ? kids : (t.text !== undefined ? t.text : t.raw)}</span>;
  });
}

function block(tokens, key, clamp) {
  return (tokens || []).map((t, i) => {
    var k = key + "." + i;
    if (t.type === "space" || t.type === "hr") return null;
    if (t.type === "heading") return <Text key={k} size="sm" fw={700} lineClamp={clamp}>{inline(t.tokens, k)}</Text>;
    if (t.type === "list") {
      return (
        <List key={k} size="sm" type={t.ordered ? "ordered" : "unordered"} withPadding>
          {t.items.map((it, j) => <List.Item key={k + "." + j}>{block(it.tokens, k + "." + j, clamp)}</List.Item>)}
        </List>
      );
    }
    if (t.type === "blockquote") return <Stack key={k} gap={4} pl="xs">{block(t.tokens, k, clamp)}</Stack>;
    if (t.type === "code") return <Code key={k} block>{t.text}</Code>;
    if (t.tokens) return <Text key={k} size="sm" lineClamp={clamp}>{inline(t.tokens, k)}</Text>;
    return <Text key={k} size="sm">{t.text !== undefined ? t.text : t.raw}</Text>;
  });
}

// clamp: show at most this many lines per paragraph (a card in a long list); omit to show it all.
export default function Markdown({ text, clamp }) {
  return <Stack gap={4}>{block(new Lexer().lex(String(text || "")), "m", clamp)}</Stack>;
}
