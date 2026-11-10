import { cleanup, render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach, expect, test } from "vitest";
import Markdown, { safeHref } from "../app/components/Markdown.jsx";

afterEach(cleanup);
function draw(text) {
  return render(<MantineProvider><Markdown text={text} /></MantineProvider>).container;
}

test("headings, bold and lists are drawn, and no markdown syntax is left in the text", () => {
  var c = draw("## Heading\n\nSays **GMP certified** here.\n\n- one\n- two");
  expect(c.textContent).not.toMatch(/##|\*\*/);
  expect(c.querySelector("strong").textContent).toBe("GMP certified");
  expect(c.querySelectorAll("li").length).toBe(2);
  expect(c.textContent).toContain("Heading");
});

test("raw HTML is shown as text, never made into elements", () => {
  var c = draw('<img src=x onerror="alert(1)"> and <script>alert(1)</script> <b>bold</b>');
  expect(c.querySelector("img")).toBeNull();
  expect(c.querySelector("script")).toBeNull();
  expect(c.querySelector("b")).toBeNull();
  expect(c.textContent).toContain("<b>");
});

test("links are live only for https, and open safely", () => {
  var c = draw("[ok](https://example.com/a) [bad](javascript:alert(1)) [web](http://example.com) [data](data:text/html,x)");
  var links = c.querySelectorAll("a");
  expect(links.length).toBe(1);
  expect(links[0].getAttribute("href")).toBe("https://example.com/a");
  expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
  expect(c.textContent).toContain("bad");
  expect(safeHref("javascript:alert(1)")).toBeNull();
  expect(safeHref("//evil.example")).toBeNull();
  expect(safeHref("https://a.example/x")).toBe("https://a.example/x");
});

test("an image in the source draws no img element", () => {
  var c = draw("![alt words](https://example.com/x.png)");
  expect(c.querySelector("img")).toBeNull();
  expect(c.textContent).toContain("alt words");
});

test("an empty or missing text draws nothing and does not throw", () => {
  expect(draw("").querySelectorAll("p, li").length).toBe(0);
  expect(draw(undefined).querySelectorAll("p, li").length).toBe(0);
});
